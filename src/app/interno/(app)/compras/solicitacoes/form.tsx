"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { Aviso } from "@/components/modal";
import { salvarSolicitacao, type SolState } from "./actions";
import type { Opcao, ProdutoOpcao, UnidadeOpcao } from "../pedidos/form";

type Linha = { key: number; product_id: string; description: string; spec: string; quantity: string; unit_id: string };
export type SolInicial = {
  id?: string; department_id?: string | null; cost_center_id?: string | null; needed_by?: string | null;
  priority?: string; justification?: string | null; notes?: string | null;
  items?: { product_id: string | null; description: string; spec: string | null; quantity: number; unit_id: string | null }[];
};

export function SolicitacaoForm({
  inicial, departamentos, centros, produtos, unidades, hoje,
}: {
  inicial: SolInicial; departamentos: Opcao[]; centros: Opcao[]; produtos: ProdutoOpcao[]; unidades: UnidadeOpcao[]; hoje: string;
}) {
  const [st, acao, pend] = useActionState<SolState, FormData>(salvarSolicitacao, {});
  const modoRef = useRef<HTMLInputElement>(null);
  const [cab, setCab] = useState({
    department_id: inicial.department_id ?? "", cost_center_id: inicial.cost_center_id ?? "",
    needed_by: inicial.needed_by ?? "", priority: inicial.priority ?? "normal",
    justification: inicial.justification ?? "", notes: inicial.notes ?? "",
  });
  const [linhas, setLinhas] = useState<Linha[]>(
    (inicial.items?.length ? inicial.items : [{ product_id: null, description: "", spec: null, quantity: 1, unit_id: null }])
      .map((i, k) => ({ key: k + 1, product_id: i.product_id ?? "", description: i.description, spec: i.spec ?? "", quantity: String(i.quantity), unit_id: i.unit_id ?? "" })));
  const porRotulo = useMemo(() => new Map(produtos.map((p) => [`${p.sku} — ${p.description}`, p])), [produtos]);
  const porId = useMemo(() => new Map(produtos.map((p) => [p.id, p])), [produtos]);

  const muda = (key: number, campo: keyof Linha, valor: string) =>
    setLinhas((ls) => ls.map((l) => {
      if (l.key !== key) return l;
      const novo = { ...l, [campo]: valor };
      if (campo === "description") {
        const p = porRotulo.get(valor);
        if (p) { novo.product_id = p.id; novo.description = p.description; if (p.unit_id) novo.unit_id = p.unit_id; }
        else if (l.product_id && porId.get(l.product_id)?.description !== valor) novo.product_id = "";
      }
      return novo;
    }));

  const payload = JSON.stringify({
    id: inicial.id ?? null, header: cab,
    items: linhas.filter((l) => l.description.trim()).map((l) => ({
      product_id: l.product_id || null, description: l.description, spec: l.spec || null, quantity: l.quantity || "0", unit_id: l.unit_id || null,
    })),
  });

  return (
    <form action={acao} className="grid gap-4">
      <input type="hidden" name="payload" value={payload} />
      <input type="hidden" name="enviar" defaultValue="0" ref={modoRef} />
      <section className="card">
        <div className="border-b border-line-soft px-4 py-3"><h3 className="text-[13.5px] font-semibold">Para quê e para quando</h3></div>
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label" htmlFor="s-dep">Departamento</label>
            <select id="s-dep" className="field" value={cab.department_id} onChange={(e) => setCab({ ...cab, department_id: e.target.value })}>
              <option value="">—</option>
              {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="s-cc">Centro de custo</label>
            <select id="s-cc" className="field" value={cab.cost_center_id} onChange={(e) => setCab({ ...cab, cost_center_id: e.target.value })}>
              <option value="">—</option>
              {centros.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="s-quando">Preciso até</label>
            <input id="s-quando" type="date" min={hoje} className="field" value={cab.needed_by} onChange={(e) => setCab({ ...cab, needed_by: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="s-pri">Prioridade</label>
            <select id="s-pri" className="field" value={cab.priority} onChange={(e) => setCab({ ...cab, priority: e.target.value })}>
              <option value="baixa">Baixa</option><option value="normal">Normal</option>
              <option value="alta">Alta</option><option value="urgente">Urgente</option>
            </select>
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <label className="label" htmlFor="s-just">Por que precisa (opcional)</label>
            <input id="s-just" maxLength={1000} className="field" placeholder="ex.: reposição do estoque de cimento; obra do cliente X"
                   value={cab.justification} onChange={(e) => setCab({ ...cab, justification: e.target.value })} />
          </div>
        </div>
      </section>

      <section className="card">
        <div className="border-b border-line-soft px-4 py-3"><h3 className="text-[13.5px] font-semibold">Itens</h3></div>
        <datalist id="s-produtos">{produtos.map((p) => <option key={p.id} value={`${p.sku} — ${p.description}`} />)}</datalist>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead><tr>
              <th className="th w-8">#</th><th className="th">O QUE PRECISA</th><th className="th w-64">DETALHES (marca, medida…)</th>
              <th className="th w-24 text-right">QTD</th><th className="th w-24">UN</th><th className="th w-10" />
            </tr></thead>
            <tbody>
              {linhas.map((l, i) => (
                <tr key={l.key} className="align-top">
                  <td className="td pt-3 text-muted">{i + 1}</td>
                  <td className="td">
                    <input aria-label={`Item ${i + 1}`} list="s-produtos" className="field" maxLength={200}
                           value={l.description} onChange={(e) => muda(l.key, "description", e.target.value)} />
                    {l.product_id && <span className="mt-0.5 block text-[11px] text-accent-ink">{porId.get(l.product_id)?.sku} no cadastro</span>}
                  </td>
                  <td className="td"><input aria-label={`Detalhes do item ${i + 1}`} className="field" maxLength={500} value={l.spec} onChange={(e) => muda(l.key, "spec", e.target.value)} /></td>
                  <td className="td"><input aria-label={`Quantidade do item ${i + 1}`} inputMode="decimal" className="field text-right" value={l.quantity} onChange={(e) => muda(l.key, "quantity", e.target.value)} /></td>
                  <td className="td">
                    <select aria-label={`Unidade do item ${i + 1}`} className="field" value={l.unit_id} onChange={(e) => muda(l.key, "unit_id", e.target.value)}>
                      <option value="">—</option>{unidades.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
                    </select>
                  </td>
                  <td className="td pt-2.5">
                    {linhas.length > 1 && (
                      <button type="button" aria-label={`Remover item ${i + 1}`} className="text-muted hover:text-danger"
                              onClick={() => setLinhas((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 className="h-4 w-4" /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-line-soft p-4">
          <button type="button" className="btn" onClick={() => setLinhas((ls) => [...ls, { key: Date.now(), product_id: "", description: "", spec: "", quantity: "1", unit_id: "" }])}>
            <Plus className="h-3.5 w-3.5" /> Adicionar item
          </button>
        </div>
      </section>

      <Aviso erro={st.erro} />
      <div className="flex flex-wrap justify-end gap-2">
        <Link href={(inicial.id ? `/interno/compras/solicitacoes/${inicial.id}` : "/interno/compras/solicitacoes") as any} className="btn">Voltar</Link>
        <button type="submit" onClick={() => { if (modoRef.current) modoRef.current.value = "0"; }} className="btn" disabled={pend}>{pend ? "Salvando…" : "Salvar rascunho"}</button>
        <button type="submit" onClick={() => { if (modoRef.current) modoRef.current.value = "1"; }} className="btn btn-primary" disabled={pend}>{pend ? "Salvando…" : "Enviar ao Compras"}</button>
      </div>
    </form>
  );
}
