"use client";

import { useActionState, useEffect, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import { Modal, Aviso } from "@/components/modal";
import { tratarDivergencia, type TratarState } from "./actions";

export function Tratar({ kind, invoiceId, titulo }: { kind: string; invoiceId: string; titulo: string }) {
  const [aberto, setAberto] = useState(false);
  const [st, acao, pend] = useActionState<TratarState, FormData>(tratarDivergencia, {});
  useEffect(() => { if (st.ok) setAberto(false); }, [st]);

  return (
    <>
      <button type="button" className="btn h-7 px-2 text-[11.5px]" onClick={() => setAberto(true)}>
        <Check className="h-3.5 w-3.5" /> Tratada
      </button>
      {aberto && (
        <Modal title="Marcar como tratada" onClose={() => setAberto(false)}>
          <form action={acao} className="grid gap-3 px-4 py-4">
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="invoice_id" value={invoiceId} />
            <p className="text-[12.5px] text-graphite">
              <b>{titulo}</b> sai da fila, com o que você escrever registrado. Se a situação mudar de novo,
              dá para devolver à fila em “Ver tratadas”.
            </p>
            <div>
              <label className="label" htmlFor={`nota-${kind}-${invoiceId}`}>O que foi feito</label>
              <input id={`nota-${kind}-${invoiceId}`} name="nota" required minLength={5} maxLength={500}
                     className="field" autoFocus
                     placeholder="ex.: fornecedor emitiu nota substituta 1234; título cancelado" />
            </div>
            <Aviso erro={st.erro} />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setAberto(false)}>Voltar</button>
              <button type="submit" className="btn btn-primary" disabled={pend}>
                {pend ? "Salvando…" : "Marcar como tratada"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function Reabrir({ kind, invoiceId }: { kind: string; invoiceId: string }) {
  const [st, acao, pend] = useActionState<TratarState, FormData>(tratarDivergencia, {});
  return (
    <form action={acao} className="inline">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <input type="hidden" name="reabrir" value="1" />
      <button type="submit" className="btn h-7 px-2 text-[11.5px]" disabled={pend}>
        <RotateCcw className="h-3.5 w-3.5" /> {pend ? "Voltando…" : "Voltar à fila"}
      </button>
      {st.erro && <span role="alert" className="ml-2 text-[11.5px] text-danger">{st.erro}</span>}
    </form>
  );
}
