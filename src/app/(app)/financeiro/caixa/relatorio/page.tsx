import Link from "next/link";
import type { Metadata } from "next";
import { AlertTriangle, ArrowLeft, CheckCircle2 } from "lucide-react";
import { EmptyState } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { cnpj, dateTime, decimal, money } from "@/lib/format";
import {
  dateBR, filtersToQuery, methodFilterLabel, normalizeRows, parseFilters, summarize,
  todayISO, weekdayShortBR, type MethodTotal, type PaymentMethod,
} from "@/lib/caixa";
import { FilterBar } from "../_components/filter-bar";
import { Card, CheckBadge, KpiRow, MethodBars } from "../_components/ui";
import { DailyChart } from "../_components/daily-chart";
import { ExportCsvButton, PrintButton } from "../_components/export-buttons";

type SP = Promise<Record<string, string | string[] | undefined>>;

const LIMITE = 1000;
const round2 = (v: number) => Math.round(v * 100) / 100;
const pct = (v: number, total: number) =>
  total > 0 ? `${((v / total) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : "—";
const plural = (n: number, um: string, varios: string) => `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;
const linhas_ = <T extends { business_date: string; opened_at: string }>(rows: T[]) =>
  [...rows].sort((a, b) => a.business_date.localeCompare(b.business_date) || a.opened_at.localeCompare(b.opened_at));

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const f = parseFilters(await searchParams, todayISO());
  const d = (s: string) => dateBR(s).replaceAll("/", "-");
  // O título vira o nome do arquivo ao salvar em PDF.
  return { title: `Relatório de caixa ${d(f.de)} a ${d(f.ate)}` };
}

