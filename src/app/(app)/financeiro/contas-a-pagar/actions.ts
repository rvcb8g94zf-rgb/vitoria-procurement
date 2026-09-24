"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { METODOS } from "@/lib/financeiro";

export type FormState = { erro?: string; ok?: boolean; mensagem?: string };

function mensagem(error: { code?: string; message?: string }) {
  if (error.code === "42501") return "Você não tem permissão para isso nesta empresa.";
  if (error.code === "28000") return "Sua sessão expirou. Entre de novo.";
  if (error.code === "P0002") return "Título não encontrado.";
  // 22023 são as recusas com texto pronto do banco
  if (error.code === "22023") return error.message ?? "Dados inválidos.";
  if (error.code === "23505") return "Esta duplicata já virou título.";
  console.error("[financeiro] rpc", error);
  return "Não foi possível concluir agora. Tente novamente.";
}

function atualizar() {
  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/duplicatas");
  revalidatePath("/financeiro/pagamentos");
  revalidatePath("/financeiro/calendario");
}

const uuid = z.string().uuid();
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");
// vem do <input type="number" step="0,01"> — o banco arredonda e confere
const valor = z.coerce.number().positive("O valor precisa ser maior que zero.").max(99999999);

// ---------------------------------------------------------------------
// Gerar títulos a partir das notas escolhidas
// ---------------------------------------------------------------------
export async function gerarTitulos(_prev: FormState, form: FormData): Promise<FormState> {
  const ids = z.array(uuid).min(1, "Escolha pelo menos uma nota.").max(200)
    .safeParse(form.getAll("notas").map(String));
  if (!ids.success) return { erro: ids.error.issues[0].message };

  const { company } = await getSession();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("generate_payables", {
    _company_id: company.id,
    _invoice_ids: ids.data,
  });
  if (error) return { erro: mensagem(error) };

  atualizar();
  const r = data as { criados: number; pulados: number; notas: number };
  if (r.criados === 0) {
    return { ok: true, mensagem: "Essas notas já tinham título. Nada foi duplicado." };
  }
  // a tela de duplicatas fica vazia depois de gerar: leva direto para a
  // lista de títulos, com o aviso do que foi criado
  redirect(`/financeiro/contas-a-pagar?gerados=${r.criados}&notas=${r.notas}&pulados=${r.pulados}`);
}

// ---------------------------------------------------------------------
// Título avulso
// ---------------------------------------------------------------------
const novo = z.object({
  descricao: z.string().trim().min(3, "Descreva o título.").max(200),
  vencimento: iso,
  valor,
  fornecedor: z.string().uuid().optional().or(z.literal("")),
  cobrador: z.string().trim().max(160).optional(),
  documento: z.string().trim().max(80).optional(),
  emissao: iso.optional().or(z.literal("")),
  observacao: z.string().trim().max(500).optional(),
});

export async function criarTitulo(_prev: FormState, form: FormData): Promise<FormState> {
  const d = novo.safeParse({
    descricao: form.get("descricao"),
    vencimento: form.get("vencimento"),
    valor: form.get("valor"),
    fornecedor: form.get("fornecedor") ?? "",
    cobrador: form.get("cobrador") ?? undefined,
    documento: form.get("documento") ?? undefined,
    emissao: form.get("emissao") ?? "",
    observacao: form.get("observacao") ?? undefined,
  });
  if (!d.success) return { erro: d.error.issues[0].message };

  const { company } = await getSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_payable", {
    _company_id: company.id,
    _description: d.data.descricao,
    _due_date: d.data.vencimento,
    _amount: d.data.valor,
    _supplier_id: d.data.fornecedor || null,
    _supplier_label: d.data.cobrador || null,
    _document: d.data.documento || null,
    _issue_date: d.data.emissao || null,
    _notes: d.data.observacao || null,
  });
  if (error) return { erro: mensagem(error) };

  atualizar();
  return { ok: true, mensagem: "Título criado." };
}

