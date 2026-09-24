"use client";

import { useMemo, useState } from "react";
import { Clock3, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { money } from "@/lib/format";

type Kind = "full" | "summary" | "cancel";
interface Dup { n: string; due: string; value: number }
interface Nota {
  id: string; vendor: string; date: string; value: number;
  novo: boolean; kind: Kind; items: number | null; dups: Dup[] | null;
}

// Dados fictícios do briefing. Nenhum fornecedor real.
const DADOS: Nota[] = [
  { id: "008.412", vendor: "Hidráulica Horizonte", date: "06/09/2026", value: 3840.5, novo: true, kind: "full", items: 8,
    dups: [{ n: "001", due: "06/10/2026", value: 1280.17 }, { n: "002", due: "05/11/2026", value: 1280.17 }, { n: "003", due: "05/12/2026", value: 1280.16 }] },
  { id: "002.193", vendor: "Conexões Serra Azul", date: "06/09/2026", value: 1275, novo: true, kind: "summary", items: null, dups: null },
  { id: "015.087", vendor: "Elétrica Aurora", date: "05/09/2026", value: 6420.9, novo: false, kind: "full", items: 12,
    dups: [{ n: "001", due: "05/10/2026", value: 3210.45 }, { n: "002", due: "04/11/2026", value: 3210.45 }] },
  { id: "004.726", vendor: "Ferragens Pontal", date: "04/09/2026", value: 890, novo: false, kind: "full", items: 4, dups: [] },
  { id: "011.362", vendor: "Tubos Vale Verde", date: "03/09/2026", value: 2180, novo: false, kind: "cancel", items: 6,
    dups: [{ n: "001", due: "03/10/2026", value: 2180 }] },
  { id: "006.951", vendor: "Distribuidora Sol Nascente", date: "02/09/2026", value: 4567.2, novo: false, kind: "full", items: 10,
    dups: [{ n: "001", due: "02/10/2026", value: 1522.4 }, { n: "002", due: "01/11/2026", value: 1522.4 }, { n: "003", due: "01/12/2026", value: 1522.4 }] },
];

const sem = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function Situacao({ k }: { k: Kind }) {
  if (k === "cancel") return <span className="badge bg-danger-soft text-danger">Cancelada</span>;
  if (k === "summary") return <span className="badge bg-warn-soft text-warn">Somente resumo</span>;
  return <span className="badge bg-accent-soft text-accent-ink">Autorizada</span>;
}

/** Regra 8 do briefing: rótulo documental, sem afirmar saldo em aberto. */
function ResumoDuplicatas({ n }: { n: Nota }) {
  if (n.dups === null) return <span className="text-muted">Aguardando XML</span>;
  if (n.dups.length === 0) return <span className="text-muted">Não informadas</span>;
  return (
    <>
      <span className="font-semibold">{n.dups.length} {n.dups.length === 1 ? "parcela" : "parcelas"}</span>
      <span className="block text-[11px] text-muted">
        {n.kind === "cancel" ? "Nota cancelada" : `1º venc.: ${n.dups[0].due}`}
      </span>
    </>
  );
}

export function ConsultaPreview({ empresa }: { empresa: string }) {
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("all");
  const [aberta, setAberta] = useState<string | null>(DADOS[0].id);

  const lista = useMemo(() => {
    const q = sem(busca.trim());
    return DADOS.filter((d) =>
      sem(`${d.vendor} ${d.id} ${d.id.replaceAll(".", "")}`).includes(q) &&
      (filtro === "all" || (filtro === "new" ? d.novo : d.kind === filtro))
    );
  }, [busca, filtro]);

  const nota = DADOS.find((d) => d.id === aberta) ?? null;

  return (
    <>
      <div className="mb-4 flex items-center gap-2 rounded border border-warn/40 bg-warn-soft px-3.5 py-2.5 text-[12.5px] text-warn">
        <ShieldCheck className="h-4 w-4 shrink-0" strokeWidth={1.6} />
        Preview visual com dados fictícios. Sem certificado, sem conexão com a SEFAZ, sem gravação.
      </div>

      <div className="card mb-4 flex flex-wrap items-center gap-3 border-l-2 border-l-accent px-4 py-3">
        <span className="badge bg-accent-soft text-accent-ink"><Clock3 className="h-3 w-3" /> A cada 3 horas</span>
        <span className="text-[12.5px] text-graphite">Última consulta: hoje, 09:00</span>
        <span className="text-[12.5px] text-muted">Próxima: 12:00 · Brasília</span>
        <button className="btn ml-auto" disabled><RefreshCw className="h-3.5 w-3.5" /> Consultar agora</button>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-3">
        {[
          { l: "Notas no mês", v: "6", s: "Setembro de 2026" },
          { l: "Novas na última consulta", v: "2", s: "Identificadas às 09:00" },
          { l: "Aguardando XML completo", v: "1", s: "Resumo disponível" },
        ].map((k) => (
          <div key={k.l} className="bg-surface px-4 py-3.5">
            <div className="text-[11px] font-medium text-muted">{k.l}</div>
            <div className="mt-1.5 font-display text-[21px] font-semibold tracking-tight">{k.v}</div>
            <div className="mt-0.5 text-[11px] text-muted">{k.s}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-3">
          <h3 className="text-[13.5px] font-semibold">Notas recebidas</h3>
          <span className="badge bg-line-soft text-graphite">NF-e · modelo 55</span>
          <span className="ml-auto text-[11.5px] text-muted">{empresa}</span>
        </div>

        <div className="flex flex-wrap gap-2.5 border-b border-line-soft px-4 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" strokeWidth={1.6} />
            <input value={busca} onChange={(e) => setBusca(e.target.value)}
                   placeholder="Fornecedor ou número da nota" className="field pl-8" aria-label="Buscar nota" />
          </div>
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className="field w-auto" aria-label="Filtrar">
            <option value="all">Todas as notas</option>
            <option value="new">Novas na última consulta</option>
            <option value="summary">Somente resumo</option>
            <option value="cancel">Canceladas</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse">
            <thead>
              <tr>
                <th className="th">FORNECEDOR / NF-E</th>
                <th className="th w-28">EMISSÃO</th>
                <th className="th w-32 text-right">VALOR</th>
                <th className="th w-40">DUPLICATAS</th>
                <th className="th w-36">SITUAÇÃO</th>
                <th className="th w-24" />
              </tr>
            </thead>
            <tbody>
              {lista.map((d) => (
                <tr key={d.id} className="hover:bg-raise">
                  <td className="td">
                    <span className="font-semibold">
                      {d.novo && <span className="mr-1.5 inline-block h-[7px] w-[7px] rounded-full bg-accent" aria-label="Nova" />}
                      {d.vendor}
                    </span>
                    <span className="block text-[11px] text-muted">NF-e {d.id} · Série 1</span>
                  </td>
                  <td className="td">{d.date}</td>
                  <td className="td text-right font-mono">{money(d.value)}</td>
                  <td className="td"><ResumoDuplicatas n={d} /></td>
                  <td className="td"><Situacao k={d.kind} /></td>
                  <td className="td text-right">
                    <button onClick={() => setAberta(d.id === aberta ? null : d.id)} className="btn h-7 px-2.5 text-[12px]">
                      {d.id === aberta ? "Fechar" : "Ver nota"}
                    </button>
                  </td>
                </tr>
              ))}
              {lista.length === 0 && (
                <tr><td className="td text-center text-muted" colSpan={6}>Nenhuma nota encontrada.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {nota && (
          <div className="border-t border-line bg-raise p-4">
            <h3 className="mb-3 text-[15px] font-semibold">NF-e {nota.id}</h3>

            <dl className="mb-5 grid gap-3 text-[12.5px] sm:grid-cols-3">
              {[
                ["Fornecedor", nota.vendor],
                ["Emissão", nota.date],
                ["Valor da nota", money(nota.value)],
                ["Documento", nota.kind === "summary" ? "Resumo da NF-e" : "XML completo"],
                ["Itens", nota.items === null ? "Aguardando XML" : `${nota.items} itens`],
                ["Manifestação", nota.kind === "summary" ? "Pendente" : "Não manifestada"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-muted">{k}</dt>
                  <dd className="mt-0.5 font-medium">{v}</dd>
                </div>
              ))}
            </dl>

            <h4 className="mb-2 text-[13.5px] font-semibold">Duplicatas da nota</h4>

            {nota.dups === null && (
              <p className="text-[12.5px] text-muted">
                Aguardando XML completo para consultar parcelas, valores e vencimentos.
              </p>
            )}

            {nota.dups?.length === 0 && (
              <p className="text-[12.5px] text-muted">
                Esta nota não informa duplicatas no XML. Isso não significa que a compra esteja paga.
              </p>
            )}

            {nota.dups && nota.dups.length > 0 && (
              <>
                {nota.kind === "cancel" && (
                  <p className="mb-2.5 rounded-sm bg-danger-soft px-3 py-2 text-[12px] text-danger">
                    Nota cancelada — duplicatas exibidas apenas como histórico, sem gerar obrigação de pagamento.
                  </p>
                )}
                <div className="overflow-x-auto rounded border border-line bg-surface">
                  <table className="w-full min-w-[480px] border-collapse">
                    <thead>
                      <tr>
                        <th className="th w-24">PARCELA</th>
                        <th className="th w-32">Nº DA DUPLICATA</th>
                        <th className="th w-32">VENCIMENTO</th>
                        <th className="th text-right">VALOR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {nota.dups.map((p, i) => (
                        <tr key={p.n}>
                          <td className="td">{i + 1} de {nota.dups!.length}</td>
                          <td className="td font-mono">{p.n}</td>
                          <td className="td">{p.due}</td>
                          <td className="td text-right font-mono">{money(p.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-raise">
                        <td className="td font-medium" colSpan={3}>Total das duplicatas</td>
                        <td className="td text-right font-mono font-semibold">
                          {money(nota.dups.reduce((s, p) => s + p.value, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p className="mt-2 text-[11.5px] text-muted">
                  Valores informados na nota. Esta consulta não informa quitação bancária — nenhuma parcela é marcada como paga ou em aberto.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      <details className="card mt-4 px-4 py-3">
        <summary className="cursor-pointer text-[12.5px] font-medium text-accent">Histórico de consultas</summary>
        <ul className="mt-2.5 space-y-1.5 text-[12.5px] text-graphite">
          <li>06/09 · 09:00 — 2 novas notas registradas.</li>
          <li>06/09 · 06:00 — Nenhuma nota nova.</li>
          <li>06/09 · 03:00 — Nenhuma nota nova.</li>
        </ul>
      </details>
    </>
  );
}
