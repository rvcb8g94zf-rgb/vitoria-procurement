import { PageHeader, EmptyState } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { TabelaValidacao, type Pend } from "./tabela";

export const metadata = { title: "Validar cadastros · Vitória Procurement" };



export default async function ValidacaoPage() {
  const { company, permissions } = await requirePermission("pending_registrations");
  const supabase = await createClient();
  const [{ data, error }, { data: prods }, { data: units }] = await Promise.all([
    supabase.rpc("pending_products", { _company_id: company.id }),
    supabase.from("products").select("id, sku, description").eq("company_id", company.id)
      .is("deleted_at", null).order("sku").limit(5000),
    supabase.from("units").select("code, name").eq("is_active", true).order("code"),
  ]);
  const lista = (data ?? []) as Pend[];
  const podeResolver = permissions.has("pending_registrations.approve");
  const podeCriar = permissions.has("products.create");

  return (
    <div className="max-w-[1200px] px-6 pb-14 pt-5">
      <PageHeader
        crumb="Notas fiscais"
        title="Validar cadastros"
        description="Itens de nota cujo código do fornecedor ainda não está ligado a um produto nosso. Ligado uma vez, as próximas notas casam sozinhas."
      />

      <div className="card overflow-x-auto">
        {error ? (
          <EmptyState title="Não foi possível carregar" hint="Tente de novo em instantes." />
        ) : lista.length === 0 ? (
          <EmptyState title="Nenhum item para validar" hint="Todo item das notas recebidas está ligado a um produto do cadastro." />
        ) : (
          <TabelaValidacao lista={lista} produtos={(prods ?? []) as any} unidades={(units ?? []) as any}
                           podeResolver={podeResolver} podeCriar={podeCriar} />
        )}
      </div>
    </div>
  );
}
