import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { cnpj, date, decimal, money } from "@/lib/format";
import { PEDIDO_STATUS } from "@/lib/compras";
import { Imprimir } from "./imprimir";

export const metadata = { title: "Pedido de compra — impressão" };

export default async function ImprimirPedido({ params }: { params: Promise<{ id: string }> }) {
  const { company } = await requirePermission("purchase_orders");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: po } = await supabase.from("purchase_orders").select(`
      *, supplier:suppliers(legal_name, trade_name, doc_number, state_reg, city, state_uf, phone, email),
      term:payment_terms(name), buyer:users!purchase_orders_buyer_id_fkey(full_name, email),
      items:purchase_order_items(line_no, description, quantity, unit_price, discount, total, product:products(sku), unit:units(code))
    `).eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!po) notFound();
  const f = po.supplier as any;
  const itens = ((po.items ?? []) as any[]).sort((a, b) => a.line_no - b.line_no);
  const rascunho = !["aprovado", "enviado", "confirmado", "parcialmente_recebido", "recebido"].includes(po.status);

  return (
    <div className="mx-auto max-w-[820px] bg-white px-8 py-8 text-[12px] text-black">
      <Imprimir />
      {rascunho && (
        <p className="mb-4 rounded border border-black px-3 py-2 text-center font-semibold">
          {PEDIDO_STATUS[po.status]?.rot.toUpperCase() ?? po.status} — NÃO VALE COMO PEDIDO
        </p>
      )}
      <div className="flex items-start justify-between border-b-2 border-black pb-3">
        <div>
          <div className="text-[16px] font-bold">{company.legal_name}</div>
          <div>CNPJ {cnpj(company.cnpj)}{company.state_reg ? ` · IE ${company.state_reg}` : ""}</div>
          <div>{[company.city, company.state_uf].filter(Boolean).join("/")}</div>
        </div>
        <div className="text-right">
          <div className="text-[18px] font-bold">PEDIDO DE COMPRA</div>
          <div className="text-[15px] font-bold">{po.number}</div>
          <div>Emissão {date(po.issued_on)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 border-b border-black py-3">
        <div>
          <div className="font-bold">Fornecedor</div>
          <div>{f?.legal_name}</div>
          <div>CNPJ {cnpj(f?.doc_number)}{f?.state_reg ? ` · IE ${f.state_reg}` : ""}</div>
          <div>{[f?.city, f?.state_uf].filter(Boolean).join("/")}{f?.phone ? ` · ${f.phone}` : ""}</div>
        </div>
        <div>
          <div><b>Pagamento:</b> {(po.term as any)?.name ?? "a combinar"}</div>
          <div><b>Entrega até:</b> {po.expected_on ? date(po.expected_on) : "a combinar"}</div>
          {po.carrier && <div><b>Transportadora:</b> {po.carrier}</div>}
          <div><b>Comprador:</b> {(po.buyer as any)?.full_name ?? "—"}</div>
        </div>
      </div>

      <table className="mt-3 w-full border-collapse">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1 pr-2">#</th><th className="py-1 pr-2">Descrição</th><th className="py-1 pr-2 text-right">Qtd</th>
            <th className="py-1 pr-2">Un</th><th className="py-1 pr-2 text-right">Preço</th><th className="py-1 pr-2 text-right">Desc.</th><th className="py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((i) => (
            <tr key={i.line_no} className="border-b border-gray-300 align-top">
              <td className="py-1 pr-2">{i.line_no}</td>
              <td className="py-1 pr-2">{i.description}{i.product?.sku ? ` (${i.product.sku})` : ""}</td>
              <td className="py-1 pr-2 text-right">{decimal(Number(i.quantity))}</td>
              <td className="py-1 pr-2">{i.unit?.code ?? ""}</td>
              <td className="py-1 pr-2 text-right">{money(Number(i.unit_price))}</td>
              <td className="py-1 pr-2 text-right">{Number(i.discount) ? money(Number(i.discount)) : ""}</td>
              <td className="py-1 text-right">{money(Number(i.total))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ml-auto mt-2 w-64">
        {Number(po.freight_amount) > 0 && <div className="flex justify-between"><span>Frete</span><span>{money(Number(po.freight_amount))}</span></div>}
        {Number(po.discount) > 0 && <div className="flex justify-between"><span>Desconto</span><span>− {money(Number(po.discount))}</span></div>}
        <div className="flex justify-between border-t border-black pt-1 text-[14px] font-bold"><span>Total</span><span>{money(Number(po.total_amount))}</span></div>
      </div>
      {po.notes && <p className="mt-4"><b>Observações:</b> {po.notes}</p>}
      <p className="mt-6 text-[11px]">
        Informe o número deste pedido na nota fiscal. Mercadoria em desacordo com o pedido (quantidade, preço ou prazo) poderá ser recusada no recebimento.
      </p>
    </div>
  );
}
