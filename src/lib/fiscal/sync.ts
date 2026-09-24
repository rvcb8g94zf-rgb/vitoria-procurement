import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { consultarDistribuicao, ErroSefaz, type Environment } from "./dfe-client";
import { abrirCertificado, ErroCertificado } from "./certificado";

/**
 * Uma execução do coletor para uma empresa.
 *
 * CAUTELA (decisão de 24/09/2026): a contabilidade também consulta a
 * distribuição destes CNPJs. A SEFAZ conta as consultas por CNPJ, então:
 *  • automático: no máximo uma vez a cada 12 h (o agendamento é diário);
 *  • manual: só se a última consulta tiver mais de 1 h;
 *  • cStat 137 (nada novo) ou ultNSU = maxNSU → espera 1 h (regra da SEFAZ);
 *  • cStat 656 (consumo indevido) → para na hora e espera 65 min;
 *  • o cursor (ultNSU) só avança depois que os documentos do lote foram
 *    gravados — falha no meio é reprocessar, nunca perder documento;
 *  • o sistema só LÊ: nenhuma manifestação é enviada daqui.
 */
const CSTAT_LOTE = "138";
const CSTAT_VAZIO = "137";
const CSTAT_CONSUMO = "656";

const INTERVALO_MANUAL_MIN = 60;
const INTERVALO_AUTO_MIN = 12 * 60;
const MAX_LOTES = 6;          // até ~300 documentos por execução
const PRAZO_MS = 40_000;      // folga dentro dos 60 s da função
const BUCKET_CERT = "fiscal-certs";

export const nomeSegredo = (companyId: string) => `dfe_cert_${companyId.replace(/-/g, "")}`;
export const caminhoCertificado = (companyId: string) => `${companyId}/a1.pfx`;

export function admin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    throw new Error("A chave de serviço do Supabase (SUPABASE_SERVICE_ROLE_KEY) não está configurada no servidor.");
  }
  return createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
}

export interface ResultadoSync {
  status: "concluida" | "sem_novidade" | "bloqueada" | "erro" | "ignorada" | "aguardando";
  mensagem: string;
  cStat?: string;
  novas?: number;
  enriquecidas?: number;
  resumos?: number;
  eventos?: number;
  lotes?: number;
  proximaEm?: string;
}

const agoraMais = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
const hora = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeStyle: "short", dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(iso));

