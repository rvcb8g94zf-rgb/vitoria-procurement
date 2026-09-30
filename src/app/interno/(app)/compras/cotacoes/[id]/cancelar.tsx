"use client";

import { useActionState, useEffect, useState } from "react";
import { Ban } from "lucide-react";
import { Modal, Aviso } from "@/components/modal";
import { cancelarCotacao, type CotState } from "../actions";

export function CancelarCotacao({ id, numero }: { id: string; numero: string }) {
  const [aberto, setAberto] = useState(false);
  const [st, acao, pend] = useActionState<CotState, FormData>(cancelarCotacao, {});
  useEffect(() => { if (st.ok) setAberto(false); }, [st]);
  return (
    <>
      <button type="button" className="btn" onClick={() => setAberto(true)}><Ban className="h-3.5 w-3.5" /> Cancelar cotação</button>
      {aberto && (
        <Modal title={`Cancelar a cotação ${numero}`} onClose={() => setAberto(false)}>
          <form action={acao} className="grid gap-3 px-4 py-4">
            <input type="hidden" name="id" value={id} />
            <p className="text-[12.5px] text-graphite">Se veio de uma solicitação, ela volta para o Compras decidir de novo.</p>
            <div><label className="label" htmlFor="cc-mot">Motivo</label>
              <input id="cc-mot" name="motivo" required minLength={5} maxLength={500} className="field" autoFocus /></div>
            <Aviso erro={st.erro} />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setAberto(false)}>Voltar</button>
              <button type="submit" className="btn btn-primary" disabled={pend}>{pend ? "Cancelando…" : "Cancelar cotação"}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
