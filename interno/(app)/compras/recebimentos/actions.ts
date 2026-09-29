"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

export type RecState = { erro?: string; ok?: boolean; msg?: string };
function mensagem(error: { code?: string; message?: string }) {
  if (error.code === "42501" || error.code === "22023" || error.code === "P0002") return error.message ?? "Pedido inválido.";
  console.error("[recebimentos]", error);
  return "Não foi possível concluir agora.";
}

export async function registrarRecebimento(_prev: RecState, form: FormData): Promise<RecState> {
  let p: any; try { p = JSON.parse(String(form.get("payload") ?? "")); } catch { return { erro: "Pedido inválido." }; }
  const d = z.object({
    order_id: z.string().uuid(), received_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data."),
    invoice_id: z.string().uuid().nullable().optional(), invoice_ref: z.string().max(60).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
    items: z.array(z.object({ order_item_id: z.string().uuid(), quantity_received: z.string(), divergence_note: z.string().max(300).optional() })),
  }).safeParse(p);
  if (!d.success) return { erro: d.error.issues[0].message };
  const { company } = await getSession();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_goods_receipt", {
    _company_id: company.id, _order_id: d.data.order_id, _received_on: d.data.received_on,
    _invoice_id: d.data.invoice_id ?? null, _invoice_ref: d.data.invoice_ref ?? null, _notes: d.data.notes ?? null,
    _itens: d.data.items.map((i) => ({ ...i, quantity_received: i.quantity_received.replace(",", ".") })),
  });
  if (error) return { erro: mensagem(error) };
  revalidatePath("/interno/compras/recebimentos");
  revalidatePath(`/interno/compras/pedidos/${d.data.order_id}`);
  revalidatePath("/interno/compras/pedidos");
  redirect(`/interno/compras/recebimentos/${(data as any).id}?novo=1` as any);
}

export async function cancelarRecebimento(_prev: RecState, form: FormData): Promise<RecState> {
  const id = String(form.get("id") ?? "");
  const { company } = await getSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_goods_receipt", { _company_id: company.id, _id: id, _motivo: String(form.get("motivo") ?? "") });
  if (error) return { erro: mensagem(error) };
  revalidatePath(`/interno/compras/recebimentos/${id}`);
  revalidatePath("/interno/compras/recebimentos");
  revalidatePath("/interno/compras/pedidos");
  return { ok: true, msg: "Recebimento cancelado." };
}
