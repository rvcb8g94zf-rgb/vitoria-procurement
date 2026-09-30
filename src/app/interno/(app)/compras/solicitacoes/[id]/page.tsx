import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/panels";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { date, dateTime, decimal, money } from "@/lib/format";
import { COT_STATUS, PEDIDO_STATUS, PRIORIDADE, SOLIC_STATUS } from "@/lib/compras";
import { AcoesSolicitacao } from "./acoes";

export const metadata = { title: "Solicitação de compra · Vitória Procurement" };

export default async function SolicitacaoPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { company, permissions, user } = await requirePermission("purchase_requests");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: r } = await supabase.from("purchase_requests").select(`
      *, requester:users!purchase_requests_requester_id_fkey(full_name), decider:users!purchase_requests_decided_by_fkey(full_name),
      dep:departments(name), cc:cost_centers(code, name),
      items:purchase_request_items(line_no, description, spec, quantity, product:products(id, sku), unit:units(code))
    `).eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!r) notFound();
  const { data: segue } = await supabase.rpc("request_followup", { _company_id: company.id, _request_id: id });
  const cotacoes = ((segue ?? []) as any[]).filter((x) => x.kind === "cotacao");
  const pedidos = ((segue ?? []) as any[]).filter((x) => x.kind === "pedido");
  const verCot = permissions.has("quotations.view");
  const verPed = permissions.has("purchase_orders.view");
  const itens = ((r.items ?? []) as any[]).sort((a, b) => a.line_no - b.line_no);
  const s = SOLIC_STATUS[r.status] ?? { rot: r.status, cls: "" };
  const pr = PRIORIDADE[r.priority] ?? PRIORIDADE.normal;
  const erro = typeof sp.erro === "string" ? sp.erro : null;

  return (
    <div className="max-w-[1100px] px-6 pb-14 pt-5">
      <PageHeader crumb={<>Compras · <Link href="/interno/compras/solicitacoes" className="hover:text-ink">Solicitações</Link></>}
                  title={`Solicitação ${r.number}`}
                  description={`Pedida por ${(r.requester as any)?.full_name ?? "—"} em ${date(r.requested_on)}`} />
      {erro && <p role="alert" className="mb-4 rounded bg-danger-soft px-3.5 py-3 text-[12.5px] text-danger">{erro}</p>}
      {sp.enviada && r.status === "enviada" && (
        <p role="status" className="mb-4 flex items-center gap-2 rounded bg-accent-soft px-3.5 py-3 text-[12.5px] text-accent-ink">
          <CheckCircle2 className="h-4 w-4" /> Solicitação enviada ao Compras.
        </p>
      )}
      {r.status === "recusada" && (
        <p className="mb-4 rounded bg-danger-soft px-3.5 py-3 text-[12.5px] text-danger">
          <b>Recusada</b> por {(r.decider as any)?.full_name ?? "—"} em {dateTime(r.decided_at)}: {r.decision_note}
        </p>
      )}
      {r.status === "cancelada" && r.cancel_reason && (
        <p className="mb-4 rounded bg-line-soft px-3.5 py-3 text-[12.5px] text-graphite"><b>Cancelada:</b> {r.cancel_reason}</p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded border border-line bg-surface px-4 py-3">
        <span className={`badge ${s.cls}`}>{s.rot}</span>
        <span className={`text-[12.5px] ${pr.cls}`}>Prioridade {pr.rot.toLowerCase()}</span>
        {r.needed_by && <span className="text-[12.5px] text-graphite">· para {date(r.needed_by)}</span>}
        <div className="ml-auto">
          <AcoesSolicitacao id={id} numero={r.number} status={r.status} souAutor={r.requester_id === user.id}
                            souComprador={permissions.has("purchase_orders.create")}
                            podeCancelar={permissions.has("purchase_requests.cancel")} />
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { l: "Departamento", v: (r.dep as any)?.name ?? "—" },
          { l: "Centro de custo", v: r.cc ? `${(r.cc as any).code} · ${(r.cc as any).name}` : "—" },
          { l: "Por que precisa", v: r.justification ?? "—" },
        ].map((k) => (
          <div key={k.l} className="card px-4 py-3">
            <div className="text-[11px] font-medium text-muted">{k.l}</div>
            <div className="mt-1 text-[13px]">{k.v}</div>
          </div>
        ))}
      </div>

      <Card title="Itens" note={`${itens.length} ${itens.length === 1 ? "item" : "itens"}`} className="mb-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead><tr><th className="th w-10">#</th><th className="th">ITEM</th><th className="th w-64">DETALHES</th><th className="th w-32 text-right">QTD</th></tr></thead>
            <tbody>
              {itens.map((i) => (
                <tr key={i.line_no} className="hover:bg-raise">
                  <td className="td text-muted">{i.line_no}</td>
                  <td className="td">{i.description}{i.product && <span className="ml-2 font-mono text-[11px] text-accent-ink">{i.product.sku}</span>}</td>
                  <td className="td text-graphite">{i.spec ?? "—"}</td>
                  <td className="td text-right font-mono tabular-nums">{decimal(Number(i.quantity))} <span className="text-[11px] text-muted">{i.unit?.code ?? ""}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {(cotacoes.length > 0 || pedidos.length > 0) && (
        <Card title="Andamento">
          <ul className="px-4 py-1 text-[12.5px]">
            {cotacoes.map((c) => (
              <li key={c.id} className="flex border-b border-line-soft py-2 last:border-0">
                {verCot ? <Link href={`/interno/compras/cotacoes/${c.id}` as any} className="font-mono hover:text-accent hover:underline">Cotação {c.number}</Link>
                        : <span className="font-mono">Cotação {c.number}</span>}
                <span className="ml-auto text-muted">{COT_STATUS[c.status]?.rot ?? c.status}</span>
              </li>
            ))}
            {pedidos.map((p) => (
              <li key={p.id} className="flex border-b border-line-soft py-2 last:border-0">
                {verPed ? <Link href={`/interno/compras/pedidos/${p.id}` as any} className="font-mono hover:text-accent hover:underline">Pedido {p.number}</Link>
                        : <span className="font-mono">Pedido {p.number}</span>}
                <span className="ml-3">{p.supplier_name}</span>
                <span className="ml-auto text-muted">{PEDIDO_STATUS[p.status]?.rot ?? p.status} · {money(Number(p.total))}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