// ---------------------------------------------------------------------
// Baixa
// ---------------------------------------------------------------------
const baixa = z.object({
  titulo: uuid,
  data: iso,
  valor,
  forma: z.enum(METODOS.map((m) => m.value) as [string, ...string[]]),
  referencia: z.string().trim().max(120).optional(),
  observacao: z.string().trim().max(500).optional(),
});

export async function darBaixa(_prev: FormState, form: FormData): Promise<FormState> {
  const d = baixa.safeParse({
    titulo: form.get("titulo"),
    data: form.get("data"),
    valor: form.get("valor"),
    forma: form.get("forma"),
    referencia: form.get("referencia") ?? undefined,
    observacao: form.get("observacao") ?? undefined,
  });
  if (!d.success) return { erro: d.error.issues[0].message };

  const { company } = await getSession();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pay_payable", {
    _company_id: company.id,
    _payable_id: d.data.titulo,
    _paid_at: d.data.data,
    _amount: d.data.valor,
    _method: d.data.forma,
    _reference: d.data.referencia || null,
    _notes: d.data.observacao || null,
  });
  if (error) return { erro: mensagem(error) };

  atualizar();
  const saldo = Number((data as { saldo: number })?.saldo ?? 0);
  return { ok: true, mensagem: saldo > 0 ? "Pagamento parcial registrado." : "Título quitado." };
}

// ---------------------------------------------------------------------
// Editar
// ---------------------------------------------------------------------
const edicao = z.object({
  titulo: uuid,
  vencimento: iso,
  valor,
  descricao: z.string().trim().min(3, "Descreva o título.").max(200),
  observacao: z.string().trim().max(500).optional(),
});

export async function editarTitulo(_prev: FormState, form: FormData): Promise<FormState> {
  const d = edicao.safeParse({
    titulo: form.get("titulo"),
    vencimento: form.get("vencimento"),
    valor: form.get("valor"),
    descricao: form.get("descricao"),
    observacao: form.get("observacao") ?? undefined,
  });
  if (!d.success) return { erro: d.error.issues[0].message };

  const { company } = await getSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_payable", {
    _company_id: company.id,
    _payable_id: d.data.titulo,
    _due_date: d.data.vencimento,
    _amount: d.data.valor,
    _description: d.data.descricao,
    _notes: d.data.observacao || null,
  });
  if (error) return { erro: mensagem(error) };

  atualizar();
  return { ok: true, mensagem: "Título alterado." };
}

// ---------------------------------------------------------------------
// Cancelamentos
// ---------------------------------------------------------------------
const motivo = z.string().trim().min(5, "Escreva o motivo (pelo menos 5 letras).").max(500);

export async function cancelarTitulo(_prev: FormState, form: FormData): Promise<FormState> {
  const d = z.object({ titulo: uuid, motivo }).safeParse({
    titulo: form.get("titulo"), motivo: form.get("motivo"),
  });
  if (!d.success) return { erro: d.error.issues[0].message };

  const { company } = await getSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_payable", {
    _company_id: company.id, _payable_id: d.data.titulo, _reason: d.data.motivo,
  });
  if (error) return { erro: mensagem(error) };

  atualizar();
  return { ok: true, mensagem: "Título cancelado." };
}

export async function estornarPagamento(_prev: FormState, form: FormData): Promise<FormState> {
  const d = z.object({ pagamento: uuid, motivo }).safeParse({
    pagamento: form.get("pagamento"), motivo: form.get("motivo"),
  });
  if (!d.success) return { erro: d.error.issues[0].message };

  const { company } = await getSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_payment", {
    _company_id: company.id, _payment_id: d.data.pagamento, _reason: d.data.motivo,
  });
  if (error) return { erro: mensagem(error) };

  atualizar();
  return { ok: true, mensagem: "Pagamento estornado." };
}
