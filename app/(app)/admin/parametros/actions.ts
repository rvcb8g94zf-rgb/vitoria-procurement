"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

const pct = z.coerce.number().min(0).max(1000);
const val = z.coerce.number().min(0);

const schema = z.object({
  tolerance_rule: z.enum(["either", "both"]),
  price_tol_pct: pct, price_tol_abs: val,
  total_tol_pct: pct, total_tol_abs: val,
  quantity_tol_pct: pct, quantity_tol_abs: val,
  favorable_review_pct: pct,
  accept_favorable_variance: z.coerce.boolean(),
  auto_register_supplier: z.coerce.boolean(),
  auto_register_product: z.coerce.boolean(),
  block_import_on_divergence: z.coerce.boolean(),
  require_cost_center: z.coerce.boolean(),
});

export type FormState = { erro?: string; ok?: boolean };

export async function salvarParametros(_prev: FormState, form: FormData): Promise<FormState> {
  const bruto = Object.fromEntries(form.entries());
  // checkbox ausente no FormData significa desmarcado
  for (const k of ["accept_favorable_variance", "auto_register_supplier",
                   "auto_register_product", "block_import_on_divergence", "require_cost_center"]) {
    bruto[k] = (bruto[k] === "on" ? "true" : "") as any;
  }

  const parsed = schema.safeParse(bruto);
  if (!parsed.success) return { erro: "Confira os valores informados." };

  const { company } = await getSession();
  const supabase = await createClient();

  const { error } = await supabase
    .from("company_settings")
    .update(parsed.data)
    .eq("company_id", company.id);

  if (error) {
    if (error.code === "42501") return { erro: "Você não tem permissão para alterar os parâmetros." };
    console.error("[parametros]", error);
    return { erro: "Não foi possível salvar." };
  }

  revalidatePath("/admin/parametros");
  return { ok: true };
}
