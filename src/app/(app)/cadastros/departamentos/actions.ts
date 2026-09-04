"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

const schema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().min(1, "Informe o código").max(20).transform((s) => s.toUpperCase()),
  name: z.string().trim().min(2, "Informe o nome").max(120),
});

export type FormState = { erro?: string; ok?: boolean };

export async function salvarDepartamento(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = schema.safeParse({
    id: (form.get("id") as string) || undefined,
    code: form.get("code"),
    name: form.get("name"),
  });

  if (!parsed.success) {
    return { erro: parsed.error.issues[0].message };
  }

  const { company } = await getSession();
  const supabase = await createClient();
  const { id, code, name } = parsed.data;

  // Sem checagem de permissão aqui de propósito: o RLS decide. Se o
  // usuário não puder, o banco recusa e caímos no tratamento abaixo.
  const { error } = id
    ? await supabase.from("departments").update({ code, name }).eq("id", id)
    : await supabase.from("departments").insert({ company_id: company.id, code, name });

  if (error) {
    if (error.code === "23505") return { erro: `Já existe um departamento com o código ${code}.` };
    if (error.code === "42501") return { erro: "Você não tem permissão para esta ação." };
    console.error("[departamentos]", error);
    return { erro: "Não foi possível salvar. Tente novamente." };
  }

  revalidatePath("/cadastros/departamentos");
  return { ok: true };
}

export async function arquivarDepartamento(id: string) {
  const { user } = await getSession();
  const supabase = await createClient();

  // exclusão lógica: centros de custo e, adiante, solicitações apontam
  // para cá — apagar de verdade quebraria histórico
  await supabase
    .from("departments")
    .update({ deleted_at: new Date().toISOString(), deleted_by: user.id, is_active: false })
    .eq("id", id);

  revalidatePath("/cadastros/departamentos");
}
