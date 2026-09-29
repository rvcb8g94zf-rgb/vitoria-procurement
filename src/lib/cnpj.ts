import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Consulta de CNPJ na base pública da Receita Federal.
 * Fonte principal: BrasilAPI. Reserva: CNPJ.ws (API pública, 3 consultas/min).
 * Devolve os campos já normalizados no formato que app.apply_supplier_registry espera.
 */
export type DadosCnpj = {
  razao_social: string | null; nome_fantasia: string | null; cep: string | null; logradouro: string | null;
  numero: string | null; complemento: string | null; bairro: string | null; municipio: string | null; uf: string | null;
  telefone: string | null; email: string | null; situacao: string | null; data_situacao: string | null;
  cnae: string | null; cnae_descricao: string | null; porte: string | null; simples: boolean | null; mei: boolean | null;
};

const TIMEOUT_MS = 8_000;
const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const iso = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

async function buscar(url: string): Promise<any | null | "nao_existe"> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: "application/json", "user-agent": "VitoriaProcurement/1.0" }, cache: "no-store" });
    if (r.status === 404) return "nao_existe";
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function deBrasilApi(d: any): DadosCnpj {
  const logr = [txt(d.descricao_tipo_de_logradouro), txt(d.logradouro)].filter(Boolean).join(" ");
  return {
    razao_social: txt(d.razao_social), nome_fantasia: txt(d.nome_fantasia), cep: txt(String(d.cep ?? "")),
    logradouro: logr || null, numero: txt(String(d.numero ?? "")), complemento: txt(d.complemento), bairro: txt(d.bairro),
    municipio: txt(d.municipio), uf: txt(d.uf), telefone: txt(d.ddd_telefone_1), email: txt(d.email),
    situacao: txt(d.descricao_situacao_cadastral), data_situacao: iso(d.data_situacao_cadastral),
    cnae: d.cnae_fiscal ? String(d.cnae_fiscal) : null, cnae_descricao: txt(d.cnae_fiscal_descricao),
    porte: txt(d.porte) ?? txt(d.descricao_porte),
    simples: typeof d.opcao_pelo_simples === "boolean" ? d.opcao_pelo_simples : null,
    mei: typeof d.opcao_pelo_mei === "boolean" ? d.opcao_pelo_mei : null,
  };
}

function deCnpjWs(d: any): DadosCnpj {
  const e = d?.estabelecimento ?? {};
  const logr = [txt(e.tipo_logradouro), txt(e.logradouro)].filter(Boolean).join(" ");
  const tel = [e.ddd1, e.telefone1].filter(Boolean).join("");
  const simples = d?.simples?.simples;
  const mei = d?.simples?.mei;
  return {
    razao_social: txt(d?.razao_social), nome_fantasia: txt(e.nome_fantasia), cep: txt(e.cep), logradouro: logr || null,
    numero: txt(e.numero), complemento: txt(e.complemento), bairro: txt(e.bairro), municipio: txt(e.cidade?.nome),
    uf: txt(e.estado?.sigla), telefone: tel || null, email: txt(e.email), situacao: txt(e.situacao_cadastral),
    data_situacao: iso(e.data_situacao_cadastral), cnae: e.atividade_principal?.id ? String(e.atividade_principal.id) : null,
    cnae_descricao: txt(e.atividade_principal?.descricao), porte: txt(d?.porte?.descricao),
    simples: simples === "Sim" ? true : simples === "Não" ? false : null,
    mei: mei === "Sim" ? true : mei === "Não" ? false : null,
  };
}

export async function consultarCnpj(cnpj: string): Promise<{ dados?: DadosCnpj; fonte: string; erro?: string }> {
  const doc = cnpj.replace(/\D/g, "");
  if (doc.length !== 14) return { fonte: "-", erro: "CNPJ inválido" };
  // endereço de teste só fora de produção (mesmo cuidado do DFE_ENDPOINT_TESTE)
  const base = process.env.NODE_ENV !== "production" && process.env.CNPJ_API_TESTE
    ? process.env.CNPJ_API_TESTE : "https://brasilapi.com.br/api/cnpj/v1";
  const a = await buscar(`${base}/${doc}`);
  if (a === "nao_existe") return { fonte: "brasilapi", erro: "CNPJ não encontrado na Receita" };
  if (a) return { dados: deBrasilApi(a), fonte: "brasilapi" };
  if (base !== "https://brasilapi.com.br/api/cnpj/v1") return { fonte: "teste", erro: "Consulta à Receita indisponível agora" };
  const b = await buscar(`https://publica.cnpj.ws/cnpj/${doc}`);
  if (b === "nao_existe") return { fonte: "cnpj.ws", erro: "CNPJ não encontrado na Receita" };
  if (b) return { dados: deCnpjWs(b), fonte: "cnpj.ws" };
  return { fonte: "-", erro: "Consulta à Receita indisponível agora" };
}

/** Consulta e grava um fornecedor. `db` pode ser o cliente do usuário ou o de serviço. */
export async function completarFornecedor(db: SupabaseClient, companyId: string, supplierId: string, cnpj: string) {
  const r = await consultarCnpj(cnpj);
  const { data, error } = await db.rpc("apply_supplier_registry", {
    _company_id: companyId, _supplier_id: supplierId, _d: r.dados ?? {}, _fonte: r.fonte, _erro: r.erro ?? null,
  });
  if (error) return { ok: false, erro: error.message };
  return data as { ok: boolean; campos?: string[]; situacao?: string; erro?: string };
}

/**
 * Completa os fornecedores ainda não consultados, um por vez, até o prazo.
 * A pausa entre consultas respeita o limite das APIs públicas.
 */
export async function completarPendentes(db: SupabaseClient, companyId: string, opts: { limite?: number; prazoMs?: number } = {}) {
  const fim = Date.now() + (opts.prazoMs ?? 20_000);
  const { data } = await db.rpc("suppliers_to_enrich", { _company_id: companyId, _limit: opts.limite ?? 10 });
  let feitos = 0; let completados = 0;
  for (const s of (data ?? []) as { id: string; doc_number: string }[]) {
    if (Date.now() > fim - TIMEOUT_MS) break;
    const r = await completarFornecedor(db, companyId, s.id, s.doc_number);
    feitos++;
    if (r.ok && (r.campos?.length ?? 0) > 0) completados++;
    await new Promise((ok) => setTimeout(ok, 400));
  }
  return { feitos, completados };
}
