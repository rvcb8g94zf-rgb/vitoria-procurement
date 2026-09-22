import "server-only";
import { createClient } from "@supabase/supabase-js";
import { consultarDistribuicao, type Environment } from "./dfe-client";
import { extrair, extrairEvento } from "./parser";

/**
 * Orquestração de uma execução do coletor para uma empresa.
 *
 * Regras que governam o fluxo:
 *  • cStat 137 = sem mais documentos. Consultar de novo em menos de 1h
 *    gera rejeição 656 e bloqueia o CNPJ. Gravamos blocked_until.
 *  • cStat 656 = já bloqueado. Recuar 1h e não insistir.
 *  • O cursor só avança depois que os documentos do lote foram gravados.
 *    Falha no meio significa reprocessar, nunca perder documento.
 *  • Resumo e XML completo da mesma chave são o mesmo registro.
 */

const CSTAT_LOTE = "138";       // documentos localizados
const CSTAT_VAZIO = "137";      // nenhum documento
const CSTAT_CONSUMO = "656";    // consumo indevido

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export interface ResultadoSync {
  status: "concluida" | "sem_novidade" | "bloqueada" | "erro" | "ignorada";
  cStat?: string;
  mensagem?: string;
  novas?: number;
  enriquecidas?: number;
}

export async function sincronizarEmpresa(
  companyId: string,
  gatilho: "cron" | "manual",
  owner: string
): Promise<ResultadoSync> {
  const db = admin();

  const { data: conn } = await db
    .from("fiscal_connections")
    .select("*")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .maybeSingle();

  if (!conn) return { status: "ignorada", mensagem: "Sem conexão fiscal ativa." };

  const env = conn.environment as Environment;

  const { data: travou } = await db.rpc("dfe_acquire_lock", {
    _company_id: companyId, _env: env, _owner: owner,
  });
  if (!travou) return { status: "ignorada", mensagem: "Outra execução em andamento ou CNPJ bloqueado." };

  const { data: run } = await db
    .from("dfe_sync_runs")
    .insert({ company_id: companyId, environment: env, trigger: gatilho })
    .select("id")
    .single();

  const encerrar = async (patch: Record<string, unknown>) => {
    await db.from("dfe_sync_runs").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", run!.id);
    await db.rpc("dfe_release_lock", { _company_id: companyId, _env: env });
  };

  try {
    const { data: estado } = await db
      .from("dfe_sync_state")
      .select("ult_nsu")
      .eq("company_id", companyId).eq("environment", env)
      .maybeSingle();

    const ultNSU = String(estado?.ult_nsu ?? 0);

    const [pfx, senha] = await Promise.all([
      baixarCertificado(db, conn.cert_storage_path),
      lerSenha(db, conn.cert_secret_name),
    ]);

    const r = await consultarDistribuicao({
      environment: env,
      cnpj: await cnpjDaEmpresa(db, companyId),
      ufCode: conn.uf_code,
      ultNSU,
      pfx,
      passphrase: senha,
    });

    if (r.cStat === CSTAT_CONSUMO) {
      await db.from("dfe_sync_state").update({
        last_cstat: r.cStat, last_message: r.xMotivo, last_run_at: new Date().toISOString(),
        blocked_until: new Date(Date.now() + 65 * 60_000).toISOString(),
      }).eq("company_id", companyId).eq("environment", env);
      await encerrar({ status: "bloqueada", cstat: r.cStat, message: r.xMotivo });
      return { status: "bloqueada", cStat: r.cStat, mensagem: r.xMotivo };
    }

    if (r.cStat === CSTAT_VAZIO) {
      // Nova consulta dentro de 1h após 137 gera 656. Guardamos a espera.
      await db.from("dfe_sync_state").update({
        last_cstat: r.cStat, last_message: r.xMotivo, last_run_at: new Date().toISOString(),
        blocked_until: new Date(Date.now() + 61 * 60_000).toISOString(),
      }).eq("company_id", companyId).eq("environment", env);
      await encerrar({ status: "sem_novidade", cstat: r.cStat, message: r.xMotivo, from_nsu: Number(ultNSU) });
      return { status: "sem_novidade", cStat: r.cStat };
    }

    if (r.cStat !== CSTAT_LOTE) {
      await encerrar({ status: "erro", cstat: r.cStat, message: r.xMotivo });
      return { status: "erro", cStat: r.cStat, mensagem: r.xMotivo };
    }

    let novas = 0, enriquecidas = 0;
    for (const doc of r.docs) {
      const evento = doc.schema.toLowerCase().includes("evento");
      if (evento) { await gravarEvento(db, companyId, env, doc); continue; }
      const res = await gravarNota(db, companyId, env, doc);
      if (res === "nova") novas += 1;
      if (res === "enriquecida") enriquecidas += 1;
    }

    // Cursor avança só agora, com tudo persistido.
    await db.from("dfe_sync_state").update({
      ult_nsu: Number(r.ultNSU), max_nsu: Number(r.maxNSU),
      last_cstat: r.cStat, last_message: r.xMotivo,
      last_run_at: new Date().toISOString(), blocked_until: null,
    }).eq("company_id", companyId).eq("environment", env);

    await encerrar({
      status: "concluida", cstat: r.cStat, message: r.xMotivo,
      docs_returned: r.docs.length, new_invoices: novas, enriched: enriquecidas,
      from_nsu: Number(ultNSU), to_nsu: Number(r.ultNSU),
    });

    return { status: "concluida", cStat: r.cStat, novas, enriquecidas };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha desconhecida";
    await encerrar({ status: "erro", message: msg });
    return { status: "erro", mensagem: msg };
  }
}

