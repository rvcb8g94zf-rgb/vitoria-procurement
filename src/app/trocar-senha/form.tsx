"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * A troca é feita pelo próprio Supabase Auth, no navegador, com a sessão da
 * pessoa — nenhuma senha passa pelo servidor do sistema. Depois o banco marca
 * que a senha provisória foi trocada.
 */
export function TrocarSenhaForm({ obrigatorio }: { obrigatorio: boolean }) {
  const router = useRouter();
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const fraca = senha.length < 10 || !/[A-Za-z]/.test(senha) || !/[0-9]/.test(senha);

  async function salvar() {
    setErro(null);
    if (fraca) return setErro("A senha precisa de 10 caracteres ou mais, misturando letras e números.");
    if (senha !== confirma) return setErro("As duas senhas não são iguais.");

    setSalvando(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: senha });

    if (error) {
      setErro(
        /different from the old password/i.test(error.message)
          ? "A senha nova precisa ser diferente da atual."
          : "Não foi possível trocar a senha agora. Tente de novo."
      );
      setSalvando(false);
      return;
    }

    // marca que a senha provisória saiu de cena; se falhar, o pior é o
    // sistema pedir a troca outra vez
    await supabase.rpc("mark_password_changed");

    router.replace("/");
    router.refresh();
  }

  return (
    <div className="space-y-3.5">
      <div>
        <label className="label" htmlFor="senha">Senha nova</label>
        <input
          id="senha" type="password" autoComplete="new-password" className="field"
          value={senha} onChange={(e) => setSenha(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && salvar()}
        />
        <p className="mt-1.5 text-[11.5px] text-muted">
          Pelo menos 10 caracteres, com letras e números.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="confirma">Repita a senha</label>
        <input
          id="confirma" type="password" autoComplete="new-password" className="field"
          value={confirma} onChange={(e) => setConfirma(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && salvar()}
        />
      </div>

      {erro && (
        <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-[12px] text-danger">
          {erro}
        </p>
      )}

      <button
        onClick={salvar}
        disabled={salvando || !senha || !confirma}
        className="btn btn-primary h-9 w-full justify-center"
      >
        {salvando ? "Salvando…" : "Salvar senha"}
      </button>

      {!obrigatorio && (
        <Link href="/" className="block pt-1 text-center text-[12px] text-muted hover:text-ink">
          Voltar ao sistema
        </Link>
      )}
    </div>
  );
}
