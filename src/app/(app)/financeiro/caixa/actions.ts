"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import type { CashPreview } from "@/lib/caixa";

// O texto do arquivo vai inteiro para o banco, que lê e confere tudo.
// Aqui só se limita tamanho e quantidade — nenhum número é calculado.
const item = z.object({
  name: z.string().trim().max(200),
  text: z.string().max(65536, "Arquivo grande demais para um relatório de caixa (limite de 64 KB)."),
});
const lote = z.array(item).min(1).max(10);

export type PreviewItem = CashPreview & { name: string };

export type RegisterItem = {
  name: string;
  status: "registrado" | "duplicado" | "erro";
  id?: string;
  business_date?: string;
  check_ok?: boolean;
  created_at?: string;
  uploaded_by?: string | null;
  errors?: string[];
};

function mensagem(error: { code?: string; message?: string }) {
  if (error.code === "42501") return "Você não tem permissão para importar fechamentos de caixa nesta empresa.";
  if (error.code === "28000") return "Sua sessão expirou. Entre de novo e repita a importação.";
  console.error("[caixa] rpc", error);
  return "Não foi possível processar este arquivo agora. Tente novamente em instantes.";
}

export async function analisarRelatorios(items: { name: string; text: string }[]): Promise<PreviewItem[]> {
  const parsed = lote.safeParse(items);
  if (!parsed.success) {
    return items.slice(0, 10).map((i) => ({ name: String(i?.name ?? "arquivo"), ok: false, warnings: [], errors: [parsed.error.issues[0].message] }));
  }

  const { company } = await getSession();
  const supabase = await createClient();

  return Promise.all(
    parsed.data.map(async (it): Promise<PreviewItem> => {
      const { data, error } = await supabase.rpc("preview_cash_report", { _company_id: company.id, _raw: it.text });
      if (error) return { name: it.name, ok: false, warnings: [], errors: [mensagem(error)] };
      const p = data as CashPreview;
      return { ...p, name: it.name, errors: p.errors ?? [], warnings: p.warnings ?? [] };
    })
  );
}

export async function registrarRelatorios(items: { name: string; text: string }[]): Promise<RegisterItem[]> {
  const parsed = lote.safeParse(items);
  if (!parsed.success) {
    return items.slice(0, 10).map((i) => ({ name: String(i?.name ?? "arquivo"), status: "erro", errors: [parsed.error.issues[0].message] }));
  }

  const { company } = await getSession();
  const supabase = await createClient();

  // Em sequência: o mesmo arquivo escolhido duas vezes vira "duplicado",
  // não uma corrida entre duas gravações.
  const out: RegisterItem[] = [];
  for (const it of parsed.data) {
    const { data, error } = await supabase.rpc("register_cash_closing", {
      _company_id: company.id,
      _raw: it.text,
      _filename: it.name,
    });
    if (error) {
      out.push({ name: it.name, status: "erro", errors: [mensagem(error)] });
      continue;
    }
    const r = data as RegisterItem;
    out.push({ ...r, name: it.name });
  }

  revalidatePath("/financeiro/caixa");
  return out;
}

export type CancelState = { erro?: string; ok?: boolean };

export async function cancelarFechamento(_prev: CancelState, form: FormData): Promise<CancelState> {
  const id = z.string().uuid().safeParse(form.get("id"));
  const motivo = z.string().trim().min(5, "Descreva o motivo com pelo menos 5 caracteres.").max(500)
    .safeParse(form.get("motivo"));
  if (!id.success) return { erro: "Fechamento inválido." };
  if (!motivo.success) return { erro: motivo.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_cash_closing", { _id: id.data, _reason: motivo.data });

  if (error) {
    if (error.code === "42501") return { erro: "Você não tem permissão para cancelar fechamentos." };
    if (error.code === "22023") return { erro: error.message };
    console.error("[caixa] cancelar", error);
    return { erro: "Não foi possível cancelar agora. Tente novamente." };
  }

  revalidatePath("/financeiro/caixa");
  revalidatePath(`/financeiro/caixa/${id.data}`);
  return { ok: true };
}
