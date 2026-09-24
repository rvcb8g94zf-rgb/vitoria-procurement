"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import type { InvoicePreview } from "@/lib/notas";

// O XML vai inteiro para o banco, que lê e confere. Aqui só se limita
// tamanho e quantidade — nenhum valor é calculado no servidor do site.
const item = z.object({
  name: z.string().trim().max(200),
  text: z.string().max(2000000, "XML maior que 2 MB."),
});
const lote = z.array(item).min(1).max(20);

export type PreviewNota = InvoicePreview & { name: string };

export type ResultadoNota = {
  name: string;
  status: "registrado" | "completado" | "duplicado" | "erro";
  id?: string;
  number?: string | null;
  emitter_name?: string | null;
  total_amount?: string | null;
  pendencias?: number;
  duplicatas?: number;
  errors?: string[];
};

function mensagem(error: { code?: string; message?: string }) {
  if (error.code === "42501") return "Você não tem permissão para importar notas nesta empresa.";
  if (error.code === "28000") return "Sua sessão expirou. Entre de novo e repita a importação.";
  console.error("[notas] rpc", error);
  return "Não foi possível processar este arquivo agora. Tente novamente.";
}

export async function analisarNotas(items: { name: string; text: string }[]): Promise<PreviewNota[]> {
  const parsed = lote.safeParse(items);
  if (!parsed.success) {
    return items.slice(0, 20).map((i) => ({
      name: String(i?.name ?? "arquivo"), ok: false, warnings: [], errors: [parsed.error.issues[0].message],
    }));
  }

  const { company } = await getSession();
  const supabase = await createClient();

  return Promise.all(
    parsed.data.map(async (it): Promise<PreviewNota> => {
      const { data, error } = await supabase.rpc("preview_invoice_xml", { _company_id: company.id, _raw: it.text });
      if (error) return { name: it.name, ok: false, warnings: [], errors: [mensagem(error)] };
      const p = data as InvoicePreview;
      return { ...p, name: it.name, errors: p.errors ?? [], warnings: p.warnings ?? [] };
    })
  );
}

export async function registrarNotas(items: { name: string; text: string }[]): Promise<ResultadoNota[]> {
  const parsed = lote.safeParse(items);
  if (!parsed.success) {
    return items.slice(0, 20).map((i) => ({
      name: String(i?.name ?? "arquivo"), status: "erro" as const, errors: [parsed.error.issues[0].message],
    }));
  }

  const { company } = await getSession();
  const supabase = await createClient();

  // uma de cada vez: o mesmo XML escolhido duas vezes vira "duplicado",
  // não uma corrida entre duas gravações
  const out: ResultadoNota[] = [];
  for (const it of parsed.data) {
    const { data, error } = await supabase.rpc("register_invoice_xml", {
      _company_id: company.id,
      _raw: it.text,
      _filename: it.name,
    });
    if (error) {
      out.push({ name: it.name, status: "erro", errors: [mensagem(error)] });
      continue;
    }
    out.push({ ...(data as ResultadoNota), name: it.name });
  }

  revalidatePath("/notas");
  revalidatePath("/relatorios/custo");
  return out;
}
