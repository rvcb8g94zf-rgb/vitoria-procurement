import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { date, money } from "@/lib/format";
import { COT_STATUS, PEDIDO_STATUS, textoCotacao } from "@/lib/compras";
import { Mapa, type MForn, type MLinha } from "./mapa";
import { CancelarCotacao } from "./cancelar";

export const metadata = { title: "Cotação · Vitória Procurement" };

export default async function CotacaoPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { company, permissions, user } = await requirePermission("quotations");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: q } = await supabase.from("quotations")
    .select("*, request:purchase_requests(id, number), opener:users!quotations_opened_by_fkey(full_name)")
    .eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!q) notFound();
  const [{ data: lin }, { data: forn }, { data: itens }, { data: conds }, { data: pedidos }] = await Promise.all([
    supabase.from("quotation_lines").select("line_no, description, quantity, unit:units(code)").eq("quotation_id", id).order("line_no"),
    supabase.from("quotation_suppliers").select("*, supplier:suppliers(legal_name, trade_name, phone)").eq("quotation_id", id),
    supabase.from("quotation_items").select("supplier_id, line_no, unit_price, is_selected").eq("quotation_id", id),
    supabase.from("payment_terms").select("id, name").eq("company_id", company.id).order("code"),
    supabase.from("purchase_orders").select("id, number, status, total_amount, supplier:suppliers(legal_name, trade_name)").eq("quotation_id", id),
  ]);
  const linhas: MLinha[] = ((lin ?? []) as any[]).map((l) => ({ line_no: l.line_no, description: l.description, quantity: Number(l.quantity), unit: l.unit?.code ?? null }));
  const empresa = company.trade_name ?? company.legal_name;
  const fornecedores: MForn[] = ((forn ?? []) as any[]).map((f) => {
    const nome = f.supplier?.trade_name ?? f.supplier?.legal_name ?? "—";
    const mine = ((itens ?? []) as any[]).filter((i) => i.supplier_id === f.supplier_id);
    const tel = String(f.supplier?.phone ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
    return {
      supplier_id: f.supplier_id, nome, telefone: tel.length >= 10 && tel.length <= 11 ? tel : null,
      freight_amount: Number(f.freight_amount), lead_days: f.lead_days, payment_term_id: f.payment_term_id,
      valid_until: f.valid_until, notes: f.notes, responded: Boolean(f.responded_at),
      precos: Object.fromEntries(mine.map((i) => [i.line_no, i.unit_price === null ? null : Number(i.unit_price)])),
      selecionados: mine.filter((i) => i.is_selected).map((i) => i.line_no),
      texto: textoCotacao({ empresa, numero: q.number, fornecedor: nome, prazo: q.closes_on, comprador: (q.opener as any)?.full_name, linhas }),
    };
  }).sort((a, b) => a.nome.localeCompare(b.nome));
  const s = COT_STATUS[q.status] ?? { rot: q.status, cls: "" };
  const aberta = ["aberta", "respondida"].includes(q.status);

  return (
    <div className="max-w-[1400px] px-6 pb-14 pt-5">
      <PageHeader crumb={<>Compras · <Link href="/interno/compras/cotacoes" className="hover:text-ink">Cotações</Link></>}
                  title={`Cotação ${q.number}`}
                  description={`Aberta por ${(q.opener as any)?.full_name ?? "—"} em ${date(q.opened_on)}${q.closes_on ? ` · respostas até ${date(q.closes_on)}` : ""}`} />
      {sp.gerados && (
        <p role="status" className="mb-4 flex items-center gap-2 rounded bg-accent-soft px-3.5 py-3 text-[12.5px] text-accent-ink">
          <CheckCircle2 className="h-4 w-4" /> {sp.gerados} pedido(s) gerado(s) em rascunho. Confira cada um e envie para aprovação.
        </p>
      )}
      {q.status === "cancelada" && <p className="mb-4 rounded bg-line-soft px-3.5 py-3 text-[12.5px] text-graphite"><b>Cancelada:</b> {q.cancel_reason}</p>}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded border border-line bg-surface px-4 py-3 text-[12.5px]">
        <span className={`badge ${s.cls}`}>{s.rot}</span>
        <span className="text-graphite">{fornecedores.filter((f) => f.responded).length} de {fornecedores.length} fornecedores responderam · {linhas.length} item(ns)</span>
        {q.request && <Link href={`/interno/compras/solicitacoes/${(q.request as any).id}` as any} className="text-accent-ink hover:underline">Solicitação {(q.request as any).number}</Link>}
        {aberta && permissions.has("quotations.cancel") && <div className="ml-auto"><CancelarCotacao id={id} numero={q.number} /></div>}
      </div>

      {(pedidos ?? []).length > 0 && (
        <section className="card mb-4">
          <div className="border-b border-line-soft px-4 py-3"><h3 className="text-[13.5px] font-semibold">Pedidos gerados</h3></div>
          <ul className="px-4 py-1 text-[12.5px]">
            {((pedidos ?? []) as any[]).map((p) => (
              <li key={p.id} className="flex border-b border-line-soft py-2 last:border-0">
                <Link href={`/interno/compras/pedidos/${p.id}` as any} className="font-mono hover:text-accent hover:underline">{p.number}</Link>
                <span className="ml-3">{p.supplier?.trade_name ?? p.supplier?.legal_name}</span>
                <span className="ml-auto text-muted">{PEDIDO_STATUS[p.status]?.rot ?? p.status} · {money(Number(p.total_amount))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Mapa id={id} linhas={linhas} fornecedores={fornecedores} condicoes={((conds ?? []) as any[]).map((c) => ({ id: c.id, nome: c.name }))}
            editavel={aberta && permissions.has("quotations.edit")} podeGerar={permissions.has("purchase_orders.create")} />
    </div>
  );
}
