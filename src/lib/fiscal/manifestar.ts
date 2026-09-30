import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { abrirCertificado, ErroCertificado } from "./certificado";
import { ErroSefaz, type Environment } from "./dfe-client";
import { enviarManifestacoes, type TipoManifestacao } from "./evento";
import { admin } from "./sync";

const BUCKET_CERT = "fiscal-certs";

export interface ResultadoNota {
  invoiceId: string;
  numero: string | null;
  situacao: "registrado" | "rejeitado" | "erro" | "recusado";
  mensagem: string;
}

/**
 * Manifestação feita por uma pessoa: o banco confere permissão, prazo e
 * sequência com o usuário logado (manifest_begin); o servidor assina com o
 * A1 e envia; o retorno da SEFAZ é gravado com a chave de serviço
 * (manifest_finish), que é a única que pode gravá-lo.
 */
export async function manifestarNotas(
  usuario: SupabaseClient, companyId: string, invoiceIds: string[], tipo: TipoManifestacao, justificativa: string | null
): Promise<ResultadoNota[]> {
  const { data: linhas, error } = await usuario.rpc("manifest_begin", {
    _company_id: companyId, _invoice_ids: invoiceIds, _tipo: tipo, _just: justificativa,
  });
  if (error) throw error;

  const todas = (linhas ?? []) as {
    request_id: string | null; invoice_id: string; access_key: string; sequence: number | null;
    number: string | null; ok: boolean; reason: string | null;
  }[];
  const resultado: ResultadoNota[] = todas.filter((l) => !l.ok).map((l) => ({
    invoiceId: l.invoice_id, numero: l.number, situacao: "recusado", mensagem: l.reason ?? "Não pode ser enviada.",
  }));
  const envio = todas.filter((l) => l.ok && l.request_id);
  if (envio.length === 0) return resultado;

  const db = admin();
  const finalizar = (requestId: string, cStat: string | null, msg: string, prot: string | null, quando: string | null, xml: string | null) =>
    db.rpc("manifest_finish", {
      _request_id: requestId, _cstat: cStat, _message: msg, _protocol: prot, _registered_at: quando, _xml: xml,
    });

  try {
    const [{ data: conn }, { data: emp }] = await Promise.all([
      db.from("fiscal_connections").select("environment, cert_storage_path, cert_secret_name")
        .eq("company_id", companyId).eq("is_active", true).maybeSingle(),
      db.from("companies").select("cnpj").eq("id", companyId).single(),
    ]);
    if (!conn?.cert_storage_path || !conn?.cert_secret_name) throw new Error("Nenhum certificado A1 configurado nesta empresa.");
    const [{ data: arquivo, error: eArq }, { data: senha, error: eSenha }] = await Promise.all([
      db.storage.from(BUCKET_CERT).download(conn.cert_storage_path),
      db.rpc("read_fiscal_secret", { _name: conn.cert_secret_name }),
    ]);
    if (eArq || !arquivo) throw new Error("Não foi possível ler o arquivo do certificado.");
    if (eSenha || typeof senha !== "string") throw new Error("Não foi possível ler a senha do certificado.");
    const cert = abrirCertificado(Buffer.from(await arquivo.arrayBuffer()), senha);
    if (cert.validoAte < new Date()) throw new Error("O certificado A1 está vencido.");
    const cnpj = String(emp?.cnpj ?? "").replace(/\D/g, "");

    const ret = await enviarManifestacoes({
      ambiente: conn.environment as Environment, cnpj,
      pedidos: envio.map((l) => ({ chave: l.access_key, tipo, seq: Number(l.sequence), justificativa })),
      keyPem: cert.keyPem, certPem: cert.certPem, cadeiaPem: cert.cadeiaPem,
    });

    for (const l of envio) {
      const ev = ret.eventos.find((e) => e.chave === l.access_key && e.tipo === tipo && e.seq === Number(l.sequence));
      if (!ev) {
        // lote recusado inteiro (ex.: 656 consumo indevido, falha de schema)
        const msg = ret.cStat === "656"
          ? "656 — Consumo indevido: a SEFAZ pede para esperar 1 hora antes de reenviar."
          : ret.cStat ? `${ret.cStat} — ${ret.xMotivo}` : "A SEFAZ não devolveu o resultado deste evento.";
        await finalizar(l.request_id!, ret.cStat && ret.cStat !== "128" ? ret.cStat : null,
                        ret.xMotivo || msg, null, null, null);
        resultado.push({ invoiceId: l.invoice_id, numero: l.number, situacao: ret.cStat && ret.cStat !== "128" ? "rejeitado" : "erro", mensagem: msg });
        continue;
      }
      const { data: st } = await finalizar(l.request_id!, ev.cStat, ev.xMotivo, ev.protocolo, ev.registradoEm, ev.xml);
      resultado.push({
        invoiceId: l.invoice_id, numero: l.number,
        situacao: st === "registrado" ? "registrado" : "rejeitado",
        mensagem: ev.cStat === "573" ? "Já estava registrada na SEFAZ." : `${ev.cStat} — ${ev.xMotivo}`,
      });
    }
  } catch (e) {
    const msg = e instanceof ErroCertificado || e instanceof ErroSefaz || e instanceof Error ? e.message : "Falha desconhecida.";
    for (const l of envio) {
      if (resultado.some((r) => r.invoiceId === l.invoice_id)) continue;
      await finalizar(l.request_id!, null, msg, null, null, null);
      resultado.push({ invoiceId: l.invoice_id, numero: l.number, situacao: "erro", mensagem: msg });
    }
  }
  return resultado;
}
