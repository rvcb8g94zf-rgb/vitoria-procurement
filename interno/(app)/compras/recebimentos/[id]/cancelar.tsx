"use client";

import { useActionState, useEffect, useState } from "react";
import { Ban } from "lucide-react";
import { Modal, Aviso } from "@/components/modal";
import { cancelarRecebimento, type RecState } from "../actions";

export function CancelarRecebimento({ id, numero }: { id: string; numero: string }) {
  const [aberto, setAberto] = useState(false);
  const [st, acao, pend] = useActionState<RecState, FormData>(cancelarRecebimento, {});
  useEffect(() => { if (st.ok) setAberto(false); }, [st]);
  return (
    <>
      <button type="button" className="btn" onClick={() => setAberto(true)}><Ban className="h-3.5 w-3.5" /> Cancelar recebimento</button>
      {aberto && (
        <Modal title={`Cancelar o recebimento ${numero}`} onClose={() => setAberto(false)}>
          <form action={acao} className="grid gap-3 px-4 py-4">
            <input type="hidden" name="id" value={id} />
            <p className="text-[12.5px] text-graphite">As quantidades voltam a constar como pendentes no pedido.</p>
            <div><label className="label" htmlFor="cr-mot">Motivo</label>
              <input id="cr-mot" name="motivo" required minLength={5} maxLength={500} className="field" autoFocus /></div>
            <Aviso erro={st.erro} />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setAberto(false)}>Voltar</button>
              <button type="submit" className="btn btn-primary" disabled={pend}>{pend ? "Cancelando…" : "Cancelar recebimento"}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
