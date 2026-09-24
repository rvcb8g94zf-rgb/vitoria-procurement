// Módulo de fechamento de caixa — tipos, filtros, resumos e exportação.
// Nada aqui decide números: o banco lê o relatório e confere as somas.
// Este arquivo só organiza o que o banco devolveu para as telas.

export const TZ = "America/Sao_Paulo";

export type MethodKind =
  | "dinheiro" | "pix" | "debito" | "credito" | "voucher"
  | "boleto" | "transferencia" | "cheque" | "crediario" | "outros";

export const KIND_LABEL: Record<MethodKind, string> = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  debito: "Débito",
  credito: "Crédito",
  voucher: "Vale / voucher",
  boleto: "Boleto",
  transferencia: "Transferência",
  cheque: "Cheque",
  crediario: "Crediário",
  outros: "Outros",
};

export const KIND_ORDER: MethodKind[] = [
  "dinheiro", "pix", "debito", "credito", "voucher",
  "boleto", "transferencia", "cheque", "crediario", "outros",
];

export interface PaymentMethod {
  code: string;
  label: string;
  kind: MethodKind;
  acquirer: string | null;
  sort_order: number;
}

export interface ClosingPayment {
  code: string;
  label: string;
  kind: MethodKind;
  acquirer: string | null;
  amount: number;
}

export interface ClosingRow {
  id: string;
  business_date: string;
  opened_at: string;
  closed_at: string;
  change_in: number;
  receipts_total: number;
  tenders_total: number;
  cash_total: number;
  non_cash_total: number;
  change_out: number;
  discount_total: number;
  outflows_total: number;
  drawer_balance: number;
  operations_count: number | null;
  check_ok: boolean;
  cancelled_at: string | null;
  source_filename: string | null;
  created_at: string;
  selected_amount: number;
  payments: ClosingPayment[];
}

export interface CashCheck {
  key: string;
  label: string;
  expected: number;
  found: number;
  ok: boolean;
}

/** Resultado da prévia devolvido por public.preview_cash_report. */
export interface CashPreview {
  ok: boolean;
  errors: string[];
  warnings: string[];
  business_date?: string;
  opened_at?: string;
  closed_at?: string;
  change_in?: number;
  receipts_total?: number;
  tenders_total?: number;
  cash_total?: number;
  non_cash_total?: number;
  change_out?: number;
  discount_total?: number;
  outflows_total?: number;
  drawer_balance?: number;
  operations_count?: number | null;
  payments?: (ClosingPayment & { position: number })[];
  checks?: CashCheck[];
  check_ok?: boolean;
  duplicate?: { id: string; created_at: string; uploaded_by: string | null };
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));

/** PostgREST devolve numeric como número ou texto, conforme o caso: normaliza. */
export function normalizeRows(data: unknown): ClosingRow[] {
  if (!Array.isArray(data)) return [];
  return data.map((r: any) => ({
    id: r.id,
    business_date: r.business_date,
    opened_at: r.opened_at,
    closed_at: r.closed_at,
    change_in: num(r.change_in),
    receipts_total: num(r.receipts_total),
    tenders_total: num(r.tenders_total),
    cash_total: num(r.cash_total),
    non_cash_total: num(r.non_cash_total),
    change_out: num(r.change_out),
    discount_total: num(r.discount_total),
    outflows_total: num(r.outflows_total),
    drawer_balance: num(r.drawer_balance),
    operations_count: r.operations_count === null ? null : Number(r.operations_count),
    check_ok: Boolean(r.check_ok),
    cancelled_at: r.cancelled_at ?? null,
    source_filename: r.source_filename ?? null,
    created_at: r.created_at,
    selected_amount: num(r.selected_amount),
    payments: (Array.isArray(r.payments) ? r.payments : []).map((p: any) => ({
      code: String(p.code),
      label: String(p.label),
      kind: p.kind as MethodKind,
      acquirer: p.acquirer ?? null,
      amount: num(p.amount),
    })),
  }));
}

// ---------------------------------------------------------------------
// Datas — sempre no fuso da loja. O banco guarda timestamptz; o "dia do
// caixa" (business_date) já vem calculado pelo banco no fuso da empresa.
// ---------------------------------------------------------------------

