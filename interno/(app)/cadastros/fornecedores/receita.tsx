"use client";

import { useActionState } from "react";
import { Landmark } from "lucide-react";
import { completarPelaReceita, type ReceitaState } from "./actions";

/** Botão "buscar na Receita" — de um fornecedor (id) ou de todos os que faltam. */
export function BotaoReceita({ id, rotulo }: { id?: string; rotulo: string }) {
  const [st, acao, pend] = useActionState<ReceitaState, FormData>(completarPelaReceita, {});
  return (
    <form action={acao} className="inline-flex flex-wrap items-center gap-2">
      {id && <input type="hidden" name="id" value={id} />}
      <button type="submit" className="btn" disabled={pend}>
        <Landmark className="h-3.5 w-3.5" /> {pend ? "Consultando a Receita…" : rotulo}
      </button>
      {st.erro && <span role="alert" className="text-[11.5px] text-danger">{st.erro}</span>}
      {st.ok && st.msg && <span role="status" className="text-[11.5px] text-accent-ink">{st.msg}</span>}
    </form>
  );
}