export async function sincronizarEmpresa(
  companyId: string,
  gatilho: "cron" | "manual",
  opts: { endpoint?: string; prazoMs?: number } = {}
): Promise<ResultadoSync> {
  const db = admin();

  const { data: conn } = await db
    .from("fiscal_connections")
    .select("environment, uf_code, cert_storage_path, cert_secret_name")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .maybeSingle();
  if (!conn?.cert_storage_path || !conn?.cert_secret_name) {
    return { status: "ignorada", mensagem: "Nenhum certificado configurado para esta empresa." };
  }
  const env = conn.environment as Environment;

  // ---- cautela: intervalo mínimo e bloqueio da SEFAZ -------------------
  const { data: estado } = await db
    .from("dfe_sync_state")
    .select("ult_nsu, last_run_at, blocked_until")
    .eq("company_id", companyId).eq("environment", env)
    .maybeSingle();

  if (estado?.blocked_until && new Date(estado.blocked_until) > new Date()) {
    return { status: "aguardando", mensagem: `A SEFAZ pede espera até ${hora(estado.blocked_until)}.`, proximaEm: estado.blocked_until };
  }
  if (estado?.last_run_at) {
    const intervalo = gatilho === "manual" ? INTERVALO_MANUAL_MIN : INTERVALO_AUTO_MIN;
    const libera = new Date(new Date(estado.last_run_at).getTime() + intervalo * 60_000);
    if (libera > new Date()) {
      return {
        status: "aguardando",
        mensagem: `A última consulta foi às ${hora(estado.last_run_at)}. Para não conflitar com a contabilidade, a próxima fica liberada às ${hora(libera.toISOString())}.`,
        proximaEm: libera.toISOString(),
      };
    }
  }

  const { data: travou } = await db.rpc("dfe_acquire_lock", {
    _company_id: companyId, _env: env, _owner: `${gatilho}-${Date.now()}`,
  });
  if (!travou) return { status: "ignorada", mensagem: "Já existe uma consulta em andamento para esta empresa." };

  const { data: run } = await db
    .from("dfe_sync_runs")
    .insert({ company_id: companyId, environment: env, trigger: gatilho, from_nsu: Number(estado?.ult_nsu ?? 0) })
    .select("id")
    .single();

  const tot = { docs: 0, novas: 0, enriquecidas: 0, resumos: 0, eventos: 0, lotes: 0 };
  let ultNSU = String(estado?.ult_nsu ?? 0);

  // last_run_at marca uma consulta feita à SEFAZ: é o que conta para o
  // intervalo mínimo. Erro antes de chegar lá (senha, arquivo) não conta.
  const gravarEstado = (patch: Record<string, unknown>, consultou = true) =>
    db.from("dfe_sync_state")
      .update(consultou ? { ...patch, last_run_at: new Date().toISOString() } : patch)
      .eq("company_id", companyId).eq("environment", env);

  const encerrar = async (status: string, cstat: string | null, mensagem: string) => {
    if (run?.id) {
      await db.from("dfe_sync_runs").update({
        status, cstat, message: mensagem.slice(0, 500), finished_at: new Date().toISOString(),
        docs_returned: Math.min(tot.docs, 32000), new_invoices: Math.min(tot.novas, 32000),
        enriched: Math.min(tot.enriquecidas, 32000), to_nsu: Number(ultNSU),
      }).eq("id", run.id);
    }
  };

  try {
    // ---- certificado: arquivo privado + senha do cofre ----------------
    const [{ data: arquivo, error: eArq }, { data: senha, error: eSenha }, { data: emp }] = await Promise.all([
      db.storage.from(BUCKET_CERT).download(conn.cert_storage_path),
      db.rpc("read_fiscal_secret", { _name: conn.cert_secret_name }),
      db.from("companies").select("cnpj").eq("id", companyId).single(),
    ]);
    if (eArq || !arquivo) throw new Error("Não foi possível ler o arquivo do certificado.");
    if (eSenha || typeof senha !== "string") throw new Error("Não foi possível ler a senha do certificado.");
    const cert = abrirCertificado(Buffer.from(await arquivo.arrayBuffer()), senha);
    if (cert.validoAte < new Date()) throw new Error("O certificado A1 está vencido. Envie o novo na tela de consulta.");
    const cnpj = String(emp?.cnpj ?? "").replace(/\D/g, "");

    const inicio = Date.now();
    let status: ResultadoSync["status"] = "sem_novidade";
    let cStat = "";
    let mensagem = "";

    const prazo = opts.prazoMs ?? PRAZO_MS;
    while (tot.lotes < MAX_LOTES && Date.now() - inicio < prazo) {
      const r = await consultarDistribuicao({
        environment: env, cnpj, ufCode: conn.uf_code ?? 35, ultNSU,
        keyPem: cert.keyPem, certPem: cert.certPem, cadeiaPem: cert.cadeiaPem,
        endpoint: opts.endpoint, timeoutMs: 15_000,
      });
      tot.lotes += 1;
      cStat = r.cStat;
      mensagem = r.xMotivo;

      if (r.cStat === CSTAT_CONSUMO) {
        await gravarEstado({ last_cstat: r.cStat, last_message: r.xMotivo, blocked_until: agoraMais(65) });
        status = "bloqueada";
        break;
      }

      if (r.cStat === CSTAT_VAZIO) {
        await gravarEstado({
          last_cstat: r.cStat, last_message: r.xMotivo, blocked_until: agoraMais(61),
          ...(r.maxNSU ? { max_nsu: Number(r.maxNSU) } : {}),
        });
        status = tot.lotes > 1 ? "concluida" : "sem_novidade";
        break;
      }

      if (r.cStat !== CSTAT_LOTE) {
        await gravarEstado({ last_cstat: r.cStat, last_message: r.xMotivo });
        status = "erro";
        break;
      }

      // grava um por um; se algum falhar por rede, o cursor não anda
      for (const doc of r.docs) {
        const { data: res, error } = await db.rpc("dfe_ingest", {
          _company_id: companyId, _env: env, _nsu: Number(doc.nsu), _schema: doc.schema, _xml: doc.xml,
        });
        if (error) throw new Error(`Falha ao gravar o documento NSU ${doc.nsu}.`);
        tot.docs += 1;
        const resultado = (res as { resultado?: string })?.resultado;
        if (resultado === "nova") tot.novas += 1;
        else if (resultado === "enriquecida") tot.enriquecidas += 1;
        else if (resultado === "resumo") tot.resumos += 1;
        else if (resultado === "evento") tot.eventos += 1;
      }

      ultNSU = r.ultNSU || ultNSU;
      const acabou = !r.maxNSU || Number(r.ultNSU) >= Number(r.maxNSU);
      await gravarEstado({
        ult_nsu: Number(ultNSU), max_nsu: Number(r.maxNSU || ultNSU),
        last_cstat: r.cStat, last_message: r.xMotivo,
        // ultNSU = maxNSU: a SEFAZ não tem mais nada; nova consulta só em 1 h
        blocked_until: acabou ? agoraMais(61) : null,
      });
      status = "concluida";
      if (acabou) break;
    }

    const resumo =
      status === "bloqueada" ? `A SEFAZ bloqueou a consulta por 1 hora (${mensagem}). Provável consulta simultânea da contabilidade.`
      : status === "erro" ? `A SEFAZ respondeu ${cStat}: ${mensagem}`
      : status === "sem_novidade" ? "Nenhum documento novo na SEFAZ."
      : `${tot.novas} ${tot.novas === 1 ? "nota nova" : "notas novas"}, ${tot.enriquecidas} ${tot.enriquecidas === 1 ? "completada" : "completadas"}, ` +
        `${tot.resumos} ${tot.resumos === 1 ? "resumo" : "resumos"} e ${tot.eventos} ${tot.eventos === 1 ? "evento" : "eventos"}.`;

    await encerrar(status, cStat || null, resumo);
    return { status, mensagem: resumo, cStat, ...tot };
  } catch (e) {
    const msg =
      e instanceof ErroCertificado || e instanceof ErroSefaz || e instanceof Error ? e.message : "Falha desconhecida.";
    await gravarEstado({ last_message: msg.slice(0, 300) }, e instanceof ErroSefaz || tot.lotes > 0);
    await encerrar("erro", null, msg);
    return { status: "erro", mensagem: msg, ...tot };
  } finally {
    await db.rpc("dfe_release_lock", { _company_id: companyId, _env: env });
  }
}
