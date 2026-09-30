"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Link2, Unlink, ShieldCheck, RotateCcw } from "lucide-react";
import { Modal, Aviso } from "@/components/modal";
import { ligarPedido, liberarPagamento, parearItem, type ConfState } from "../conferencia/actions";

type Candidato = { id: string; number: string; status: string; issued_on: string; total_amount: number };

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

export function LigarPedido({ notaId, candidatos }: { notaId: string; candidatos: Candidato[] }) {
  const [st, acao, pend] = useActionState<ConfState, FormData>(ligarPedido, {});
  if (candidatos.length === 0) {
    return <p className="text-[12px] text-muted">Nenhum pedido aprovado deste fornecedor para ligar.</p>;
  }
  return (
    <form action={acao} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="nota" value={notaId} />
      <select name="pedido" className="field h-8 w-auto min-w-[260px] text-[12.5px]" defaultValue="" required
              aria-label="Pedido para ligar">
        <option value="" disabled>Escolha o pedido…</option>
        {candidatos.map((c) => (
          <option key={c.id} value={c.id}>
            {c.number} · {dataBR(c.issued_on)} · {brl(Number(c.total_amount ?? 0))}
            {c.status === "recebido" ? " · já recebido" : ""}
          </option>
        ))}
      </select>
      <button type="submit" className="btn h-8 px-2.5 text-[12px]" disabled={pend}>
        <Link2 className="h-3.5 w-3.5" /> {pend ? "Ligando…" : "Ligar ao pedido"}
      </button>
      {st.erro && <span role="alert" className="text-[11.5px] text-danger">{st.erro}</span>}
    </form>
  );
}

export function DesligarPedido({ notaId, pedidoId, numero }: { notaId: string; pedidoId: string; numero: string }) {
  const [st, acao, pend] = useActionState<ConfState, FormData>(ligarPedido, {});
  return (
    <form action={acao} className="inline">
      <input type="hidden" name="nota" value={notaId} />
      <input type="hidden" name="pedido" value={pedidoId} />
      <input type="hidden" name="remover" value="1" />
      <button type="submit" className="btn h-7 w-7 justify-center px-0" disabled={pend}
              title={`Desligar do pedido ${numero}`} aria-label={`Desligar do pedido ${numero}`}>
        <Unlink className="h-3.5 w-3.5" />
      </button>
      {st.erro && <span role="alert" className="ml-2 text-[11.5px] text-danger">{st.erro}</span>}
    </form>
  );
}

type ItemPedido = { id: string; order_number: string; line_no: number; description: string; unit: string | null };

/** Troca o par de um item da nota; envia sozinho ao escolher. */
export function ParItem({
  notaId, seq, atual, manual, itens,
}: { notaId: string; seq: number; atual: string | null; manual: boolean; itens: ItemPedido[] }) {
  const [st, acao, pend] = useActionState<ConfState, FormData>(parearItem, {});
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={acao}>
      <input type="hidden" name="nota" value={notaId} />
      <input type="hidden" name="seq" value={seq} />
      <select name="item" className="field h-7 w-full py-0 text-[11.5px]" disabled={pend}
              defaultValue={manual ? atual ?? "" : ""} aria-label={`Item do pedido para o item ${seq} da nota`}
              onChange={() => ref.current?.requestSubmit()}>
        <option value="">{atual && !manual ? "Automático (atual)" : "Automático"}</option>
        {itens.map((i) => (
          <option key={i.id} value={i.id}>
            {i.order_number} · {i.line_no}. {i.description.slice(0, 50)}{i.unit ? ` (${i.unit})` : ""}
          </option>
        ))}
      </select>
      {st.erro && <span role="alert" className="text-[11px] text-danger">{st.erro}</span>}
    </form>
  );
}

export function LiberarPagamento({ notaId, resumo }: { notaId: string; resumo: string }) {
  const [aberto, setAberto] = useState(false);
  const [st, acao, pend] = useActionState<ConfState, FormData>(liberarPagamento, {});
  useEffect(() => { if (st.ok) setAberto(false); }, [st]);
  return (
    <>
      <button type="button" className="btn h-8 px-2.5 text-[12px]" onClick={() => setAberto(true)}>
        <ShieldCheck className="h-3.5 w-3.5" /> Liberar pagamento
      </button>
      {aberto && (
        <Modal title="Liberar pagamento com divergência" onClose={() => setAberto(false)}>
          <form action={acao} className="grid gap-3 px-4 py-4">
            <input type="hidden" name="nota" value={notaId} />
            <p className="text-[12.5px] text-graphite">
              Divergências de agora: <b>{resumo}</b>. A liberação vale para elas; se aparecer outra depois
              (um recebimento cancelado, outra nota), o pagamento volta a ficar retido.
            </p>
            <div>
              <label className="label" htmlFor="motivo-liberacao">Motivo</label>
              <input id="motivo-liberacao" name="motivo" required minLength={5} maxLength={500} className="field" autoFocus
                     placeholder="ex.: reajuste combinado com o fornecedor por telefone em 28/09" />
            </div>
            <Aviso erro={st.erro} />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setAberto(false)}>Voltar</button>
              <button type="submit" className="btn btn-primary" disabled={pend}>
                {pend ? "Liberando…" : "Liberar pagamento"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function DesfazerLiberacao({ notaId }: { notaId: string }) {
  const [st, acao, pend] = useActionState<ConfState, FormData>(liberarPagamento, {});
  return (
    <form action={acao} className="inline">
      <input type="hidden" name="nota" value={notaId} />
      <input type="hidden" name="desfazer" value="1" />
      <button type="submit" className="btn h-7 px-2 text-[11.5px]" disabled={pend}>
        <RotateCcw className="h-3.5 w-3.5" /> {pend ? "Desfazendo…" : "Desfazer liberação"}
      </button>
      {st.erro && <span role="alert" className="ml-2 text-[11.5px] text-danger">{st.erro}</span>}
    </form>
  );
}
