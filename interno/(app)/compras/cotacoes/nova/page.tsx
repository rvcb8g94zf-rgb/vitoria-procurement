import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/caixa";
import { opcoesPedido } from "../../pedidos/opcoes";
import { NovaCotacaoForm } from "./form";

export const metadata = { title: "Nova cotação · Vitória Procurement" };

export default async function NovaCotacaoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company } = await requirePermission("quotations", "create");
  const sp = await searchParams;
  const solId = typeof sp.solicitacao === "string" && /^[0-9a-f-]{36}$/i.test(sp.solicitacao) ? sp.solicitacao : null;
  const supabase = await createClient();
  const o = await opcoesPedido(company.id);
  let itens: { product_id: string | null; description: string; quantity: number; unit_id: string | null }[] = [];
  let numero: string | null = null;
  if (solId) {
    const { data: r } = await supabase.from("purchase_requests")
      .select("number, items:purchase_request_items(line_no, product_id, description, spec, quantity, unit_id)")
      .eq("id", solId).eq("company_id", company.id).maybeSingle();
    if (r) {
      numero = r.number;
      itens = ((r.items ?? []) as any[]).sort((a, b) => a.line_no - b.line_no).map((i) => ({
        product_id: i.product_id, description: i.spec ? `${i.description} — ${i.spec}`.slice(0, 200) : i.description,
        quantity: Number(i.quantity), unit_id: i.unit_id,
      }));
    }
  }
  // fornecedor que já vendeu algum destes produtos aparece marcado
  const prodIds = itens.map((i) => i.product_id).filter(Boolean) as string[];
  const sugeridos = new Set<string>();
  if (prodIds.length) {
    const { data } = await supabase.from("supplier_products").select("supplier_id").in("product_id", prodIds);
    for (const s of (data ?? []) as any[]) sugeridos.add(s.supplier_id);
  }
  const fornecedores = o.fornecedores.map((f) => ({ ...f, sugerido: sugeridos.has(f.id) }))
    .sort((a, b) => Number(b.sugerido) - Number(a.sugerido) || a.nome.localeCompare(b.nome));

  return (
    <div className="max-w-[1100px] px-6 pb-14 pt-5">
      <PageHeader crumb={<>Compras · <Link href="/interno/compras/cotacoes" className="hover:text-ink">Cotações</Link></>}
                  title="Nova cotação"
                  description={numero ? `A partir da solicitação ${numero}.` : "Escolha os fornecedores e os itens. O texto para enviar a cada um fica pronto na próxima tela."} />
      <NovaCotacaoForm requestId={solId && numero ? solId : null} requestNumber={numero} fornecedores={fornecedores}
                       produtos={o.produtos} unidades={o.unidades} itens={itens} hoje={todayISO()} />
    </div>
  );
}
