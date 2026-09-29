import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Opcao, ProdutoOpcao, UnidadeOpcao } from "./form";

/** Listas do formulário de pedido (fornecedores ativos, condições, centros, produtos com último preço). */
export async function opcoesPedido(companyId: string) {
  const supabase = await createClient();
  const [forn, cond, cc, prods, units, hist] = await Promise.all([
    supabase.from("suppliers").select("id, legal_name, trade_name").eq("company_id", companyId)
      .eq("status", "ativo").is("deleted_at", null).order("legal_name"),
    supabase.from("payment_terms").select("id, name").eq("company_id", companyId).eq("is_active", true).order("code"),
    supabase.from("cost_centers").select("id, code, name").eq("company_id", companyId).order("code"),
    supabase.from("products").select("id, sku, description, unit_id").eq("company_id", companyId)
      .is("deleted_at", null).eq("is_active", true).order("sku").limit(5000),
    supabase.from("units").select("id, code").eq("is_active", true).order("code"),
    supabase.from("product_price_history").select("product_id, unit_price, occurred_on")
      .eq("company_id", companyId).order("occurred_on", { ascending: false }).limit(5000),
  ]);
  const ultimo = new Map<string, number>();
  for (const h of (hist.data ?? []) as any[]) if (!ultimo.has(h.product_id)) ultimo.set(h.product_id, Number(h.unit_price));

  return {
    fornecedores: ((forn.data ?? []) as any[]).map((f) => ({ id: f.id, nome: f.trade_name ?? f.legal_name })) as Opcao[],
    condicoes: ((cond.data ?? []) as any[]).map((c) => ({ id: c.id, nome: c.name })) as Opcao[],
    centros: ((cc.data ?? []) as any[]).map((c) => ({ id: c.id, nome: `${c.code} · ${c.name}` })) as Opcao[],
    produtos: ((prods.data ?? []) as any[]).map((p) => ({ ...p, ultimo: ultimo.get(p.id) ?? null })) as ProdutoOpcao[],
    unidades: (units.data ?? []) as UnidadeOpcao[],
  };
}
