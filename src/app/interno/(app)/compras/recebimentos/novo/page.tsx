import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { date, money } from "@/lib/format";
import { todayISO } from "@/lib/caixa";
import { RecebimentoForm } from "./form";

export const metadata = { title: "Registrar recebimento · Vitória Procurement" };

export default async function NovoRecebimentoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company } = await requirePermission("goods_receipts", "create");
  const sp = await searchParams;
  const id = typeof sp.pedido === "string" && /^[0-9a-f-]{36}$/i.test(sp.pedido) ? sp.pedido : null;
  if (!id) redirect("/interno/compras/recebimentos");
  const supabase = await createClient();
  const { data: po } = await supabase.from("purchase_orders").select("id, number, status, supplier_id, issued_on, supplier:suppliers(legal_name, trade_name)")
    .eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!po) notFound();
  const [{ data: prog }, { data: notas }] = await Promise.all([
    supabase.rpc("order_item_progress", { _company_id: company.id, _order_id: id }),
    supabase.from("received_invoices").select("id, number, issued_at, total_amount").eq("company_id", company.id)
      .eq("supplier_id", po.supplier_id).gte("issued_at", po.issued_on).neq("fiscal_status", "cancelada")
      .order("issued_at", { ascending: false }).limit(50),
  ]);
  const f = po.supplier as any;
  return (
    <div className="max-w-[1100px] px-6 pb-14 pt-5">
      <PageHeader crumb={<>Compras · <Link href="/interno/compras/recebimentos" className="hover:text-ink">Recebimentos</Link></>}
                  title={`Receber o pedido ${po.number}`} description={f?.trade_name ?? f?.legal_name} />
      {!["aprovado", "enviado", "confirmado", "parcialmente_recebido"].includes(po.status) ? (
        <p className="rounded bg-warn-soft px-3.5 py-3 text-[12.5px] text-warn">Este pedido não está esperando entrega.</p>
      ) : (
        <RecebimentoForm orderId={id} hoje={todayISO()}
          itens={((prog ?? []) as any[]).map((i) => ({ ...i, ordered: Number(i.ordered), received: Number(i.received), pending: Number(i.pending) }))}
          notas={((notas ?? []) as any[]).map((x) => ({ id: x.id, rotulo: `NF-e ${x.number} · ${date(x.issued_at)} · ${money(Number(x.total_amount))}` }))} />
      )}
    </div>
  );
}
