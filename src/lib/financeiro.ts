// Contas a pagar — tipos, filtros e resumos das telas do financeiro.
// Como no caixa e nas notas, nada aqui calcula dinheiro: os valores, o
// saldo e o atraso vêm prontos do banco.

export interface PayableRow {
  id: string;
  supplier_id: string | null;
  supplier_name: string | null;
  invoice_id: string | null;
  invoice_number: string | null;
  duplicate_id: string | null;
  origin: "nfe" | "manual";
  document: string | null;
  description: string;
  issue_date: string | null;
  due_date: string;
  amount: number;
  paid_amount: number;
  balance: number;
  status: "aberto" | "parcial" | "pago" | "cancelado";
  days_late: number;
  cost_center_name: string | null;
  department_name: string | null;
  created_at: string;
}

export interface PaymentRow {
  id: string;
  payable_id: string;
  paid_at: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  description: string;
  document: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  invoice_number: string | null;
  paid_by: string | null;
  created_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

export interface PendingInvoiceRow {
  invoice_id: string;
  invoice_number: string | null;
  issued_at: string | null;
  emitter_name: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  fiscal_status: string;
  invoice_total: number;
  duplicates_count: number;
  pending_count: number;
  pending_total: number;
  first_due: string | null;
  last_due: string | null;
}

export interface CalendarDay {
  day: string;
  titulos: number;
  total: number;
  aberto: number;
  pago: number;
}

export type PaymentMethod =
  | "pix" | "boleto" | "ted" | "doc" | "dinheiro"
  | "cartao" | "cheque" | "debito_automatico" | "outros";

export const METODOS: { value: PaymentMethod; label: string }[] = [
  { value: "pix", label: "Pix" },
  { value: "boleto", label: "Boleto" },
  { value: "ted", label: "TED" },
  { value: "doc", label: "DOC" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "cartao", label: "Cartão" },
  { value: "cheque", label: "Cheque" },
  { value: "debito_automatico", label: "Débito automático" },
  { value: "outros", label: "Outros" },
];
export const METODO_LABEL: Record<string, string> =
  Object.fromEntries(METODOS.map((m) => [m.value, m.label]));

export const STATUS_PAGAR: { value: string; label: string }[] = [
  { value: "", label: "Todas" },
  { value: "em_aberto", label: "Em aberto" },
  { value: "vencido", label: "Vencidas" },
  { value: "a_vencer", label: "A vencer" },
  { value: "parcial", label: "Pagas em parte" },
  { value: "pago", label: "Pagas" },
  { value: "cancelado", label: "Canceladas" },
];
export const STATUS_LABEL: Record<string, string> = {
  aberto: "Em aberto",
  parcial: "Paga em parte",
  pago: "Paga",
  cancelado: "Cancelada",
};

const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));

export function normalizePayables(data: unknown): PayableRow[] {
  if (!Array.isArray(data)) return [];
  return data.map((r: any) => ({
    id: r.id,
    supplier_id: r.supplier_id ?? null,
    supplier_name: r.supplier_name ?? null,
    invoice_id: r.invoice_id ?? null,
    invoice_number: r.invoice_number ?? null,
    duplicate_id: r.duplicate_id ?? null,
    origin: r.origin === "nfe" ? "nfe" : "manual",
    document: r.document ?? null,
    description: String(r.description ?? ""),
    issue_date: r.issue_date ?? null,
    due_date: r.due_date,
    amount: num(r.amount),
    paid_amount: num(r.paid_amount),
    balance: num(r.balance),
    status: r.status,
    days_late: Number(r.days_late ?? 0),
    cost_center_name: r.cost_center_name ?? null,
    department_name: r.department_name ?? null,
    created_at: r.created_at,
  }));
}

export function normalizePayments(data: unknown): PaymentRow[] {
  if (!Array.isArray(data)) return [];
  return data.map((r: any) => ({
    id: r.id,
    payable_id: r.payable_id,
    paid_at: r.paid_at,
    amount: num(r.amount),
    method: r.method,
    reference: r.reference ?? null,
    notes: r.notes ?? null,
    description: String(r.description ?? ""),
    document: r.document ?? null,
    supplier_id: r.supplier_id ?? null,
    supplier_name: r.supplier_name ?? null,
    invoice_number: r.invoice_number ?? null,
    paid_by: r.paid_by ?? null,
    created_at: r.created_at,
    cancelled_at: r.cancelled_at ?? null,
    cancel_reason: r.cancel_reason ?? null,
  }));
}

