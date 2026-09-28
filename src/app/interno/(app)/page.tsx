import { PageHeader } from "@/components/page-header";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { dateTime } from "@/lib/format";

export default async function DashboardPage() {
  const { company, user, role } = await getSession();
  const supabase = await createClient();

  const [{ count: depts }, { count: centros }, { data: atividades }] = await Promise.all([
    supabase.from("departments").select("id", { count: "exact", head: true }).eq("company_id", company.id),
    supabase.from("cost_centers").select("id", { count: "exact", head: true }).eq("company_id", company.id),
    supabase.from("activity_logs").select("summary, created_at")
      .eq("company_id", company.id).order("created_at", { ascending: false }).limit(6),
  ]);

  return (
    <div className="max-w-[1360px] px-6 pb-14 pt-5">
      <PageHeader
        crumb={company.trade_name ?? company.legal_name}
        title={`Olá, ${user.full_name.split(" ")[0]}`}
        description={`Você está em ${company.trade_name ?? company.legal_name} como ${role.name}.`}
      />

      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded border border-line bg-line lg:grid-cols-4">
        {[
          { l: "Departamentos", v: depts ?? 0 },
          { l: "Centros de custo", v: centros ?? 0 },
          { l: "Fornecedores", v: "—", s: "Fase 2" },
          { l: "Notas fiscais", v: "—", s: "Fase 4" },
        ].map((k) => (
          <div key={k.l} className="bg-surface px-4 py-3.5">
            <div className="text-[11px] font-medium text-muted">{k.l}</div>
            <div className="mt-1.5 font-display text-[21px] font-semibold tracking-tight">{k.v}</div>
            {k.s && <div className="mt-0.5 text-[11px] text-muted">{k.s}</div>}
          </div>
        ))}
      </div>

      <div className="card">
        <div className="border-b border-line-soft px-4 py-3">
          <h3 className="text-[13.5px] font-semibold">Atividades recentes</h3>
        </div>
        <div className="px-4 py-1">
          {(atividades ?? []).map((a, i) => (
            <div key={i} className="flex gap-3 border-b border-line-soft py-2.5 last:border-0">
              <p className="text-[12.5px] text-graphite">{a.summary}</p>
              <time className="ml-auto whitespace-nowrap text-[11px] text-muted">
                {dateTime(a.created_at)}
              </time>
            </div>
          ))}
          {(atividades ?? []).length === 0 && (
            <p className="py-8 text-center text-[12.5px] text-muted">Nenhuma atividade registrada ainda.</p>
          )}
        </div>
      </div>
    </div>
  );
}
