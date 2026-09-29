import Link from "next/link";
import { PackageCheck } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { date, money } from "@/lib/format";
import { PEDIDO_STATUS } from "@/lib/compras";

export const metadata = { title: "Recebimentos · Vitória Procurement" };

export default async function RecebimentosPage() {
  const { company, permissions } = await requirePermission("goods_receipts");
  const supabase = await createClient();
  const [{ data: aguardando }, { data: recentes }] = await Promise.all([
    supabase.rpc("orders_awaiting_delivery", { _company_id: company.id }),
    supabase.from("goods_receipts").select("id, number, received_on, cancelled_at, invoice_ref, order:purchase_orders(number, supplier:suppliers(legal_name, trade_name)), invoice:received_invoices(number)")
      .eq("company_id", company.id).order("created_at", { ascending: false }).limit(30),
  ]);
  const podeReceber = permissions.has("goods_receipts.create");
  return (
    <div className="max-w-[1200px] px-6 pb-14 pt-5">
      <PageHeader crumb="Compras" title="Recebimentos" description="O que está para chegar e o que já foi conferido." />
      <section className="card mb-4 overflow-x-auto">
        <div className="border-b border-line-soft px-4 py-3"><h3 className="text-[13.5px] font-semibold">Pedidos esperando entrega</h3></div>
        {(aguardando ?? []).length === 0 ? <EmptyState title="Nenhum pedido esperando entrega" /> : (
          <table className="w-full min-w-[820px] border-collapse">
            <thead><tr><th className="th w-28">PEDIDO</th><th className="th">FORNECEDOR</th><th className="th w-32">ENTREGA</th><th className="th w-44">SITUAÇÃO</th><th className="th w-32 text-right">TOTAL</th>{podeReceber && <th className="th w-32" />}</tr></thead>
            <tbody>
              {((aguardando ?? []) as any[]).map((p) => (
                <tr key={p.id} className="hover:bg-raise">
                  <td className="td"><Link href={`/interno/compras/pedidos/${p.id}` as any} className="font-mono font-semibold hover:text-accent hover:underline">{p.number}</Link></td>
                  <td className="td">{p.supplier_name}<span className="block text-[11px] text-muted">{p.pending_items} de {p.items} item(ns) pendente(s)</span></td>
                  <td className={`td ${p.days_late > 0 ? "text-danger" : ""}`}>{p.expected_on ? date(p.expected_on) : "—"}{p.days_late > 0 && <span className="block text-[11px]">{p.days_late} dia(s) de atraso</span>}</td>
                  <td className="td"><span className={`badge ${PEDIDO_STATUS[p.status]?.cls ?? ""}`}>{PEDIDO_STATUS[p.status]?.rot ?? p.status}</span></td>
                  <td className="td text-right font-mono">{money(Number(p.total_amount))}</td>
                  {podeReceber && <td className="td"><Link href={`/interno/compras/recebimentos/novo?pedido=${p.id}` as any} className="btn h-7 px-2 text-[11.5px]"><PackageCheck className="h-3.5 w-3.5" /> Receber</Link></td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="card overflow-x-auto">
        <div className="border-b border-line-soft px-4 py-3"><h3 className="text-[13.5px] font-semibold">Últimos recebimentos</h3></div>
        {(recentes ?? []).length === 0 ? <EmptyState title="Nenhum recebimento registrado ainda" /> : (
          <table className="w-full min-w-[700px] border-collapse">
            <thead><tr><th className="th w-28">NÚMERO</th><th className="th w-28">DATA</th><th className="th w-28">PEDIDO</th><th className="th">FORNECEDOR</th><th className="th w-32">NOTA</th></tr></thead>
            <tbody>
              {((recentes ?? []) as any[]).map((g) => (
                <tr key={g.id} className={`hover:bg-raise ${g.cancelled_at ? "text-muted line-through" : ""}`}>
                  <td className="td"><Link href={`/interno/compras/recebimentos/${g.id}` as any} className="font-mono font-semibold hover:text-accent hover:underline">{g.number}</Link></td>
                  <td className="td">{date(g.received_on)}</td>
                  <td className="td font-mono">{g.order?.number ?? "—"}</td>
                  <td className="td">{g.order?.supplier?.trade_name ?? g.order?.supplier?.legal_name ?? "—"}</td>
                  <td className="td">{g.invoice ? `NF-e ${g.invoice.number}` : g.invoice_ref ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
