"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Wallet } from "lucide-react";
import { Aviso } from "@/components/modal";
import { money } from "@/lib/format";
import { date as dataBR } from "@/lib/format";
import type { PendingInvoiceRow } from "@/lib/financeiro";
import { gerarTitulos, type FormState } from "../contas-a-pagar/actions";

/**
 * Uma nota por linha, com as parcelas que ainda não viraram título.
 * Nada é gerado sozinho: quem escolhe é o financeiro, e gerar duas vezes
 * não duplica — o banco pula o que já existe.
 */
export function GerarTitulos({ notas }: { notas: PendingInvoiceRow[] }) {
  const [marcadas, setMarcadas] = useState<Set<string>>(() => new Set(notas.map((n) => n.invoice_id)));
  const [estado, acao, pendente] = useActionState<FormState, FormData>(gerarTitulos, {});

  const alternar = (id: string) =>
    setMarcadas((s) => {
      const novo = new Set(s);
      if (novo.has(id)) novo.delete(id); else novo.add(id);
      return novo;
    });

  const escolhidas = notas.filter((n) => marcadas.has(n.invoice_id));
  const total = escolhidas.reduce((s, n) => s + n.pending_total, 0);
  const parcelas = escolhidas.reduce((s, n) => s + Math.max(n.pending_count, 1), 0);
  const todas = marcadas.size === notas.length;

  return (
    <form action={acao}>
      {escolhidas.map((n) => <input key={n.invoice_id} type="hidden" name="notas" value={n.invoice_id} />)}

      {estado.ok && estado.mensagem && (
        <div className="mb-4 flex gap-2.5 rounded bg-accent-soft px-3.5 py-3 text-[12.5px] text-accent-ink">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
          <p>{estado.mensagem}</p>
        </div>
      )}
      {estado.erro && <div className="mb-4"><Aviso erro={estado.erro} /></div>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[920px] border-collapse">
          <thead>
            <tr>
              <th className="th w-10">
                <input
                  type="checkbox"
                  aria-label={todas ? "Desmarcar todas" : "Marcar todas"}
                  checked={todas}
                  onChange={() => setMarcadas(todas ? new Set() : new Set(notas.map((n) => n.invoice_id)))}
                />
              </th>
              <th className="th w-28">EMISSÃO</th>
              <th className="th w-28">NOTA</th>
              <th className="th">FORNECEDOR</th>
              <th className="th w-44">PARCELAS PENDENTES</th>
              <th className="th w-36 text-right">VALOR A GERAR</th>
            </tr>
          </thead>
          <tbody>
            {notas.map((n) => (
              <tr key={n.invoice_id} className="align-top hover:bg-raise">
                <td className="td">
                  <input
                    type="checkbox"
                    aria-label={`Gerar títulos da nota ${n.invoice_number ?? ""}`}
                    checked={marcadas.has(n.invoice_id)}
                    onChange={() => alternar(n.invoice_id)}
                  />
                </td>
                <td className="td whitespace-nowrap">{dataBR(n.issued_at)}</td>
                <td className="td whitespace-nowrap font-semibold">{n.invoice_number ?? "s/nº"}</td>
                <td className="td">
                  <div className="min-w-0 truncate">{n.supplier_name ?? n.emitter_name ?? "—"}</div>
                  <div className="text-[11px] text-muted">nota de {money(n.invoice_total)}</div>
                </td>
                <td className="td text-[12px]">
                  {n.duplicates_count === 0 ? (
                    <>
                      1 título único
                      <span className="block text-[11px] text-muted">a nota não trouxe parcelas</span>
                    </>
                  ) : (
                    <>
                      {n.pending_count} de {n.duplicates_count}
                      {n.first_due && (
                        <span className="block text-[11px] text-muted">
                          {n.first_due === n.last_due
                            ? `vence em ${dataBR(n.first_due)}`
                            : `de ${dataBR(n.first_due)} a ${dataBR(n.last_due)}`}
                        </span>
                      )}
                    </>
                  )}
                </td>
                <td className="td text-right font-mono font-semibold tabular-nums">{money(n.pending_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sticky bottom-0 mt-4 flex flex-wrap items-center gap-3 rounded border border-line bg-surface px-4 py-3 shadow-lg">
        <p className="text-[12.5px] text-graphite">
          {escolhidas.length === 0
            ? "Marque as notas que devem virar conta a pagar."
            : <>
                <b>{parcelas}</b> {parcelas === 1 ? "título" : "títulos"} de{" "}
                <b>{escolhidas.length}</b> {escolhidas.length === 1 ? "nota" : "notas"}, somando{" "}
                <b>{money(total)}</b>.
              </>}
        </p>
        <button type="submit" className="btn btn-primary ml-auto" disabled={pendente || escolhidas.length === 0}>
          <Wallet className="h-3.5 w-3.5" />
          {pendente ? "Gerando…" : `Gerar ${parcelas} ${parcelas === 1 ? "título" : "títulos"}`}
        </button>
      </div>
    </form>
  );
}
