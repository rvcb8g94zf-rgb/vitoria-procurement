import Link from "next/link";
import { AlertTriangle, ChevronRight, Upload } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/page-header";
import { KpiRow } from "@/components/panels";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { cnpj, date as dataBR, money } from "@/lib/format";
import { todayISO } from "@/lib/caixa";
import {
  STATUS_LABEL, normalizeInvoices, parseInvoiceFilters, summarizeInvoices, type InvoiceRow,
} from "@/lib/notas";
import { FiltrosNotas } from "./filtros";

export const metadata = { title: "Notas fiscais · Vitória Procurement" };

const LIMITE = 500;

export default async function NotasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { company, permissions } = await requirePermission("invoices");
  const hoje = todayISO();
  const filtros = parseInvoiceFilters(await searchParams, hoje);
  const supabase = await createClient();

  const [{ data, error }, { data: forn }, { count: totalGeral }] = await Promise.all([
    supabase.rpc("search_received_invoices", {
      _company_id: company.id,
      _from: filtros.de,
      _to: filtros.ate,
      _supplier: filtros.fornecedor || null,
      _status: filtros.situacao || null,
      _search: filtros.busca || null,
      _limit: LIMITE,
    }),
    supabase
      .from("suppliers")
      .select("id, trade_name, legal_name")
      .eq("company_id", company.id)
      .is("deleted_at", null)
      .order("trade_name"),
    supabase.from("received_invoices").select("id", { count: "exact", head: true }).eq("company_id", company.id),
  ]);

  if (error) console.error("[notas] busca", error);

  const rows: InvoiceRow[] = normalizeInvoices(data);
  const resumo = summarizeInvoices(rows, hoje);
  const fornecedores = ((forn ?? []) as any[]).map((f) => ({
    id: f.id as string,
    nome: (f.trade_name ?? f.legal_name) as string,
  }));
  const nenhumaAinda = (totalGeral ?? 0) === 0;

  return (
    <div className="max-w-[1240px] px-6 pb-14 pt-5">
      <PageHeader
        crumb="Notas fiscais"
        title="Notas recebidas"
        description={`Compras de ${company.trade_name ?? company.legal_name}, vindas do XML ou da consulta automática.`}
        actions={
          permissions.has("xml_import.import") ? (
            <Link href="/notas/importar" className="btn btn-primary">
              <Upload className="h-3.5 w-3.5" /> Importar XML
            </Link>
          ) : undefined
        }
      />

      {nenhumaAinda ? (
        <div className="card">
          <EmptyState
            title="Nenhuma nota importada ainda"
            hint="Envie os XMLs que a contabilidade ou o fornecedor mandam. O sistema lê a nota, separa os itens, guarda as duplicatas e liga tudo ao cadastro."
            action={
              permissions.has("xml_import.import") ? (
                <Link href="/notas/importar" className="btn btn-primary inline-flex">
                  <Upload className="h-3.5 w-3.5" /> Importar a primeira nota
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <FiltrosNotas filters={filtros} fornecedores={fornecedores} hoje={hoje} />

          <KpiRow
            items={[
              { label: "Total em notas", value: money(resumo.total), note: `${dataBR(filtros.de)} a ${dataBR(filtros.ate)}` },
              { label: "Notas", value: String(resumo.count) },
              { label: "Vencendo em 7 dias", value: String(resumo.aVencer), note: "duplicatas da nota" },
              ...(resumo.semFornecedor > 0
                ? [{ label: "Sem fornecedor", value: String(resumo.semFornecedor), note: "aguardando cadastro", tone: "warn" as const }]
                : []),
              ...(resumo.resumos > 0
                ? [{ label: "Só resumo", value: String(resumo.resumos), note: "falta o XML completo" }]
                : []),
              ...(resumo.canceladas > 0 ? [{ label: "Canceladas", value: String(resumo.canceladas) }] : []),
            ]}
          />

          <div className="card overflow-x-auto">
            {rows.length === 0 ? (
              <EmptyState
                title="Nenhuma nota com esses filtros"
                hint="Amplie o período ou limpe o fornecedor e a busca."
                action={<Link href="/notas" className="btn inline-flex">Limpar filtros</Link>}
              />
            ) : (
              <table className="w-full min-w-[980px] border-collapse">
                <thead>
                  <tr>
                    <th className="th w-28">EMISSÃO</th>
                    <th className="th w-28">NÚMERO</th>
                    <th className="th">FORNECEDOR</th>
                    <th className="th w-36 text-right">VALOR</th>
                    <th className="th w-20 text-right">ITENS</th>
                    <th className="th w-40">DUPLICATAS</th>
                    <th className="th w-32">SITUAÇÃO</th>
                    <th className="th w-8" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={`hover:bg-raise ${r.fiscal_status === "cancelada" ? "opacity-60" : ""}`}>
                      <td className="td whitespace-nowrap">{dataBR(r.issued_at)}</td>
                      <td className="td whitespace-nowrap">
                        <Link href={`/notas/${r.id}`} className="font-semibold hover:text-accent hover:underline">
                          {r.number ?? "s/nº"}
                        </Link>
                        {r.series && <span className="text-[11px] text-muted">/{r.series}</span>}
                      </td>
                      <td className="td">
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {r.supplier_name ?? r.emitter_name ?? "—"}
                          </div>
                          <div className="text-[11px] text-muted">
                            <span className="font-mono">{cnpj(r.emitter_cnpj)}</span>
                            {!r.supplier_id && (
                              <span className="ml-1.5 inline-flex items-center gap-1 text-warn">
                                <AlertTriangle className="h-3 w-3" /> fornecedor não cadastrado
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="td text-right font-mono font-semibold tabular-nums">{money(r.total_amount)}</td>
                      <td className="td text-right font-mono tabular-nums text-graphite">{r.item_count ?? "—"}</td>
                      <td className="td text-[12px]">
                        {r.duplicates_count === 0 ? (
                          <span className="text-muted">sem parcelas</span>
                        ) : (
                          <>
                            {r.duplicates_count} {r.duplicates_count === 1 ? "parcela" : "parcelas"}
                            {r.next_due && (
                              <span className="block text-[11px] text-muted">próxima em {dataBR(r.next_due)}</span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="td">
                        <span className={`badge ${
                          r.fiscal_status === "autorizada" ? "bg-accent-soft text-accent-ink"
                          : r.fiscal_status === "cancelada" ? "bg-danger-soft text-danger"
                          : "bg-line-soft text-graphite"}`}>
                          {STATUS_LABEL[r.fiscal_status] ?? r.fiscal_status}
                        </span>
                        {r.doc_kind === "resumo" && (
                          <span className="mt-1 block text-[11px] text-muted">só resumo</span>
                        )}
                      </td>
                      <td className="td text-right">
                        <Link href={`/notas/${r.id}`} aria-label={`Abrir a nota ${r.number ?? ""}`} className="text-muted hover:text-ink">
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
                  ? `Mostrando as ${LIMITE} notas mais recentes do filtro — reduza o período para ver todas.`
                  : `${rows.length} ${rows.length === 1 ? "nota" : "notas"} no filtro.`}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
