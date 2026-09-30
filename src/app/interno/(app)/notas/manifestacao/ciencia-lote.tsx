"use client";

import { useState } from "react";
import Link from "next/link";
import { EnviarManifestacao } from "./enviar";

type Linha = {
  invoice_id: string; number: string | null; emitter_name: string | null; issued_at: string | null;
  total_amount: number | null; deadline: string; days_left: number;
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

/** Notas só com resumo, dentro do prazo da Ciência: escolher e enviar juntas (até 20). */
export function CienciaEmLote({ notas, podeEnviar }: { notas: Linha[]; podeEnviar: boolean }) {
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const alterna = (id: string) =>
    setMarcadas((m) => (m.includes(id) ? m.filter((x) => x !== id) : m.length >= 20 ? m : [...m, id]));
  const todas = notas.slice(0, 20).map((n) => n.invoice_id);
  const escolhidas = notas.filter((n) => marcadas.includes(n.invoice_id)).map((n) => ({ id: n.invoice_id, numero: n.number }));

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr>
              {podeEnviar && (
                <th className="th w-10">
                  <input type="checkbox" aria-label="Marcar as 20 primeiras"
                         checked={marcadas.length > 0 && todas.every((id) => marcadas.includes(id))}
                         onChange={(e) => setMarcadas(e.target.checked ? todas : [])} />
                </th>
              )}
              <th className="th w-28">NOTA</th>
              <th className="th">EMITENTE</th>
              <th className="th w-28">EMISSÃO</th>
              <th className="th w-32 text-right">VALOR</th>
              <th className="th w-36">CIÊNCIA ATÉ</th>
            </tr>
          </thead>
          <tbody>
            {notas.map((n) => (
              <tr key={n.invoice_id} className="hover:bg-raise">
                {podeEnviar && (
                  <td className="td">
                    <input type="checkbox" aria-label={`Marcar NF ${n.number ?? ""}`} checked={marcadas.includes(n.invoice_id)}
                           onChange={() => alterna(n.invoice_id)} />
                  </td>
                )}
                <td className="td">
                  <Link href={`/interno/notas/${n.invoice_id}` as any} className="font-mono font-semibold hover:text-accent hover:underline">
                    {n.number ?? "s/nº"}
                  </Link>
                </td>
                <td className="td">{n.emitter_name ?? "—"}</td>
                <td className="td whitespace-nowrap">{dataBR(n.issued_at)}</td>
                <td className="td text-right font-mono tabular-nums">{brl(Number(n.total_amount ?? 0))}</td>
                <td className={`td whitespace-nowrap ${n.days_left <= 2 ? "text-danger" : ""}`}>
                  {dataBR(n.deadline)}
                  <span className="block text-[11px] text-muted">
                    {n.days_left === 0 ? "vence hoje" : `${n.days_left} ${n.days_left === 1 ? "dia" : "dias"}`}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {podeEnviar && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line-soft px-4 py-3">
          <span className="text-[12px] text-muted">
            {marcadas.length === 0 ? "Marque as notas (até 20 por envio)." : `${marcadas.length} marcada(s).`}
          </span>
          <div className="ml-auto">
            <EnviarManifestacao tipo="210210" notas={escolhidas} variante="primario"
                                rotulo={`Dar ciência${marcadas.length ? ` (${marcadas.length})` : ""}`}
                                onFeito={() => setMarcadas([])} />
          </div>
        </div>
      )}
    </div>
  );
}
