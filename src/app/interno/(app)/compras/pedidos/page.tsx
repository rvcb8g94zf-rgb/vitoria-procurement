import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { date, money } from "@/lib/format";
import { PEDIDO_FILTROS, PEDIDO_STATUS } from "@/lib/compras";

export const metadata = { title: "Pedidos de compra · Vitória Procurement" };

type Linha = {
  id: string; number: string; supplier_name: string; issued_on: string; expected_on: string | null;
  status: string; total_amount: number; items_count: number; buyer_name: string | null;
  pending_rule: string | null; can_decide: boolean;
};

export default async function PedidosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { company, permissions } = await requirePermission("purchase_orders");
  const sp = await searchParams;
  const um = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) as string | undefined;
  const situacao = PEDIDO_FILTROS.some((f) => f.valor === (um("situacao") ?? "abertos")) ? (um("situacao") ?? "abertos") : "abertos";
  const busca = (um("busca") ?? "").slice(0, 60);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_purchase_orders", {
    _company_id: company.id, _status: situacao, _search: busca || null,
  });
  const lista = (data ?? []) as Linha[];
  const total = lista.filter((p) => p.status !== "cancelado").reduce((s, p) => s + Number(p.total_amount), 0);
  const url = (v: string) => `/interno/compras/pedidos?situacao=${v}${busca ? `&busca=${encodeURIComponent(busca)}` : ""}`;

  return (
    <div className="max-w-[1240px] px-6 pb-14 pt-5">
      <PageHeader
        crumb="Compras"
        title="Pedidos de compra"
        description={`${lista.length} pedido(s) · ${money(total)}`}
        actions={permissions.has("purchase_orders.create") ? (
          <Link href="/interno/compras/pedidos/novo" className="btn btn-primary"><Plus className="h-3.5 w-3.5" /> Novo pedido</Link>
        ) : undefined}
      />

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {PEDIDO_FILTROS.map((f) => (
          <Link key={f.valor || "todos"} href={url(f.valor) as any} aria-current={f.valor === situacao ? "true" : undefined}
                className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium ${f.valor === situacao
                  ? "border-accent bg-accent-soft text-accent-ink" : "border-line text-graphite hover:border-graphite hover:text-ink"}`}>
            {f.rotulo}
          </Link>
        ))}
        <form method="get" action="/interno/compras/pedidos" className="ml-auto flex gap-1.5">
          <input type="hidden" name="situacao" value={situacao} />
          <input name="busca" defaultValue={busca} placeholder="Número, fornecedor ou item" aria-label="Buscar pedidos"
                 className="field h-8 w-60" />
          <button type="submit" className="btn h-8">Buscar</button>
        </form>
      </div>

      <div className="card overflow-x-auto">
        {error ? (
          <EmptyState title="Não foi possível carregar os pedidos" hint="Tente de novo em instantes." />
        ) : lista.length === 0 ? (
          <EmptyState title="Nenhum pedido aqui" hint={permissions.has("purchase_orders.create") ? "Use “Novo pedido” para lançar o primeiro." : undefined} />
        ) : (
          <table className="w-full min-w-[900px] border-collapse">
            <thead><tr>
              <th className="th w-28">PEDIDO</th><th className="th">FORNECEDOR</th><th className="th w-28">EMISSÃO</th>
              <th className="th w-28">ENTREGA</th><th className="th w-56">SITUAÇÃO</th><th className="th w-32 text-right">TOTAL</th>
            </tr></thead>
            <tbody>
              {lista.map((p) => {
                const s = PEDIDO_STATUS[p.status] ?? { rot: p.status, cls: "" };
                return (
                  <tr key={p.id} className="align-top hover:bg-raise">
                    <td className="td">
                      <Link href={`/interno/compras/pedidos/${p.id}` as any} className="font-mono font-semibold hover:text-accent hover:underline">{p.number}</Link>
                    </td>
                    <td className="td">
                      {p.supplier_name}
                      <span className="block text-[11px] text-muted">{p.items_count} item(ns){p.buyer_name ? ` · ${p.buyer_name}` : ""}</span>
                    </td>
                    <td className="td">{date(p.issued_on)}</td>
                    <td className="td">{p.expected_on ? date(p.expected_on) : "—"}</td>
                    <td className="td">
                      <span className={`badge ${s.cls}`}>{s.rot}</span>
                      {p.pending_rule && <span className="mt-1 block text-[11px] text-muted">{p.pending_rule}</span>}
                      {p.can_decide && (
                        <Link href={`/interno/compras/pedidos/${p.id}` as any} className="mt-1 block text-[11.5px] font-medium text-accent-ink hover:underline">Você pode aprovar</Link>
                      )}
                    </td>
                    <td className="td text-right font-mono tabular-nums">{money(Number(p.total_amount))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
