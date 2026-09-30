import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { date, dateTime, money } from "@/lib/format";
import { AcoesPedido } from "../pedidos/[id]/acoes";

export const metadata = { title: "Aprovações · Vitória Procurement" };

type Pend = {
  order_id: string; number: string; supplier_name: string; total_amount: number; rule_name: string;
  requested_by_name: string | null; submitted_at: string; items_count: number; expected_on: string | null;
};

export default async function AprovacoesPage() {
  const { company, permissions } = await requirePermission("approvals");
  const supabase = await createClient();
  const [{ data, error }, { data: regras }] = await Promise.all([
    supabase.rpc("my_pending_approvals", { _company_id: company.id }),
    supabase.from("approval_rules").select("name, min_amount, max_amount, is_active")
      .eq("company_id", company.id).eq("is_active", true).order("min_amount"),
  ]);
  const lista = (data ?? []) as Pend[];

  return (
    <div className="max-w-[1200px] px-6 pb-14 pt-5">
      <PageHeader
        crumb="Compras"
        title="Aprovações"
        description="Pedidos de compra esperando a sua decisão, conforme a alçada do seu perfil."
      />

      <div className="card mb-4 overflow-x-auto">
        {error ? (
          <EmptyState title="Não foi possível carregar" hint="Tente de novo em instantes." />
        ) : lista.length === 0 ? (
          <EmptyState title="Nada esperando por você" hint="Quando um pedido cair na sua faixa de valor, ele aparece aqui." />
        ) : (
          <table className="w-full min-w-[980px] border-collapse">
            <thead><tr>
              <th className="th w-28">PEDIDO</th><th className="th">FORNECEDOR</th><th className="th w-44">ENVIADO POR</th>
              <th className="th w-32 text-right">TOTAL</th><th className="th w-[330px]" />
            </tr></thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.order_id} className="align-top hover:bg-raise">
                  <td className="td">
                    <Link href={`/interno/compras/pedidos/${p.order_id}` as any} className="font-mono font-semibold hover:text-accent hover:underline">{p.number}</Link>
                  </td>
                  <td className="td">
                    {p.supplier_name}
                    <span className="block text-[11px] text-muted">
                      {p.items_count} item(ns) · {p.rule_name}{p.expected_on ? ` · entrega ${date(p.expected_on)}` : ""}
                    </span>
                  </td>
                  <td className="td">{p.requested_by_name ?? "—"}<span className="block text-[11px] text-muted">{dateTime(p.submitted_at)}</span></td>
                  <td className="td text-right font-mono tabular-nums">{money(Number(p.total_amount))}</td>
                  <td className="td">
                    <AcoesPedido id={p.order_id} numero={p.number} status="aguardando_aprovacao" compacto
                                 podeEditar={false} podeCancelar={false} podeDecidir />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <section className="card">
        <div className="border-b border-line-soft px-4 py-3">
          <h3 className="text-[13.5px] font-semibold">Faixas de aprovação</h3>
          <p className="mt-0.5 text-[11.5px] text-muted">
            Quem lança um pedido dentro da própria faixa já aprova ao enviar. Diretoria e Administrador aprovam qualquer faixa; ninguém aprova o próprio pedido.
          </p>
        </div>
        <ul className="px-4 py-1 text-[12.5px]">
          {((regras ?? []) as any[]).map((r) => (
            <li key={r.name} className="flex border-b border-line-soft py-2 last:border-0">
              <span>{r.name}</span>
              <span className="ml-auto font-mono text-muted">
                {money(Number(r.min_amount))} {r.max_amount ? `a ${money(Number(r.max_amount))}` : "ou mais"}
              </span>
            </li>
          ))}
        </ul>
        {permissions.has("approval_flows.edit") && (
          <p className="border-t border-line-soft px-4 py-2.5 text-[11.5px] text-muted">As faixas ficam na tabela de regras de aprovação de cada empresa.</p>
        )}
      </section>
    </div>
  );
}
