"use client";

import { useActionState, useEffect, useState } from "react";
import { Undo2 } from "lucide-react";
import { Modal, Aviso } from "@/components/modal";
import { money } from "@/lib/format";
import { estornarPagamento, type FormState } from "../contas-a-pagar/actions";

export function Estornar({
  id, descricao, valor,
}: {
  id: string;
  descricao: string;
  valor: number;
}) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao, pendente] = useActionState<FormState, FormData>(estornarPagamento, {});

  useEffect(() => { if (estado.ok) setAberto(false); }, [estado]);

  return (
    <>
      <button type="button" className="btn h-7 px-2 text-[11.5px]" onClick={() => setAberto(true)}>
        <Undo2 className="h-3.5 w-3.5" /> Estornar
      </button>

      {aberto && (
        <Modal title="Estornar pagamento" onClose={() => setAberto(false)}>
          <form action={acao} className="grid gap-3 px-4 py-4">
            <input type="hidden" name="pagamento" value={id} />
            <p className="text-[12.5px] text-graphite">
              O pagamento de <b>{money(valor)}</b> em <b>{descricao}</b> volta para o saldo do título.
              O lançamento fica no histórico, marcado como estornado.
            </p>
            <div>
              <label className="label" htmlFor={`m-${id}`}>Motivo</label>
              <input id={`m-${id}`} name="motivo" required minLength={5} maxLength={500}
                     className="field" placeholder="ex.: pagamento lançado em duplicidade" autoFocus />
            </div>
            <Aviso erro={estado.erro} />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setAberto(false)}>Voltar</button>
              <button type="submit" className="btn btn-primary" disabled={pendente}>
                {pendente ? "Estornando…" : "Estornar"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
