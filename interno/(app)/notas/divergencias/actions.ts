"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

export type TratarState = { ok?: boolean; erro?: string };

const schema = z.object({
  kind: z.string().min(3).max(40),
  invoice_id: z.string().uuid(),
  nota: z.string().trim().max(500).optional(),
  reabrir: z.enum(["0", "1"]).default("0"),
});

/** Marca a divergência como tratada (com o que foi feito) ou devolve à fila. */
export async function tratarDivergencia(_prev: TratarState, form: FormData): Promise<TratarState> {
  const d = schema.safeParse({
    kind: form.get("kind"), invoice_id: form.get("invoice_id"),
    nota: form.get("nota") ?? undefined, reabrir: form.get("reabrir") ?? "0",
  });
  if (!d.success) return { erro: "Pedido inválido." };
  if (d.data.reabrir === "0" && (d.data.nota ?? "").length < 5) {
    return { erro: "Escreva o que foi feito (pelo menos 5 letras)." };
  }

  const { company } = await getSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_divergence", {
    _company_id: company.id, _kind: d.data.kind, _invoice_id: d.data.invoice_id,
    _note: d.data.nota ?? null, _reabrir: d.data.reabrir === "1",
  });
  if (error) {
    if (error.code === "42501") return { erro: "Você não tem permissão para tratar divergências." };
    if (error.code === "22023" || error.code === "P0002") return { erro: error.message };
    console.error("[divergencias] tratar", error);
    return { erro: "Não foi possível concluir agora." };
  }
  revalidatePath("/interno/notas/divergencias");
  revalidatePath("/interno");
  return { ok: true };
}
