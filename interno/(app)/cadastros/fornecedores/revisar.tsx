"use client";

import { useActionState, useEffect, useState } from "react";
import { Ban, Check } from "lucide-react";
import { Modal, Aviso } from "@/components/modal";
import { revisarFornecedor, type RevisaoState } from "./actions";

/** Aprovar / Rejeitar um fornecedor que entrou pela nota fiscal. */
export function RevisarFornecedor({ id, nome, compacto = false }: { id: string; nome: string; compacto?: boolean }) {
  const [rejeitando, setRejeitando] = useState(false);
  const [aprov, acaoAprov, pAprov] = useActionState<RevisaoState, FormData>(revisarFornecedor, {});
  const [rej, acaoRej, pRej] = useActionState<RevisaoState, FormData>(revisarFornecedor, {});

  useEffect(() => { if (rej.ok) setRejeitando(false); }, [rej]);

  const tam = compacto ? "h-7 px-2 text-[11.5px]" : "";

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <form action={acaoAprov}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="decisao" value="aprovar" />
        <button type="submit" className={`btn btn-primary ${tam}`} disabled={pAprov}>
          <Check className="h-3.5 w-3.5" /> {pAprov ? "Aprovando…" : "Aprovar"}
        </button>
      </form>
      <button type="button" className={`btn ${tam}`} onClick={() => setRejeitando(true)}>
        <Ban className="h-3.5 w-3.5" /> Rejeitar
      </button>
      {aprov.erro && <span role="alert" className="w-full text-right text-[11.5px] text-danger">{aprov.erro}</span>}

      {rejeitando && (
        <Modal title="Rejeitar fornecedor" onClose={() => setRejeitando(false)}>
          <form action={acaoRej} className="grid gap-3 px-4 py-4">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="decisao" value="rejeitar" />
            <p className="text-[12.5px] text-graphite">
              <b>{nome}</b> fica <b>bloqueado</b>, com o motivo registrado. Nada é apagado: as notas já recebidas
              continuam ligadas a ele e as próximas notas deste CNPJ aparecem como de fornecedor bloqueado.
            </p>
            <div>
              <label className="label" htmlFor={`mot-${id}`}>Motivo</label>
              <input id={`mot-${id}`} name="motivo" required minLength={5} maxLength={500} className="field"
                     placeholder="ex.: nota lançada por engano / não é nosso fornecedor" autoFocus />
            </div>
            <Aviso erro={rej.erro} />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setRejeitando(false)}>Voltar</button>
              <button type="submit" className="btn btn-primary" disabled={pRej}>
                {pRej ? "Rejeitando…" : "Rejeitar fornecedor"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
