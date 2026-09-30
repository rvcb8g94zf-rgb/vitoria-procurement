"use client";

import { useActionState, useEffect, useState } from "react";
import { Ban, Check, Copy, Pencil, Send, Truck, Undo2, X } from "lucide-react";
import { Modal, Aviso } from "@/components/modal";
import { acaoPedido, type PedidoState } from "../actions";

type Modo = null | "recusar" | "alterar" | "cancelar";

/** Botões do pedido conforme a situação e o que o usuário pode fazer. */
export function AcoesPedido({
  id, numero, status, podeEditar, podeCancelar, podeDecidir, texto, compacto = false,
}: {
  id: string; numero: string; status: string; podeEditar: boolean; podeCancelar: boolean;
  podeDecidir: boolean; texto?: string; compacto?: boolean;
}) {
  const [st, acao, pend] = useActionState<PedidoState, FormData>(acaoPedido, {});
  const [modo, setModo] = useState<Modo>(null);
  const [copiado, setCopiado] = useState(false);
  useEffect(() => { if (st.ok) setModo(null); }, [st]);
  const tam = compacto ? "h-7 px-2 text-[11.5px]" : "";

  const simples = (a: string, rot: string, Icone: any, primario = false) => (
    <form action={acao}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="acao" value={a} />
      <button type="submit" className={`btn ${primario ? "btn-primary" : ""} ${tam}`} disabled={pend}>
        <Icone className="h-3.5 w-3.5" /> {rot}
      </button>
    </form>
  );

  const TITULO: Record<string, string> = {
    recusar: `Recusar o pedido ${numero}`, alterar: `Pedir alteração no pedido ${numero}`, cancelar: `Cancelar o pedido ${numero}`,
  };
  const DICA: Record<string, string> = {
    recusar: "O pedido é cancelado, com a sua justificativa registrada.",
    alterar: "O pedido volta para rascunho; quem lançou corrige e envia de novo.",
    cancelar: "O pedido fica no histórico como cancelado. Se já foi enviado, avise o fornecedor.",
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {status === "rascunho" && podeEditar && (
        <>
          <a href={`/interno/compras/pedidos/${id}/editar`} className={`btn ${tam}`}><Pencil className="h-3.5 w-3.5" /> Editar</a>
          {simples("enviar", "Enviar para aprovação", Send, true)}
        </>
      )}
      {status === "aguardando_aprovacao" && podeDecidir && (
        <>
          {simples("aprovar", "Aprovar", Check, true)}
          <button type="button" className={`btn ${tam}`} onClick={() => setModo("alterar")}><Undo2 className="h-3.5 w-3.5" /> Pedir alteração</button>
          <button type="button" className={`btn ${tam}`} onClick={() => setModo("recusar")}><X className="h-3.5 w-3.5" /> Recusar</button>
        </>
      )}
      {status === "aprovado" && podeEditar && simples("marcar_enviado", "Marcar como enviado", Truck, true)}
      {texto && ["aprovado", "enviado", "confirmado", "parcialmente_recebido"].includes(status) && (
        <button type="button" className={`btn ${tam}`}
                onClick={async () => { await navigator.clipboard.writeText(texto); setCopiado(true); setTimeout(() => setCopiado(false), 2500); }}>
          <Copy className="h-3.5 w-3.5" /> {copiado ? "Copiado!" : "Copiar para WhatsApp"}
        </button>
      )}
      {podeCancelar && !["cancelado", "recebido", "parcialmente_recebido"].includes(status) && (
        <button type="button" className={`btn ${tam}`} onClick={() => setModo("cancelar")}><Ban className="h-3.5 w-3.5" /> Cancelar</button>
      )}
      {st.erro && !modo && <span role="alert" className="w-full text-right text-[11.5px] text-danger">{st.erro}</span>}
      {st.ok && st.msg && <span role="status" className="w-full text-right text-[11.5px] text-accent-ink">{st.msg}</span>}

      {modo && (
        <Modal title={TITULO[modo]} onClose={() => setModo(null)}>
          <form action={acao} className="grid gap-3 px-4 py-4">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="acao" value={modo} />
            <p className="text-[12.5px] text-graphite">{DICA[modo]}</p>
            <div>
              <label className="label" htmlFor={`c-${id}`}>{modo === "cancelar" ? "Motivo" : "Justificativa"}</label>
              <input id={`c-${id}`} name="comentario" required minLength={5} maxLength={500} className="field" autoFocus />
            </div>
            <Aviso erro={st.erro} />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setModo(null)}>Voltar</button>
              <button type="submit" className="btn btn-primary" disabled={pend}>
                {pend ? "Salvando…" : modo === "recusar" ? "Recusar pedido" : modo === "alterar" ? "Devolver para alteração" : "Cancelar pedido"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
