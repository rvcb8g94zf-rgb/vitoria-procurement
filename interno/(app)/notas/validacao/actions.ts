"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

export type ValidarState = { ok?: boolean; erro?: string; msg?: string };

const schema = z.object({
  id: z.string().uuid(),
  acao: z.enum(["ligar", "criar", "ignorar"]),
  produto: z.string().trim().max(200).optional(),
  sku: z.string().trim().max(40).optional(),
  descricao: z.string().trim().max(200).optional(),
  unidade: z.string().trim().max(10).optional(),
  motivo: z.string().trim().max(500).optional(),
});

export async function validarItem(_prev: ValidarState, form: FormData): Promise<ValidarState> {
  const get = (k: string) => (form.get(k) as string | null) ?? undefined;
  const d = schema.safeParse({
    id: get("id"), acao: get("acao"), produto: get("produto"), sku: get("sku"),
    descricao: get("descricao"), unidade: get("unidade"), motivo: get("motivo"),
  });
  if (!d.success) return { erro: "Pedido inválido." };

  const { company } = await getSession();
  const supabase = await createClient();

  // "ligar": o campo traz o texto escolhido na lista ("SKU — descrição");
  // o id vai no campo oculto, mas aceitamos também o SKU digitado à mão
  let produtoId: string | null = null;
  if (d.data.acao === "ligar") {
    const escolhido = (form.get("produto_id") as string | null) || null;
    if (escolhido && /^[0-9a-f-]{36}$/i.test(escolhido)) produtoId = escolhido;
    else if (d.data.produto) {
      const sku = d.data.produto.split(" — ")[0].trim();
      const { data } = await supabase.from("products").select("id").eq("company_id", company.id)
        .is("deleted_at", null).ilike("sku", sku).limit(1).maybeSingle();
      produtoId = (data as { id: string } | null)?.id ?? null;
    }
    if (!produtoId) return { erro: "Escolha um produto da lista." };
  }

  const { data, error } = await supabase.rpc("resolve_pending_product", {
    _company_id: company.id, _pending_id: d.data.id, _acao: d.data.acao,
    _product_id: produtoId, _sku: d.data.sku ?? null, _description: d.data.descricao ?? null,
    _unit: d.data.unidade ?? null, _note: d.data.motivo ?? null,
  });
  if (error) {
    if (error.code === "42501") return { erro: "Você não tem permissão para isso." };
    if (error.code === "22023" || error.code === "P0002") return { erro: error.message };
    console.error("[validacao]", error);
    return { erro: "Não foi possível concluir agora." };
  }
  revalidatePath("/interno/notas/validacao");
  revalidatePath("/interno/cadastros/produtos");
  revalidatePath("/interno/notas");
  const r = data as { acao: string; itens?: number };
  return {
    ok: true,
    msg: r.acao === "ignorar" ? "Item ignorado." : `Pronto: ${r.itens ?? 0} item(ns) de nota ligado(s) ao produto.`,
  };
}
