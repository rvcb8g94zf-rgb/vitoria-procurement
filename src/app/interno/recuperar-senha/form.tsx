"use client";

import { useActionState } from "react";
import { pedirRecuperacao, type RecuperarState } from "./actions";

export function RecuperarForm() {
  const [st, acao, pend] = useActionState<RecuperarState, FormData>(pedirRecuperacao, {});
  if (st.ok) {
    return (
      <div className="space-y-4">
        <p role="status" className="rounded bg-accent-soft px-3 py-2.5 text-[12.5px] text-accent-ink">
          Se o e-mail estiver cadastrado, chega em instantes uma mensagem com o link para criar uma senha nova.
          O link vale por 1 hora e só pode ser usado uma vez.
        </p>
        <p className="text-[12px] text-muted">Não chegou? Olhe o spam ou peça de novo daqui a alguns minutos.</p>
        <a href="/interno/login" className="btn w-full justify-center">Voltar para o login</a>
      </div>
    );
  }
  return (
    <form action={acao} className="space-y-3.5">
      <div>
        <label className="label" htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" autoComplete="email" required className="field" autoFocus />
      </div>
      {st.erro && <p role="alert" className="rounded bg-danger-soft px-3 py-2 text-[12px] text-danger">{st.erro}</p>}
      <button type="submit" className="btn btn-primary w-full justify-center" disabled={pend}>
        {pend ? "Enviando…" : "Enviar link"}
      </button>
      <a href="/interno/login" className="block pt-1 text-center text-[12px] text-muted hover:text-ink">Voltar para o login</a>
    </form>
  );
}
