"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { Aviso } from "@/components/modal";
import { criarCotacao, type CotState } from "../actions";
import type { ProdutoOpcao, UnidadeOpcao } from "../../pedidos/form";

type Forn = { id: string; nome: string; sugerido: boolean };
type Linha = { key: number; product_id: string; description: string; quantity: string; unit_id: string };

export function NovaCotacaoForm({
  requestId, requestNumber, fornecedores, produtos, unidades, itens, hoje,
}: {
  requestId: string | null; requestNumber: string | null; fornecedores: Forn[]; produtos: ProdutoOpcao[]; unidades: UnidadeOpcao[];
  itens: { product_id: string | null; description: string; quantity: number; unit_id: string | null }[]; hoje: string;
}) {
  const [st, acao, pend] = useActionState<CotState, FormData>(criarCotacao, {});
  const [sel, setSel] = useState<Set<string>>(new Set(fornecedores.filter((f) => f.sugerido).slice(0, 5).map((f) => f.id)));
  const [prazo, setPrazo] = useState("");
  const [obs, setObs] = useState("");
  const [filtro, setFiltro] = useState("");
  const [linhas, setLinhas] = useState<Linha[]>(
    (itens.length ? itens : [{ product_id: null, description: "", quantity: 1, unit_id: null }])
      .map((i, k) => ({ key: k + 1, product_id: i.product_id ?? "", description: i.description, quantity: String(i.quantity), unit_id: i.unit_id ?? "" })));
  const porRotulo = useMemo(() => new Map(produtos.map((p) => [`${p.sku} — ${p.description}`, p])), [produtos]);
  const visiveis = fornecedores.filter((f) => !filtro || f.nome.toLowerCase().includes(filtro.toLowerCase()));

  const muda = (key: number, campo: keyof Linha, valor: string) =>
    setLinhas((ls) => ls.map((l) => {
      if (l.key !== key) return l;
      const novo = { ...l, [campo]: valor };
      if (campo === "description") {
        const p = porRotulo.get(valor);
        if (p) { novo.product_id = p.id; novo.description = p.description; if (p.unit_id) novo.unit_id = p.unit_id; }
      }
      return novo;
    }));

  const payload = JSON.stringify({
    request_id: requestId, closes_on: prazo || null, notes: obs || null, suppliers: [...sel],
    items: linhas.filter((l) => l.description.trim()).map((l) => ({ product_id: l.product_id || null, description: l.description, quantity: l.quantity || "0", unit_id: l.unit_id || null })),
  });

  return (
    <form action={acao} className="grid gap-4">
      <input type="hidden" name="payload" value={payload} />
      <section className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3">
          <h3 className="text-[13.5px] font-semibold">Fornecedores ({sel.size})</h3>
          <span className="text-[11.5px] text-muted">Os marcados com ★ já venderam estes itens para a empresa.</span>
          <input aria-label="Filtrar fornecedores" className="field ml-auto h-8 w-56" placeholder="Filtrar" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        </div>
        <div className="grid max-h-64 gap-x-4 overflow-y-auto p-4 sm:grid-cols-2 lg:grid-cols-3">
          {visiveis.map((f) => (
            <label key={f.id} className="flex items-center gap-2 py-1 text-[12.5px]">
              <input type="checkbox" checked={sel.has(f.id)}
                     onChange={(e) => setSel((s) => { const n = new Set(s); e.target.checked ? n.add(f.id) : n.delete(f.id); return n; })} />
              <span>{f.sugerido && <span className="text-warn">★ </span>}{f.nome}</span>
            </label>
          ))}
          {visiveis.length === 0 && <p className="text-[12px] text-muted">Nenhum fornecedor ativo com esse nome.</p>}
        </div>
      </section>

      <section className="card">
        <div className="border-b border-line-soft px-4 py-3"><h3 className="text-[13.5px] font-semibold">Itens a cotar</h3></div>
        <datalist id="c-produtos">{produtos.map((p) => <option key={p.id} value={`${p.sku} — ${p.description}`} />)}</datalist>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead><tr><th className="th w-8">#</th><th className="th">ITEM</th><th className="th w-28 text-right">QTD</th><th className="th w-24">UN</th><th className="th w-10" /></tr></thead>
            <tbody>
              {linhas.map((l, i) => (
                <tr key={l.key}>
                  <td className="td text-muted">{i + 1}</td>
                  <td className="td"><input aria-label={`Item ${i + 1}`} list="c-produtos" className="field" maxLength={200} value={l.description} onChange={(e) => muda(l.key, "description", e.target.value)} /></td>
                  <td className="td"><input aria-label={`Quantidade do item ${i + 1}`} inputMode="decimal" className="field text-right" value={l.quantity} onChange={(e) => muda(l.key, "quantity", e.target.value)} /></td>
                  <td className="td">
                    <select aria-label={`Unidade do item ${i + 1}`} className="field" value={l.unit_id} onChange={(e) => muda(l.key, "unit_id", e.target.value)}>
                      <option value="">—</option>{unidades.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
                    </select>
                  </td>
                  <td className="td">
                    {linhas.length > 1 && <button type="button" aria-label={`Remover item ${i + 1}`} className="text-muted hover:text-danger" onClick={() => setLinhas((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 className="h-4 w-4" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-end gap-3 border-t border-line-soft p-4">
          <button type="button" className="btn" onClick={() => setLinhas((ls) => [...ls, { key: Date.now(), product_id: "", description: "", quantity: "1", unit_id: "" }])}>
            <Plus className="h-3.5 w-3.5" /> Adicionar item
          </button>
          <div className="ml-auto">
            <label className="label" htmlFor="c-prazo">Responder até</label>
            <input id="c-prazo" type="date" min={hoje} className="field" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
          </div>
          <div className="w-full sm:w-80">
            <label className="label" htmlFor="c-obs">Observação (opcional)</label>
            <input id="c-obs" maxLength={1000} className="field" value={obs} onChange={(e) => setObs(e.target.value)} />
          </div>
        </div>
      </section>

      <Aviso erro={st.erro} />
      <div className="flex justify-end gap-2">
        <Link href={(requestId ? `/interno/compras/solicitacoes/${requestId}` : "/interno/compras/cotacoes") as any} className="btn">Voltar</Link>
        <button type="submit" className="btn btn-primary" disabled={pend || sel.size === 0}>{pend ? "Abrindo…" : "Abrir cotação"}</button>
      </div>
      {requestNumber && <p className="text-right text-[11.5px] text-muted">A solicitação {requestNumber} passa para “em cotação”.</p>}
    </form>
  );
}