export default async function RelatorioCaixaPage({ searchParams }: { searchParams: SP }) {
  const { company, user } = await requirePermission("cash", "export");
  const today = todayISO();
  const filtros = parseFilters(await searchParams, today);
  const supabase = await createClient();

  const [{ data, error }, { data: metodos }] = await Promise.all([
    supabase.rpc("search_cash_closings", {
      _company_id: company.id,
      _from: filtros.de,
      _to: filtros.ate,
      _method: filtros.modalidade || null,
      _min: filtros.min,
      _max: filtros.max,
      _include_cancelled: filtros.cancelados,
      _limit: LIMITE,
    }),
    supabase
      .from("cash_payment_methods")
      .select("code, label, kind, acquirer, sort_order")
      .eq("company_id", company.id)
      .order("sort_order")
      .order("label"),
  ]);
  if (error) console.error("[caixa] relatório", error);

  const rows = normalizeRows(data);
  const ativos = rows.filter((r) => !r.cancelled_at);
  const methods = (metodos ?? []) as PaymentMethod[];
  const resumo = summarize(rows);
  const nomeModalidade = methodFilterLabel(filtros.modalidade, methods);
  const query = filtersToQuery(filtros);

  // Um ponto por dia: dois caixas no mesmo dia somam.
  const porDia = new Map<string, number>();
  for (const r of ativos) porDia.set(r.business_date, (porDia.get(r.business_date) ?? 0) + r.receipts_total);
  const serie = [...porDia.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value: round2(value) }));
  const maior = serie.length ? serie.reduce((m, p) => (p.value > m.value ? p : m)) : null;
  const menor = serie.length ? serie.reduce((m, p) => (p.value < m.value ? p : m)) : null;

  // Uma coluna por forma de pagamento usada no período, na ordem do cadastro.
  const usadas = new Map<string, string>();
  for (const r of rows) for (const p of r.payments) if (!usadas.has(p.code)) usadas.set(p.code, p.label);
  const ordem = new Map(methods.map((m, i) => [m.code, i]));
  const colunas = [...usadas.entries()]
    .sort(([a], [b]) => (ordem.get(a) ?? 999) - (ordem.get(b) ?? 999))
    .map(([code, label]) => ({ code, label }));
  const totalColuna = (code: string) =>
    round2(ativos.reduce((s, r) => s + (r.payments.find((p) => p.code === code)?.amount ?? 0), 0));

  const divergentes = linhas_(rows).filter((r) => !r.cancelled_at && !r.check_ok);
  const linhas = linhas_(rows);

  const porTipo: MethodTotal[] = resumo.kinds.map((k) => ({
    code: k.kind, label: k.label, kind: k.kind, acquirer: null, amount: k.amount, days: 0,
  }));
  const totalCartoes = round2(resumo.acquirers.reduce((s, a) => s + a.total, 0));
  const temOutrosNaMaquininha = resumo.acquirers.some((a) => a.outros !== 0);

  const partes: string[] = [nomeModalidade ? `Modalidade: ${nomeModalidade}` : "Todas as modalidades"];
  const alvo = nomeModalidade ? `valor em ${nomeModalidade}` : "pedidos pagos no dia";
  if (filtros.min !== null && filtros.max !== null) partes.push(`${alvo} entre ${money(filtros.min)} e ${money(filtros.max)}`);
  else if (filtros.min !== null) partes.push(`${alvo} a partir de ${money(filtros.min)}`);
  else if (filtros.max !== null) partes.push(`${alvo} até ${money(filtros.max)}`);
  if (filtros.cancelados) partes.push("cancelados listados, fora dos totais");

  return (
    <div className="max-w-[1240px] px-6 pb-14 pt-5 print:max-w-none print:px-0 print:pb-0 print:pt-0">
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Link href={{ pathname: "/financeiro/caixa", query }} className="btn">
          <ArrowLeft className="h-3.5 w-3.5" /> Fechamentos
        </Link>
        <div className="ml-auto flex flex-wrap gap-2">
          <ExportCsvButton rows={rows} filename={`caixa_${filtros.de}_a_${filtros.ate}.csv`} />
          <PrintButton />
        </div>
      </div>

      <FilterBar filters={filtros} methods={methods} action="/financeiro/caixa/relatorio" today={today} />

      <header className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-2 border-b border-line pb-3">
        <div>
          <p className="text-[11.5px] text-muted">
            {company.legal_name} · CNPJ <span className="font-mono">{cnpj(company.cnpj)}</span>
          </p>
          <h1 className="mt-0.5 text-[22px] font-semibold">Relatório de fechamento de caixa</h1>
          <p className="mt-0.5 text-[12.5px] text-graphite">
            <b className="font-semibold text-ink">{dateBR(filtros.de)} a {dateBR(filtros.ate)}</b> · {partes.join(" · ")}
          </p>
        </div>
        <p className="ml-auto text-right text-[11px] text-muted">
          Gerado em {dateTime(new Date().toISOString())}
          <br />
          por {user.full_name}
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Nenhum fechamento com esses filtros"
            hint="Amplie o período ou limpe a modalidade e os valores."
          />
        </div>
      ) : (
        <>
          <KpiRow
            items={[
              { label: "Pedidos pagos", value: money(resumo.receipts), note: plural(resumo.count, "fechamento", "fechamentos") },
              {
                label: "Média por dia",
                value: money(serie.length ? resumo.receipts / serie.length : 0),
                note: plural(serie.length, "dia com caixa", "dias com caixa"),
              },
              ...(maior && menor && serie.length > 1
                ? [
                    { label: "Maior dia", value: money(maior.value), note: `${dateBR(maior.date)} · ${weekdayShortBR(maior.date)}` },
                    { label: "Menor dia", value: money(menor.value), note: `${dateBR(menor.date)} · ${weekdayShortBR(menor.date)}` },
                  ]
                : []),
              {
                label: "Operações",
                value: resumo.operations.toLocaleString("pt-BR"),
                note: resumo.operations > 0 ? `média de ${money(resumo.receipts / resumo.operations)}` : undefined,
              },
              nomeModalidade
                ? { label: `Em ${nomeModalidade}`, value: money(resumo.selected), note: `${pct(resumo.selected, resumo.tenders)} da soma das formas` }
                : { label: "Dinheiro", value: money(resumo.cash), note: `${pct(resumo.cash, resumo.tenders)} da soma das formas` },
              { label: "Descontos", value: money(resumo.discounts), note: "informativo" },
            ]}
          />

          {divergentes.length > 0 ? (
            <p className="mb-4 flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded bg-warn-soft px-3.5 py-2.5 text-[12.5px] text-warn">
              <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.8} />
              <b className="font-semibold">
                {plural(divergentes.length, "fechamento com divergência", "fechamentos com divergência")}:
              </b>
              {divergentes.map((r, i) => (
                <span key={r.id}>
                  <Link href={`/financeiro/caixa/${r.id}`} className="underline underline-offset-2 hover:no-underline">
                    {dateBR(r.business_date)}
                  </Link>
                  {i < divergentes.length - 1 ? "," : ""}
                </span>
              ))}
              <span className="text-graphite">— as somas do relatório não fecham; confira o caixa físico.</span>
            </p>
          ) : resumo.count > 0 ? (
            <p className="mb-4 flex items-center gap-1.5 text-[12.5px] text-accent-ink">
              <CheckCircle2 className="h-4 w-4" strokeWidth={1.8} />
              {resumo.count === 1
                ? "Conferência: o fechamento do período fecha sem divergência."
                : `Conferência: os ${resumo.count} fechamentos do período fecham sem divergência.`}
            </p>
          ) : null}

          <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start print:grid-cols-2">
            <Card
              title="Por forma de pagamento"
              note={`Percentual sobre a soma das formas (${money(resumo.tenders)}) — pedidos pagos + troco devolvido.`}
            >
              <div className="px-4 py-2">
                <MethodBars methods={resumo.methods} total={resumo.tenders} showDays />
              </div>
            </Card>

            <div className="grid min-w-0 grid-cols-1 gap-4">
              <Card title="Por tipo" note="Percentual sobre a soma das formas.">
                <div className="px-4 py-2">
                  <MethodBars methods={porTipo} total={resumo.tenders} />
                </div>
              </Card>

              {resumo.acquirers.length > 0 && (
                <Card title="Cartões por maquininha" note={`Total nas maquininhas: ${money(totalCartoes)}. Valores em R$.`}>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <th className="th">MAQUININHA</th>
                          <th className="th text-right">DÉBITO</th>
                          <th className="th text-right">CRÉDITO</th>
                          {temOutrosNaMaquininha && <th className="th text-right">OUTROS</th>}
                          <th className="th text-right">TOTAL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resumo.acquirers.map((a) => (
                          <tr key={a.acquirer}>
                            <td className="td">
                              <span className="font-medium">{a.acquirer}</span>
                              <span className="block text-[11px] text-muted">{pct(a.total, totalCartoes)} do total</span>
                            </td>
                            <td className="td text-right font-mono tabular-nums">{decimal(a.debito)}</td>
                            <td className="td text-right font-mono tabular-nums">{decimal(a.credito)}</td>
                            {temOutrosNaMaquininha && <td className="td text-right font-mono tabular-nums">{decimal(a.outros)}</td>}
                            <td className="td text-right font-mono font-semibold tabular-nums">{decimal(a.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          </div>

          {serie.length >= 2 && (
            <Card title="Pedidos pagos por dia" note="Só os dias com caixa. Passe o dedo ou o mouse nas colunas para ver o valor." className="mb-4">
              <div className="px-3 pb-2 pt-3">
                <DailyChart points={serie} title="Pedidos pagos por dia" />
              </div>
            </Card>
          )}

          <Card
            className="print-break-ok"
            title="Fechamentos do período"
            note={`${plural(rows.length, "fechamento", "fechamentos")}${resumo.cancelled ? ` — ${resumo.cancelled} cancelado(s), fora dos totais` : ""}. Valores em R$.`}
          >
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="th">DATA</th>
                    <th className="th text-right">OPER.</th>
                    <th className="th text-right">PEDIDOS PAGOS</th>
                    {colunas.map((c) => (
                      <th key={c.code} className="th text-right">{c.label.toUpperCase()}</th>
                    ))}
                    <th className="th text-right">DESCONTOS</th>
                    <th className="th text-right">GAVETA</th>
                    <th className="th">CONFERÊNCIA</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((r) => {
                    const porCodigo = new Map(r.payments.map((p) => [p.code, p.amount]));
                    return (
                      <tr key={r.id} className={r.cancelled_at ? "opacity-60" : ""}>
                        <td className="td whitespace-nowrap py-2">
                          <Link href={`/financeiro/caixa/${r.id}`} className="font-semibold hover:text-accent hover:underline">
                            {dateBR(r.business_date)}
                          </Link>{" "}
                          <span className="text-muted">{weekdayShortBR(r.business_date)}</span>
                        </td>
                        <td className="td py-2 text-right font-mono tabular-nums">{r.operations_count ?? "—"}</td>
                        <td className="td py-2 text-right font-mono font-semibold tabular-nums">{decimal(r.receipts_total)}</td>
                        {colunas.map((c) => (
                          <td key={c.code} className="td py-2 text-right font-mono tabular-nums">
                            {porCodigo.has(c.code) ? decimal(porCodigo.get(c.code)) : <span className="text-muted">—</span>}
                          </td>
                        ))}
                        <td className="td py-2 text-right font-mono tabular-nums">{decimal(r.discount_total)}</td>
                        <td className="td py-2 text-right font-mono tabular-nums">{decimal(r.drawer_balance)}</td>
                        <td className="td py-2"><CheckBadge ok={r.check_ok} cancelled={!!r.cancelled_at} /></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="td border-t-2 border-t-ink py-2.5 font-semibold">Total</td>
                    <td className="td border-t-2 border-t-ink py-2.5 text-right font-mono font-semibold tabular-nums">
                      {resumo.operations.toLocaleString("pt-BR")}
                    </td>
                    <td className="td border-t-2 border-t-ink py-2.5 text-right font-mono font-semibold tabular-nums">
                      {decimal(resumo.receipts)}
                    </td>
                    {colunas.map((c) => (
                      <td key={c.code} className="td border-t-2 border-t-ink py-2.5 text-right font-mono font-semibold tabular-nums">
                        {decimal(totalColuna(c.code))}
                      </td>
                    ))}
                    <td className="td border-t-2 border-t-ink py-2.5 text-right font-mono font-semibold tabular-nums">
                      {decimal(resumo.discounts)}
                    </td>
                    <td className="td border-t-2 border-t-ink py-2.5" />
                    <td className="td border-t-2 border-t-ink py-2.5 text-[11.5px] text-graphite">
                      {resumo.divergent > 0 ? plural(resumo.divergent, "divergência", "divergências") : "Tudo confere"}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {rows.length === LIMITE && (
              <p className="border-t border-line-soft px-4 py-2.5 text-[11.5px] text-warn">
                O relatório parou nos {LIMITE} fechamentos mais recentes do filtro — reduza o período para incluir todos.
              </p>
            )}
          </Card>

          <p className="mt-4 text-[11px] leading-relaxed text-muted">
            Valores lidos dos relatórios de fechamento do PDV e conferidos pelo sistema. Soma das formas = pedidos pagos +
            troco devolvido; os percentuais usam essa soma. Descontos são informativos (não saem da gaveta). Troco na
            gaveta é o saldo de cada dia e não se soma. Fechamentos cancelados não entram nos totais.
          </p>
        </>
      )}
    </div>
  );
}
