"use client";

import { useActionState, useEffect, useState } from "react";
import { Ban, Banknote, Pencil } from "lucide-react";
import { Modal, Aviso } from "@/components/modal";
import { METODOS, type PayableRow } from "@/lib/financeiro";
import { money } from "@/lib/format";
import { cancelarTitulo, darBaixa, editarTitulo, type FormState } from "./actions";

const reais = (v: number) => v.toFixed(2);

export function AcoesTitulo({
  titulo, hoje, podePagar, podeEditar, podeCancelar,
}: {
  titulo: PayableRow;
  hoje: string;
  podePagar: boolean;
  podeEditar: boolean;
  podeCancelar: boolean;
}) {
  const [modal, setModal] = useState<null | "baixa" | "editar" | "cancelar">(null);
  const [eBaixa, aBaixa, pBaixa] = useActionState<FormState, FormData>(darBaixa, {});
  const [eEdit, aEdit, pEdit] = useActionState<FormState, FormData>(editarTitulo, {});
  const [eCanc, aCanc, pCanc] = useActionState<FormState, FormData>(cancelarTitulo, {});

  useEffect(() => { if (eBaixa.ok) setModal(null); }, [eBaixa]);
  useEffect(() => { if (eEdit.ok) setModal(null); }, [eEdit]);
  useEffect(() => { if (eCanc.ok) setModal(null); }, [eCanc]);

  const aberto = titulo.status === "aberto" || titulo.status === "parcial";
  const semPagamento = titulo.paid_amount === 0;
  const fechar = () => setModal(null);

  return (
    <div className="flex justify-end gap-1.5">
      {podePagar && aberto && (
        <button type="button" className="btn btn-primary h-7 shrink-0 px-2 text-[11.5px]" onClick={() => setModal("baixa")}>
          <Banknote className="h-3.5 w-3.5" /> Baixar
        </button>
      )}
      {podeEditar && aberto && (
        <button type="button" className="btn h-7 w-7 shrink-0 justify-center px-0" onClick={() => setModal("editar")}
                aria-label="Editar" title="Editar">
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
      {podeCancelar && aberto && semPagamento && (
        <button type="button" className="btn h-7 w-7 shrink-0 justify-center px-0" onClick={() => setModal("cancelar")}
                aria-label="Cancelar" title="Cancelar título">
          <Ban className="h-3.5 w-3.5" />
        </button>
      )}

      {modal === "baixa" && (
        <Modal title="Registrar pagamento" onClose={fechar}>
          <form action={aBaixa} className="grid gap-3 px-4 py-4">
            <input type="hidden" name="titulo" value={titulo.id} />
            <p className="text-[12.5px] text-graphite">
              <b>{titulo.description}</b>
              <span className="block text-[11.5px] text-muted">
                {titulo.supplier_name ?? "sem fornecedor"} · saldo de {money(titulo.balance)}
              </span>
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor={`d-${titulo.id}`}>Data do pagamento</label>
                <input id={`d-${titulo.id}`} name="data" type="date" required defaultValue={hoje} max={hoje} className="field" />
              </div>
              <div>
                <label className="label" htmlFor={`v-${titulo.id}`}>Valor pago</label>
                <input id={`v-${titulo.id}`} name="valor" type="number" step="0.01" min="0.01"
                       max={reais(titulo.balance)} required defaultValue={reais(titulo.balance)} className="field" />
              </div>
            </div>
            <div>
              <label className="label" htmlFor={`f-${titulo.id}`}>Forma</label>
              <select id={`f-${titulo.id}`} name="forma" defaultValue="pix" className="field">
                {METODOS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor={`r-${titulo.id}`}>Comprovante ou autenticação (opcional)</label>
              <input id={`r-${titulo.id}`} name="referencia" className="field" placeholder="ex.: E1234567890" />
            </div>
            <Aviso erro={eBaixa.erro} />
            <p className="text-[11.5px] text-muted">
              Pagou só uma parte? Baixe o valor pago — o título fica com o saldo em aberto.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={fechar}>Voltar</button>
              <button type="submit" className="btn btn-primary" disabled={pBaixa}>
                {pBaixa ? "Registrando…" : "Registrar pagamento"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "editar" && (
        <Modal title="Editar título" onClose={fechar}>
          <form action={aEdit} className="grid gap-3 px-4 py-4">
            <input type="hidden" name="titulo" value={titulo.id} />
            <div>
              <label className="label" htmlFor={`ed-${titulo.id}`}>Descrição</label>
              <input id={`ed-${titulo.id}`} name="descricao" required maxLength={200}
                     defaultValue={titulo.description} className="field" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor={`ev-${titulo.id}`}>Vencimento</label>
                <input id={`ev-${titulo.id}`} name="vencimento" type="date" required
                       defaultValue={titulo.due_date} className="field" />
              </div>
              <div>
                <label className="label" htmlFor={`eva-${titulo.id}`}>Valor</label>
                <input id={`eva-${titulo.id}`} name="valor" type="number" step="0.01"
                       min={reais(Math.max(titulo.paid_amount, 0.01))} required
                       defaultValue={reais(titulo.amount)} className="field" />
              </div>
            </div>
            <div>
              <label className="label" htmlFor={`eo-${titulo.id}`}>Observação (opcional)</label>
              <input id={`eo-${titulo.id}`} name="observacao" maxLength={500} className="field" />
            </div>
            <Aviso erro={eEdit.erro} />
            {titulo.paid_amount > 0 && (
              <p className="text-[11.5px] text-muted">
                Já foram pagos {money(titulo.paid_amount)}: o valor não pode ficar abaixo disso.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={fechar}>Voltar</button>
              <button type="submit" className="btn btn-primary" disabled={pEdit}>
                {pEdit ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "cancelar" && (
        <Modal title="Cancelar título" onClose={fechar}>
          <form action={aCanc} className="grid gap-3 px-4 py-4">
            <input type="hidden" name="titulo" value={titulo.id} />
            <p className="text-[12.5px] text-graphite">
              O título <b>{titulo.description}</b> ({money(titulo.amount)}) fica no histórico marcado
              como cancelado. Ele não é apagado.
            </p>
            <div>
              <label className="label" htmlFor={`cm-${titulo.id}`}>Motivo</label>
              <input id={`cm-${titulo.id}`} name="motivo" required minLength={5} maxLength={500}
                     className="field" placeholder="ex.: devolução da mercadoria" />
            </div>
            <Aviso erro={eCanc.erro} />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={fechar}>Voltar</button>
              <button type="submit" className="btn btn-primary" disabled={pCanc}>
                {pCanc ? "Cancelando…" : "Cancelar título"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
