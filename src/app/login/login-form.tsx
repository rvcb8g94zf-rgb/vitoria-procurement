"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LoginForm({ proximo }: { proximo?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function entrar() {
    setErro(null);
    setCarregando(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });

    if (error) {
      // mensagem genérica de propósito: dizer "e-mail não existe"
      // entrega a terceiros quem tem conta no sistema
      setErro("E-mail ou senha inválidos.");
      setCarregando(false);
      return;
    }

    // typedRoutes não conhece rotas vindas de query string; o startsWith("/")
    // é o que impede redirect aberto para domínio externo
    const destino = proximo && proximo.startsWith("/") ? proximo : "/";
    router.replace(destino as Parameters<typeof router.replace>[0]);
    router.refresh();
  }

  return (
    <div className="space-y-3.5">
      <div>
        <label className="label" htmlFor="email">E-mail</label>
        <input
          id="email" type="email" autoComplete="email" className="field"
          value={email} onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && entrar()}
        />
      </div>

      <div>
        <label className="label" htmlFor="senha">Senha</label>
        <input
          id="senha" type="password" autoComplete="current-password" className="field"
          value={senha} onChange={(e) => setSenha(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && entrar()}
        />
      </div>

      {erro && (
        <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-[12px] text-danger">
          {erro}
        </p>
      )}

      <button
        onClick={entrar}
        disabled={carregando || !email || !senha}
        className="btn btn-primary h-9 w-full justify-center"
      >
        {carregando ? "Entrando…" : "Entrar"}
      </button>

      <a href="/recuperar-senha" className="block pt-1 text-center text-[12px] text-muted hover:text-ink">
        Esqueci minha senha
      </a>
    </div>
  );
}