/** "2026-09-21" no fuso de São Paulo. */
export function todayISO(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const isISODate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export function monthStart(iso: string): string {
  return iso.slice(0, 8) + "01";
}

export function monthEnd(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** "18/09/2026" a partir de "2026-09-18" — sem passar por Date, sem fuso. */
export function dateBR(iso: string | null | undefined): string {
  if (!iso || !isISODate(iso.slice(0, 10))) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function weekdayBR(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "sexta-feira" → "Sexta-feira" (o CSS capitalize faria "Sexta-Feira"). */
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "sex." — para colunas estreitas. */
export function weekdayShortBR(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "08:24" no fuso da loja. */
export function timeBR(ts: string | null | undefined): string {
  if (!ts) return "—";
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(new Date(ts));
}

export function dateTimeBR(ts: string | null | undefined): string {
  if (!ts) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: TZ }).format(new Date(ts));
}

/** "9h29" entre abertura e fechamento. */
export function duration(from: string, to: string): string {
  const min = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000));
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m} min`;
}

// ---------------------------------------------------------------------
// Rótulos do relatório: o PDV imprime em maiúsculas e sem acento
// ("SAIDA DE TROCO"). Para a tela, vira "Saída de troco".
// ---------------------------------------------------------------------
const PALAVRAS: Record<string, string> = {
  SAIDA: "saída", SAIDAS: "saídas", TITULO: "título", TITULOS: "títulos",
  OPERACAO: "operação", OPERACOES: "operações", CREDITO: "crédito", DEBITO: "débito",
  CARTAO: "cartão", CARTOES: "cartões", CREDIARIO: "crediário", TRANSFERENCIA: "transferência",
  DEVOLUCAO: "devolução", DEVOLUCOES: "devoluções", PAGTO: "pagto.", PGTO: "pgto.",
  PIX: "PIX", TEF: "TEF", POS: "POS", NFCE: "NFC-e",
};

export interface CashLine {
  i: number;
  sec: number;
  label: string;
  amount: number;
  sign: "+" | "-";
}

export function prettyLabel(s: string): string {
  const out = s.trim().split(/\s+/).map((w) => PALAVRAS[w.toUpperCase()] ?? w.toLowerCase()).join(" ");
  return out.charAt(0).toUpperCase() + out.slice(1);
}

// ---------------------------------------------------------------------
// Valores digitados: aceita "1.234,56", "1234,56" e "1234.56".
// ---------------------------------------------------------------------
export function parseMoneyInput(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/^R\$\s*/i, "");
  if (!s) return null;
  const n = s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export function moneyInputValue(n: number | null): string {
  return n === null ? "" : n.toFixed(2).replace(".", ",");
}

// ---------------------------------------------------------------------
// Filtros da URL
// ---------------------------------------------------------------------
export interface CashFilters {
  de: string;
  ate: string;
  modalidade: string;       // "" | "kind:credito" | "CREDITO REDE"
  min: number | null;
  max: number | null;
  cancelados: boolean;
}

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseFilters(sp: SP, today = todayISO()): CashFilters {
  let de = first(sp.de);
  let ate = first(sp.ate);
  if (!isISODate(de)) de = monthStart(today);
  if (!isISODate(ate)) ate = today;
  if (de > ate) [de, ate] = [ate, de];

  let min = parseMoneyInput(first(sp.min));
  let max = parseMoneyInput(first(sp.max));
  if (min !== null && max !== null && min > max) [min, max] = [max, min];

  const modalidade = (first(sp.modalidade) ?? "").slice(0, 60);
  return { de, ate, modalidade, min, max, cancelados: first(sp.cancelados) === "1" };
}

/** Filtros → query string, omitindo o que está no padrão. */
export function filtersToQuery(f: CashFilters, extra: Record<string, string> = {}): Record<string, string> {
  const q: Record<string, string> = { de: f.de, ate: f.ate };
  if (f.modalidade) q.modalidade = f.modalidade;
  if (f.min !== null) q.min = moneyInputValue(f.min);
  if (f.max !== null) q.max = moneyInputValue(f.max);
  if (f.cancelados) q.cancelados = "1";
  return { ...q, ...extra };
}

export function presets(today = todayISO()) {
  const prevMonthDay = addDays(monthStart(today), -1);
  return [
    { label: "Hoje", de: today, ate: today },
    { label: "7 dias", de: addDays(today, -6), ate: today },
    { label: "Este mês", de: monthStart(today), ate: today },
    { label: "Mês passado", de: monthStart(prevMonthDay), ate: prevMonthDay },
    { label: "Este ano", de: today.slice(0, 4) + "-01-01", ate: today },
  ];
}

/** Nome legível do filtro de modalidade. */
export function methodFilterLabel(value: string, methods: PaymentMethod[]): string | null {
  if (!value) return null;
  if (value.startsWith("kind:")) {
    const k = value.slice(5) as MethodKind;
    return KIND_LABEL[k] ? `${KIND_LABEL[k]} (todas)` : null;
  }
  return methods.find((m) => m.code === value)?.label ?? value;
}

/** Opções do seletor agrupadas por tipo, na ordem do caixa. */
export function methodOptions(methods: PaymentMethod[]) {
  return KIND_ORDER
    .map((kind) => ({ kind, label: KIND_LABEL[kind], methods: methods.filter((m) => m.kind === kind) }))
    .filter((g) => g.methods.length > 0);
}

// ---------------------------------------------------------------------
// Resumo do período
// ---------------------------------------------------------------------
export interface MethodTotal {
  code: string;
  label: string;
  kind: MethodKind;
  acquirer: string | null;
  amount: number;
  days: number;
}

export interface PeriodSummary {
  count: number;
  receipts: number;
  tenders: number;
  cash: number;
  changeOut: number;
  discounts: number;
  operations: number;
  divergent: number;
  cancelled: number;
  average: number;
  best: ClosingRow | null;
  worst: ClosingRow | null;
  selected: number;
  methods: MethodTotal[];
  kinds: { kind: MethodKind; label: string; amount: number }[];
  acquirers: { acquirer: string; debito: number; credito: number; outros: number; total: number }[];
}

export function summarize(rows: ClosingRow[]): PeriodSummary {
  const active = rows.filter((r) => !r.cancelled_at);
  const methods = new Map<string, MethodTotal>();
  const kinds = new Map<MethodKind, number>();
  const acq = new Map<string, { debito: number; credito: number; outros: number }>();

  for (const r of active) {
    for (const p of r.payments) {
      const m = methods.get(p.code) ?? { ...p, amount: 0, days: 0 };
      m.amount += p.amount;
      if (p.amount !== 0) m.days += 1;
      methods.set(p.code, m);
      kinds.set(p.kind, (kinds.get(p.kind) ?? 0) + p.amount);
      if (p.acquirer) {
        const a = acq.get(p.acquirer) ?? { debito: 0, credito: 0, outros: 0 };
        if (p.kind === "debito") a.debito += p.amount;
        else if (p.kind === "credito") a.credito += p.amount;
        else a.outros += p.amount;
        acq.set(p.acquirer, a);
      }
    }
  }

  const sum = (f: (r: ClosingRow) => number) => round2(active.reduce((s, r) => s + f(r), 0));
  const byReceipts = [...active].sort((a, b) => b.receipts_total - a.receipts_total);

  return {
    count: active.length,
    receipts: sum((r) => r.receipts_total),
    tenders: sum((r) => r.tenders_total),
    cash: sum((r) => r.cash_total),
    changeOut: sum((r) => r.change_out),
    discounts: sum((r) => r.discount_total),
    operations: active.reduce((s, r) => s + (r.operations_count ?? 0), 0),
    divergent: active.filter((r) => !r.check_ok).length,
    cancelled: rows.length - active.length,
    average: active.length ? round2(sum((r) => r.receipts_total) / active.length) : 0,
    best: byReceipts[0] ?? null,
    worst: byReceipts.length > 1 ? byReceipts[byReceipts.length - 1] : null,
    selected: sum((r) => r.selected_amount),
    methods: [...methods.values()]
      .map((m) => ({ ...m, amount: round2(m.amount) }))
      .sort((a, b) => b.amount - a.amount),
    kinds: KIND_ORDER.filter((k) => kinds.has(k)).map((k) => ({ kind: k, label: KIND_LABEL[k], amount: round2(kinds.get(k)!) })),
    acquirers: [...acq.entries()]
      .map(([acquirer, v]) => ({
        acquirer,
        debito: round2(v.debito), credito: round2(v.credito), outros: round2(v.outros),
        total: round2(v.debito + v.credito + v.outros),
      }))
      .sort((a, b) => b.total - a.total),
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------
// CSV para Excel pt-BR: separador ";", vírgula decimal, BOM, CRLF.
// Campo que começa com = + - @ ganha apóstrofo (injeção de fórmula).
// ---------------------------------------------------------------------
function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return v.toFixed(2).replace(".", ",");
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: ClosingRow[]): string {
  const methodCols = new Map<string, string>();
  for (const r of rows) for (const p of r.payments) if (!methodCols.has(p.code)) methodCols.set(p.code, p.label);
  const codes = [...methodCols.keys()];

  const head = [
    "Data", "Dia da semana", "Abertura", "Fechamento", "Operações",
    "Entrada de troco", "Pedidos pagos",
    ...codes.map((c) => methodCols.get(c)!),
    "Soma das formas", "Total em títulos", "Saída de troco", "Descontos",
    "Total das saídas", "Troco na gaveta", "Conferência", "Situação", "Arquivo",
  ];

  const lines = [head.map(csvCell).join(";")];
  for (const r of [...rows].sort((a, b) => a.business_date.localeCompare(b.business_date) || a.opened_at.localeCompare(b.opened_at))) {
    const byCode = new Map(r.payments.map((p) => [p.code, p.amount]));
    lines.push([
      dateBR(r.business_date), weekdayBR(r.business_date), timeBR(r.opened_at), timeBR(r.closed_at),
      r.operations_count === null ? "" : String(r.operations_count),
      r.change_in, r.receipts_total,
      ...codes.map((c) => byCode.get(c) ?? 0),
      r.tenders_total, r.non_cash_total, r.change_out, r.discount_total,
      r.outflows_total, r.drawer_balance,
      r.check_ok ? "Conferido" : "Divergência",
      r.cancelled_at ? "Cancelado" : "Ativo",
      r.source_filename ?? "",
    ].map(csvCell).join(";"));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
