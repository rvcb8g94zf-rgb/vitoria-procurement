"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

export type PedidoState = { erro?: string; ok?: boolean; msg?: string };

function mensagem(error: { code?: string; message?: string }) {
  if (error.code === "42501") return error.message?.startsWith("Sem permissão") ? "Você não tem permissão para isso nesta empresa." : error.message ?? "Sem permissão.";
  if (error.code === "22023" || error.code === "P0002") return error.message ?? "Pedido inválido.";
  console.error("[pedidos]", error);
  return "Não foi possível concluir agora.";
}

const num = z.union([z.string(), z.number()]).transform((v) => (v === "" ? null : Number(String(v).replace(",", "."))));
const item = z.object({
  product_id: z.string().optional().nullable(),
  description: z.string().trim().min(2).max(200),
  quantity: num, unit_id: z.string().optional().nullable(), unit_price: num,
  discount: num.optional(),
});
const payload = z.object({
  id: z.string().uuid().optional().nullable(),
  header: z.object({
    supplier_id: z.string().uuid({ message: "Escolha o fornecedor." }),
    payment_term_id: z.string().optional().nullable(), cost_center_id: z.string().optional().nullable(),
    expected_on: z.string().optional().nullable(), carrier: z.string().max(120).optional().nullable(),
    freight_amount: num.optional(), discount: num.optional(), notes: z.string().max(1000).optional().nullable(),
    request_id: z.string().optional().nullable(), quotation_id: z.string().optional().nullable(),
  }),
  items: z.array(item).min(1, "O pedido precisa de pelo menos um item.").max(300),
});

/** Salva o rascunho e, se pedido, já envia para aprovação. */
export async function salvarPedido(_prev: PedidoState, form: FormData): Promise<PedidoState> {
  let bruto: unknown;
  try { bruto = JSON.parse(String(form.get("payload") ?? "")); } catch { return { erro: "Pedido inválido." }; }
  const d = payload.safeParse(bruto);
  if (!d.success) {
    const i = d.error.issues[0];
    return { erro: i.path.includes("description") ? "Todo item precisa de descrição." : i.message };
  }
  const enviar = form.get("enviar") === "1";
  const { company } = await getSession();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_purchase_order", {
    _company_id: company.id, _id: d.data.id ?? null, _h: d.data.header, _itens: d.data.items,
  });
  if (error) return { erro: mensagem(error) };
  const id = (data as { id: string }).id;

  if (enviar) {
    const { error: e2 } = await supabase.rpc("submit_purchase_order", { _company_id: company.id, _id: id });
    if (e2) {
      revalidatePath("/interno/compras/pedidos");
      redirect(`/interno/compras/pedidos/${id}?erro=${encodeURIComponent(mensagem(e2))}` as any);
    }
  }
  revalidatePath("/interno/compras/pedidos");
  revalidatePath("/interno/compras/aprovacoes");
  redirect(`/interno/compras/pedidos/${id}${enviar ? "?enviado=1" : "?salvo=1"}` as any);
}

const acaoSchema = z.object({
  id: z.string().uuid(),
  acao: z.enum(["enviar", "aprovar", "recusar", "alterar", "marcar_enviado", "cancelar"]),
  comentario: z.string().trim().max(500).optional(),
});

export async function acaoPedido(_prev: PedidoState, form: FormData): Promise<PedidoState> {
  const d = acaoSchema.safeParse({
    id: form.get("id"), acao: form.get("acao"), comentario: (form.get("comentario") as string | null) ?? undefined,
  });
  if (!d.success) return { erro: "Pedido inválido." };
  const { company } = await getSession();
  const supabase = await createClient();
  const { id, acao, comentario } = d.data;

  let r;
  if (acao === "enviar") r = await supabase.rpc("submit_purchase_order", { _company_id: company.id, _id: id });
  else if (acao === "marcar_enviado") r = await supabase.rpc("mark_order_sent", { _company_id: company.id, _id: id });
  else if (acao === "cancelar") r = await supabase.rpc("cancel_purchase_order", { _company_id: company.id, _id: id, _motivo: comentario ?? "" });
  else r = await supabase.rpc("decide_purchase_order", { _company_id: company.id, _id: id, _decisao: acao, _comentario: comentario ?? null });
  if (r.error) return { erro: mensagem(r.error) };

  revalidatePath("/interno/compras/pedidos");
  revalidatePath(`/interno/compras/pedidos/${id}`);
  revalidatePath("/interno/compras/aprovacoes");
  revalidatePath("/interno");
  const msg: Record<string, string> = {
    enviar: (r.data as any)?.status === "aprovado" ? "Pedido aprovado: está dentro da sua alçada." : "Pedido enviado para aprovação.",
    aprovar: "Pedido aprovado.", recusar: "Pedido recusado.", alterar: "Pedido devolvido para alteração.",
    marcar_enviado: "Pedido marcado como enviado ao fornecedor.", cancelar: "Pedido cancelado.",
  };
  return { ok: true, msg: msg[acao] };
}
