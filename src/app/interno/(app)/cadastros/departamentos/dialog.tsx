"use client";

import { useActionState, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { salvarDepartamento, type FormState } from "./actions";
import type { Department } from "@/types";

export function DepartamentoDialog({ departamento }: { departamento?: Department }) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao, pendente] = useActionState<FormState, FormData>(salvarDepartamento, {});

  useEffect(() => { if (estado.ok) setAberto(false); }, [estado.ok]);

  return (
    <>
      <button onClick={() => setAberto(true)} className={departamento ? "btn h-7 px-2.5 text-[12px]" : "btn btn-primary"}>
        {departamento ? "Editar" : <><Plus className="h-3.5 w-3.5" /> Novo departamento</>}
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={(e) => e.target === e.currentTarget && setAberto(false)}
          onKeyDown={(e) => e.key === "Escape" && setAberto(false)}
        >
          <form action={acao} className="w-full max-w-[400px] rounded border border-line bg-surface p-5">
            <h2 className="mb-4 text-[16px] font-semibold">
              {departamento ? "Editar departamento" : "Novo departamento"}
            </h2>

            {departamento && <input type="hidden" name="id" value={departamento.id} />}

            <div className="space-y-3.5">
              <div>
                <label className="label" htmlFor="code">Código</label>
                <input id="code" name="code" defaultValue={departamento?.code}
                       maxLength={20} required className="field font-mono uppercase" placeholder="ADM" />
              </div>
              <div>
                <label className="label" htmlFor="name">Nome</label>
                <input id="name" name="name" defaultValue={departamento?.name}
                       maxLength={120} required className="field" placeholder="Administrativo" />
              </div>
            </div>

            {estado.erro && (
              <p role="alert" className="mt-3 rounded-sm bg-danger-soft px-3 py-2 text-[12px] text-danger">
                {estado.erro}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setAberto(false)} className="btn">Cancelar</button>
              <button type="submit" disabled={pendente} className="btn btn-primary">
                {pendente ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
