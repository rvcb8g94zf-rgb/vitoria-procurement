"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { Aviso } from "@/components/modal";
import { salvarPedido, type PedidoState } from "./actions";

export type Opcao = { id: string; nome: string };
export type ProdutoOpcao = { id: string; sku: string; description: string; unit_id: string | null; ultimo?: number | null };
export type UnidadeOpcao = { id: string; code: string };
type Linha = { key: number; product_id: string; description: string; quantity: string; unit_id: string; unit_price: string; discount: string };

export type PedidoInicial = {
  id?: string;
  supplier_id?: string; payment_term_id?: string | null; cost_center_id?: string | null;
  expected_on?: string | null; carrier?: string | null; freight_amount?: number; discount?: number;
  notes?: string | null; request_id?: string | null; quotation_id?: string | null;
  items?: { product_id: string | null; description: string; quantity: number; unit_id: string | null; unit_price: number; discount: number }[];
};

const n = (s: string) => { const v = Number(String(s).replace(",", ".")); return Number.isFinite(v) ? v : 0; };
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function PedidoForm({
  inicial, fornecedores, condicoes, centros, produtos, unidades, hoje,
}: {
  inicial: PedidoInicial; fornecedores: Opcao[]; condicoes: Opcao[]; centros: Opcao[];
  produtos: ProdutoOpcao[]; unidades: UnidadeOpcao[]; hoje: string;
}) {
  const [st, acao, pend] = useActionState<PedidoState, FormData>(salvarPedido, {});
  const modoRef = useRef<HTMLInputElement>(null);
  let seq = 0;
  const [linhas, setLinhas] = useState<Linha[]>(
    (inicial.items?.length ? inicial.items : [{ product_id: null, description: "", quantity: 1, unit_id: null, unit_price: 0, discount: 0 }])
      .map((i) => ({
        key: ++seq, product_id: i.product_id ?? "", description: i.description, quantity: String(i.quantity),
        unit_id: i.unit_id ?? "", unit_price: i.unit_price ? String(i.unit_price) : "", discount: i.discount ? String(i.discount) : "",
      })));
  const [cab, setCab] = useState({
    supplier_id: inicial.supplier_id ?? "", payment_term_id: inicial.payment_term_id ?? "",
    cost_center_id: inicial.cost_center_id ?? "", expected_on: inicial.expected_on ?? "",
    carrier: inicial.carrier ?? "", freight_amount: inicial.freight_amount ? String(inicial.freight_amount) : "",
    discount: inicial.discount ? String(inicial.discount) : "", notes: inicial.notes ?? "",
  });

  const porRotulo = useMemo(() => new Map(produtos.map((p) => [`${p.sku} — ${p.description}`, p])), [produtos]);
  const porId = useMemo(() => new Map(produtos.map((p) => [p.id, p])), [produtos]);
  const subtotal = linhas.reduce((s, l) => s + Math.max(0, n(l.quantity) * n(l.unit_price) - n(l.discount)), 0);
  const total = subtotal + n(cab.freight_amount) - n(cab.discount);

  const muda = (key: number, campo: keyof Linha, valor: string) =>
    setLinhas((ls) => ls.map((l) => {
      if (l.key !== key) return l;
      const novo = { ...l, [campo]: valor };
      if (campo === "description") {
        const p = porRotulo.get(valor);
        if (p) {
          novo.product_id = p.id; novo.description = p.description;
          if (p.unit_id) novo.unit_id = p.unit_id;
          if (!l.unit_price && p.ultimo) novo.unit_price = String(p.ultimo);
        } else if (l.product_id && porId.get(l.product_id)?.description !== valor) {
          novo.product_id = "";
        }
      }
      return novo;
    }));

  const payload = JSON.stringify({
    id: inicial.id ?? null,
    header: { ...cab, request_id: inicial.request_id ?? null, quotation_id: inicial.quotation_id ?? null },
    items: linhas.filter((l) => l.description.trim() || n(l.unit_price) > 0).map((l) => ({
      product_id: l.product_id || null, description: l.description, quantity: l.quantity,
      unit_id: l.unit_id || null, unit_price: l.unit_price === "" ? "0" : l.unit_price, discount: l.discount || "0",
    })),
  });

  return (
    <form action={acao} className="grid gap-4">
      <input type="hidden" name="payload" value={payload} />
      <input type="hidden" name="enviar" defaultValue="0" ref={modoRef} />

      <section className="card">
        <div className="border-b border-line-soft px-4 py-3"><h3 className="text-[13.5px] font-semibold">Fornecedor e condições</h3></div>
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-1">
            <label className="label" htmlFor="p-forn">Fornecedor</label>
            <select id="p-forn" className="field" required value={cab.supplier_id}
                    onChange={(e) => setCab({ ...cab, supplier_id: e.target.value })}>
              <option value="">Escolha…</option>
              {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="p-cond">Condição de pagamento</label>
            <select id="p-cond" className="field" value={cab.payment_term_id}
                    onChange={(e) => setCab({ ...cab, payment_term_id: e.target.value })}>
              <option value="">—</option>
              {condicoes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="p-ent">Entrega até</label>
            <input id="p-ent" type="date" min={hoje} className="field" value={cab.expected_on}
                   onChange={(e) => setCab({ ...cab, expected_on: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="p-cc">Centro de custo</label>
            <select id="p-cc" className="field" value={cab.cost_center_id}
                    onChange={(e) => setCab({ ...cab, cost_center_id: e.target.value })}>
              <option value="">—</option>
              {centros.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="p-transp">Transportadora (opcional)</label>
            <input id="p-transp" maxLength={120} className="field" value={cab.carrier}
                   onChange={(e) => setCab({ ...cab, carrier: e.target.value })} />
          </div>
        </div>
      </section>

      <section className="card">
        <div className="flex items-center border-b border-line-soft px-4 py-3">
          <h3 className="text-[13.5px] font-semibold">Itens</h3>
          <span className="ml-3 text-[11.5px] text-muted">Digite o SKU ou a descrição para puxar do cadastro; item fora do cadastro também vale.</span>
        </div>
        <datalist id="p-produtos">
          {produtos.map((p) => <option key={p.id} value={`${p.sku} — ${p.description}`} />)}
        </datalist>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse">
            <thead>
              <tr>
                <th className="th w-8">#</th>
                <th className="th">DESCRIÇÃO</th>
                <th className="th w-24 text-right">QTD</th>
                <th className="th w-24">UN</th>
                <th className="th w-32 text-right">PREÇO UNIT.</th>
                <th className="th w-28 text-right">DESCONTO</th>
                <th className="th w-32 text-right">TOTAL</th>
                <th className="th w-10" />
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, i) => {
                const p = l.product_id ? porId.get(l.product_id) : undefined;
                return (
                  <tr key={l.key} className="align-top">
                    <td className="td pt-3 text-muted">{i + 1}</td>
                    <td className="td">
                      <input aria-label={`Descrição do item ${i + 1}`} list="p-produtos" className="field" maxLength={200}
                             value={l.description} onChange={(e) => muda(l.key, "description", e.target.value)} />
                      {p && (
                        <span className="mt-0.5 block text-[11px] text-accent-ink">
                          {p.sku} no cadastro{p.ultimo ? ` · último preço ${brl(p.ultimo)}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="td">
                      <input aria-label={`Quantidade do item ${i + 1}`} inputMode="decimal" className="field text-right"
                             value={l.quantity} onChange={(e) => muda(l.key, "quantity", e.target.value)} />
                    </td>
                    <td className="td">
                      <select aria-label={`Unidade do item ${i + 1}`} className="field" value={l.unit_id}
                              onChange={(e) => muda(l.key, "unit_id", e.target.value)}>
                        <option value="">—</option>
                        {unidades.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
                      </select>
                    </td>
                    <td className="td">
                      <input aria-label={`Preço do item ${i + 1}`} inputMode="decimal" className="field text-right" placeholder="0,00"
                             value={l.unit_price} onChange={(e) => muda(l.key, "unit_price", e.target.value)} />
                    </td>
                    <td className="td">
                      <input aria-label={`Desconto do item ${i + 1}`} inputMode="decimal" className="field text-right" placeholder="0,00"
                             value={l.discount} onChange={(e) => muda(l.key, "discount", e.target.value)} />
                    </td>
                    <td className="td pt-3 text-right font-mono tabular-nums">
                      {brl(Math.max(0, n(l.quantity) * n(l.unit_price) - n(l.discount)))}
                    </td>
                    <td className="td pt-2.5">
                      {linhas.length > 1 && (
                        <button type="button" aria-label={`Remover item ${i + 1}`} className="text-muted hover:text-danger"
                                onClick={() => setLinhas((ls) => ls.filter((x) => x.key !== l.key))}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-start gap-4 border-t border-line-soft p-4">
          <button type="button" className="btn"
                  onClick={() => setLinhas((ls) => [...ls, { key: Date.now(), product_id: "", description: "", quantity: "1", unit_id: "", unit_price: "", discount: "" }])}>
            <Plus className="h-3.5 w-3.5" /> Adicionar item
          </button>
          <div className="ml-auto grid w-full max-w-[320px] gap-2 text-[12.5px]">
            <div className="flex justify-between"><span className="text-graphite">Itens</span><span className="font-mono">{brl(subtotal)}</span></div>
            <label className="flex items-center justify-between gap-3">
              <span className="text-graphite">Frete</span>
              <input inputMode="decimal" className="field h-8 w-32 text-right" placeholder="0,00" value={cab.freight_amount}
                     onChange={(e) => setCab({ ...cab, freight_amount: e.target.value })} />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span className="text-graphite">Desconto no pedido</span>
              <input inputMode="decimal" className="field h-8 w-32 text-right" placeholder="0,00" value={cab.discount}
                     onChange={(e) => setCab({ ...cab, discount: e.target.value })} />
            </label>
            <div className="flex justify-between border-t border-line-soft pt-2 text-[14px] font-semibold">
              <span>Total do pedido</span><span className="font-mono">{brl(total)}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="card p-4">
        <label className="label" htmlFor="p-obs">Observações para o fornecedor (opcional)</label>
        <textarea id="p-obs" rows={2} maxLength={1000} className="field h-auto py-2" value={cab.notes}
                  onChange={(e) => setCab({ ...cab, notes: e.target.value })} />
      </section>

      <Aviso erro={st.erro} />
      <div className="flex flex-wrap justify-end gap-2">
        <Link href={(inicial.id ? `/interno/compras/pedidos/${inicial.id}` : "/interno/compras/pedidos") as any} className="btn">Voltar</Link>
        <button type="submit" onClick={() => { if (modoRef.current) modoRef.current.value = "0"; }} className="btn" disabled={pend}>
          {pend ? "Salvando…" : "Salvar rascunho"}
        </button>
        <button type="submit" onClick={() => { if (modoRef.current) modoRef.current.value = "1"; }} className="btn btn-primary" disabled={pend}>
          {pend ? "Salvando…" : "Salvar e enviar para aprovação"}
        </button>
      </div>
    </form>
  );
}
