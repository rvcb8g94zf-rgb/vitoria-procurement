"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

const schema = z.object({
  id: z.string().uuid().optional(),
  doc_type: z.enum(["cnpj", "cpf"]),
  doc_number: z.string().transform(digits),
  legal_name: z.string().trim().min(3, "Informe a razão social").max(160),
  trade_name: z.string().trim().max(120).optional().or(z.literal("")),
  state_reg: z.string().trim().max(30).optional().or(z.literal("")),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  state_uf: z.string().trim().length(2).optional().or(z.literal("")),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  email: z.string().trim().email("E-mail inválido").optional().or(z.literal("")),
  payment_term_id: z.string().uuid().optional().or(z.literal("")),
  avg_lead_days: z.coerce.number().int().min(0).max(365).optional(),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type FormState = { erro?: string; ok?: boolean };

const nulls = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === "" ? null : v]));

export async function salvarFornecedor(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = schema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { erro: parsed.error.issues[0].message };

  const { company } = await getSession();
  const supabase = await createClient();
  const { id, ...campos } = parsed.data;

  const { error } = id
    ? await supabase.from("suppliers").update(nulls(campos)).eq("id", id)
    : await supabase.from("suppliers").insert({ ...nulls(campos), company_id: company.id });

  if (error) {
    // 23514 = CHECK: o dígito verificador do documento não fecha
    if (error.code === "23514") return { erro: "CNPJ ou CPF inválido — confira os dígitos." };
    if (error.code === "23505") return { erro: "Já existe um fornecedor com este documento nesta empresa." };
    if (error.code === "42501") return { erro: "Você não tem permissão para esta ação." };
    console.error("[fornecedores]", error);
    return { erro: "Não foi possível salvar." };
  }

  revalidatePath("/cadastros/fornecedores");
  return { ok: true };
}
