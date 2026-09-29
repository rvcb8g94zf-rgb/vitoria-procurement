import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/caixa";
import { PedidoForm } from "../../form";
import { opcoesPedido } from "../../opcoes";

export const metadata = { title: "Editar pedido · Vitória Procurement" };

export default async function EditarPedidoPage({ params }: { params: Promise<{ id: string }> }) {
  const { company } = await requirePermission("purchase_orders", "edit");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: po } = await supabase.from("purchase_orders")
    .select("*, items:purchase_order_items(line_no, product_id, description, quantity, unit_id, unit_price, discount)")
    .eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!po) notFound();
  if (po.status !== "rascunho") redirect(`/interno/compras/pedidos/${id}` as any);
  const o = await opcoesPedido(company.id);
  const itens = ((po.items ?? []) as any[]).sort((a, b) => a.line_no - b.line_no)
    .map((i) => ({ ...i, quantity: Number(i.quantity), unit_price: Number(i.unit_price), discount: Number(i.discount) }));
  // fornecedor que saiu da lista de ativos continua aparecendo no próprio pedido
  if (!o.fornecedores.some((f) => f.id === po.supplier_id)) {
    const { data: f } = await supabase.from("suppliers").select("id, legal_name, trade_name").eq("id", po.supplier_id).maybeSingle();
    if (f) o.fornecedores.unshift({ id: f.id, nome: `${f.trade_name ?? f.legal_name} (não está ativo)` });
  }

  return (
    <div className="max-w-[1200px] px-6 pb-14 pt-5">
      <PageHeader
        crumb={<>Compras · <Link href="/interno/compras/pedidos" className="hover:text-ink">Pedidos de compra</Link></>}
        title={`Editar pedido ${po.number}`}
      />
      <PedidoForm
        inicial={{
          id: po.id, supplier_id: po.supplier_id, payment_term_id: po.payment_term_id, cost_center_id: po.cost_center_id,
          expected_on: po.expected_on, carrier: po.carrier, freight_amount: Number(po.freight_amount),
          discount: Number(po.discount), notes: po.notes, request_id: po.request_id, quotation_id: po.quotation_id, items: itens,
        }}
        {...o}
        hoje={todayISO()}
      />
    </div>
  );
}
