import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/caixa";
import { PedidoForm, type PedidoInicial } from "../form";
import { opcoesPedido } from "../opcoes";

export const metadata = { title: "Novo pedido de compra · Vitória Procurement" };

export default async function NovoPedidoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company } = await requirePermission("purchase_orders", "create");
  const sp = await searchParams;
  const solId = typeof sp.solicitacao === "string" && /^[0-9a-f-]{36}$/i.test(sp.solicitacao) ? sp.solicitacao : null;
  const o = await opcoesPedido(company.id);

  // pedido a partir de uma solicitação: itens, centro de custo e prazo já vêm preenchidos
  let inicial: PedidoInicial = {};
  let origem: string | null = null;
  if (solId) {
    const supabase = await createClient();
    const { data: r } = await supabase.from("purchase_requests")
      .select("id, number, cost_center_id, needed_by, items:purchase_request_items(line_no, product_id, description, spec, quantity, unit_id)")
      .eq("id", solId).eq("company_id", company.id).maybeSingle();
    if (r) {
      origem = r.number;
      const ultimo = new Map(o.produtos.map((p) => [p.id, p.ultimo ?? 0]));
      inicial = {
        request_id: r.id, cost_center_id: r.cost_center_id, expected_on: r.needed_by,
        items: ((r.items ?? []) as any[]).sort((a, b) => a.line_no - b.line_no).map((i) => ({
          product_id: i.product_id, description: i.spec ? `${i.description} — ${i.spec}`.slice(0, 200) : i.description,
          quantity: Number(i.quantity), unit_id: i.unit_id, unit_price: i.product_id ? ultimo.get(i.product_id) ?? 0 : 0, discount: 0,
        })),
      };
    }
  }

  return (
    <div className="max-w-[1200px] px-6 pb-14 pt-5">
      <PageHeader
        crumb={<>Compras · <Link href="/interno/compras/pedidos" className="hover:text-ink">Pedidos de compra</Link></>}
        title="Novo pedido de compra"
        description={origem
          ? `A partir da solicitação ${origem}. Confira os preços antes de enviar.`
          : "Pedido direto ao fornecedor. Ao enviar, ele segue para aprovação conforme o valor."}
      />
      <PedidoForm inicial={inicial} {...o} hoje={todayISO()} />
    </div>
  );
}
