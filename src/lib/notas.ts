// Notas fiscais recebidas — tipos e filtros das telas.
// Como no caixa, nada aqui calcula valor: o banco lê o XML e devolve pronto.

export interface InvoiceRow {
  id: string;
  access_key: string;
  number: string | null;
  series: string | null;
  issued_at: string | null;
  emitter_name: string | null;
  emitter_cnpj: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  total_amount: number;
  item_count: number | null;
  doc_kind: "resumo" | "completo";
  fiscal_status: "autorizada" | "cancelada" | "denegada" | "desconhecida";
  source: string;
  duplicates_count: number;
  next_due: string | null;
  created_at: string;
}

export interface InvoiceItemPreview {
  seq: number;
  code: string | null;
  ean: string | null;
  description: string;
  ncm: string | null;
  cfop: string | null;
  unit: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
  discount: number;
  icms_st: number;
  ipi: number;
  landed_total: number;
  landed_price: number;
  product_id: string | null;
  product_description: string | null;
}

/** Devolvido por public.preview_invoice_xml. */
export interface InvoicePreview {
  ok: boolean;
  errors: string[];
  warnings: string[];
  access_key?: string;
  kind?: "resumo" | "completo";
  number?: string | null;
  series?: string | null;
  issued_at?: string | null;
  operation?: string | null;
  emitter_name?: string | null;
  emitter_cnpj?: string | null;
  dest_cnpj?: string | null;
  fiscal_status?: string;
  products_total?: number | null;
  discount_total?: number | null;
  freight_total?: number | null;
  icms_st_total?: number | null;
  ipi_total?: number | null;
  total_amount?: number | null;
  items?: InvoiceItemPreview[];
  duplicates?: { seq: number; number: string | null; due_date: string | null; amount: number }[];
  supplier?: { id: string; name: string } | null;
  existing?: { id: string; kind: string; source: string; created_at: string } | null;
  unmatched_items?: number;
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));

export function normalizeInvoices(data: unknown): InvoiceRow[] {
  if (!Array.isArray(data)) return [];
  return data.map((r: any) => ({
    id: r.id,
    access_key: String(r.access_key ?? ""),
    number: r.number ?? null,
    series: r.series ?? null,
    issued_at: r.issued_at ?? null,
    emitter_name: r.emitter_name ?? null,
    emitter_cnpj: r.emitter_cnpj ?? null,
    supplier_id: r.supplier_id ?? null,
    supplier_name: r.supplier_name ?? null,
    total_amount: num(r.total_amount),
    item_count: r.item_count === null ? null : Number(r.item_count),
    doc_kind: r.doc_kind === "resumo" ? "resumo" : "completo",
    fiscal_status: r.fiscal_status ?? "desconhecida",
    source: r.source ?? "dfe",
    duplicates_count: Number(r.duplicates_count ?? 0),
    next_due: r.next_due ?? null,
    created_at: r.created_at,
  }));
}

export const STATUS_LABEL: Record<string, string> = {
  autorizada: "Autorizada",
  cancelada: "Cancelada",
  denegada: "Denegada",
  desconhecida: "Sem protocolo",
};

export interface InvoiceFilters {
  de: string;
  ate: string;
  fornecedor: string;
  situacao: string;
  busca: string;
}

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const isISO = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Padrão: últimos 90 dias, que é onde mora o contas a pagar. */
export function parseInvoiceFilters(sp: SP, hoje: string): InvoiceFilters {
  let de = first(sp.de);
  let ate = first(sp.ate);
  if (!isISO(de)) de = addDays(hoje, -90);
  if (!isISO(ate)) ate = hoje;
  if (de > ate) [de, ate] = [ate, de];
  return {
    de,
    ate,
    fornecedor: (first(sp.fornecedor) ?? "").slice(0, 40),
    situacao: (first(sp.situacao) ?? "").slice(0, 20),
    busca: (first(sp.busca) ?? "").slice(0, 60),
  };
}

export function invoiceFiltersToQuery(f: InvoiceFilters): Record<string, string> {
  const q: Record<string, string> = { de: f.de, ate: f.ate };
  if (f.fornecedor) q.fornecedor = f.fornecedor;
  if (f.situacao) q.situacao = f.situacao;
  if (f.busca) q.busca = f.busca;
  return q;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export interface InvoiceSummary {
  count: number;
  total: number;
  semFornecedor: number;
  resumos: number;
  canceladas: number;
  aVencer: number;
  aVencerTotal: number;
}

export function summarizeInvoices(rows: InvoiceRow[], hoje: string): InvoiceSummary {
  const limite = addDays(hoje, 7);
  const validas = rows.filter((r) => r.fiscal_status !== "cancelada");
  return {
    count: rows.length,
    total: Math.round(validas.reduce((s, r) => s + r.total_amount, 0) * 100) / 100,
    semFornecedor: rows.filter((r) => !r.supplier_id).length,
    resumos: rows.filter((r) => r.doc_kind === "resumo").length,
    canceladas: rows.filter((r) => r.fiscal_status === "cancelada").length,
    aVencer: validas.filter((r) => r.next_due && r.next_due <= limite).length,
    aVencerTotal: 0,
  };
}
