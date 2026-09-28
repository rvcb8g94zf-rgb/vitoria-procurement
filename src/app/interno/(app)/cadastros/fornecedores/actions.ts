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

  revalidatePath("/interno/cadastros/fornecedores");
  return { ok: true };
}

// ---------------------------------------------------------------------
// Fornecedor que chegou pela nota: aprovar (vira ativo) ou rejeitar
// (vira bloqueado, com motivo). Quem decide é o banco, com suppliers.edit.
// ---------------------------------------------------------------------
const revisao = z.object({
  id: z.string().uuid(),
  decisao: z.enum(["aprovar", "rejeitar"]),
  motivo: z.string().trim().max(500).optional(),
});

export type RevisaoState = { erro?: string; ok?: boolean; decisao?: "aprovar" | "rejeitar" };

export async function revisarFornecedor(_prev: RevisaoState, form: FormData): Promise<RevisaoState> {
  const d = revisao.safeParse({
    id: form.get("id"), decisao: form.get("decisao"), motivo: form.get("motivo") ?? undefined,
  });
  if (!d.success) return { erro: "Pedido inválido." };
  if (d.data.decisao === "rejeitar" && (d.data.motivo ?? "").length < 5) {
    return { erro: "Escreva o motivo da rejeição (pelo menos 5 letras)." };
  }

  const { company } = await getSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_supplier", {
    _company_id: company.id, _supplier_id: d.data.id, _decisao: d.data.decisao, _motivo: d.data.motivo ?? null,
  });
  if (error) {
    if (error.code === "42501") return { erro: "Você não tem permissão para aprovar fornecedores." };
    if (error.code === "22023") return { erro: error.message };
    console.error("[fornecedores] revisão", error);
    return { erro: "Não foi possível concluir agora." };
  }

  revalidatePath("/interno/cadastros/fornecedores");
  revalidatePath(`/interno/cadastros/fornecedores/${d.data.id}`);
  revalidatePath("/interno/notas");
  return { ok: true, decisao: d.data.decisao };
}
