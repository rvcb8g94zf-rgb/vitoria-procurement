"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

export type ConfState = { ok?: boolean; erro?: string; msg?: string };

const uuid = z.string().uuid();

function erroDoBanco(error: { code?: string; message?: string }, contexto: string): string {
  if (error.code === "42501") return error.message || "Você não tem permissão para isso.";
  if (error.code === "22023" || error.code === "P0002") return error.message ?? "Dados inválidos.";
  console.error(`[conferencia] ${contexto}`, error);
  return "Não foi possível concluir agora.";
}

function atualizar(invoiceId: string) {
  revalidatePath(`/interno/notas/${invoiceId}`);
  revalidatePath("/interno/notas/conferencia");
  revalidatePath("/interno/financeiro/contas-a-pagar");
  revalidatePath("/interno");
}

/** Liga ou desliga a nota de um pedido. */
export async function ligarPedido(_prev: ConfState, form: FormData): Promise<ConfState> {
  const nota = uuid.safeParse(form.get("nota"));
  const pedido = uuid.safeParse(form.get("pedido"));
  if (!nota.success) return { erro: "Nota inválida." };
  if (!pedido.success) return { erro: "Escolha o pedido." };
  const remover = form.get("remover") === "1";

  const { company } = await getSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("link_invoice_order", {
    _company_id: company.id, _invoice_id: nota.data, _order_id: pedido.data, _remover: remover,
  });
  if (error) return { erro: erroDoBanco(error, "ligar") };
  atualizar(nota.data);
  revalidatePath(`/interno/compras/pedidos/${pedido.data}`);
  return { ok: true, msg: remover ? "Pedido desligado." : "Pedido ligado." };
}

/** Escolhe à mão com qual item do pedido um item da nota corresponde (vazio = automático). */
export async function parearItem(_prev: ConfState, form: FormData): Promise<ConfState> {
  const nota = uuid.safeParse(form.get("nota"));
  const seq = z.coerce.number().int().min(1).max(990).safeParse(form.get("seq"));
  const item = String(form.get("item") ?? "");
  if (!nota.success || !seq.success) return { erro: "Item inválido." };
  if (item && !uuid.safeParse(item).success) return { erro: "Item do pedido inválido." };

  const { company } = await getSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("pair_invoice_item", {
    _company_id: company.id, _invoice_id: nota.data, _seq: seq.data, _order_item_id: item || null,
  });
  if (error) return { erro: erroDoBanco(error, "parear") };
  atualizar(nota.data);
  return { ok: true };
}

/** Libera o pagamento de uma nota com divergência (ou desfaz a liberação). */
export async function liberarPagamento(_prev: ConfState, form: FormData): Promise<ConfState> {
  const nota = uuid.safeParse(form.get("nota"));
  if (!nota.success) return { erro: "Nota inválida." };
  const desfazer = form.get("desfazer") === "1";
  const motivo = String(form.get("motivo") ?? "").trim().slice(0, 500);
  if (!desfazer && motivo.length < 5) return { erro: "Escreva o motivo da liberação (pelo menos 5 letras)." };

  const { company } = await getSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("release_invoice_match", {
    _company_id: company.id, _invoice_id: nota.data, _note: desfazer ? null : motivo, _desfazer: desfazer,
  });
  if (error) return { erro: erroDoBanco(error, "liberar") };
  atualizar(nota.data);
  return { ok: true, msg: desfazer ? "Liberação desfeita." : "Pagamento liberado." };
}
