import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { date } from "@/lib/format";
import { COT_STATUS } from "@/lib/compras";

export const metadata = { title: "Cotações · Vitória Procurement" };
const FILTROS = [{ v: "abertas", r: "Em andamento" }, { v: "encerrada", r: "Encerradas" }, { v: "cancelada", r: "Canceladas" }, { v: "", r: "Todas" }];

export default async function CotacoesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company, permissions } = await requirePermission("quotations");
  const sp = await searchParams;
  const pedido = typeof sp.situacao === "string" ? sp.situacao : "abertas";
  const situacao = FILTROS.some((f) => f.v === pedido) ? pedido : "abertas";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_quotations", { _company_id: company.id, _status: situacao });
  const lista = (data ?? []) as any[];
  return (
    <div className="max-w-[1200px] px-6 pb-14 pt-5">
      <PageHeader crumb="Compras" title="Cotações" description="Preço de vários fornecedores lado a lado antes de fazer o pedido."
                  actions={permissions.has("quotations.create") ? <Link href="/interno/compras/cotacoes/nova" className="btn btn-primary"><Plus className="h-3.5 w-3.5" /> Nova cotação</Link> : undefined} />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTROS.map((f) => (
          <Link key={f.v || "todas"} href={`/interno/compras/cotacoes?situacao=${f.v}` as any} aria-current={f.v === situacao ? "true" : undefined}
                className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium ${f.v === situacao ? "border-accent bg-accent-soft text-accent-ink" : "border-line text-graphite hover:border-graphite hover:text-ink"}`}>{f.r}</Link>
        ))}
      </div>
      <div className="card overflow-x-auto">
        {error ? <EmptyState title="Não foi possível carregar" /> : lista.length === 0 ? <EmptyState title="Nenhuma cotação aqui" hint="Abra uma a partir de uma solicitação aceita ou em “Nova cotação”." /> : (
          <table className="w-full min-w-[800px] border-collapse">
            <thead><tr><th className="th w-28">COTAÇÃO</th><th className="th w-32">SOLICITAÇÃO</th><th className="th">RESPOSTAS</th><th className="th w-28">ABERTA</th><th className="th w-28">PRAZO</th><th className="th w-48">SITUAÇÃO</th></tr></thead>
            <tbody>
              {lista.map((q) => {
                const s = COT_STATUS[q.status] ?? { rot: q.status, cls: "" };
                return (
                  <tr key={q.id} className="hover:bg-raise">
                    <td className="td"><Link href={`/interno/compras/cotacoes/${q.id}` as any} className="font-mono font-semibold hover:text-accent hover:underline">{q.number}</Link></td>
                    <td className="td font-mono">{q.request_number ?? "—"}</td>
                    <td className="td">{q.responded} de {q.suppliers} fornecedores · {q.lines} item(ns)</td>
                    <td className="td">{date(q.opened_on)}</td>
                    <td className="td">{q.closes_on ? date(q.closes_on) : "—"}</td>
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
