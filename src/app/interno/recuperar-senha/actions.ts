"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type RecuperarState = { ok?: boolean; erro?: string };

/**
 * Pede ao Supabase Auth o e-mail de redefinição. A resposta é sempre a mesma,
 * exista ou não a conta — assim a tela não revela quais e-mails são cadastrados.
 */
export async function pedirRecuperacao(_prev: RecuperarState, form: FormData): Promise<RecuperarState> {
  const email = z.string().trim().toLowerCase().email().max(160).safeParse(form.get("email"));
  if (!email.success) return { erro: "Digite um e-mail válido." };

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "www.depositovitoriasa.com.br";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${proto}://${host}/interno/auth/confirmar`,
  });
  if (error) {
    if (error.status === 429 || /rate limit|too many/i.test(error.message)) {
      return { erro: "Muitos pedidos seguidos. Espere alguns minutos e tente de novo." };
    }
    if (/sending|smtp|email/i.test(error.message)) {
      console.error("[recuperar-senha] envio", error.message);
      return { erro: "O envio de e-mail não está funcionando agora. Peça a um administrador para redefinir sua senha em Gestão › Usuários." };
    }
    console.error("[recuperar-senha]", error.message);
  }
  return { ok: true };
}