async function cnpjDaEmpresa(db: ReturnType<typeof admin>, companyId: string) {
  const { data } = await db.from("companies").select("cnpj").eq("id", companyId).single();
  return data!.cnpj as string;
}

async function baixarCertificado(db: ReturnType<typeof admin>, path: string | null) {
  if (!path) throw new Error("Certificado não configurado.");
  const { data, error } = await db.storage.from("fiscal").download(path);
  if (error || !data) throw new Error("Não foi possível ler o certificado.");
  return Buffer.from(await data.arrayBuffer());
}

async function lerSenha(db: ReturnType<typeof admin>, secretName: string | null) {
  if (!secretName) throw new Error("Senha do certificado não configurada.");
  const { data, error } = await db.rpc("read_fiscal_secret", { _name: secretName });
  if (error || !data) throw new Error("Não foi possível ler a senha do certificado.");
  return data as string;
}

async function gravarEvento(db: ReturnType<typeof admin>, companyId: string, env: string, doc: { nsu: string; xml: string }) {
  const ev = extrairEvento(doc.xml);
  if (!ev) return;

  await db.from("fiscal_events").upsert({
    company_id: companyId, environment: env, access_key: ev.accessKey,
    event_type: ev.eventType, sequence: ev.sequence,
    occurred_at: ev.occurredAt, nsu: Number(doc.nsu), description: ev.description,
  }, { onConflict: "company_id,environment,access_key,event_type,sequence" });

  // 110111 = cancelamento. Cancelada nunca volta para autorizada por
  // evento atrasado, então só marcamos, nunca revertemos.
  if (ev.eventType === "110111") {
    await db.from("received_invoices")
      .update({ fiscal_status: "cancelada", cancelled_at: ev.occurredAt })
      .eq("company_id", companyId).eq("environment", env).eq("access_key", ev.accessKey);
  }
}

async function gravarNota(
  db: ReturnType<typeof admin>, companyId: string, env: string,
  doc: { nsu: string; schema: string; xml: string }
): Promise<"nova" | "enriquecida" | "ignorada"> {
  const n = extrair(doc.xml, doc.schema);
  if (!n) return "ignorada";

  const { data: existente } = await db
    .from("received_invoices")
    .select("id, doc_kind, fiscal_status")
    .eq("company_id", companyId).eq("environment", env).eq("access_key", n.accessKey)
    .maybeSingle();

  // resumo que chega depois do completo não rebaixa o registro
  if (existente && existente.doc_kind === "completo" && n.kind === "resumo") return "ignorada";

  const xmlPath = `${companyId}/dfe/${n.accessKey.slice(2, 6)}/${n.accessKey}.xml`;
  if (n.kind === "completo") {
    await db.storage.from("fiscal").upload(xmlPath, new Blob([doc.xml], { type: "application/xml" }), { upsert: true });
  }

  const registro = {
    company_id: companyId, environment: env, access_key: n.accessKey,
    nsu: Number(doc.nsu), doc_kind: n.kind,
    emitter_cnpj: n.emitterCnpj ?? "", emitter_name: n.emitterName, emitter_ie: n.emitterIe,
    number: n.number, series: n.series, issued_at: n.issuedAt,
    total_amount: n.totalAmount, protocol: n.protocol, item_count: n.itemCount,
    ...(n.kind === "completo" ? { xml_path: xmlPath, completed_at: new Date().toISOString() } : {}),
  };

  const { data: salvo } = await db
    .from("received_invoices")
    .upsert(registro, { onConflict: "company_id,environment,access_key" })
    .select("id")
    .single();

  // Duplicatas só existem no XML completo. Reprocessar não duplica:
  // a chave (invoice_id, seq) resolve por upsert.
  if (n.duplicates && n.duplicates.length > 0 && salvo) {
    await db.from("received_invoice_duplicates").upsert(
      n.duplicates.map((d) => ({
        company_id: companyId, invoice_id: salvo.id, seq: d.seq,
        number: d.number, due_date: d.dueDate, amount: d.amount,
      })),
      { onConflict: "invoice_id,seq" }
    );
  }

  // vincula ao fornecedor por CNPJ, nunca por semelhança de nome
  if (n.emitterCnpj && salvo) {
    const { data: forn } = await db
      .from("suppliers").select("id")
      .eq("company_id", companyId).eq("doc_number", n.emitterCnpj)
      .maybeSingle();
    if (forn) await db.from("received_invoices").update({ supplier_id: forn.id }).eq("id", salvo.id);
  }

  if (!existente) return "nova";
  return existente.doc_kind === "resumo" && n.kind === "completo" ? "enriquecida" : "ignorada";
}
