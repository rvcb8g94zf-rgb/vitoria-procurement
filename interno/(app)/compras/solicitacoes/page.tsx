import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { date } from "@/lib/format";
import { PRIORIDADE, SOLIC_FILTROS, SOLIC_STATUS } from "@/lib/compras";

export const metadata = { title: "Solicitações de compra · Vitória Procurement" };

export default async function SolicitacoesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company, permissions } = await requirePermission("purchase_requests");
  const sp = await searchParams;
  const um = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) as string | undefined;
  const comprador = permissions.has("purchase_orders.create");
  const padrao = comprador ? "enviada" : "abertas";
  const situacao = SOLIC_FILTROS.some((f) => f.valor === (um("situacao") ?? padrao)) ? (um("situacao") ?? padrao) : padrao;
  const minhas = um("minhas") === "1" || !comprador;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_purchase_requests", {
    _company_id: company.id, _status: situacao, _mine: minhas, _search: (um("busca") ?? "").slice(0, 60) || null,
  });
  const lista = (data ?? []) as any[];
  const url = (v: string, m = minhas) => `/interno/compras/solicitacoes?situacao=${v}${m && comprador ? "&minhas=1" : ""}`;

  return (
    <div className="max-w-[1200px] px-6 pb-14 pt-5">
      <PageHeader crumb="Compras" title="Solicitações de compra"
                  description={comprador ? "O que os setores pediram. Aceite para cotar ou fazer o pedido." : "O que você pediu ao Compras e em que pé está."}
                  actions={permissions.has("purchase_requests.create")
                    ? <Link href="/interno/compras/solicitacoes/novo" className="btn btn-primary"><Plus className="h-3.5 w-3.5" /> Nova solicitação</Link>
                    : undefined} />
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {SOLIC_FILTROS.map((f) => (
          <Link key={f.valor || "todas"} href={url(f.valor) as any} aria-current={f.valor === situacao ? "true" : undefined}
                className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium ${f.valor === situacao
                  ? "border-accent bg-accent-soft text-accent-ink" : "border-line text-graphite hover:border-graphite hover:text-ink"}`}>{f.rotulo}</Link>
        ))}
        {comprador && (
          <Link href={url(situacao, !minhas) as any} className="ml-auto text-[12px] text-accent-ink hover:underline">
            {minhas ? "Ver de todos" : "Só as minhas"}
          </Link>
        )}
      </div>
      <div className="card overflow-x-auto">
        {error ? <EmptyState title="Não foi possível carregar" hint="Tente de novo em instantes." />
        : lista.length === 0 ? <EmptyState title="Nenhuma solicitação aqui" />
        : (
          <table className="w-full min-w-[860px] border-collapse">
            <thead><tr>
              <th className="th w-28">NÚMERO</th><th className="th">ITENS</th><th className="th w-44">QUEM PEDIU</th>
              <th className="th w-28">PARA</th><th className="th w-24">PRIORIDADE</th><th className="th w-48">SITUAÇÃO</th>
            </tr></thead>
            <tbody>
              {lista.map((r) => {
                const s = SOLIC_STATUS[r.status] ?? { rot: r.status, cls: "" };
                const p = PRIORIDADE[r.priority] ?? PRIORIDADE.normal;
                return (
                  <tr key={r.id} className="align-top hover:bg-raise">
                    <td className="td"><Link href={`/interno/compras/solicitacoes/${r.id}` as any} className="font-mono font-semibold hover:text-accent hover:underline">{r.number}</Link></td>
                    <td className="td">{r.first_item}{r.items_count > 1 && <span className="text-muted"> +{r.items_count - 1}</span>}</td>
                    <td className="td">{r.requester_name}<span className="block text-[11px] text-muted">{r.department_name ?? ""} · {date(r.requested_on)}</span></td>
                    <td className="td">{r.needed_by ? date(r.needed_by) : "—"}</td>
                    <td className={`td ${p.cls}`}>{p.rot}</td>
                    <td className="td"><span className={`badge ${s.cls}`}>{s.rot}</span></td>
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
