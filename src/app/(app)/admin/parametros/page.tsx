import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ParametrosForm } from "./form";
import type { CompanySettings } from "@/types";

export const metadata = { title: "Parâmetros · Vitória Procurement" };

export default async function ParametrosPage() {
  const { company, permissions } = await requirePermission("settings");
  const supabase = await createClient();

  const { data } = await supabase
    .from("company_settings")
    .select("*")
    .eq("company_id", company.id)
    .single<CompanySettings>();

  return (
    <div className="max-w-[820px] px-6 pb-14 pt-5">
      <PageHeader
        crumb="Administração"
        title="Parâmetros"
        description={`Regras de conferência e importação de ${company.trade_name ?? company.legal_name}.`}
      />
      {data && <ParametrosForm settings={data} somenteLeitura={!permissions.has("settings.edit")} />}
    </div>
  );
}
