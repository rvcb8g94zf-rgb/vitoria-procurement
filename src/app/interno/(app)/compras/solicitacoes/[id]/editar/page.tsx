import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/caixa";
import { SolicitacaoForm } from "../../form";
import { opcoesSolicitacao } from "../../opcoes";

export const metadata = { title: "Editar solicitação · Vitória Procurement" };

export default async function EditarSolicitacaoPage({ params }: { params: Promise<{ id: string }> }) {
  const { company } = await requirePermission("purchase_requests", "create");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: r } = await supabase.from("purchase_requests")
    .select("*, items:purchase_request_items(line_no, product_id, description, spec, quantity, unit_id)")
    .eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!r) notFound();
  if (r.status !== "rascunho") redirect(`/interno/compras/solicitacoes/${id}` as any);
  const o = await opcoesSolicitacao(company.id);
  return (
    <div className="max-w-[1100px] px-6 pb-14 pt-5">
      <PageHeader crumb={<>Compras · <Link href="/interno/compras/solicitacoes" className="hover:text-ink">Solicitações</Link></>}
                  title={`Editar solicitação ${r.number}`} />
      <SolicitacaoForm
        inicial={{ ...r, items: ((r.items ?? []) as any[]).sort((a, b) => a.line_no - b.line_no).map((i) => ({ ...i, quantity: Number(i.quantity) })) }}
        {...o} hoje={todayISO()} />
    </div>
  );
}