export function normalizePending(data: unknown): PendingInvoiceRow[] {
  if (!Array.isArray(data)) return [];
  return data.map((r: any) => ({
    invoice_id: r.invoice_id,
    invoice_number: r.invoice_number ?? null,
    issued_at: r.issued_at ?? null,
    emitter_name: r.emitter_name ?? null,
    supplier_id: r.supplier_id ?? null,
    supplier_name: r.supplier_name ?? null,
    fiscal_status: r.fiscal_status ?? "desconhecida",
    invoice_total: num(r.invoice_total),
    duplicates_count: Number(r.duplicates_count ?? 0),
    pending_count: Number(r.pending_count ?? 0),
    pending_total: num(r.pending_total),
    first_due: r.first_due ?? null,
    last_due: r.last_due ?? null,
  }));
}

export interface PayableFilters {
  de: string;
  ate: string;
  fornecedor: string;
  situacao: string;
  busca: string;
}

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const isISO = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function monthStart(iso: string): string {
  return iso.slice(0, 8) + "01";
}
export function monthEnd(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
export function addMonths(iso: string, n: number): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
}

/** Padrão do contas a pagar: 30 dias para trás, 60 para a frente. */
export function parsePayableFilters(sp: SP, hoje: string): PayableFilters {
  let de = first(sp.de);
  let ate = first(sp.ate);
  if (!isISO(de)) de = addDays(hoje, -30);
  if (!isISO(ate)) ate = addDays(hoje, 60);
  if (de > ate) [de, ate] = [ate, de];
  return {
    de,
    ate,
    fornecedor: (first(sp.fornecedor) ?? "").slice(0, 40),
    situacao: (first(sp.situacao) ?? "").slice(0, 20),
    busca: (first(sp.busca) ?? "").slice(0, 60),
  };
}

export function payableFiltersToQuery(f: PayableFilters): Record<string, string> {
  const q: Record<string, string> = { de: f.de, ate: f.ate };
  if (f.fornecedor) q.fornecedor = f.fornecedor;
  if (f.situacao) q.situacao = f.situacao;
  if (f.busca) q.busca = f.busca;
  return q;
}

export function payablePresets(hoje: string) {
  return [
    { label: "Vencidas", de: "2000-01-01", ate: addDays(hoje, -1), situacao: "em_aberto" },
    { label: "Esta semana", de: hoje, ate: addDays(hoje, 7), situacao: "em_aberto" },
    { label: "Este mês", de: monthStart(hoje), ate: monthEnd(hoje), situacao: "" },
    { label: "Próximos 60 dias", de: addDays(hoje, -30), ate: addDays(hoje, 60), situacao: "" },
  ];
}

export interface PayableSummary {
  count: number;
  total: number;
  aberto: number;
  vencido: number;
  vencidoCount: number;
  semana: number;
  semanaCount: number;
  pago: number;
}

export function summarizePayables(rows: PayableRow[], hoje: string): PayableSummary {
  const limite = addDays(hoje, 7);
  const vivos = rows.filter((r) => r.status === "aberto" || r.status === "parcial");
  const vencidas = vivos.filter((r) => r.due_date < hoje);
  const semana = vivos.filter((r) => r.due_date >= hoje && r.due_date <= limite);
  const cents = (v: number) => Math.round(v * 100) / 100;
  return {
    count: rows.filter((r) => r.status !== "cancelado").length,
    total: cents(rows.filter((r) => r.status !== "cancelado").reduce((s, r) => s + r.amount, 0)),
    aberto: cents(vivos.reduce((s, r) => s + r.balance, 0)),
    vencido: cents(vencidas.reduce((s, r) => s + r.balance, 0)),
    vencidoCount: vencidas.length,
    semana: cents(semana.reduce((s, r) => s + r.balance, 0)),
    semanaCount: semana.length,
    pago: cents(rows.reduce((s, r) => s + r.paid_amount, 0)),
  };
}

/** Semanas do mês, de domingo a sábado, para o calendário. */
export function monthGrid(anchor: string): string[][] {
  const [y, m] = anchor.split("-").map(Number);
  const primeiro = new Date(Date.UTC(y, m - 1, 1));
  const inicio = new Date(primeiro);
  inicio.setUTCDate(1 - primeiro.getUTCDay());
  const semanas: string[][] = [];
  for (let s = 0; s < 6; s++) {
    const semana: string[] = [];
    for (let d = 0; d < 7; d++) {
      const dia = new Date(inicio);
      dia.setUTCDate(inicio.getUTCDate() + s * 7 + d);
      semana.push(dia.toISOString().slice(0, 10));
    }
    semanas.push(semana);
    const ultimo = semana[6];
    if (Number(ultimo.slice(5, 7)) !== m && s >= 3) break;
  }
  return semanas;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const mesPorExtenso = (iso: string) =>
  `${MESES[Number(iso.slice(5, 7)) - 1]} de ${iso.slice(0, 4)}`;
