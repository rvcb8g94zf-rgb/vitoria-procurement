import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Destino do link do e-mail de "esqueci minha senha".
 * O modelo do e-mail manda token_hash + type (funciona em qualquer aparelho);
 * o formato padrão do Supabase manda ?code= (só funciona no mesmo navegador
 * que pediu). Os dois são aceitos. Sucesso → tela de senha nova.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  const supabase = await createClient();

  let ok = false;
  if (tokenHash && type === "recovery") {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  const destino = url.clone();
  destino.search = "";
  if (ok) {
    destino.pathname = "/interno/trocar-senha";
    destino.searchParams.set("recuperacao", "1");
  } else {
    destino.pathname = "/interno/recuperar-senha";
    destino.searchParams.set("erro", "link");
  }
  return NextResponse.redirect(destino);
}
