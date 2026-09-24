import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileStack, Receipt } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/page-header";
import { KpiRow } from "@/components/panels";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { date as dataBR, money } from "@/lib/format";
import { todayISO } from "@/lib/caixa";
import {
  normalizePayables, parsePayableFilters, summarizePayables, STATUS_LABEL, type PayableRow,
} from "@/lib/financeiro";
import { FiltrosPagar } from "./filtros";
import { AcoesTitulo } from "./acoes";
import { NovoTitulo } from "./novo-titulo";

export const metadata = { title: "Contas a pagar · Vitória Procurement" };

const LIMITE = 500;

export default async function ContasAPagarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { company, permissions } = await requirePermission("accounts_payable");
  const hoje = todayISO();
  const sp = await searchParams;
  const filtros = parsePayableFilters(sp, hoje);
  const inteiro = (v: unknown) => Math.max(0, Math.min(9999, Number.parseInt(String(Array.isArray(v) ? v[0] : v ?? ""), 10) || 0));
  const gerados = inteiro(sp.gerados);
  const notasGeradas = inteiro(sp.notas);
  const pulados = inteiro(sp.pulados);
  const supabase = await createClient();

  const [{ data, error }, { data: forn }, { count: totalGeral }, { count: pendentes }] = await Promise.all([
    supabase.rpc("search_payables", {
      _company_id: company.id,
      _from: filtros.de,
      _to: filtros.ate,
      _supplier: filtros.fornecedor || null,
      _status: filtros.situacao || null,
      _search: filtros.busca || null,
      _limit: LIMITE,
    }),
    supabase.from("suppliers").select("id, trade_name, legal_name")
      .eq("company_id", company.id).is("deleted_at", null).order("trade_name"),
    supabase.from("payables").select("id", { count: "exact", head: true }).eq("company_id", company.id),
    supabase.from("received_invoice_duplicates").select("id", { count: "exact", head: true })
      .eq("company_id", company.id),
  ]);

  if (error) console.error("[contas a pagar] busca", error);

  const rows: PayableRow[] = normalizePayables(data);
  const resumo = summarizePayables(rows, hoje);
  const fornecedores = ((forn ?? []) as any[]).map((f) => ({
    id: f.id as string, nome: (f.trade_name ?? f.legal_name) as string,
  }));

  const podeCriar = permissions.has("accounts_payable.create");
  const podeEditar = permissions.has("accounts_payable.edit");
  const podeCancelar = permissions.has("accounts_payable.cancel");
  const podePagar = permissions.has("payments.pay");
  const temAcoes = podePagar || podeEditar || podeCancelar;
  const nenhumAinda = (totalGeral ?? 0) === 0;

  return (
    <div className="max-w-[1240px] px-6 pb-14 pt-5">
      <PageHeader
        crumb="Financeiro"
        title="Contas a pagar"
        description={`Compromissos de ${company.trade_name ?? company.legal_name}: o que vence, o que está vencido e o que já foi pago.`}
        actions={
          <>
            <Link href="/financeiro/duplicatas" className="btn">
              <FileStack className="h-3.5 w-3.5" /> Duplicatas das notas
            </Link>
            {podeCriar && <NovoTitulo fornecedores={fornecedores} hoje={hoje} />}
          </>
        }
      />

      {gerados > 0 && (
        <div role="status" className="mb-4 flex gap-2.5 rounded bg-accent-soft px-3.5 py-3 text-[12.5px] text-accent-ink">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
          <p>
            <b>{gerados} {gerados === 1 ? "título gerado" : "títulos gerados"}</b>
            {notasGeradas > 0 && <> a partir de {notasGeradas} {notasGeradas === 1 ? "nota" : "notas"}</>}
            {pulados > 0 ? ` — ${pulados} já existiam e foram mantidos.` : "."}
          </p>
        </div>
      )}

      {nenhumAinda ? (
        <div className="card">
          <EmptyState
            title="Nenhum título a pagar ainda"
            hint={
              (pendentes ?? 0) > 0
                ? "As notas já importadas trazem duplicatas esperando virar título. Gere os títulos na tela de duplicatas."
                : "Importe os XMLs das notas para trazer as duplicatas, ou crie um título avulso (aluguel, imposto, serviço)."
            }
            action={
              <div className="flex justify-center gap-2">
                <Link href="/financeiro/duplicatas" className="btn btn-primary inline-flex">
                  <FileStack className="h-3.5 w-3.5" /> Ver duplicatas das notas
                </Link>
                {podeCriar && <NovoTitulo fornecedores={fornecedores} hoje={hoje} />}
              </div>
            }
          />
        </div>
      ) : (
        <>
          <FiltrosPagar filtros={filtros} fornecedores={fornecedores} hoje={hoje} />

          <KpiRow
            items={[
              { label: "Em aberto", value: money(resumo.aberto), note: `${dataBR(filtros.de)} a ${dataBR(filtros.ate)}` },
              ...(resumo.vencidoCount > 0
                ? [{ label: "Vencido", value: money(resumo.vencido), note: `${resumo.vencidoCount} ${resumo.vencidoCount === 1 ? "título" : "títulos"}`, tone: "warn" as const }]
                : []),
              { label: "Vence em 7 dias", value: money(resumo.semana), note: `${resumo.semanaCount} ${resumo.semanaCount === 1 ? "título" : "títulos"}` },
              { label: "Pago no período", value: money(resumo.pago) },
              { label: "Títulos", value: String(resumo.count) },
            ]}
          />

          <div className="card overflow-x-auto">
            {rows.length === 0 ? (
              <EmptyState
                title="Nenhum título com esses filtros"
                hint="Amplie o período ou limpe o fornecedor e a busca."
                action={<Link href="/financeiro/contas-a-pagar" className="btn inline-flex">Limpar filtros</Link>}
              />
            ) : (
              <table className={`w-full border-collapse ${temAcoes ? "min-w-[1020px] table-fixed" : "min-w-[880px]"}`}>
                <thead>
                  <tr>
                    <th className="th w-28">VENCIMENTO</th>
                    <th className="th">TÍTULO</th>
                    <th className="th w-60">FORNECEDOR</th>
                    <th className="th w-32 text-right">VALOR</th>
                    <th className="th w-32 text-right">SALDO</th>
                    <th className="th w-32">SITUAÇÃO</th>
                    {temAcoes && <th className="th w-[168px]" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const vencida = r.days_late > 0;
                    return (
                      <tr key={r.id} className={`align-top hover:bg-raise ${r.status === "cancelado" ? "opacity-60" : ""}`}>
                        <td className="td whitespace-nowrap">
                          {dataBR(r.due_date)}
                          {vencida && (
                            <span className="block text-[11px] font-medium text-danger">
                              {r.days_late} {r.days_late === 1 ? "dia" : "dias"} em atraso
                            </span>
                          )}
                        </td>
                        <td className="td">
                          <div className="min-w-0">
                            {r.invoice_id ? (
                              <>
                                <Link href={`/notas/${r.invoice_id}`}
                                      className="inline-flex max-w-full items-center gap-1 font-medium hover:text-accent hover:underline"
                                      title="Abrir a nota">
                                  <Receipt className="h-3.5 w-3.5 shrink-0 text-muted" />
                                  <span className="truncate">NF {r.invoice_number ?? "s/nº"}</span>
                                </Link>
                                <div className="truncate text-[11px] text-muted">
                                  {(r.document ?? "").split(" · ")[1] ?? "parcela única"}
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="truncate font-medium" title={r.description}>{r.description}</div>
                                <div className="truncate text-[11px] text-muted">{r.document ?? "título avulso"}</div>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="td">
                          <div className="min-w-0 truncate" title={r.supplier_name ?? ""}>
                            {r.supplier_name ?? <span className="text-muted">—</span>}
                          </div>
                          {!r.supplier_id && r.origin === "nfe" && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-warn">
                              <AlertTriangle className="h-3 w-3" /> fornecedor não cadastrado
                            </span>
                          )}
                        </td>
                        <td className="td text-right font-mono tabular-nums">{money(r.amount)}</td>
                        <td className="td text-right font-mono font-semibold tabular-nums">
                          {money(r.balance)}
                          {r.paid_amount > 0 && r.status !== "pago" && (
                            <span className="block text-[11px] font-normal text-muted">pago {money(r.paid_amount)}</span>
                          )}
                        </td>
                        <td className="td">
                          <span className={`badge ${
                            r.status === "pago" ? "bg-accent-soft text-accent-ink"
                            : r.status === "cancelado" ? "bg-line-soft text-graphite"
                            : vencida ? "bg-danger-soft text-danger"
                            : r.status === "parcial" ? "bg-warn-soft text-warn"
                            : "bg-line-soft text-graphite"}`}>
                            {vencida && r.status !== "cancelado" ? "Vencida" : STATUS_LABEL[r.status] ?? r.status}
                          </span>
                        </td>
                        {temAcoes && (
                          <td className="td">
                            <AcoesTitulo titulo={r} hoje={hoje} podePagar={podePagar}
                                         podeEditar={podeEditar} podeCancelar={podeCancelar} />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {rows.length > 0 && (
              <div className="border-t border-line-soft px-4 py-2.5 text-[11.5px] text-muted">
                {rows.length === LIMITE
                  ? `Mostrando os ${LIMITE} títulos mais próximos do filtro — reduza o período para ver todos.`
                  : `${rows.length} ${rows.length === 1 ? "título" : "títulos"} no filtro.`}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
