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

// ---------------------------------------------------------------------------
// Vários itens de uma vez
// ---------------------------------------------------------------------------
export type LoteState = {
  ok?: boolean; erro?: string;
  resumo?: { criados: number; ligados: number; ignorados: number; falhas: { item: string; motivo: string }[] };
};

const loteSchema = z.object({
  acao: z.enum(["criar", "ligar", "ignorar"]),
  ids: z.array(z.string().uuid()).min(1, "Marque pelo menos um item.").max(50, "No máximo 50 itens por vez."),
  produto_id: z.string().uuid().optional(),
  motivo: z.string().trim().max(500).optional(),
});

/**
 * Criar: cada item vira um produto com o código da nota como SKU (editável na janela).
 * Se o código já existe no cadastro — antes ou porque outro item marcado acabou de criá-lo —
 * o item é ligado a esse produto em vez de duplicar.
 * Ligar: todos os itens marcados ao mesmo produto. Ignorar: um motivo para todos.
 */
export async function validarLote(_prev: LoteState, form: FormData): Promise<LoteState> {
  const d = loteSchema.safeParse({
    acao: form.get("acao"),
    ids: form.getAll("id").map(String).filter(Boolean),
    produto_id: (form.get("produto_id") as string | null) || undefined,
    motivo: (form.get("motivo") as string | null) ?? undefined,
  });
  if (!d.success) return { erro: d.error.issues[0]?.message ?? "Pedido inválido." };
  if (d.data.acao === "ligar" && !d.data.produto_id) return { erro: "Escolha um produto da lista." };
  if (d.data.acao === "ignorar" && (d.data.motivo ?? "").length < 5) return { erro: "Escreva o motivo (pelo menos 5 letras)." };

  const { company } = await getSession();
  const supabase = await createClient();
  const resumo = { criados: 0, ligados: 0, ignorados: 0, falhas: [] as { item: string; motivo: string }[] };

  const resolver = (id: string, acao: "ligar" | "criar" | "ignorar", extra: Record<string, string | null>) =>
    supabase.rpc("resolve_pending_product", {
      _company_id: company.id, _pending_id: id, _acao: acao,
      _product_id: extra.produto ?? null, _sku: extra.sku ?? null, _description: extra.descricao ?? null,
      _unit: extra.unidade ?? null, _note: extra.motivo ?? null,
    });

  for (const id of d.data.ids) {
    const nome = String(form.get(`nome_${id}`) ?? "item").slice(0, 120);
    let error: { code?: string; message?: string } | null = null;

    if (d.data.acao === "criar") {
      const sku = String(form.get(`sku_${id}`) ?? "").trim().slice(0, 40);
      const descricao = String(form.get(`descricao_${id}`) ?? "").trim().slice(0, 200);
      const unidade = String(form.get(`unidade_${id}`) ?? "").trim().slice(0, 10) || null;
      if (!sku) { resumo.falhas.push({ item: nome, motivo: "sem código" }); continue; }
      // código já no cadastro: liga em vez de criar
      const { data: existe } = await supabase.from("products").select("id").eq("company_id", company.id)
        .is("deleted_at", null).ilike("sku", sku.replace(/[%_\\]/g, "\\$&")).limit(1).maybeSingle();
      if (existe) {
        ({ error } = await resolver(id, "ligar", { produto: (existe as { id: string }).id }));
        if (!error) { resumo.ligados += 1; continue; }
      } else {
        ({ error } = await resolver(id, "criar", { sku, descricao, unidade }));
        if (!error) { resumo.criados += 1; continue; }
      }
    } else if (d.data.acao === "ligar") {
      ({ error } = await resolver(id, "ligar", { produto: d.data.produto_id! }));
      if (!error) { resumo.ligados += 1; continue; }
    } else {
      ({ error } = await resolver(id, "ignorar", { motivo: d.data.motivo! }));
      if (!error) { resumo.ignorados += 1; continue; }
    }

    if (error?.code === "42501") return { erro: "Você não tem permissão para isso." };
    if (error?.code !== "22023" && error?.code !== "P0002") console.error("[validacao lote]", error);
    resumo.falhas.push({
      item: nome,
      motivo: error?.code === "22023" || error?.code === "P0002" ? error.message ?? "recusado" : "não foi possível agora",
    });
  }

  revalidatePath("/interno/notas/validacao");
  revalidatePath("/interno/cadastros/produtos");
  revalidatePath("/interno/notas");
  return { ok: true, resumo };
}
