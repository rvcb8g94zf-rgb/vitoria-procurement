"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { manifestarNotas, type ResultadoNota } from "@/lib/fiscal/manifestar";

export type ManifState = { ok?: boolean; erro?: string; resultados?: ResultadoNota[] };

const schema = z.object({
  tipo: z.enum(["210210", "210200", "210220", "210240"]),
  notas: z.array(z.string().uuid()).min(1, "Escolha pelo menos uma nota.").max(20, "No máximo 20 notas por envio."),
  justificativa: z.string().max(1000).optional(),
  confirmo: z.literal("1", { errorMap: () => ({ message: "Confirme que conferiu antes de enviar." }) }),
});

/** Envia à SEFAZ o evento escolhido para as notas escolhidas. Sempre uma ação de quem está usando. */
export async function manifestar(_prev: ManifState, form: FormData): Promise<ManifState> {
  const d = schema.safeParse({
    tipo: form.get("tipo"),
    notas: form.getAll("nota").map(String).filter(Boolean),
    justificativa: (form.get("justificativa") as string | null) ?? undefined,
    confirmo: form.get("confirmo") ?? "",
  });
  if (!d.success) return { erro: d.error.issues[0]?.message ?? "Pedido inválido." };
  if (d.data.tipo === "210240" && (d.data.justificativa ?? "").trim().length < 15) {
    return { erro: "Escreva a justificativa (pelo menos 15 caracteres)." };
  }

  const { company } = await getSession();
  const supabase = await createClient();
  try {
    const resultados = await manifestarNotas(
      supabase, company.id, d.data.notas, d.data.tipo,
      d.data.tipo === "210240" ? (d.data.justificativa ?? "").trim() : null
    );
    for (const id of d.data.notas) revalidatePath(`/interno/notas/${id}`);
    revalidatePath("/interno/notas/consulta");
    revalidatePath("/interno/notas");
    revalidatePath("/interno");
    return { ok: true, resultados };
  } catch (e: any) {
    if (e?.code === "42501") return { erro: e.message || "Você não tem permissão para manifestar notas." };
    if (e?.code === "22023" || e?.code === "P0002") return { erro: e.message };
    console.error("[manifestacao]", e?.message ?? e);
    return { erro: "Não foi possível enviar agora." };
  }
}
