import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { dateTime, initials } from "@/lib/format";

export const metadata = { title: "Usuários · Vitória Procurement" };

export default async function UsuariosPage() {
  const { company } = await requirePermission("users");
  const supabase = await createClient();

  const { data } = await supabase
    .from("user_companies")
    .select("is_active, is_default, user:users(*), role:roles(name, slug)")
    .eq("company_id", company.id);

  const lista = (data ?? []) as any[];

  return (
    <div className="max-w-[1100px] px-6 pb-14 pt-5">
      <PageHeader
        crumb="Administração"
        title="Usuários"
        description={`${lista.length} com acesso a ${company.trade_name ?? company.legal_name}.`}
      />

      <div className="card overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="th">USUÁRIO</th>
              <th className="th">PERFIL</th>
              <th className="th w-28">SITUAÇÃO</th>
              <th className="th w-44">ÚLTIMO ACESSO</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((v) => (
              <tr key={v.user.id} className="hover:bg-raise">
                <td className="td">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-line-soft text-[10px] font-semibold text-graphite">
                      {initials(v.user.full_name)}
                    </span>
                    <div>
                      <div className="font-semibold">{v.user.full_name}</div>
                      <div className="text-[11px] text-muted">{v.user.email}</div>
                    </div>
                  </div>
                </td>
                <td className="td">
                  {v.role.name}
                  {v.user.is_superadmin && (
                    <span className="badge ml-2 bg-info-soft text-info">superadmin</span>
                  )}
                </td>
                <td className="td">
                  <span className={`badge ${v.is_active && v.user.status === "ativo"
                    ? "bg-accent-soft text-accent-ink" : "bg-line-soft text-graphite"}`}>
                    {v.is_active && v.user.status === "ativo" ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td className="td text-graphite">{dateTime(v.user.last_seen_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11.5px] text-muted">
        Convite de novos usuários entra junto com os fluxos de aprovação, na Fase 3.
      </p>
    </div>
  );
}
