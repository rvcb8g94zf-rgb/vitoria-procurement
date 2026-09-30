import "server-only";
import { createClient } from "@/lib/supabase/server";
import { opcoesPedido } from "../pedidos/opcoes";

export async function opcoesSolicitacao(companyId: string) {
  const supabase = await createClient();
  const [o, deps] = await Promise.all([
    opcoesPedido(companyId),
    supabase.from("departments").select("id, name").eq("company_id", companyId).order("name"),
  ]);
  return {
    departamentos: ((deps.data ?? []) as any[]).map((d) => ({ id: d.id, nome: d.name })),
    centros: o.centros, produtos: o.produtos, unidades: o.unidades,
  };
}
