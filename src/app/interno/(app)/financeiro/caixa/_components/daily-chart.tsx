"use client";

import { useEffect, useRef, useState } from "react";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const COMPACT = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Escala com números redondos: 0, 2 mil, 4 mil… */
function niceScale(max: number, count = 4) {
  if (max <= 0) return { top: 1, ticks: [0, 1] };
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
  return { top, ticks };
}

/** Coluna com topo arredondado (4px) e base reta, crescendo da linha zero. */
function columnPath(x: number, w: number, yTop: number, yBase: number) {
  const h = yBase - yTop;
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${yBase}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${yBase}Z`;
}

/**
 * Pedidos pagos por dia. Uma série, uma cor. O maior dia leva rótulo
 * direto; os demais valores aparecem ao passar o mouse ou focar a coluna
 * — e todos estão na tabela diária logo abaixo do gráfico.
 */
export function DailyChart({ points, title }: { points: { date: string; value: number }[]; title: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = 230, padL = 58, padR = 10, padT = 24, padB = 26;
  const plotW = width - padL - padR;
  const plotH = H - padT - padB;
  const maxV = Math.max(0, ...points.map((p) => p.value));
  const { top, ticks } = niceScale(maxV);
  const band = plotW / Math.max(points.length, 1);
  const barW = Math.max(2, Math.min(24, band - 2));
  const y = (v: number) => padT + plotH - (Math.max(0, v) / top) * plotH;
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(plotW / 46))));
  const maxIdx = points.findIndex((p) => p.value === maxV);
  const cur = active !== null ? points[active] : null;
  const curX = active !== null ? padL + band * active + band / 2 : 0;

  return (
    <div ref={wrap} className="relative w-full">
      {/* viewBox + largura 100%: na impressão o gráfico acompanha o papel */}
      <svg
        viewBox={`0 0 ${width} ${H}`}
        style={{ width: "100%", height: "auto" }}
        role="img"
        aria-label={`${title}. ${points.length} dias; maior valor ${BRL.format(maxV)}${maxIdx >= 0 ? ` em ${ddmm(points[maxIdx].date)}` : ""}. Valores na tabela abaixo.`}
        className="block"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} style={{ stroke: t === 0 ? "var(--line)" : "var(--line-soft)" }} strokeWidth={1} />
            <text x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end" style={{ fill: "var(--muted)", fontSize: 10.5, fontVariantNumeric: "tabular-nums" }}>
              {t === 0 ? "0" : `R$ ${COMPACT.format(t)}`}
            </text>
          </g>
        ))}

        {points.map((p, i) => {
          const x = padL + band * i + (band - barW) / 2;
          return (
            <path
              key={p.date}
              d={columnPath(x, barW, y(p.value), y(0))}
              style={{ fill: "var(--viz-1)", opacity: active === null || active === i ? 1 : 0.55, transition: "opacity 120ms" }}
            />
          );
        })}

        {maxIdx >= 0 && points.length > 1 && (
          <text
            x={padL + band * maxIdx + band / 2}
            y={y(maxV) - 6}
            textAnchor="middle"
            style={{ fill: "var(--graphite)", fontSize: 10.5, fontWeight: 600 }}
          >
            R$ {COMPACT.format(maxV)}
          </text>
        )}

        {points.map((p, i) =>
          i % labelEvery === 0 ? (
            <text key={p.date} x={padL + band * i + band / 2} y={H - 8} textAnchor="middle"
                  style={{ fill: "var(--muted)", fontSize: 10.5, fontVariantNumeric: "tabular-nums" }}>
              {ddmm(p.date)}
            </text>
          ) : null
        )}

        {/* alvo de toque maior que a coluna: a faixa inteira do dia */}
        {points.map((p, i) => (
          <rect
            key={p.date}
            x={padL + band * i}
            y={padT}
            width={band}
            height={plotH}
            fill="transparent"
            tabIndex={0}
            aria-label={`${ddmm(p.date)}: ${BRL.format(p.value)}`}
            onPointerEnter={() => setActive(i)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            className="cursor-default outline-none focus-visible:[stroke:var(--accent)] focus-visible:[stroke-width:1.5px]"
          />
        ))}
      </svg>

      {cur && (
        <div
          className="pointer-events-none absolute z-10 rounded border border-line bg-surface px-2.5 py-1.5 shadow-sm print:hidden"
          style={{
            left: Math.min(Math.max(curX, 70), width - 70),
            top: Math.max(0, y(cur.value) - 52),
            transform: "translateX(-50%)",
          }}
        >
          <div className="font-mono text-[12.5px] font-semibold tabular-nums">{BRL.format(cur.value)}</div>
          <div className="text-[11px] text-muted">{ddmm(cur.date)}</div>
        </div>
      )}
    </div>
  );
}
