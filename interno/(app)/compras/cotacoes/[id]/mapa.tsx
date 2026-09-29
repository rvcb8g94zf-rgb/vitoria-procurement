"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { Check, Copy, MessageCircle } from "lucide-react";
import { Aviso } from "@/components/modal";
import { salvarRespostas, type CotState } from "../actions";

export type MLinha = { line_no: number; description: string; quantity: number; unit: string | null };
export type MForn = {
  supplier_id: string; nome: string; telefone: string | null; freight_amount: number; lead_days: number | null;
  payment_term_id: string | null; valid_until: string | null; notes: string | null; responded: boolean;
  precos: Record<number, number | null>; selecionados: number[]; texto: string;
};

const n = (s: string) => { const v = Number(String(s).replace(",", ".")); return Number.isFinite(v) ? v : NaN; };
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function Mapa({
  id, linhas, fornecedores, condicoes, editavel, podeGerar,
}: {
  id: string; linhas: MLinha[]; fornecedores: MForn[]; condicoes: { id: string; nome: string }[]; editavel: boolean; podeGerar: boolean;
}) {
  const [st, acao, pend] = useActionState<CotState, FormData>(salvarRespostas, {});
  const modoRef = useRef<HTMLInputElement>(null);
  const [resp, setResp] = useState(() => Object.fromEntries(fornecedores.map((f) => [f.supplier_id, {
    freight_amount: f.freight_amount ? String(f.freight_amount) : "", lead_days: f.lead_days !== null ? String(f.lead_days) : "",
    payment_term_id: f.payment_term_id ?? "", valid_until: f.valid_until ?? "", notes: f.notes ?? "",
    precos: Object.fromEntries(linhas.map((l) => [l.line_no, f.precos[l.line_no] !== null && f.precos[l.line_no] !== undefined ? String(f.precos[l.line_no]) : ""])) as Record<number, string>,
  }])));
  const [copiado, setCopiado] = useState<string | null>(null);

  const preco = (sid: string, ln: number) => { const v = n(resp[sid].precos[ln]); return resp[sid].precos[ln] === "" || Number.isNaN(v) ? null : v; };
  const menor = useMemo(() => Object.fromEntries(linhas.map((l) => {
    let best: string | null = null; let bv = Infinity;
    for (const f of fornecedores) { const v = preco(f.supplier_id, l.line_no); if (v !== null && v < bv) { bv = v; best = f.supplier_id; } }
    return [l.line_no, best];
  })), [resp, linhas, fornecedores]); // eslint-disable-line react-hooks/exhaustive-deps

  const inicialEscolha = Object.fromEntries(linhas.map((l) => [l.line_no,
    fornecedores.find((f) => f.selecionados.includes(l.line_no))?.supplier_id ?? null]));
  const [escolha, setEscolha] = useState<Record<number, string | null>>(inicialEscolha);
  const escolhido = (ln: number) => escolha[ln] ?? menor[ln] ?? null;

  const totalForn = (sid: string) => {
    let s = 0; let c = 0;
    for (const l of linhas) { const v = preco(sid, l.line_no); if (v !== null) { s += v * l.quantity; c++; } }
    const fr = n(resp[sid].freight_amount); return { s: s + (Number.isNaN(fr) ? 0 : fr), c };
  };
  const vencedores = new Set(linhas.map((l) => escolhido(l.line_no)).filter(Boolean) as string[]);
  const totalEscolha = linhas.reduce((s, l) => { const sid = escolhido(l.line_no); const v = sid ? preco(sid, l.line_no) : null; return s + (v ?? 0) * l.quantity; }, 0)
    + [...vencedores].reduce((s, sid) => { const fr = n(resp[sid].freight_amount); return s + (Number.isNaN(fr) ? 0 : fr); }, 0);
  const semPreco = linhas.filter((l) => !escolhido(l.line_no)).length;

  const payload = JSON.stringify({
    respostas: fornecedores.map((f) => ({ supplier_id: f.supplier_id, ...resp[f.supplier_id],
      prices: linhas.map((l) => ({ line_no: l.line_no, unit_price: resp[f.supplier_id].precos[l.line_no].replace(",", ".") })) })),
    escolha: linhas.filter((l) => escolhido(l.line_no)).map((l) => ({ line_no: l.line_no, supplier_id: escolhido(l.line_no) })),
  });
  const setR = (sid: string, campo: string, v: string) => setResp((r) => ({ ...r, [sid]: { ...r[sid], [campo]: v } }));
  const setP = (sid: string, ln: number, v: string) => setResp((r) => ({ ...r, [sid]: { ...r[sid], precos: { ...r[sid].precos, [ln]: v } } }));

  return (
    <form action={acao} className="grid gap-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="payload" value={payload} />
      <input type="hidden" name="gerar" defaultValue="0" ref={modoRef} />
      <section className="card">
        <div className="border-b border-line-soft px-4 py-3">
          <h3 className="text-[13.5px] font-semibold">Mapa comparativo</h3>
          <p className="mt-0.5 text-[11.5px] text-muted">
            {editavel ? "Digite o preço unitário que cada fornecedor passou. O menor de cada item fica em verde; clique na célula para escolher outro." : "Preços e fornecedores escolhidos quando a cotação foi encerrada."}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{ minWidth: 380 + fornecedores.length * 190 }}>
            <thead>
              <tr>
                <th className="th sticky left-0 z-10 w-64 bg-raise">ITEM</th>
                <th className="th w-24 text-right">QTD</th>
                {fornecedores.map((f) => (
                  <th key={f.supplier_id} className="th w-[190px] align-top normal-case tracking-normal">
                    <div className="text-[12px] font-semibold text-ink">{f.nome}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <button type="button" className="btn h-6 px-1.5 text-[10.5px]"
                              onClick={async () => { await navigator.clipboard.writeText(f.texto); setCopiado(f.supplier_id); setTimeout(() => setCopiado(null), 2000); }}>
                        <Copy className="h-3 w-3" /> {copiado === f.supplier_id ? "Copiado!" : "Copiar pedido"}
                      </button>
                      {f.telefone && (
                        <a className="btn h-6 px-1.5 text-[10.5px]" target="_blank" rel="noopener noreferrer"
                           href={`https://wa.me/55${f.telefone}?text=${encodeURIComponent(f.texto)}`}>
                          <MessageCircle className="h-3 w-3" /> WhatsApp
                        </a>
                      )}
                    </div>
                    {editavel && (
                      <button type="button" className="mt-1 text-[10.5px] font-medium text-accent-ink hover:underline"
                              onClick={() => setEscolha(Object.fromEntries(linhas.map((l) => [l.line_no, preco(f.supplier_id, l.line_no) !== null ? f.supplier_id : escolha[l.line_no] ?? null])))}>
                        Tudo com este
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.line_no}>
                  <td className="td sticky left-0 z-10 bg-surface">{l.line_no}. {l.description}</td>
                  <td className="td text-right font-mono tabular-nums">{l.quantity.toLocaleString("pt-BR")} <span className="text-[11px] text-muted">{l.unit ?? ""}</span></td>
                  {fornecedores.map((f) => {
                    const v = preco(f.supplier_id, l.line_no);
                    const eMenor = menor[l.line_no] === f.supplier_id;
                    const eEsc = escolhido(l.line_no) === f.supplier_id;
                    return (
                      <td key={f.supplier_id} className={`td ${eEsc ? "bg-accent-soft" : ""}`}>
                        {editavel ? (
                          <div className="flex items-center gap-1">
                            <input aria-label={`Preço de ${f.nome} para o item ${l.line_no}`} inputMode="decimal" placeholder="—"
                                   className={`field h-8 text-right ${eMenor ? "border-accent text-accent-ink" : ""}`}
                                   value={resp[f.supplier_id].precos[l.line_no]} onChange={(e) => setP(f.supplier_id, l.line_no, e.target.value)} />
                            <button type="button" aria-label={`Escolher ${f.nome} para o item ${l.line_no}`} disabled={v === null}
                                    className={`grid h-8 w-7 shrink-0 place-items-center rounded ${eEsc ? "bg-accent text-white" : "border border-line text-muted hover:text-ink"} disabled:opacity-30`}
                                    onClick={() => setEscolha((e) => ({ ...e, [l.line_no]: f.supplier_id }))}>
                              <Check className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className={`text-right font-mono tabular-nums ${eEsc ? "font-semibold text-accent-ink" : ""}`}>{v !== null ? brl(v) : "—"}</div>
                        )}
                        {v !== null && <div className="mt-0.5 text-right text-[10.5px] text-muted">{brl(v * l.quantity)}</div>}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {[
                { rot: "Frete", campo: "freight_amount", tipo: "dinheiro" },
                { rot: "Prazo de entrega (dias)", campo: "lead_days", tipo: "int" },
                { rot: "Validade da proposta", campo: "valid_until", tipo: "data" },
              ].map((c) => (
                <tr key={c.campo} className="bg-raise">
                  <td className="td sticky left-0 z-10 bg-raise text-graphite" colSpan={2}>{c.rot}</td>
                  {fornecedores.map((f) => (
                    <td key={f.supplier_id} className="td">
                      {editavel ? (
                        <input aria-label={`${c.rot} de ${f.nome}`} type={c.tipo === "data" ? "date" : "text"} inputMode={c.tipo === "data" ? undefined : "decimal"}
                               className="field h-8 text-right" value={(resp[f.supplier_id] as any)[c.campo]} onChange={(e) => setR(f.supplier_id, c.campo, e.target.value)} />
                      ) : <div className="text-right">{(resp[f.supplier_id] as any)[c.campo] || "—"}</div>}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="bg-raise">
                <td className="td sticky left-0 z-10 bg-raise text-graphite" colSpan={2}>Condição de pagamento</td>
                {fornecedores.map((f) => (
                  <td key={f.supplier_id} className="td">
                    {editavel ? (
                      <select aria-label={`Condição de ${f.nome}`} className="field h-8" value={resp[f.supplier_id].payment_term_id} onChange={(e) => setR(f.supplier_id, "payment_term_id", e.target.value)}>
                        <option value="">—</option>{condicoes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                      </select>
                    ) : <div className="text-right">{condicoes.find((c) => c.id === resp[f.supplier_id].payment_term_id)?.nome ?? "—"}</div>}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="td sticky left-0 z-10 bg-surface font-semibold" colSpan={2}>Total da proposta</td>
                {fornecedores.map((f) => {
                  const t = totalForn(f.supplier_id);
                  return (
                    <td key={f.supplier_id} className="td text-right">
                      <div className="font-mono font-semibold tabular-nums">{t.c ? brl(t.s) : "—"}</div>
                      <div className="text-[10.5px] text-muted">{t.c}/{linhas.length} itens cotados</div>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {editavel && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="mr-auto text-[12.5px] text-graphite">
            Escolha atual: <b className="font-mono">{brl(totalEscolha)}</b> em {vencedores.size} pedido(s)
            {semPreco > 0 && <span className="text-warn"> · {semPreco} item(ns) sem preço ficam de fora</span>}
          </span>
          <Aviso erro={st.erro} />
          {st.ok && st.msg && <span role="status" className="text-[12px] text-accent-ink">{st.msg}</span>}
          <button type="submit" onClick={() => { if (modoRef.current) modoRef.current.value = "0"; }} className="btn" disabled={pend}>{pend ? "Salvando…" : "Salvar respostas"}</button>
          {podeGerar && (
            <button type="submit" onClick={() => { if (modoRef.current) modoRef.current.value = "1"; }} className="btn btn-primary" disabled={pend || vencedores.size === 0}>
              {pend ? "Gerando…" : `Encerrar e gerar ${vencedores.size} pedido(s)`}
            </button>
          )}
        </div>
      )}
    </form>
  );
}
