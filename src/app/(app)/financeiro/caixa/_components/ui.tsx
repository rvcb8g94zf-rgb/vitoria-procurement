import { AlertTriangle, CheckCircle2, Ban } from "lucide-react";
import { money } from "@/lib/format";
import type { MethodTotal } from "@/lib/caixa";

// Card e KpiRow moram em components/panels: as telas de notas usam os mesmos
export { Card, KpiRow } from "@/components/panels";

/** Selo da conferência: ícone + texto, nunca só cor. */
export function CheckBadge({ ok, cancelled }: { ok: boolean; cancelled?: boolean }) {
  if (cancelled) {
    return (
      <span className="badge bg-line-soft text-graphite">
        <Ban className="h-3 w-3" strokeWidth={2} /> Cancelado
      </span>
    );
  }
  return ok ? (
    <span className="badge bg-accent-soft text-accent-ink">
      <CheckCircle2 className="h-3 w-3" strokeWidth={2} /> Conferido
    </span>
  ) : (
    <span className="badge bg-warn-soft text-warn">
      <AlertTriangle className="h-3 w-3" strokeWidth={2} /> Divergência
    </span>
  );
}

/**
 * Participação de cada forma de pagamento. Uma série só → uma cor só; cada
 * barra tem o valor escrito ao lado, então a tabela é o próprio gráfico.
 */
export function MethodBars({ methods, total, showDays }: { methods: MethodTotal[]; total: number; showDays?: boolean }) {
  if (methods.length === 0) {
    return <p className="py-6 text-center text-[12.5px] text-muted">Nenhuma forma de pagamento no período.</p>;
  }
  const max = Math.max(...methods.map((m) => Math.abs(m.amount)), 0.01);
  return (
    <table className="mbars w-full border-collapse">
      <thead className="sr-only">
        <tr><th>Forma de pagamento</th><th>Participação</th><th>Valor</th><th>Percentual</th></tr>
      </thead>
      <tbody>
        {methods.map((m) => {
          const share = total > 0 ? (m.amount / total) * 100 : 0;
          return (
            <tr key={m.code} className="align-middle">
              <td className="w-[34%] py-2 pr-3 text-[12.5px]">
                <span className="font-medium">{m.label}</span>
                {showDays && (
                  <span className="block text-[11px] text-muted">
                    {m.days} {m.days === 1 ? "dia" : "dias"} com uso
                  </span>
                )}
              </td>
              <td className="py-2 pr-3">
                <div className="h-2 w-full overflow-hidden rounded-r bg-line-soft">
                  <div
                    className="h-2 rounded-r"
                    style={{ width: `${Math.max(0.5, (Math.abs(m.amount) / max) * 100)}%`, background: "var(--viz-1)" }}
                  />
                </div>
              </td>
              <td className="w-[1%] whitespace-nowrap py-2 pr-2 text-right font-mono text-[12px] tabular-nums">{money(m.amount)}</td>
              <td className="w-[1%] whitespace-nowrap py-2 text-right font-mono text-[11.5px] tabular-nums text-muted">
                {share.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
