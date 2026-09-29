import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { date, dateTime, money } from "@/lib/format";
import { addDays, todayISO } from "@/lib/caixa";
import { STATUS_LABEL } from "@/lib/notas";

type Titulo = {
  id: string; description: string | null; supplier_label: string | null; due_date: string;
  amount: number; paid_amount: number; supplier: { trade_name: string | null; legal_name: string } | null;
};

const soma = (l: Titulo[]) => l.reduce((s, t) => s + Number(t.amount) - Number(t.paid_amount), 0);

export default async function VisaoGeralPage() {
  const { company, user, role, permissions } = await getSession();
  const pode = (p: string) => permissions.has(p);
  const supabase = await createClient();
  const hoje = todayISO();
  const em7 = addDays(hoje, 7);
  const inicioMes = hoje.slice(0, 8) + "01";
  const vazio = Promise.resolve({ data: null, count: null, error: null });

  const [titulos, notasMes, notasRecentes, divergencias, fornPend, itensPend, dups, atividades, aprovar, solics] = await Promise.all([
    pode("accounts_payable.view")
      ? supabase.from("payables")
          .select("id, description, supplier_label, due_date, amount, paid_amount, supplier:suppliers(trade_name, legal_name)")
          .eq("company_id", company.id).is("cancelled_at", null).in("status", ["aberto", "parcial"])
          .lte("due_date", em7).order("due_date").limit(500)
      : vazio,
    pode("invoices.view")
      ? supabase.from("received_invoices").select("total_amount", { count: "exact" })
          .eq("company_id", company.id).gte("issued_at", inicioMes).neq("fiscal_status", "cancelada").limit(2000)
      : vazio,
    pode("invoices.view")
      ? supabase.from("received_invoices")
          .select("id, number, emitter_name, issued_at, total_amount, fiscal_status, doc_kind, supplier:suppliers(trade_name, legal_name)")
          .eq("company_id", company.id).order("issued_at", { ascending: false }).limit(6)
      : vazio,
    pode("divergences.view") ? supabase.rpc("list_divergences", { _company_id: company.id }) : vazio,
    pode("suppliers.view")
      ? supabase.from("suppliers").select("id", { count: "exact", head: true })
          .eq("company_id", company.id).eq("status", "pendente").is("deleted_at", null)
      : vazio,
    pode("pending_registrations.view") ? supabase.rpc("pending_products", { _company_id: company.id }) : vazio,
    pode("installments.view") ? supabase.rpc("pending_duplicates", { _company_id: company.id }) : vazio,
    supabase.from("activity_logs").select("summary, created_at, link")
      .eq("company_id", company.id).order("created_at", { ascending: false }).limit(6),
    pode("approvals.view") ? supabase.rpc("my_pending_approvals", { _company_id: company.id }) : vazio,
    pode("purchase_orders.create")
      ? supabase.from("purchase_requests").select("id", { count: "exact", head: true })
          .eq("company_id", company.id).eq("status", "enviada").is("deleted_at", null)
      : vazio,
  ]);
  const nAprovar = ((aprovar.data ?? []) as unknown[]).length;
  const nSolics = solics.count ?? 0;

  const tit = ((titulos.data ?? []) as unknown as Titulo[]);
  const vencidos = tit.filter((t) => t.due_date < hoje);
  const semana = tit.filter((t) => t.due_date >= hoje);
  const notasNoMes = (notasMes.data ?? []) as { total_amount: number }[];
  const valorMes = notasNoMes.reduce((s, n) => s + Number(n.total_amount ?? 0), 0);
  const divs = (divergencias.data ?? []) as { severity: string }[];
  const divGraves = divs.filter((d) => d.severity !== "info").length;
  const nFornPend = fornPend.count ?? 0;
  const nItens = ((itensPend.data ?? []) as unknown[]).length;
  const nDups = ((dups.data ?? []) as unknown[]).length;

  const pendencias = [
    pode("approvals.view") && { n: nAprovar, rot: nAprovar === 1 ? "pedido de compra esperando a sua aprovação" : "pedidos de compra esperando a sua aprovação", href: "/interno/compras/aprovacoes", grave: nAprovar > 0 },
    pode("purchase_orders.create") && { n: nSolics, rot: nSolics === 1 ? "solicitação esperando o Compras" : "solicitações esperando o Compras", href: "/interno/compras/solicitacoes?situacao=enviada" },
    pode("divergences.view") && { n: divGraves, rot: divGraves === 1 ? "divergência entre nota e financeiro" : "divergências entre nota e financeiro", href: "/interno/notas/divergencias", grave: divGraves > 0 },
    pode("suppliers.view") && { n: nFornPend, rot: nFornPend === 1 ? "fornecedor aguardando aprovação" : "fornecedores aguardando aprovação", href: "/interno/cadastros/fornecedores?situacao=pendente" },
    pode("pending_registrations.view") && { n: nItens, rot: nItens === 1 ? "item de nota sem produto" : "itens de nota sem produto", href: "/interno/notas/validacao" },
    pode("installments.view") && { n: nDups, rot: nDups === 1 ? "nota com parcelas sem título" : "notas com parcelas sem título", href: "/interno/financeiro/duplicatas" },
  ].filter(Boolean) as { n: number; rot: string; href: string; grave?: boolean }[];

  const kpis = [
    pode("accounts_payable.view") && { l: "Vencido sem pagamento", v: money(soma(vencidos)), s: `${vencidos.length} título(s)`, tom: vencidos.length > 0 ? "text-danger" : "", href: `/interno/financeiro/contas-a-pagar?de=2000-01-01&ate=${addDays(hoje, -1)}&situacao=em_aberto` },
    pode("accounts_payable.view") && { l: "Vence em 7 dias", v: money(soma(semana)), s: `${semana.length} título(s)`, tom: "", href: `/interno/financeiro/contas-a-pagar?de=${hoje}&ate=${em7}&situacao=em_aberto` },
    pode("invoices.view") && { l: "Notas recebidas no mês", v: String(notasMes.count ?? notasNoMes.length), s: money(valorMes), tom: "", href: `/interno/notas?de=${inicioMes}&ate=${hoje}` },
    pendencias.length > 0 && { l: "Pendências", v: String(pendencias.reduce((s, p) => s + p.n, 0)), s: "detalhes abaixo", tom: pendencias.some((p) => p.grave) ? "text-warn" : "", href: "#pendencias" },
  ].filter(Boolean) as { l: string; v: string; s: string; tom: string; href: string }[];

  const proximos = [...vencidos, ...semana].slice(0, 8);
  const recentes = (notasRecentes.data ?? []) as any[];

  return (
    <div className="max-w-[1360px] px-6 pb-14 pt-5">
      <PageHeader
        crumb={company.trade_name ?? company.legal_name}
        title={`Olá, ${user.full_name.split(" ")[0]}`}
        description={`Você está em ${company.trade_name ?? company.legal_name} como ${role.name}. Posição de ${date(hoje)}.`}
      />

      {kpis.length > 0 && (
        <div className={`mb-5 grid grid-cols-2 gap-px overflow-hidden rounded border border-line bg-line ${kpis.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
          {kpis.map((k) => (
            <Link key={k.l} href={k.href as any} className="group bg-surface px-4 py-3.5 hover:bg-raise">
              <div className="text-[11px] font-medium text-muted">{k.l}</div>
              <div className={`mt-1.5 font-display text-[21px] font-semibold tracking-tight ${k.tom}`}>{k.v}</div>
              <div className="mt-0.5 text-[11px] text-muted">{k.s}</div>
            </Link>
          ))}
        </div>
      )}

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        {pode("accounts_payable.view") && (
          <section className="card">
            <div className="flex items-center border-b border-line-soft px-4 py-3">
              <h3 className="text-[13.5px] font-semibold">Vencidos e próximos 7 dias</h3>
              <Link href="/interno/financeiro/calendario" className="ml-auto inline-flex items-center gap-1 text-[12px] text-accent-ink hover:underline">
                Calendário <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            {proximos.length === 0 ? (
              <p className="px-4 py-8 text-center text-[12.5px] text-muted">Nada vencido nem vencendo nos próximos 7 dias.</p>
            ) : (
              <ul className="px-4 py-1">
                {proximos.map((t) => {
                  const atraso = t.due_date < hoje;
                  return (
                    <li key={t.id} className="flex items-baseline gap-3 border-b border-line-soft py-2.5 last:border-0">
                      <span className={`w-20 shrink-0 font-mono text-[12px] ${atraso ? "text-danger" : "text-graphite"}`}>{date(t.due_date)}</span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px]">
                        {t.supplier ? (t.supplier.trade_name ?? t.supplier.legal_name) : t.supplier_label ?? "—"}
                        <span className="block truncate text-[11px] text-muted">{t.description}</span>
                      </span>
                      <span className="font-mono text-[12.5px] tabular-nums">{money(Number(t.amount) - Number(t.paid_amount))}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {pendencias.length > 0 && (
          <section id="pendencias" className="card">
            <div className="border-b border-line-soft px-4 py-3">
              <h3 className="text-[13.5px] font-semibold">Pendências</h3>
            </div>
            <ul className="px-4 py-1">
              {pendencias.map((p) => (
                <li key={p.href} className="border-b border-line-soft last:border-0">
                  <Link href={p.href as any} className="flex items-center gap-3 py-2.5 text-[12.5px] hover:text-accent-ink">
                    {p.n > 0
                      ? <AlertTriangle className={`h-4 w-4 shrink-0 ${p.grave ? "text-danger" : "text-warn"}`} strokeWidth={1.8} />
                      : <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} />}
                    <span className={p.n > 0 ? "" : "text-muted"}>
                      <b className="font-mono">{p.n}</b> {p.rot}
                    </span>
                    <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        {pode("invoices.view") && (
          <section className="card">
            <div className="flex items-center border-b border-line-soft px-4 py-3">
              <h3 className="text-[13.5px] font-semibold">Notas recentes</h3>
              <Link href="/interno/notas" className="ml-auto inline-flex items-center gap-1 text-[12px] text-accent-ink hover:underline">
                Todas <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            {recentes.length === 0 ? (
              <p className="px-4 py-8 text-center text-[12.5px] text-muted">Nenhuma nota recebida ainda.</p>
            ) : (
              <ul className="px-4 py-1">
                {recentes.map((n) => {
                  const f = Array.isArray(n.supplier) ? n.supplier[0] : n.supplier;
                  return (
                    <li key={n.id} className="border-b border-line-soft last:border-0">
                      <Link href={`/interno/notas/${n.id}`} className="flex items-baseline gap-3 py-2.5 hover:text-accent-ink">
                        <span className="w-20 shrink-0 font-mono text-[12px] text-graphite">{date(n.issued_at)}</span>
                        <span className="min-w-0 flex-1 truncate text-[12.5px]">
                          {f ? (f.trade_name ?? f.legal_name) : n.emitter_name}
                          <span className="block text-[11px] text-muted">
                            NF-e {n.number ?? "s/nº"} · {STATUS_LABEL[n.fiscal_status] ?? n.fiscal_status}
                            {n.doc_kind === "resumo" ? " · só resumo" : ""}
                          </span>
                        </span>
                        <span className="font-mono text-[12.5px] tabular-nums">{money(Number(n.total_amount ?? 0))}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        <section className="card">
          <div className="border-b border-line-soft px-4 py-3">
            <h3 className="text-[13.5px] font-semibold">Atividades recentes</h3>
          </div>
          <div className="px-4 py-1">
            {((atividades.data ?? []) as any[]).map((a, i) => (
              <div key={i} className="flex gap-3 border-b border-line-soft py-2.5 last:border-0">
                <p className="text-[12.5px] text-graphite">{a.summary}</p>
                <time className="ml-auto whitespace-nowrap text-[11px] text-muted">{dateTime(a.created_at)}</time>
              </div>
            ))}
            {(atividades.data ?? []).length === 0 && (
              <p className="py-8 text-center text-[12.5px] text-muted">Nenhuma atividade registrada ainda.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
