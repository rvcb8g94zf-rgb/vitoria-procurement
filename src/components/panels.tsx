/**
 * Peças de layout usadas pelas telas de dados (caixa, notas, financeiro).
 * Ficam aqui para que todas as listas tenham o mesmo desenho.
 */

/** Linha de indicadores. As divisórias são sombras de 1px cortadas pela
 *  borda do contêiner: uma última linha incompleta fica em branco. */
export function KpiRow({ items }: { items: { label: string; value: string; note?: string; tone?: "warn" }[] }) {
  return (
    <div
      className="kpi-grid mb-4 grid overflow-hidden rounded border border-line bg-surface"
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(140px, 1fr))` }}
    >
      {items.map((k) => (
        <div key={k.label} className="px-4 py-3.5" style={{ boxShadow: "1px 0 0 0 var(--line), 0 1px 0 0 var(--line)" }}>
          <div className="text-[11px] font-medium text-muted">{k.label}</div>
          <div className={`kpi-value mt-1.5 font-display text-[20px] font-semibold tracking-tight ${k.tone === "warn" ? "text-warn" : ""}`}>
            {k.value}
          </div>
          {k.note && <div className="mt-0.5 text-[11px] text-muted">{k.note}</div>}
        </div>
      ))}
    </div>
  );
}

export function Card({
  title, note, actions, children, className = "",
}: {
  title: string;
  note?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      <div className="card-head flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3">
        <div>
          <h3 className="text-[13.5px] font-semibold">{title}</h3>
          {note && <p className="mt-0.5 text-[11.5px] text-muted">{note}</p>}
        </div>
        {actions && <div className="ml-auto flex gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
