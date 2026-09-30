"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Ban, Link2, Plus } from "lucide-react";
import { Modal, Aviso } from "@/components/modal";
import { AcoesValidacao } from "./acoes";
import { validarLote, type LoteState } from "./actions";

export type Pend = {
  id: string; supplier_id: string | null; supplier_name: string | null; supplier_code: string | null;
  description: string; unit: string | null; ncm: string | null; ean: string | null; unit_price: number | null;
  items_count: number; last_invoice_id: string | null; last_invoice_number: string | null;
  last_issued_at: string | null; suggested_product_id: string | null; suggested_product: string | null;
};
type Produto = { id: string; sku: string; description: string };
type Unidade = { code: string; name: string };

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const MAX = 50;

export function TabelaValidacao({
  lista, produtos, unidades, podeResolver, podeCriar,
}: { lista: Pend[]; produtos: Produto[]; unidades: Unidade[]; podeResolver: boolean; podeCriar: boolean }) {
  const [marcados, setMarcados] = useState<string[]>([]);
  const [lote, setLote] = useState<null | "criar" | "ligar" | "ignorar">(null);
  // itens que já saíram da lista (depois de resolvidos) deixam de estar marcados
  useEffect(() => {
    setMarcados((m) => m.filter((id) => lista.some((p) => p.id === id)));
  }, [lista]);

  const alterna = (id: string) =>
    setMarcados((m) => (m.includes(id) ? m.filter((x) => x !== id) : m.length >= MAX ? m : [...m, id]));
  const visiveis = lista.slice(0, MAX).map((p) => p.id);
  const todos = marcados.length > 0 && visiveis.every((id) => marcados.includes(id));
  const escolhidos = lista.filter((p) => marcados.includes(p.id));

  return (
    <>
      {podeResolver && (
        <div className={marcados.length > 0
          ? "fixed bottom-4 left-1/2 z-40 flex w-[min(920px,calc(100vw-2rem))] -translate-x-1/2 flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 shadow-xl"
          : "flex flex-wrap items-center gap-2 border-b border-line-soft bg-surface px-4 py-2.5"}>
          <span className="text-[12px] text-muted">
            {marcados.length === 0
              ? `Marque os itens para resolver vários de uma vez (até ${MAX}).`
              : `${marcados.length} ${marcados.length === 1 ? "item marcado" : "itens marcados"}.`}
          </span>
          {marcados.length > 0 && (
            <div className="ml-auto flex flex-wrap gap-1.5">
              {podeCriar && (
                <button type="button" className="btn btn-primary h-8 px-2.5 text-[12px]" onClick={() => setLote("criar")}>
                  <Plus className="h-3.5 w-3.5" /> Criar produtos ({marcados.length})
                </button>
              )}
              <button type="button" className="btn h-8 px-2.5 text-[12px]" onClick={() => setLote("ligar")}>
                <Link2 className="h-3.5 w-3.5" /> Ligar ao mesmo produto
              </button>
              <button type="button" className="btn h-8 px-2.5 text-[12px]" onClick={() => setLote("ignorar")}>
                <Ban className="h-3.5 w-3.5" /> Ignorar
              </button>
              <button type="button" className="btn h-8 px-2.5 text-[12px]" onClick={() => setMarcados([])}>Desmarcar</button>
            </div>
          )}
        </div>
      )}

      <table className="w-full min-w-[1020px] border-collapse">
        <thead>
          <tr>
            {podeResolver && (
              <th className="th w-10">
                <input type="checkbox" aria-label={`Marcar os ${Math.min(MAX, lista.length)} primeiros`} checked={todos}
                       onChange={(e) => setMarcados(e.target.checked ? visiveis : [])} />
              </th>
            )}
            <th className="th">ITEM NA NOTA</th>
            <th className="th w-52">FORNECEDOR</th>
            <th className="th w-28">NCM / UN</th>
            <th className="th w-28 text-right">ÚLT. PREÇO</th>
            <th className="th w-36">ÚLTIMA NOTA</th>
            {podeResolver && <th className="th w-[260px]" />}
          </tr>
        </thead>
        <tbody>
          {lista.map((p) => {
            const marcado = marcados.includes(p.id);
            return (
              <tr key={p.id} className={`align-top hover:bg-raise ${marcado ? "shadow-[inset_3px_0_0_var(--accent)]" : ""}`}>
                {podeResolver && (
                  <td className="td">
                    <input type="checkbox" aria-label={`Marcar ${p.description}`} checked={marcado} onChange={() => alterna(p.id)} />
                  </td>
                )}
                <td className="td">
                  <div className="font-medium">{p.description}</div>
                  <div className="text-[11px] text-muted">
                    código <span className="font-mono">{p.supplier_code ?? "—"}</span>
                    {p.ean && <span className="ml-2 font-mono">EAN {p.ean}</span>}
                    {p.items_count > 1 && <span className="ml-2">· {p.items_count} itens de nota</span>}
                  </div>
                  {p.suggested_product && (
                    <div className="mt-1 text-[11.5px] text-accent-ink">Sugestão pelo EAN: {p.suggested_product}</div>
                  )}
                </td>
                <td className="td text-graphite">
                  {p.supplier_id
                    ? <Link href={`/interno/cadastros/fornecedores/${p.supplier_id}` as any} className="hover:text-accent hover:underline">{p.supplier_name ?? "—"}</Link>
                    : p.supplier_name ?? "—"}
                </td>
                <td className="td font-mono text-[11.5px] text-graphite">
                  {p.ncm ?? "—"}<span className="block text-muted">{p.unit ?? ""}</span>
                </td>
                <td className="td text-right font-mono tabular-nums">{p.unit_price !== null ? brl(Number(p.unit_price)) : "—"}</td>
                <td className="td">
                  {p.last_invoice_id
                    ? <Link href={`/interno/notas/${p.last_invoice_id}` as any} className="hover:text-accent hover:underline">NF-e {p.last_invoice_number}</Link>
                    : "—"}
                  <span className="block text-[11px] text-muted">{dataBR(p.last_issued_at)}</span>
                </td>
                {podeResolver && (
                  <td className="td">
                    <AcoesValidacao item={p} produtos={produtos} unidades={unidades} podeCriar={podeCriar} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {lote && (
        <JanelaLote acao={lote} itens={escolhidos} produtos={produtos} unidades={unidades}
                    onFechar={() => setLote(null)} onFeito={() => setMarcados([])} />
      )}
    </>
  );
}

function JanelaLote({
  acao, itens, produtos, unidades, onFechar, onFeito,
}: {
  acao: "criar" | "ligar" | "ignorar"; itens: Pend[]; produtos: Produto[]; unidades: Unidade[];
  onFechar: () => void; onFeito: () => void;
}) {
  const [st, enviar, pend] = useActionState<LoteState, FormData>(validarLote, {});
  const [texto, setTexto] = useState("");
  const rotulo = (p: Produto) => `${p.sku} — ${p.description}`;
  const escolhido = useMemo(() => produtos.find((p) => rotulo(p) === texto), [texto, produtos]);
  const porSku = useMemo(() => new Map(produtos.map((p) => [p.sku.trim().toUpperCase(), p])), [produtos]);
  // a lista marcada fica congelada na janela (a tabela pode mudar depois do envio)
  const [linhas] = useState(() => itens);
  const [skus, setSkus] = useState<Record<string, string>>(
    () => Object.fromEntries(itens.map((i) => [i.id, (i.supplier_code ?? "").trim().slice(0, 40)]))
  );
  useEffect(() => { if (st.ok) onFeito(); }, [st]); // eslint-disable-line react-hooks/exhaustive-deps

  // códigos repetidos dentro da própria seleção: o primeiro cria, os outros ligam a ele
  const repetidos = useMemo(() => {
    const vistos = new Set<string>(); const rep = new Set<string>();
    for (const l of linhas) {
      const k = (skus[l.id] ?? "").trim().toUpperCase();
      if (!k) continue;
      if (vistos.has(k)) rep.add(l.id); else vistos.add(k);
    }
    return rep;
  }, [linhas, skus]);

  const titulo = acao === "criar" ? `Criar ${linhas.length} produto(s)` : acao === "ligar" ? "Ligar ao mesmo produto" : "Ignorar itens";

  return (
    <Modal title={titulo} onClose={onFechar} width={acao === "criar" ? "max-w-[900px]" : "max-w-[560px]"}>
      {st.ok && st.resumo ? (
        <div className="grid gap-3 px-4 py-4 text-[12.5px]">
          <p>
            {st.resumo.criados > 0 && <><b>{st.resumo.criados}</b> produto(s) criado(s). </>}
            {st.resumo.ligados > 0 && <><b>{st.resumo.ligados}</b> item(ns) ligado(s) a produto existente. </>}
            {st.resumo.ignorados > 0 && <><b>{st.resumo.ignorados}</b> item(ns) ignorado(s). </>}
          </p>
          {st.resumo.falhas.length > 0 && (
            <div className="rounded bg-warn-soft px-3 py-2 text-warn">
              <b>Não foram resolvidos:</b>
              <ul className="mt-1 list-disc pl-5">
                {st.resumo.falhas.map((f, i) => <li key={i}>{f.item} — {f.motivo}</li>)}
              </ul>
            </div>
          )}
          <p className="text-muted">As próximas notas destes fornecedores com estes códigos já entram ligadas.</p>
          <div className="flex justify-end"><button type="button" className="btn" onClick={onFechar}>Fechar</button></div>
        </div>
      ) : (
        <form action={enviar} className="grid gap-3 px-4 py-4">
          <input type="hidden" name="acao" value={acao} />
          {linhas.map((l) => (
            <span key={l.id} hidden>
              <input type="hidden" name="id" value={l.id} />
              <input type="hidden" name={`nome_${l.id}`} value={l.description} />
            </span>
          ))}

          {acao === "criar" && (
            <>
              <p className="text-[12.5px] text-graphite">
                Código, descrição e unidade vêm da nota; ajuste o que precisar. Se o código já existir no cadastro, o item é
                <b> ligado</b> ao produto existente em vez de duplicar.
              </p>
              <div className="max-h-[52vh] overflow-auto rounded border border-line">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="th w-44">CÓDIGO (SKU)</th>
                      <th className="th">DESCRIÇÃO</th>
                      <th className="th w-36">UNIDADE</th>
                      <th className="th w-44">RESULTADO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l) => {
                      const sku = skus[l.id] ?? "";
                      const existe = porSku.get(sku.trim().toUpperCase());
                      const un = unidades.find((u) => u.code === (l.unit ?? "").toUpperCase())?.code ?? "";
                      return (
                        <tr key={l.id} className="align-top">
                          <td className="td">
                            <input name={`sku_${l.id}`} required maxLength={40} className="field h-8 font-mono text-[12px]"
                                   value={sku} onChange={(e) => setSkus((s) => ({ ...s, [l.id]: e.target.value }))}
                                   aria-label={`Código para ${l.description}`} />
                          </td>
                          <td className="td">
                            <input name={`descricao_${l.id}`} required minLength={3} maxLength={200} className="field h-8 text-[12px]"
                                   defaultValue={l.description} aria-label="Descrição" />
                            <span className="text-[11px] text-muted">{l.supplier_name}</span>
                          </td>
                          <td className="td">
                            <select name={`unidade_${l.id}`} className="field h-8 text-[12px]" defaultValue={un} aria-label="Unidade">
                              <option value="">pela nota ({l.unit ?? "—"})</option>
                              {unidades.map((u) => <option key={u.code} value={u.code}>{u.code}</option>)}
                            </select>
                          </td>
                          <td className="td text-[11.5px]">
                            {existe
                              ? <span className="text-info">liga a {existe.sku} — {existe.description.slice(0, 40)}</span>
                              : repetidos.has(l.id)
                              ? <span className="text-info">liga ao criado acima (mesmo código)</span>
                              : <span className="text-accent-ink">cria novo</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {acao === "ligar" && (
            <div>
              <p className="mb-2 text-[12.5px] text-graphite">
                Os {linhas.length} itens marcados passam a ser o mesmo produto do cadastro — útil quando fornecedores
                diferentes vendem a mesma mercadoria com códigos próprios.
              </p>
              <label className="label" htmlFor="lote-produto">Produto</label>
              <input id="lote-produto" list="lote-produtos" className="field" autoFocus required value={texto}
                     onChange={(e) => setTexto(e.target.value)} placeholder="Digite o SKU ou parte da descrição" />
              <datalist id="lote-produtos">{produtos.map((p) => <option key={p.id} value={rotulo(p)} />)}</datalist>
              <input type="hidden" name="produto_id" value={escolhido?.id ?? ""} />
              <ul className="mt-2 max-h-40 overflow-auto text-[11.5px] text-muted">
                {linhas.map((l) => <li key={l.id}>{l.supplier_code ?? "—"} · {l.description}</li>)}
              </ul>
            </div>
          )}

          {acao === "ignorar" && (
            <div>
              <p className="mb-2 text-[12.5px] text-graphite">{linhas.length} itens saem da fila com o mesmo motivo.</p>
              <label className="label" htmlFor="lote-motivo">Por que não entram no cadastro?</label>
              <input id="lote-motivo" name="motivo" required minLength={5} maxLength={500} className="field" autoFocus
                     placeholder="ex.: material de uso interno / serviço / frete" />
            </div>
          )}

          <Aviso erro={st.erro} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={onFechar}>Voltar</button>
            <button type="submit" className="btn btn-primary" disabled={pend || (acao === "ligar" && !escolhido)}>
              {pend ? "Salvando…" : acao === "criar" ? "Criar e ligar" : acao === "ligar" ? "Ligar" : "Ignorar"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
