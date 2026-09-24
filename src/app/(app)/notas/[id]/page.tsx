import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle, Ban, FileText, Package } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, KpiRow } from "@/components/panels";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { cnpj, date as dataBR, dateTime, decimal, money } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/notas";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const n = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const um = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

const carregar = cache(async (id: string) => {
  if (!UUID.test(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("received_invoices")
    .select(`
      id, company_id, access_key, number, series, issued_at, operation, emitter_name, emitter_cnpj,
      emitter_ie, emitter_uf, dest_cnpj, total_amount, products_total, discount_total, freight_total,
      insurance_total, other_total, icms_st_total, ipi_total, item_count, doc_kind, fiscal_status,
      protocol, source, source_filename, xml_content, created_at, supplier_id, manifestation, nsu,
      supplier:suppliers(id, legal_name, trade_name),
      importer:users!received_invoices_imported_by_fkey(full_name),
      items:received_invoice_items(*),
      duplicates:received_invoice_duplicates(seq, number, due_date, amount)
    `)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[notas] detalhe", error);
    return null;
  }
  return (data as any) ?? null;
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const nota = await carregar(id);
  return { title: nota ? `NF-e ${nota.number ?? ""} · Vitória Procurement` : "Nota fiscal · Vitória Procurement" };
}

export default async function NotaPage({ params }: { params: Promise<{ id: string }> }) {
  const { permissions } = await requirePermission("invoices");
  const { id } = await params;
  const nota = await carregar(id);
  if (!nota) notFound();

  const fornecedor = um<{ id: string; legal_name: string; trade_name: string | null }>(nota.supplier);
  const importador = um<{ full_name: string }>(nota.importer);
  const itens = ((nota.items ?? []) as any[]).sort((a, b) => Number(a.seq) - Number(b.seq));
  const duplicatas = ((nota.duplicates ?? []) as any[]).sort((a, b) => Number(a.seq) - Number(b.seq));
  const totalDuplicatas = duplicatas.reduce((s, d) => s + n(d.amount), 0);
  const semProduto = itens.filter((i) => !i.product_id).length;
  const cancelada = nota.fiscal_status === "cancelada";
  const resumo = nota.doc_kind === "resumo";
  const MANIF: Record<string, string> = {
    nenhuma: "Nenhuma registrada", ciencia: "Ciência da Operação", confirmada: "Operação confirmada",
    desconhecida: "Operação desconhecida", nao_realizada: "Operação não realizada",
  };

  return (
    <div className="max-w-[1240px] px-6 pb-14 pt-5">
      <PageHeader
        crumb={<>Notas fiscais · <Link href="/notas" className="hover:text-ink">Notas recebidas</Link></>}
        title={`NF-e ${nota.number ?? "s/nº"}${nota.series ? `/${nota.series}` : ""}`}
        description={
          `${fornecedor ? (fornecedor.trade_name ?? fornecedor.legal_name) : nota.emitter_name ?? "Emitente"} · ` +
          `emitida em ${dataBR(nota.issued_at)}${nota.operation ? ` · ${nota.operation}` : ""}`
        }
      />

      {cancelada && (
        <div className="mb-4 flex gap-2.5 rounded bg-danger-soft px-3.5 py-3 text-[12.5px] text-danger">
          <Ban className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
          <p><b>Nota cancelada.</b> Ela fica no histórico, mas não deve virar pagamento.</p>
        </div>
      )}

      {resumo && !cancelada && (
        <div className="mb-4 flex gap-2.5 rounded bg-warn-soft px-3.5 py-3 text-[12.5px] text-warn">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
          <p>
            <b>Só o resumo da SEFAZ.</b> Itens e parcelas chegam com o XML completo, que a SEFAZ libera depois
            que a contabilidade registra a Ciência da Operação. A próxima consulta já completa esta nota.
          </p>
        </div>
      )}

      {!fornecedor && (
        <div className="mb-4 flex gap-2.5 rounded bg-warn-soft px-3.5 py-3 text-[12.5px] text-warn">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
          <p>
            O emitente <b>{nota.emitter_name}</b> ({cnpj(nota.emitter_cnpj)}) ainda não está no cadastro de
            fornecedores. A importação já deixou a pendência registrada;{" "}
            <Link href="/cadastros/fornecedores" className="underline underline-offset-2">cadastre o fornecedor</Link>{" "}
            para ligar as compras dele ao histórico.
          </p>
        </div>
      )}

      <KpiRow
        items={[
          { label: "Produtos", value: money(n(nota.products_total)) },
          { label: "Descontos", value: money(n(nota.discount_total)) },
          { label: "Frete", value: money(n(nota.freight_total)) },
          { label: "ICMS-ST", value: money(n(nota.icms_st_total)) },
          { label: "IPI", value: money(n(nota.ipi_total)) },
          { label: "Total da nota", value: money(n(nota.total_amount)) },
        ]}
      />

      <Card
        title="Itens"
        note={
          itens.length === 0
            ? (resumo ? "Os itens chegam com o XML completo." : "A nota não trouxe itens.")
            : semProduto > 0
            ? `${itens.length} ${itens.length === 1 ? "item" : "itens"} — ${semProduto} sem produto ligado ao cadastro.`
            : `${itens.length} ${itens.length === 1 ? "item" : "itens"}, todos ligados ao cadastro.`
        }
        className="mb-4"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] border-collapse">
            <thead>
              <tr>
                <th className="th w-10">#</th>
                <th className="th w-28">CÓDIGO</th>
                <th className="th">DESCRIÇÃO</th>
                <th className="th w-24">NCM / CFOP</th>
                <th className="th w-24 text-right">QTD</th>
                <th className="th w-28 text-right">PREÇO</th>
                <th className="th w-28 text-right">TOTAL</th>
                <th className="th w-28 text-right">CUSTO CHEIO</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((i) => {
                const acrescimo = n(i.unit_price) > 0 ? (n(i.landed_price) / n(i.unit_price) - 1) * 100 : 0;
                return (
                  <tr key={i.id} className="align-top hover:bg-raise">
                    <td className="td text-muted">{i.seq}</td>
                    <td className="td whitespace-nowrap font-mono text-[11.5px]">{i.supplier_code ?? "—"}</td>
                    <td className="td">
                      <div className="font-medium">{i.description}</div>
                      <div className="text-[11px] text-muted">
                        {i.product_id ? (
                          <span className="inline-flex items-center gap-1 text-accent-ink">
                            <Package className="h-3 w-3" /> ligado ao cadastro
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-warn">
                            <AlertTriangle className="h-3 w-3" /> produto não cadastrado
                          </span>
                        )}
                        {i.ean && <span className="ml-2 font-mono">EAN {i.ean}</span>}
                      </div>
                    </td>
                    <td className="td whitespace-nowrap font-mono text-[11.5px] text-graphite">
                      {i.ncm ?? "—"}
                      <span className="block text-muted">{i.cfop ?? ""}</span>
                    </td>
                    <td className="td whitespace-nowrap text-right font-mono tabular-nums">
                      {decimal(n(i.quantity))}
                      <span className="block text-[11px] text-muted">{i.unit_raw ?? ""}</span>
                    </td>
                    <td className="td text-right font-mono tabular-nums">{money(n(i.unit_price))}</td>
                    <td className="td text-right font-mono tabular-nums">{money(n(i.line_total))}</td>
                    <td className="td text-right font-mono tabular-nums">
                      {money(n(i.landed_price))}
                      {acrescimo >= 0.05 && (
                        <span className="block text-[11px] text-warn">+{acrescimo.toFixed(1)}%</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        <Card
          title="Duplicatas"
          note={
            duplicatas.length === 0
              ? "A nota não informou parcelas."
              : `${duplicatas.length} ${duplicatas.length === 1 ? "parcela" : "parcelas"}, somando ${money(totalDuplicatas)}.`
          }
        >
          {duplicatas.length > 0 && (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="th w-16">#</th>
                  <th className="th">NÚMERO</th>
                  <th className="th w-32">VENCIMENTO</th>
                  <th className="th w-32 text-right">VALOR</th>
                </tr>
              </thead>
              <tbody>
                {duplicatas.map((d) => (
                  <tr key={d.seq}>
                    <td className="td text-muted">{d.seq}</td>
                    <td className="td font-mono text-[12px]">{d.number ?? "—"}</td>
                    <td className="td whitespace-nowrap">{dataBR(d.due_date)}</td>
                    <td className="td text-right font-mono tabular-nums">{money(n(d.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Documento">
          <dl className="grid gap-x-6 gap-y-3 px-4 py-3 text-[12.5px] sm:grid-cols-2">
            <div>
              <dt className="text-[11px] text-muted">Emitente</dt>
              <dd className="font-medium">{nota.emitter_name ?? "—"}</dd>
              <dd className="font-mono text-[11.5px] text-graphite">{cnpj(nota.emitter_cnpj)}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted">Inscrição estadual</dt>
              <dd className="font-mono">{nota.emitter_ie ?? "—"} {nota.emitter_uf ? `· ${nota.emitter_uf}` : ""}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted">Situação</dt>
              <dd className="font-medium">{STATUS_LABEL[nota.fiscal_status] ?? nota.fiscal_status}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted">Protocolo</dt>
              <dd className="font-mono">{nota.protocol ?? "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[11px] text-muted">Chave de acesso</dt>
              <dd className="break-all font-mono text-[11.5px]">{nota.access_key}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted">Origem</dt>
              <dd>{nota.source === "xml" ? "XML importado" : `Consulta SEFAZ${nota.nsu ? ` · NSU ${nota.nsu}` : ""}`}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted">Manifestação do destinatário</dt>
              <dd>{MANIF[nota.manifestation] ?? nota.manifestation ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted">Importada por</dt>
              <dd>
                {importador?.full_name ?? "—"}
                <span className="block text-[11px] text-muted">{dateTime(nota.created_at)}</span>
              </dd>
            </div>
            {nota.source_filename && (
              <div className="sm:col-span-2 min-w-0">
                <dt className="text-[11px] text-muted">Arquivo</dt>
                <dd className="truncate" title={nota.source_filename}>{nota.source_filename}</dd>
              </div>
            )}
          </dl>

          {nota.xml_content && permissions.has("invoices.export") && (
            <details className="border-t border-line-soft">
              <summary className="cursor-pointer px-4 py-2.5 text-[12.5px] font-medium text-accent hover:underline">
                <FileText className="mr-1 inline h-3.5 w-3.5" /> Ver o XML original
              </summary>
              <pre className="max-h-[420px] overflow-auto border-t border-line-soft bg-raise px-4 py-3 font-mono text-[11px] leading-[1.45]">
                {nota.xml_content}
              </pre>
            </details>
          )}
        </Card>
      </div>
    </div>
  );
}
