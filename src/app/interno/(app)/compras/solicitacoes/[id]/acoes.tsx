"use client";

import { useActionState, useEffect, useState } from "react";
import { Ban, ClipboardList, ListChecks, Pencil, Send, X } from "lucide-react";
import { Modal, Aviso } from "@/components/modal";
import { acaoSolicitacao, type SolState } from "../actions";

export function AcoesSolicitacao({
  id, numero, status, souAutor, souComprador, podeCancelar,
}: { id: string; numero: string; status: string; souAutor: boolean; souComprador: boolean; podeCancelar: boolean }) {
  const [st, acao, pend] = useActionState<SolState, FormData>(acaoSolicitacao, {});
  const [modo, setModo] = useState<null | "recusar" | "cancelar">(null);
  useEffect(() => { if (st.ok) setModo(null); }, [st]);

  const botao = (a: string, rot: string, Icone: any, primario = false, depois = "") => (
    <form action={acao}>
      <input type="hidden" name="id" value={id} /><input type="hidden" name="acao" value={a} />
      {depois && <input type="hidden" name="depois" value={depois} />}
      <button type="submit" className={`btn ${primario ? "btn-primary" : ""}`} disabled={pend}><Icone className="h-3.5 w-3.5" /> {rot}</button>
    </form>
  );

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {status === "rascunho" && (souAutor || souComprador) && (
        <>
          <a href={`/interno/compras/solicitacoes/${id}/editar`} className="btn"><Pencil className="h-3.5 w-3.5" /> Editar</a>
          {botao("enviar", "Enviar ao Compras", Send, true)}
        </>
      )}
      {status === "enviada" && souComprador && (
        <>
          {botao("aceitar", "Aceitar e cotar", ListChecks, true, "cotacao")}
          {botao("aceitar", "Aceitar e fazer pedido", ClipboardList, false, "pedido")}
          <button type="button" className="btn" onClick={() => setModo("recusar")}><X className="h-3.5 w-3.5" /> Recusar</button>
        </>
      )}
      {status === "aprovada" && souComprador && (
        <>
          <a href={`/interno/compras/cotacoes/nova?solicitacao=${id}`} className="btn btn-primary"><ListChecks className="h-3.5 w-3.5" /> Abrir cotação</a>
          <a href={`/interno/compras/pedidos/novo?solicitacao=${id}`} className="btn"><ClipboardList className="h-3.5 w-3.5" /> Fazer pedido</a>
        </>
      )}
      {["rascunho", "enviada", "aprovada"].includes(status) && (souAutor || podeCancelar) && (
        <button type="button" className="btn" onClick={() => setModo("cancelar")}><Ban className="h-3.5 w-3.5" /> Cancelar</button>
      )}
      {st.erro && !modo && <span role="alert" className="w-full text-right text-[11.5px] text-danger">{st.erro}</span>}
      {st.ok && st.msg && <span role="status" className="w-full text-right text-[11.5px] text-accent-ink">{st.msg}</span>}

      {modo && (
        <Modal title={modo === "recusar" ? `Recusar a solicitação ${numero}` : `Cancelar a solicitação ${numero}`} onClose={() => setModo(null)}>
          <form action={acao} className="grid gap-3 px-4 py-4">
            <input type="hidden" name="id" value={id} /><input type="hidden" name="acao" value={modo} />
            <p className="text-[12.5px] text-graphite">
              {modo === "recusar" ? "Quem pediu vê a sua justificativa." : "A solicitação fica no histórico como cancelada."}
            </p>
            <div>
              <label className="label" htmlFor={`n-${id}`}>{modo === "recusar" ? "Justificativa" : "Motivo"}</label>
              <input id={`n-${id}`} name="nota" required minLength={5} maxLength={500} className="field" autoFocus
                     placeholder={modo === "recusar" ? "ex.: temos em estoque; use o do depósito 2" : ""} />
            </div>
            <Aviso erro={st.erro} />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setModo(null)}>Voltar</button>
              <button type="submit" className="btn btn-primary" disabled={pend}>
                {pend ? "Salvando…" : modo === "recusar" ? "Recusar solicitação" : "Cancelar solicitação"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
