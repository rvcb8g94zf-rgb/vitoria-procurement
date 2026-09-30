import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { date, dateTime, decimal } from "@/lib/format";
import { PEDIDO_STATUS } from "@/lib/compras";
import { CancelarRecebimento } from "./cancelar";

export const metadata = { title: "Recebimento · Vitória Procurement" };

export default async function RecebimentoPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { company, permissions } = await requirePermission("goods_receipts");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: g } = await supabase.from("goods_receipts").select(`
      *, order:purchase_orders(id, number, status, supplier:suppliers(legal_name, trade_name)),
      invoice:received_invoices(id, number), who:users!goods_receipts_received_by_fkey(full_name),
      items:goods_receipt_items(quantity_ordered, quantity_received, divergence_note, oi:purchase_order_items(line_no, description, unit:units(code)))
    `).eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!g) notFound();
  const po = g.order as any;
  const itens = ((g.items ?? []) as any[]).sort((a, b) => (a.oi?.line_no ?? 0) - (b.oi?.line_no ?? 0));
  return (
    <div className="max-w-[1100px] px-6 pb-14 pt-5">
      <PageHeader crumb={<>Compras · <Link href="/interno/compras/recebimentos" className="hover:text-ink">Recebimentos</Link></>}
                  title={`Recebimento ${g.number}`}
                  description={`${po?.supplier?.trade_name ?? po?.supplier?.legal_name ?? ""} · recebido em ${date(g.received_on)} por ${(g.who as any)?.full_name ?? "—"}`} />
      {sp.novo && !g.cancelled_at && (
        <p role="status" className="mb-4 flex items-center gap-2 rounded bg-accent-soft px-3.5 py-3 text-[12.5px] text-accent-ink">
          <CheckCircle2 className="h-4 w-4" /> Recebimento registrado. O pedido está “{PEDIDO_STATUS[po?.status]?.rot ?? po?.status}”.
        </p>
      )}
      {g.cancelled_at && <p className="mb-4 rounded bg-danger-soft px-3.5 py-3 text-[12.5px] text-danger"><b>Cancelado</b> em {dateTime(g.cancelled_at)}: {g.cancel_reason}</p>}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded border border-line bg-surface px-4 py-3 text-[12.5px]">
        {po && <Link href={`/interno/compras/pedidos/${po.id}` as any} className="font-mono text-accent-ink hover:underline">Pedido {po.number}</Link>}
        <span className="text-graphite">
          Nota: {g.invoice ? <Link href={`/interno/notas/${(g.invoice as any).id}` as any} className="text-accent-ink hover:underline">NF-e {(g.invoice as any).number}</Link> : g.invoice_ref ?? "não informada"}
        </span>
        {!g.cancelled_at && permissions.has("goods_receipts.cancel") && <div className="ml-auto"><CancelarRecebimento id={id} numero={g.number} /></div>}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <thead><tr><th className="th w-10">#</th><th className="th">ITEM</th><th className="th w-28 text-right">PEDIDO</th><th className="th w-28 text-right">RECEBIDO</th><th className="th w-64">OBSERVAÇÃO</th></tr></thead>
          <tbody>
            {itens.map((i, k) => (
              <tr key={k}>
                <td className="td text-muted">{i.oi?.line_no}</td>
                <td className="td">{i.oi?.description}</td>
                <td className="td text-right font-mono">{decimal(Number(i.quantity_ordered))} <span className="text-[11px] text-muted">{i.oi?.unit?.code ?? ""}</span></td>
                <td className="td text-right font-mono font-semibold">{decimal(Number(i.quantity_received))}</td>
                <td className="td text-graphite">{i.divergence_note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {g.notes && <p className="border-t border-line-soft px-4 py-3 text-[12.5px] text-graphite"><b>Observação:</b> {g.notes}</p>}
      </div>
    </div>
  );
}
