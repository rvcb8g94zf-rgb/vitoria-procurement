"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

export type SolState = { erro?: string; ok?: boolean; msg?: string };

function mensagem(error: { code?: string; message?: string }) {
  if (error.code === "42501" || error.code === "22023" || error.code === "P0002") return error.message ?? "Pedido inválido.";
  console.error("[solicitacoes]", error);
  return "Não foi possível concluir agora.";
}

const payload = z.object({
  id: z.string().uuid().optional().nullable(),
  header: z.object({
    department_id: z.string().optional().nullable(), cost_center_id: z.string().optional().nullable(),
    needed_by: z.string().optional().nullable(), priority: z.enum(["baixa", "normal", "alta", "urgente"]),
    justification: z.string().max(1000).optional().nullable(), notes: z.string().max(1000).optional().nullable(),
  }),
  items: z.array(z.object({
    product_id: z.string().optional().nullable(), description: z.string().trim().min(2, "Todo item precisa de descrição.").max(200),
    spec: z.string().max(500).optional().nullable(), quantity: z.union([z.string(), z.number()]), unit_id: z.string().optional().nullable(),
  })).min(1, "A solicitação precisa de pelo menos um item.").max(200),
});

export async function salvarSolicitacao(_prev: SolState, form: FormData): Promise<SolState> {
  let bruto: unknown;
  try { bruto = JSON.parse(String(form.get("payload") ?? "")); } catch { return { erro: "Pedido inválido." }; }
  const d = payload.safeParse(bruto);
  if (!d.success) return { erro: d.error.issues[0].message };
  const enviar = form.get("enviar") === "1";
  const { company } = await getSession();
  const supabase = await createClient();
  const items = d.data.items.map((i) => ({ ...i, quantity: String(i.quantity).replace(",", ".") }));
  const { data, error } = await supabase.rpc("save_purchase_request", {
    _company_id: company.id, _id: d.data.id ?? null, _h: d.data.header, _itens: items,
  });
  if (error) return { erro: mensagem(error) };
  const id = (data as { id: string }).id;
  if (enviar) {
    const { error: e2 } = await supabase.rpc("act_purchase_request", { _company_id: company.id, _id: id, _acao: "enviar" });
    if (e2) redirect(`/interno/compras/solicitacoes/${id}?erro=${encodeURIComponent(mensagem(e2))}` as any);
  }
  revalidatePath("/interno/compras/solicitacoes");
  redirect(`/interno/compras/solicitacoes/${id}${enviar ? "?enviada=1" : ""}` as any);
}

export async function acaoSolicitacao(_prev: SolState, form: FormData): Promise<SolState> {
  const d = z.object({
    id: z.string().uuid(), acao: z.enum(["enviar", "cancelar", "aceitar", "recusar"]),
    nota: z.string().trim().max(500).optional(), depois: z.enum(["", "pedido", "cotacao"]).optional(),
  }).safeParse({
    id: form.get("id"), acao: form.get("acao"), nota: (form.get("nota") as string | null) ?? undefined,
    depois: (form.get("depois") as string | null) ?? "",
  });
  if (!d.success) return { erro: "Pedido inválido." };
  const { company } = await getSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("act_purchase_request", {
    _company_id: company.id, _id: d.data.id, _acao: d.data.acao, _nota: d.data.nota ?? null,
  });
  if (error) return { erro: mensagem(error) };
  revalidatePath("/interno/compras/solicitacoes");
  revalidatePath(`/interno/compras/solicitacoes/${d.data.id}`);
  if (d.data.acao === "aceitar" && d.data.depois === "pedido") redirect(`/interno/compras/pedidos/novo?solicitacao=${d.data.id}` as any);
  if (d.data.acao === "aceitar" && d.data.depois === "cotacao") redirect(`/interno/compras/cotacoes/nova?solicitacao=${d.data.id}` as any);
  const msg: Record<string, string> = {
    enviar: "Solicitação enviada ao Compras.", cancelar: "Solicitação cancelada.",
    aceitar: "Solicitação aceita.", recusar: "Solicitação recusada.",
  };
  return { ok: true, msg: msg[d.data.acao] };
}
