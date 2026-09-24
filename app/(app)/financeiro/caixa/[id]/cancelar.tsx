"use client";

import { useActionState, useEffect, useState } from "react";
import { Ban } from "lucide-react";
import { cancelarFechamento, type CancelState } from "../actions";

/**
 * Cancelar não apaga: o fechamento fica guardado, marcado, com motivo e
 * autor. Só quem tem "cash.delete" vê o botão — e o banco confere de novo.
 */
export function CancelarFechamento({ id, data }: { id: string; data: string }) {
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [estado, acao, pendente] = useActionState<CancelState, FormData>(cancelarFechamento, {});

  useEffect(() => {
    if (estado.ok) setAberto(false);
  }, [estado]);

  useEffect(() => {
    if (!aberto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pendente) setAberto(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aberto, pendente]);

  return (
    <>
      <button type="button" className="btn text-danger hover:border-danger" onClick={() => setAberto(true)}>
        <Ban className="h-3.5 w-3.5" /> Cancelar fechamento
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
          onClick={(e) => e.target === e.currentTarget && !pendente && setAberto(false)}
        >
          <form
            action={acao}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancelar-titulo"
            className="my-16 w-full max-w-[460px] rounded border border-line bg-surface p-5"
          >
            <h2 id="cancelar-titulo" className="text-[16px] font-semibold">Cancelar o caixa de {data}?</h2>
            <p className="mt-1.5 text-[12.5px] text-graphite">
              O registro continua guardado, marcado como cancelado, e deixa de contar nos totais e relatórios.
              Depois dá para importar de novo o relatório corrigido deste dia.
            </p>

            <input type="hidden" name="id" value={id} />
            <label className="label mt-4" htmlFor="motivo">Motivo do cancelamento</label>
            <textarea
              id="motivo"
              name="motivo"
              rows={3}
              required
              minLength={5}
              maxLength={500}
              autoFocus
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="field h-auto py-2"
              placeholder="Ex.: importado o arquivo do dia errado"
            />

            {estado.erro && (
              <p role="alert" className="mt-3 rounded-sm bg-danger-soft px-3 py-2 text-[12px] text-danger">
                {estado.erro}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setAberto(false)} disabled={pendente}>
                Voltar
              </button>
              <button
                type="submit"
                disabled={pendente || motivo.trim().length < 5}
                className="btn border-danger bg-danger text-white hover:border-danger hover:opacity-90"
              >
                {pendente ? "Cancelando…" : "Cancelar fechamento"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
