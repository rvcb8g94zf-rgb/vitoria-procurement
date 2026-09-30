"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

export type CotState = { erro?: string; ok?: boolean; msg?: string };

function mensagem(error: { code?: string; message?: string }) {
  if (error.code === "42501" || error.code === "22023" || error.code === "P0002") return error.message ?? "Pedido inválido.";
  console.error("[cotacoes]", error);
  return "Não foi possível concluir agora.";
}
const json = (form: FormData) => { try { return JSON.parse(String(form.get("payload") ?? "")); } catch { return null; } };

export async function criarCotacao(_prev: CotState, form: FormData): Promise<CotState> {
  const d = z.object({
    request_id: z.string().uuid().nullable().optional(), closes_on: z.string().optional().nullable(),
    notes: z.string().max(1000).optional().nullable(),
    suppliers: z.array(z.string().uuid()).min(1, "Escolha pelo menos um fornecedor.").max(10, "Máximo de 10 fornecedores."),
    items: z.array(z.object({
      product_id: z.string().nullable().optional(), description: z.string().trim().min(2, "Todo item precisa de descrição.").max(200),
      quantity: z.union([z.string(), z.number()]), unit_id: z.string().nullable().optional(),
    })).min(1, "A cotação precisa de pelo menos um item."),
  }).safeParse(json(form));
  if (!d.success) return { erro: d.error.issues[0].message };
  const { company } = await getSession();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_quotation", {
    _company_id: company.id, _request_id: d.data.request_id ?? null, _closes_on: d.data.closes_on || null,
    _notes: d.data.notes ?? null, _suppliers: d.data.suppliers,
    _itens: d.data.items.map((i) => ({ ...i, quantity: String(i.quantity).replace(",", ".") })),
  });
  if (error) return { erro: mensagem(error) };
  revalidatePath("/interno/compras/cotacoes");
  revalidatePath("/interno/compras/solicitacoes");
  redirect(`/interno/compras/cotacoes/${(data as any).id}` as any);
}

export async function salvarRespostas(_prev: CotState, form: FormData): Promise<CotState> {
  const p = json(form);
  const id = String(form.get("id") ?? "");
  if (!p || !/^[0-9a-f-]{36}$/i.test(id)) return { erro: "Pedido inválido." };
  const { company } = await getSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_quotation_answers", { _company_id: company.id, _id: id, _respostas: p.respostas });
  if (error) return { erro: mensagem(error) };
  if (form.get("gerar") === "1") {
    const { data, error: e2 } = await supabase.rpc("close_quotation", { _company_id: company.id, _id: id, _escolha: p.escolha });
    if (e2) return { erro: mensagem(e2) };
    revalidatePath("/interno/compras/pedidos");
    revalidatePath("/interno/compras/cotacoes");
    const peds = ((data as any)?.pedidos ?? []) as { id: string }[];
    redirect((peds.length === 1 ? `/interno/compras/pedidos/${peds[0].id}?salvo=1` : `/interno/compras/cotacoes/${id}?gerados=${peds.length}`) as any);
  }
  revalidatePath(`/interno/compras/cotacoes/${id}`);
  return { ok: true, msg: "Respostas salvas." };
}

export async function cancelarCotacao(_prev: CotState, form: FormData): Promise<CotState> {
  const id = String(form.get("id") ?? ""); const motivo = String(form.get("motivo") ?? "");
  const { company } = await getSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_quotation", { _company_id: company.id, _id: id, _motivo: motivo });
  if (error) return { erro: mensagem(error) };
  revalidatePath(`/interno/compras/cotacoes/${id}`);
  revalidatePath("/interno/compras/cotacoes");
  return { ok: true, msg: "Cotação cancelada." };
}
