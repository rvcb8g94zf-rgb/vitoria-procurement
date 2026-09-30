import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, PackageCheck, Printer } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/panels";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { cnpj, date, dateTime, decimal, money } from "@/lib/format";
import { DECISAO, PEDIDO_STATUS, textoPedido } from "@/lib/compras";
import { CONF_STATUS, ORIGEM_LIGACAO } from "@/lib/conferencia";
import { AcoesPedido } from "./acoes";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `Pedido de compra · Vitória Procurement` };
}

export default async function PedidoPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { company, permissions, user } = await requirePermission("purchase_orders");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: po }, { data: aprov }, { data: podeDec }, { data: prog }, { data: recs }, { data: nfs }] = await Promise.all([
    supabase.from("purchase_orders").select(`
        *, supplier:suppliers(id, legal_name, trade_name, doc_number, phone, email),
        term:payment_terms(name), cc:cost_centers(code, name),
        buyer:users!purchase_orders_buyer_id_fkey(full_name),
        items:purchase_order_items(line_no, description, quantity, unit_price, discount, total, product:products(id, sku), unit:units(code))
      `).eq("id", id).eq("company_id", company.id).maybeSingle(),
    supabase.rpc("order_approvals", { _company_id: company.id, _order_id: id }),
    supabase.rpc("can_decide_order", { _company_id: company.id, _order_id: id }),
    supabase.rpc("order_item_progress", { _company_id: company.id, _order_id: id }),
    supabase.from("goods_receipts").select("id, number, received_on, cancelled_at, invoice_ref, invoice:received_invoices(number)")
      .eq("order_id", id).order("created_at"),
    supabase.rpc("order_invoices", { _company_id: company.id, _order_id: id }),
  ]);
  const notas = (nfs ?? []) as any[];
  const recebido = new Map(((prog ?? []) as any[]).map((p) => [p.line_no, Number(p.received)]));
  const mostraRec = ((recs ?? []) as any[]).length > 0;
  const aguardaEntrega = ["aprovado", "enviado", "confirmado", "parcialmente_recebido"].includes(po?.status ?? "");
  if (!po) notFound();
  const itens = ((po.items ?? []) as any[]).sort((a, b) => a.line_no - b.line_no);
  const subtotal = itens.reduce((s, i) => s + Number(i.total), 0);
  const st = PEDIDO_STATUS[po.status] ?? { rot: po.status, cls: "" };
  const forn = po.supplier as any;
  const texto = textoPedido({
    empresa: company.trade_name ?? company.legal_name, cnpj: cnpj(company.cnpj), numero: po.number,
    fornecedor: forn?.trade_name ?? forn?.legal_name ?? "", itens, frete: Number(po.freight_amount),
    desconto: Number(po.discount), total: Number(po.total_amount), condicao: (po.term as any)?.name,
    entrega: po.expected_on, observacao: po.notes, comprador: (po.buyer as any)?.full_name,
  });
  const erro = typeof sp.erro === "string" ? sp.erro : null;
  const aviso = sp.enviado
    ? (po.status === "aprovado" ? "Pedido aprovado: o valor está dentro da sua alçada."
       : po.status === "aguardando_aprovacao" ? "Pedido enviado para aprovação." : null)
    : sp.salvo && po.status === "rascunho" ? "Rascunho salvo." : null;

  return (
    <div className="max-w-[1200px] px-6 pb-14 pt-5">
      <PageHeader
        crumb={<>Compras · <Link href="/interno/compras/pedidos" className="hover:text-ink">Pedidos de compra</Link></>}
        title={`Pedido ${po.number}`}
        description={`${forn?.trade_name ?? forn?.legal_name ?? "—"} · emitido em ${date(po.issued_on)}`}
        actions={
          <>
            {aguardaEntrega && permissions.has("goods_receipts.create") && (
              <Link href={`/interno/compras/recebimentos/novo?pedido=${id}` as any} className="btn btn-primary">
                <PackageCheck className="h-3.5 w-3.5" /> Registrar recebimento
              </Link>
            )}
            <Link href={`/interno/compras/pedidos/${id}/imprimir` as any} className="btn" target="_blank">
              <Printer className="h-3.5 w-3.5" /> Imprimir / PDF
            </Link>
          </>
        }
      />

      {erro && <p role="alert" className="mb-4 rounded bg-danger-soft px-3.5 py-3 text-[12.5px] text-danger">{erro}</p>}
      {aviso && !erro && (
        <p role="status" className="mb-4 flex items-center gap-2 rounded bg-accent-soft px-3.5 py-3 text-[12.5px] text-accent-ink">
          <CheckCircle2 className="h-4 w-4" /> {aviso}
        </p>
      )}
      {po.status === "cancelado" && po.cancel_reason && (
        <p className="mb-4 rounded bg-danger-soft px-3.5 py-3 text-[12.5px] text-danger"><b>Cancelado.</b> {po.cancel_reason}</p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded border border-line bg-surface px-4 py-3">
        <span className={`badge ${st.cls}`}>{st.rot}</span>
        <span className="font-display text-[20px] font-semibold tracking-tight">{money(Number(po.total_amount))}</span>
        <div className="ml-auto">
          <AcoesPedido id={id} numero={po.number} status={po.status}
                       podeEditar={permissions.has("purchase_orders.edit")}
                       podeCancelar={permissions.has("purchase_orders.cancel")}
                       podeDecidir={Boolean(podeDec)} texto={texto} />
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {[
          { l: "Fornecedor", v: forn ? <Link href={`/interno/cadastros/fornecedores/${forn.id}` as any} className="hover:text-accent hover:underline">{forn.trade_name ?? forn.legal_name}</Link> : "—",
            s: forn ? `${cnpj(forn.doc_number)}${forn.phone ? ` · ${forn.phone}` : ""}` : "" },
          { l: "Condição · entrega", v: (po.term as any)?.name ?? "—", s: po.expected_on ? `entrega até ${date(po.expected_on)}` : "sem data de entrega" },
          { l: "Comprador · centro de custo", v: (po.buyer as any)?.full_name ?? "—", s: po.cc ? `${(po.cc as any).code} · ${(po.cc as any).name}` : "sem centro de custo" },
        ].map((k) => (
          <div key={k.l} className="card px-4 py-3">
            <div className="text-[11px] font-medium text-muted">{k.l}</div>
            <div className="mt-1 text-[13.5px] font-semibold">{k.v}</div>
            <div className="text-[11.5px] text-muted">{k.s}</div>
          </div>
        ))}
      </div>

      <Card title="Itens" note={`${itens.length} ${itens.length === 1 ? "item" : "itens"}`} className="mb-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead><tr>
              <th className="th w-10">#</th><th className="th">DESCRIÇÃO</th><th className="th w-28 text-right">QTD</th>
              <th className="th w-32 text-right">PREÇO</th><th className="th w-28 text-right">DESCONTO</th><th className="th w-32 text-right">TOTAL</th>
              {mostraRec && <th className="th w-28 text-right">RECEBIDO</th>}
            </tr></thead>
            <tbody>
              {itens.map((i) => (
                <tr key={i.line_no} className="hover:bg-raise">
                  <td className="td text-muted">{i.line_no}</td>
                  <td className="td">
                    {i.description}
                    {i.product && (
                      <Link href={`/interno/cadastros/produtos/${i.product.id}` as any} className="ml-2 font-mono text-[11px] text-accent-ink hover:underline">{i.product.sku}</Link>
                    )}
                  </td>
                  <td className="td text-right font-mono tabular-nums">{decimal(Number(i.quantity))} <span className="text-[11px] text-muted">{i.unit?.code ?? ""}</span></td>
                  <td className="td text-right font-mono tabular-nums">{money(Number(i.unit_price))}</td>
                  <td className="td text-right font-mono tabular-nums">{Number(i.discount) ? money(Number(i.discount)) : "—"}</td>
                  <td className="td text-right font-mono tabular-nums">{money(Number(i.total))}</td>
                  {mostraRec && (
                    <td className={`td text-right font-mono tabular-nums ${(recebido.get(i.line_no) ?? 0) >= Number(i.quantity) ? "text-accent-ink" : "text-warn"}`}>
                      {decimal(recebido.get(i.line_no) ?? 0)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ml-auto grid max-w-[300px] gap-1 border-t border-line-soft px-4 py-3 text-[12.5px]">
          <div className="flex justify-between"><span className="text-graphite">Itens</span><span className="font-mono">{money(subtotal)}</span></div>
          {Number(po.freight_amount) > 0 && <div className="flex justify-between"><span className="text-graphite">Frete</span><span className="font-mono">{money(Number(po.freight_amount))}</span></div>}
          {Number(po.discount) > 0 && <div className="flex justify-between"><span className="text-graphite">Desconto</span><span className="font-mono">− {money(Number(po.discount))}</span></div>}
          <div className="flex justify-between border-t border-line-soft pt-1 font-semibold"><span>Total</span><span className="font-mono">{money(Number(po.total_amount))}</span></div>
        </div>
        {po.notes && <p className="border-t border-line-soft px-4 py-3 text-[12.5px] text-graphite"><b>Observações:</b> {po.notes}</p>}
      </Card>

      {mostraRec && (
        <Card title="Recebimentos" className="mb-4">
          <ul className="px-4 py-1 text-[12.5px]">
            {((recs ?? []) as any[]).map((g) => (
              <li key={g.id} className={`flex border-b border-line-soft py-2 last:border-0 ${g.cancelled_at ? "text-muted line-through" : ""}`}>
                <Link href={`/interno/compras/recebimentos/${g.id}` as any} className="font-mono hover:text-accent hover:underline">{g.number}</Link>
                <span className="ml-3">{date(g.received_on)}</span>
                <span className="ml-auto text-muted">{g.invoice ? `NF-e ${g.invoice.number}` : g.invoice_ref ?? "sem nota"}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {notas.length > 0 && (
        <Card title="Notas fiscais" note="Conferência de preço e quantidade contra este pedido." className="mb-4">
          <ul className="px-4 py-1 text-[12.5px]">
            {notas.map((nf) => {
              const st = CONF_STATUS[nf.status] ?? CONF_STATUS.sem_pedido;
              return (
                <li key={nf.invoice_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft py-2 last:border-0">
                  <Link href={`/interno/notas/${nf.invoice_id}` as any} className="font-mono hover:text-accent hover:underline">
                    NF-e {nf.number ?? "s/nº"}
                  </Link>
                  <span className="text-muted">{nf.issued_at ? date(nf.issued_at) : ""}</span>
                  <span className="text-[11px] text-muted">{ORIGEM_LIGACAO[nf.source] ?? nf.source}</span>
                  <span className="ml-auto font-mono tabular-nums">{money(Number(nf.total_amount ?? 0))}</span>
                  <span className={`badge ${st.cls}`} title={st.dica}>{st.rot}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card title="Aprovação" note={(aprov ?? []).length === 0 ? "Ainda não foi enviado para aprovação." : undefined}>
        {(aprov ?? []).length > 0 && (
          <ul className="px-4 py-1">
            {((aprov ?? []) as any[]).map((a, i) => {
              const d = DECISAO[a.decision] ?? { rot: a.decision, cls: "" };
              return (
                <li key={i} className="border-b border-line-soft py-2.5 text-[12.5px] last:border-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <b className={d.cls}>{d.rot}</b>
                    <span className="text-graphite">{a.rule_name} · {money(Number(a.amount))}</span>
                    <span className="ml-auto text-[11px] text-muted">enviado por {a.requested_by_name ?? "—"} em {dateTime(a.created_at)}</span>
                  </div>
                  {a.decision !== "pendente" && (
                    <div className="mt-0.5 text-[12px] text-muted">
                      {a.decided_by_name ?? "—"} em {dateTime(a.decided_at)}{a.comment ? ` — ${a.comment}` : ""}
                    </div>
                  )}
                  {a.decision === "pendente" && (
                    <div className="mt-0.5 text-[12px] text-muted">
                      Aguardando {a.role_name} (ou Diretoria). {user.id === po.created_by ? "Quem lançou não aprova o próprio pedido." : ""}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
