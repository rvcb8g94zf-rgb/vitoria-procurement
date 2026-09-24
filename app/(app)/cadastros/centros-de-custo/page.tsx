import { PageHeader, EmptyState } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";

export const metadata = { title: "Centros de custo · Vitória Procurement" };

export default async function CentrosDeCustoPage() {
  const { company } = await requirePermission("cost_centers");
  const supabase = await createClient();

  const { data } = await supabase
    .from("cost_centers")
    .select("*, department:departments(code, name)")
    .eq("company_id", company.id)
    .order("code");

  const lista = (data ?? []) as any[];

  return (
    <div className="max-w-[1100px] px-6 pb-14 pt-5">
      <PageHeader
        crumb="Cadastros"
        title="Centros de custo"
        description="Todo item de pedido e de nota fiscal é rateado por aqui."
      />

      <div className="card overflow-hidden">
        {lista.length === 0 ? (
          <EmptyState title="Nenhum centro de custo" hint="Sem centro de custo o rateio da Fase 3 não tem destino." />
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="th w-28">CÓDIGO</th>
                <th className="th">NOME</th>
                <th className="th">DEPARTAMENTO</th>
                <th className="th w-40 text-right">ORÇAMENTO MENSAL</th>
                <th className="th w-40 text-right">ORÇAMENTO ANUAL</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id} className="hover:bg-raise">
                  <td className="td font-mono">{c.code}</td>
                  <td className="td font-semibold">{c.name}</td>
                  <td className="td text-graphite">{c.department?.name ?? "—"}</td>
                  <td className="td text-right font-mono">{money(c.monthly_budget)}</td>
                  <td className="td text-right font-mono">{money(c.annual_budget)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
