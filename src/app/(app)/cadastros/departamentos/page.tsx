import { PageHeader, EmptyState } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { DepartamentoDialog } from "./dialog";
import type { Department } from "@/types";

export const metadata = { title: "Departamentos · Vitória Procurement" };

export default async function DepartamentosPage() {
  const { company, permissions } = await requirePermission("departments");
  const podeEditar = permissions.has("departments.edit");
  const podeCriar = permissions.has("departments.create");

  const supabase = await createClient();
  const { data } = await supabase
    .from("departments")
    .select("*")
    .eq("company_id", company.id)
    .order("code");

  const lista = (data ?? []) as Department[];

  return (
    <div className="max-w-[1100px] px-6 pb-14 pt-5">
      <PageHeader
        crumb="Cadastros"
        title="Departamentos"
        description={`${lista.length} cadastrados em ${company.trade_name ?? company.legal_name}.`}
        actions={podeCriar ? <DepartamentoDialog /> : undefined}
      />

      <div className="card overflow-hidden">
        {lista.length === 0 ? (
          <EmptyState
            title="Nenhum departamento cadastrado"
            hint="Departamentos organizam solicitações e centros de custo."
            action={podeCriar ? <DepartamentoDialog /> : undefined}
          />
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="th w-32">CÓDIGO</th>
                <th className="th">NOME</th>
                <th className="th w-28">SITUAÇÃO</th>
                {podeEditar && <th className="th w-24" />}
              </tr>
            </thead>
            <tbody>
              {lista.map((d) => (
                <tr key={d.id} className="hover:bg-raise">
                  <td className="td font-mono">{d.code}</td>
                  <td className="td font-semibold">{d.name}</td>
                  <td className="td">
                    <span className={`badge ${d.is_active ? "bg-accent-soft text-accent-ink" : "bg-line-soft text-graphite"}`}>
                      {d.is_active ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  {podeEditar && (
                    <td className="td text-right">
                      <DepartamentoDialog departamento={d} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
