import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle, Ban, Building2, CheckCircle2, Info } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { cnpj, money } from "@/lib/format";
import {
  capitalize, dateBR, dateTimeBR, duration, prettyLabel, timeBR, weekdayBR,
  type CashCheck, type CashLine, type MethodKind, type MethodTotal,
} from "@/lib/caixa";
import { Card, KpiRow, MethodBars } from "../_components/ui";
import { PrintButton } from "../_components/export-buttons";
import { CancelarFechamento } from "./cancelar";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const n = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const um = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

interface Detalhe {
  id: string;
  company_id: string;
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
  checks: CashCheck[];
  entries: CashLine[];
  outflows: CashLine[];
  others: CashLine[];
  warnings: string[];
  raw_text: string;
  source_filename: string | null;
  created_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
  uploader: string | null;
  canceller: string | null;
  payments: MethodTotal[];
}

const linhas = (v: unknown): CashLine[] =>
  (Array.isArray(v) ? v : []).map((l: any) => ({
    i: Number(l.i), sec: Number(l.sec), label: String(l.label ?? ""),
    amount: n(l.amount), sign: l.sign === "-" ? "-" : "+",
  }));

/** Uma leitura por request, compartilhada entre o título da aba e a página. */
const carregar = cache(async (id: string): Promise<Detalhe | null> => {
  if (!UUID.test(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cash_closings")
    .select(`
      id, company_id, business_date, opened_at, closed_at,
      change_in, receipts_total, tenders_total, cash_total, non_cash_total,
      change_out, discount_total, outflows_total, drawer_balance, operations_count,
      check_ok, checks, lines, warnings, raw_text, source_filename,
      created_at, cancelled_at, cancel_reason,
      uploader:users!cash_closings_uploaded_by_fkey(full_name),
      canceller:users!cash_closings_cancelled_by_fkey(full_name),
      payments:cash_closing_payments(amount, position, method:cash_payment_methods(code, label, kind, acquirer))
    `)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[caixa] detalhe", error);
    return null;
  }
  if (!data) return null;
  const r = data as any;

  return {
    id: r.id,
    company_id: r.company_id,
    business_date: r.business_date,
    opened_at: r.opened_at,
    closed_at: r.closed_at,
    change_in: n(r.change_in),
    receipts_total: n(r.receipts_total),
    tenders_total: n(r.tenders_total),
    cash_total: n(r.cash_total),
    non_cash_total: n(r.non_cash_total),
    change_out: n(r.change_out),
    discount_total: n(r.discount_total),
    outflows_total: n(r.outflows_total),
    drawer_balance: n(r.drawer_balance),
    operations_count: r.operations_count === null ? null : Number(r.operations_count),
    check_ok: Boolean(r.check_ok),
    checks: (Array.isArray(r.checks) ? r.checks : []).map((c: any) => ({
      key: String(c.key), label: String(c.label), expected: n(c.expected), found: n(c.found), ok: Boolean(c.ok),
    })),
    entries: linhas(r.lines?.entries),
    outflows: linhas(r.lines?.outflows),
    others: linhas(r.lines?.others),
    warnings: Array.isArray(r.warnings) ? r.warnings.map(String) : [],
    raw_text: String(r.raw_text ?? ""),
    source_filename: r.source_filename ?? null,
    created_at: r.created_at,
    cancelled_at: r.cancelled_at ?? null,
    cancel_reason: r.cancel_reason ?? null,
    uploader: um<{ full_name: string }>(r.uploader)?.full_name ?? null,
    canceller: um<{ full_name: string }>(r.canceller)?.full_name ?? null,
    payments: (Array.isArray(r.payments) ? r.payments : [])
      .map((p: any) => ({ p, m: um<any>(p.method) }))
      .filter(({ m }: any) => m)
      .sort((a: any, b: any) => Number(a.p.position) - Number(b.p.position))
      .map(({ p, m }: any) => ({
        code: String(m.code),
        label: String(m.label),
        kind: m.kind as MethodKind,
        acquirer: m.acquirer ?? null,
        amount: n(p.amount),
        days: 1,
      })),
  };
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const c = await carregar(id);
  // O título vira o nome do arquivo quando se salva em PDF.
  return { title: c ? `Caixa de ${dateBR(c.business_date).replaceAll("/", "-")} · Vitória Procurement` : "Fechamento de caixa · Vitória Procurement" };
}

export default async function CaixaDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { company, memberships, permissions } = await requirePermission("cash");
  const { id } = await params;
  const c = await carregar(id);
  if (!c) notFound();

  const outraEmpresa =
    c.company_id !== company.id ? memberships.find((m) => m.company.id === c.company_id)?.company ?? null : null;
  const podeCancelar = !c.cancelled_at && !outraEmpresa && permissions.has("cash.delete");
  const empresa = outraEmpresa ?? company;
  const falhas = c.checks.filter((k) => !k.ok);

  return (
    <div className="max-w-[1100px] px-6 pb-14 pt-5 print:max-w-none print:p-0">
      {/* no papel, a empresa vem no topo — na tela ela já está no menu */}
      <p className="mb-1 hidden text-[11px] text-muted print:block">
        {empresa.legal_name} · CNPJ {cnpj(empresa.cnpj)}
      </p>
      <PageHeader
        crumb={<>Financeiro · <Link href="/financeiro/caixa" className="hover:text-ink">Fechamento de caixa</Link></>}
        title={`Caixa de ${dateBR(c.business_date)}`}
        description={
          `${capitalize(weekdayBR(c.business_date))} · aberto às ${timeBR(c.opened_at)}, fechado às ${timeBR(c.closed_at)} ` +
          `(${duration(c.opened_at, c.closed_at)})` +
          (c.operations_count !== null ? ` · ${c.operations_count} operações` : "")
        }
        actions={
          <div className="flex gap-2 print:hidden">
            <PrintButton label="Imprimir" primary={false} />
            {podeCancelar && <CancelarFechamento id={c.id} data={dateBR(c.business_date)} />}
          </div>
        }
      />

      {outraEmpresa && (
        <Aviso tom="info" icone={<Building2 className="h-4 w-4" strokeWidth={1.8} />}>
          Este fechamento é de <b>{outraEmpresa.trade_name ?? outraEmpresa.legal_name}</b>, não da empresa ativa.
          Para cancelar, troque a empresa no menu lateral.
        </Aviso>
      )}

      {c.cancelled_at ? (
        <Aviso tom="neutro" icone={<Ban className="h-4 w-4" strokeWidth={1.8} />} titulo="Fechamento cancelado">
          Cancelado em {dateTimeBR(c.cancelled_at)}{c.canceller ? ` por ${c.canceller}` : ""}. Motivo: “{c.cancel_reason}”.
          Não entra nos totais nem nos relatórios — se o arquivo estava errado, importe o relatório corrigido deste dia.
        </Aviso>
      ) : c.check_ok ? (
        <p className="mb-4 flex items-center gap-1.5 text-[12.5px] text-accent-ink">
          <CheckCircle2 className="h-4 w-4" strokeWidth={1.8} />
          Conferido — as {c.checks.length} somas do relatório fecham.
        </p>
      ) : (
        <Aviso tom="warn" icone={<AlertTriangle className="h-4 w-4" strokeWidth={1.8} />} titulo="Divergência na conferência">
          {falhas.length === 1 ? "Uma soma do relatório não fecha" : `${falhas.length} somas do relatório não fecham`}:{" "}
          {falhas.map((f) => f.label.toLowerCase()).join("; ")}. Os valores foram guardados como vieram do PDV — confira o
          caixa físico e, se o arquivo estiver errado, cancele e importe de novo.
        </Aviso>
      )}

      <KpiRow
        items={[
          { label: "Pedidos pagos", value: money(c.receipts_total) },
          { label: "Soma das formas", value: money(c.tenders_total), note: "pedidos + troco devolvido" },
          { label: "Dinheiro", value: money(c.cash_total) },
          { label: "Total em títulos", value: money(c.non_cash_total), note: "cartões, PIX e outros" },
          { label: "Troco na gaveta", value: money(c.drawer_balance) },
          { label: "Descontos", value: money(c.discount_total), note: "informativo" },
        ]}
      />

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start print:grid-cols-2">
        <Card title="Formas de pagamento" note={`Percentual sobre a soma das formas (${money(c.tenders_total)}).`}>
          <div className="px-4 py-2">
            <MethodBars methods={c.payments} total={c.tenders_total} />
          </div>
        </Card>

        <Card title="Movimento do caixa" note="O relatório do PDV, linha a linha.">
          <Extrato c={c} />
        </Card>
      </div>

      <Card
        title="Conferência"
        note="O sistema refaz as contas do relatório. Diferença acima de R$ 0,01 marca divergência."
        className="mb-4"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr>
                <th className="th min-w-[260px]">CONTA</th>
                <th className="th w-32 text-right">CALCULADO</th>
                <th className="th w-32 text-right">NO RELATÓRIO</th>
                <th className="th w-28 text-right">DIFERENÇA</th>
                <th className="th w-28">SITUAÇÃO</th>
              </tr>
            </thead>
            <tbody>
              {c.checks.map((k) => {
                const dif = Math.round((k.found - k.expected) * 100) / 100 || 0;
                return (
                  <tr key={k.key}>
                    <td className="td">{k.label}</td>
                    <td className="td text-right font-mono tabular-nums">{money(k.expected)}</td>
                    <td className="td text-right font-mono tabular-nums">{money(k.found)}</td>
                    <td className={`td text-right font-mono tabular-nums ${k.ok ? "text-muted" : "font-semibold text-warn"}`}>
                      {money(dif)}
                    </td>
                    <td className="td">
                      {k.ok ? (
                        <span className="badge bg-accent-soft text-accent-ink">
                          <CheckCircle2 className="h-3 w-3" strokeWidth={2} /> Fecha
                        </span>
                      ) : (
                        <span className="badge bg-warn-soft text-warn">
                          <AlertTriangle className="h-3 w-3" strokeWidth={2} /> Não fecha
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {c.warnings.length > 0 && (
        <Card title="Avisos da leitura" className="mb-4">
          <ul className="space-y-1 px-4 py-3 text-[12.5px] text-graphite">
            {c.warnings.map((w) => (
              <li key={w} className="flex gap-2">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" strokeWidth={1.8} /> {w}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Registro">
        <dl className="grid gap-x-6 gap-y-3 px-4 py-3 text-[12.5px] sm:grid-cols-3">
          <div>
            <dt className="text-[11px] text-muted">Importado por</dt>
            <dd className="font-medium">{c.uploader ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">Importado em</dt>
            <dd className="font-medium">{dateTimeBR(c.created_at)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] text-muted">Arquivo</dt>
            <dd className="truncate font-medium" title={c.source_filename ?? undefined}>{c.source_filename ?? "—"}</dd>
          </div>
        </dl>
        <details className="border-t border-line-soft print:hidden">
          <summary className="cursor-pointer px-4 py-2.5 text-[12.5px] font-medium text-accent hover:underline">
            Ver o relatório original
          </summary>
          <pre className="overflow-x-auto border-t border-line-soft bg-raise px-4 py-3 font-mono text-[11.5px] leading-[1.45]">
            {c.raw_text}
          </pre>
        </details>
      </Card>
    </div>
  );
}

function Aviso({
  tom, icone, titulo, children,
}: {
  tom: "warn" | "neutro" | "info";
  icone: React.ReactNode;
  titulo?: string;
  children: React.ReactNode;
}) {
  const cls = {
    warn: "bg-warn-soft text-warn",
    neutro: "bg-line-soft text-graphite",
    info: "bg-info-soft text-info",
  }[tom];
  return (
    <div className={`mb-4 flex gap-2.5 rounded px-3.5 py-3 text-[12.5px] ${cls}`}>
      <span className="mt-0.5 shrink-0">{icone}</span>
      <div>
        {titulo && <p className="font-semibold">{titulo}</p>}
        <p className={titulo ? "mt-0.5" : ""}>{children}</p>
      </div>
    </div>
  );
}

/** O relatório do PDV reescrito como extrato: entradas, formas, saídas, gaveta. */
function Extrato({ c }: { c: Detalhe }) {
  return (
    <table className="extrato w-full border-collapse text-[12.5px]">
      <tbody>
        <Secao titulo="Entradas" />
        {c.entries.map((l) => (
          <Linha key={`e${l.i}`} rotulo={prettyLabel(l.label)} valor={l.sign === "-" ? -l.amount : l.amount} />
        ))}

        <Secao titulo="Formas de pagamento" />
        {c.payments.map((p) => (
          <Linha key={p.code} rotulo={p.label} valor={p.amount} />
        ))}
        <Linha rotulo="Total em títulos" valor={c.non_cash_total} total nota="formas, exceto dinheiro" />

        <Secao titulo="Saídas" />
        {c.outflows.length === 0 && <Linha rotulo="Nenhuma saída" valor={null} />}
        {c.outflows.map((l) => (
          <Linha
            key={`s${l.i}`}
            rotulo={prettyLabel(l.label)}
            valor={-l.amount}
            nota={/^DESCONTO/.test(l.label) ? "informativo — não sai da gaveta" : undefined}
          />
        ))}
        <Linha rotulo="Total das saídas" valor={-c.outflows_total} total />

        {c.others.length > 0 && (
          <>
            <Secao titulo="Outras linhas do relatório" />
            {c.others.map((l) => (
              <Linha key={`o${l.i}`} rotulo={prettyLabel(l.label)} valor={l.sign === "-" ? -l.amount : l.amount} />
            ))}
          </>
        )}

        <tr className="border-t-2 border-ink">
          <td className="px-4 py-2.5 text-[13px] font-semibold">Troco na gaveta</td>
          <td className="px-4 py-2.5 text-right font-mono text-[13px] font-semibold tabular-nums">{money(c.drawer_balance)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function Secao({ titulo }: { titulo: string }) {
  return (
    <tr>
      <th colSpan={2} scope="colgroup" className="bg-raise px-4 pb-1.5 pt-3 text-left text-[10.5px] font-semibold tracking-[0.07em] text-muted">
        {titulo.toUpperCase()}
      </th>
    </tr>
  );
}

function Linha({ rotulo, valor, total, nota }: { rotulo: string; valor: number | null; total?: boolean; nota?: string }) {
  return (
    <tr className={total ? "border-t border-line" : ""}>
      <td className={`px-4 py-1.5 ${total ? "font-semibold" : valor === null ? "text-muted" : ""}`}>
        {rotulo}
        {nota && <span className="ml-1.5 text-[11px] font-normal text-muted">({nota})</span>}
      </td>
      <td className={`whitespace-nowrap px-4 py-1.5 text-right font-mono tabular-nums ${total ? "font-semibold" : ""}`}>
        {valor === null ? "" : money(valor)}
      </td>
    </tr>
  );
}
