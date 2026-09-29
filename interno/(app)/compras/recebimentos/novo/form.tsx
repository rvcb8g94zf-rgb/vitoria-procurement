"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Aviso } from "@/components/modal";
import { registrarRecebimento, type RecState } from "../actions";

type Item = { order_item_id: string; line_no: number; description: string; unit: string | null; ordered: number; received: number; pending: number };

export function RecebimentoForm({ orderId, itens, notas, hoje }: {
  orderId: string; itens: Item[]; notas: { id: string; rotulo: string }[]; hoje: string;
}) {
  const [st, acao, pend] = useActionState<RecState, FormData>(registrarRecebimento, {});
  const [data, setData] = useState(hoje);
  const [nota, setNota] = useState("");
  const [ref, setRef] = useState("");
  const [obs, setObs] = useState("");
  const [qtd, setQtd] = useState<Record<string, string>>(Object.fromEntries(itens.map((i) => [i.order_item_id, i.pending > 0 ? String(i.pending) : "0"])));
  const [div, setDiv] = useState<Record<string, string>>({});
  const n = (s: string) => Number(String(s).replace(",", ".")) || 0;
  const payload = JSON.stringify({
    order_id: orderId, received_on: data, invoice_id: nota || null, invoice_ref: ref || null, notes: obs || null,
    items: itens.map((i) => ({ order_item_id: i.order_item_id, quantity_received: qtd[i.order_item_id] || "0", divergence_note: div[i.order_item_id] || "" })),
  });

  return (
    <form action={acao} className="grid gap-4">
      <input type="hidden" name="payload" value={payload} />
      <section className="card">
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <div><label className="label" htmlFor="r-data">Recebido em</label>
            <input id="r-data" type="date" max={hoje} required className="field" value={data} onChange={(e) => setData(e.target.value)} /></div>
          <div><label className="label" htmlFor="r-nota">Nota fiscal da entrega</label>
            <select id="r-nota" className="field" value={nota} onChange={(e) => setNota(e.target.value)}>
              <option value="">{notas.length ? "Escolha… (ou digite ao lado)" : "Nenhuma nota deste fornecedor no sistema"}</option>
              {notas.map((x) => <option key={x.id} value={x.id}>{x.rotulo}</option>)}
            </select></div>
          <div><label className="label" htmlFor="r-ref">ou número da nota</label>
            <input id="r-ref" maxLength={60} className="field" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="ex.: 12345" /></div>
        </div>
      </section>
      <section className="card">
        <div className="border-b border-line-soft px-4 py-3">
          <h3 className="text-[13.5px] font-semibold">Conferência</h3>
          <p className="mt-0.5 text-[11.5px] text-muted">Já vem preenchido com o que falta. Ajuste para o que chegou de verdade; faltou, coloque 0.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse">
            <thead><tr>
              <th className="th w-8">#</th><th className="th">ITEM</th><th className="th w-24 text-right">PEDIDO</th><th className="th w-24 text-right">JÁ VEIO</th>
              <th className="th w-24 text-right">FALTA</th><th className="th w-28 text-right">CHEGOU AGORA</th><th className="th w-64">OBSERVAÇÃO</th>
            </tr></thead>
            <tbody>
              {itens.map((i) => {
                const q = n(qtd[i.order_item_id]);
                const mais = q > i.pending;
                const menos = q < i.pending;
                return (
                  <tr key={i.order_item_id} className="align-top">
                    <td className="td pt-3 text-muted">{i.line_no}</td>
                    <td className="td pt-3">{i.description}</td>
                    <td className="td pt-3 text-right font-mono">{i.ordered.toLocaleString("pt-BR")} <span className="text-[11px] text-muted">{i.unit ?? ""}</span></td>
                    <td className="td pt-3 text-right font-mono">{i.received.toLocaleString("pt-BR")}</td>
                    <td className="td pt-3 text-right font-mono">{i.pending.toLocaleString("pt-BR")}</td>
                    <td className="td">
                      <input aria-label={`Quantidade recebida do item ${i.line_no}`} inputMode="decimal"
                             className={`field text-right ${mais ? "border-warn" : ""}`} value={qtd[i.order_item_id]}
                             onChange={(e) => setQtd({ ...qtd, [i.order_item_id]: e.target.value })} />
                      {mais && <span className="block text-[11px] text-warn">acima do que falta</span>}
                      {menos && q > 0 && <span className="block text-[11px] text-muted">entrega parcial</span>}
                    </td>
                    <td className="td">
                      <input aria-label={`Observação do item ${i.line_no}`} maxLength={300} className="field" placeholder={mais ? "obrigatória quando vem a mais" : "avaria, troca…"}
                             value={div[i.order_item_id] ?? ""} onChange={(e) => setDiv({ ...div, [i.order_item_id]: e.target.value })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-line-soft p-4">
          <label className="label" htmlFor="r-obs">Observação geral (opcional)</label>
          <input id="r-obs" maxLength={1000} className="field" value={obs} onChange={(e) => setObs(e.target.value)} />
        </div>
      </section>
      <Aviso erro={st.erro} />
      <div className="flex justify-end gap-2">
        <Link href={`/interno/compras/pedidos/${orderId}` as any} className="btn">Voltar</Link>
        <button type="submit" className="btn btn-primary" disabled={pend}>{pend ? "Registrando…" : "Registrar recebimento"}</button>
      </div>
    </form>
  );
}
