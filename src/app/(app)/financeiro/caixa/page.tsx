import Link from "next/link";
import { BarChart3, ChevronRight, Upload } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";
import {
  capitalize, dateBR, filtersToQuery, methodFilterLabel, normalizeRows, parseFilters,
  summarize, timeBR, todayISO, weekdayBR, type PaymentMethod,
} from "@/lib/caixa";
import { FilterBar } from "./_components/filter-bar";
import { Card, CheckBadge, KpiRow, MethodBars } from "./_components/ui";

export const metadata = { title: "Fechamento de caixa · Vitória Procurement" };

const LIMITE = 1000;

export default async function CaixaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { company, permissions } = await requirePermission("cash");
  const today = todayISO();
  const filtros = parseFilters(await searchParams, today);
  const supabase = await createClient();

  const [{ data, error }, { data: metodos }, { count: totalGeral }] = await Promise.all([
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
    supabase.from("cash_closings").select("id", { count: "exact", head: true }).eq("company_id", company.id),
  ]);

  if (error) console.error("[caixa] busca", error);

  const rows = normalizeRows(data);
  const methods = (metodos ?? []) as PaymentMethod[];
  const resumo = summarize(rows);
  const nomeModalidade = methodFilterLabel(filtros.modalidade, methods);
  const query = filtersToQuery(filtros);
  const nenhumAinda = (totalGeral ?? 0) === 0;

  return (
    <div className="max-w-[1240px] px-6 pb-14 pt-5 print:max-w-none print:p-0">
      <PageHeader
        crumb="Financeiro"
        title="Fechamento de caixa"
        description={`Relatórios diários do caixa da loja — ${company.trade_name ?? company.legal_name}.`}
        actions={
          <>
            {permissions.has("cash.export") && !nenhumAinda && (
              <Link href={{ pathname: "/financeiro/caixa/relatorio", query }} className="btn">
                <BarChart3 className="h-3.5 w-3.5" /> Gerar relatório
              </Link>
            )}
            {permissions.has("cash.create") && (
              <Link href="/financeiro/caixa/importar" className="btn btn-primary">
                <Upload className="h-3.5 w-3.5" /> Importar relatório
              </Link>
            )}
          </>
        }
      />

      {nenhumAinda ? (
        <div className="card">
          <EmptyState
            title="Nenhum fechamento importado ainda"
            hint="Envie o arquivo do relatório de caixa do dia. O sistema lê os valores, confere as somas e guarda para consulta."
            action={
              permissions.has("cash.create") ? (
                <Link href="/financeiro/caixa/importar" className="btn btn-primary inline-flex">
                  <Upload className="h-3.5 w-3.5" /> Importar o primeiro relatório
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <FilterBar filters={filtros} methods={methods} action="/financeiro/caixa" today={today} />

          <KpiRow
            items={[
              { label: "Pedidos pagos", value: money(resumo.receipts), note: `${dateBR(filtros.de)} a ${dateBR(filtros.ate)}` },
              { label: "Fechamentos", value: String(resumo.count), note: resumo.cancelled ? `${resumo.cancelled} cancelado(s) na lista` : undefined },
              { label: "Média por fechamento", value: money(resumo.average) },
              nomeModalidade
                ? { label: `Em ${nomeModalidade}`, value: money(resumo.selected), note: "no período filtrado" }
                : { label: "Descontos concedidos", value: money(resumo.discounts) },
              ...(resumo.divergent > 0
                ? [{ label: "Com divergência", value: String(resumo.divergent), note: "somas que não fecham", tone: "warn" as const }]
                : []),
            ]}
          />

          {resumo.methods.length > 0 && (
            <Card
              title="Por forma de pagamento"
              note="Soma das formas = pedidos pagos + troco devolvido. Percentual sobre a soma das formas."
              className="mb-4"
            >
              <div className="px-4 py-2">
                <MethodBars methods={resumo.methods} total={resumo.tenders} />
              </div>
            </Card>
          )}

          <div className="card overflow-x-auto">
            {rows.length === 0 ? (
              <EmptyState
                title="Nenhum fechamento encontrado com esses filtros"
                hint="Amplie o período ou limpe a modalidade e os valores."
                action={<Link href="/financeiro/caixa" className="btn inline-flex">Limpar filtros</Link>}
              />
            ) : (
              <table className="w-full min-w-[860px] border-collapse">
                <thead>
                  <tr>
                    <th className="th">DATA</th>
                    <th className="th w-32">CAIXA</th>
                    <th className="th w-36 text-right">PEDIDOS PAGOS</th>
                    {nomeModalidade && <th className="th w-36 text-right">{nomeModalidade.toUpperCase()}</th>}
                    <th className="th w-32 text-right">DINHEIRO</th>
                    <th className="th w-36 text-right">CARTÕES, PIX E OUTROS</th>
                    <th className="th w-32 text-right">GAVETA</th>
                    <th className="th w-32">CONFERÊNCIA</th>
                    <th className="th w-8" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={`hover:bg-raise ${r.cancelled_at ? "opacity-60" : ""}`}>
                      <td className="td whitespace-nowrap">
                        <Link href={`/financeiro/caixa/${r.id}`} className="font-semibold hover:text-accent hover:underline">
                          {dateBR(r.business_date)}
                        </Link>
                        <span className="block whitespace-nowrap text-[11px] text-muted">{capitalize(weekdayBR(r.business_date))}</span>
                      </td>
                      <td className="td whitespace-nowrap font-mono tabular-nums text-graphite">
                        {timeBR(r.opened_at)}–{timeBR(r.closed_at)}
                      </td>
                      <td className="td text-right font-mono font-semibold tabular-nums">{money(r.receipts_total)}</td>
                      {nomeModalidade && (
                        <td className="td text-right font-mono tabular-nums text-accent-ink">{money(r.selected_amount)}</td>
                      )}
                      <td className="td text-right font-mono tabular-nums">{money(r.cash_total)}</td>
                      <td className="td text-right font-mono tabular-nums">{money(r.non_cash_total)}</td>
                      <td className="td text-right font-mono tabular-nums">{money(r.drawer_balance)}</td>
                      <td className="td"><CheckBadge ok={r.check_ok} cancelled={!!r.cancelled_at} /></td>
                      <td className="td text-right">
                        <Link href={`/financeiro/caixa/${r.id}`} aria-label={`Abrir o caixa de ${dateBR(r.business_date)}`}
                              className="text-muted hover:text-ink">
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {rows.length > 0 && (
              <div className="border-t border-line-soft px-4 py-2.5 text-[11.5px] text-muted">
                {rows.length === LIMITE
                  ? `Mostrando os ${LIMITE} fechamentos mais recentes do filtro — reduza o período para ver todos.`
                  : `${rows.length} ${rows.length === 1 ? "fechamento" : "fechamentos"} no filtro.`}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
