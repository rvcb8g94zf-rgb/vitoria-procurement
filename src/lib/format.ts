const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const NUM = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const money = (v: number | null | undefined) => BRL.format(v ?? 0);
export const decimal = (v: number | null | undefined) => NUM.format(v ?? 0);

export function cnpj(digits: string | null | undefined) {
  const d = (digits ?? "").replace(/\D/g, "");
  if (d.length !== 14) return digits ?? "";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/**
 * Datas sempre em America/Sao_Paulo: o banco guarda timestamptz em UTC.
 *
 * Data pura (vencimento de duplicata, dia do caixa) não tem hora nem fuso —
 * vem do Postgres como "2026-09-28". Passar isso por new Date() dá meia-noite
 * em UTC, que no horário de Brasília ainda é dia 27. Por isso a data pura é
 * formatada direto, sem conversão.
 */
export function date(iso: string | null | undefined) {
  if (!iso) return "—";
  const puro = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (puro) return `${puro[3]}/${puro[2]}/${puro[1]}`;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));
}

export function dateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));
}

export const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
