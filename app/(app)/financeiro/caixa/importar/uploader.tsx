"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, Building2, CheckCircle2, ClipboardPaste, Copy, FileText, Loader2, Upload, X, XCircle,
} from "lucide-react";
import { money } from "@/lib/format";
import { dateBR, dateTimeBR, duration, timeBR, weekdayBR } from "@/lib/caixa";
import { analisarRelatorios, registrarRelatorios, type PreviewItem, type RegisterItem } from "../actions";

type Estado = "lendo" | "pronto" | "duplicado" | "erro" | "registrando" | "registrado";

interface Item {
  key: string;
  name: string;
  text: string;
  estado: Estado;
  preview?: PreviewItem;
  result?: RegisterItem;
  erros?: string[];
}

const MAX_BYTES = 64 * 1024;
const LOTE = 10;
const MAX_ARQUIVOS = 400;

/** PDV costuma gravar em UTF-8 ou Windows-1252; tenta um, cai no outro. */
function decodificar(buf: ArrayBuffer): string {
  let s: string;
  try {
    s = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    s = new TextDecoder("windows-1252").decode(buf);
  }
  return s.replace(/\u0000/g, "");
}

const chave = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2);

function estadoDaPrevia(p: PreviewItem): Pick<Item, "estado" | "erros"> {
  if (!p.ok) return { estado: "erro", erros: p.errors?.length ? p.errors : ["Não foi possível ler este arquivo."] };
  if (p.duplicate) return { estado: "duplicado" };
  return { estado: "pronto" };
}

export function Uploader({ empresa, cnpj }: { empresa: string; cnpj: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [arrastando, setArrastando] = useState(false);
  const [colar, setColar] = useState(false);
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState<null | "lendo" | "registrando">(null);

  const atualizar = (key: string, patch: Partial<Item>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  async function analisar(novos: Item[]) {
    if (novos.length === 0) return;
    setOcupado("lendo");
    try {
      for (let i = 0; i < novos.length; i += LOTE) {
        const lote = novos.slice(i, i + LOTE);
        try {
          const res = await analisarRelatorios(lote.map(({ name, text }) => ({ name, text })));
          lote.forEach((it, k) => {
            const p = res[k];
            if (p) atualizar(it.key, { preview: p, ...estadoDaPrevia(p) });
          });
        } catch {
          lote.forEach((it) => atualizar(it.key, { estado: "erro", erros: ["Falha de conexão ao ler o arquivo. Tente de novo."] }));
        }
      }
    } finally {
      setOcupado(null);
    }
  }

  async function adicionarArquivos(lista: FileList | File[]) {
    const files = Array.from(lista).slice(0, MAX_ARQUIVOS);
    const novos: Item[] = [];
    for (const f of files) {
      if (f.size > MAX_BYTES) {
        novos.push({ key: chave(), name: f.name, text: "", estado: "erro",
          erros: ["Arquivo grande demais para um relatório de caixa (limite de 64 KB)."] });
        continue;
      }
      novos.push({ key: chave(), name: f.name, text: decodificar(await f.arrayBuffer()), estado: "lendo" });
    }
    setItems((prev) => [...prev, ...novos]);
    await analisar(novos.filter((n) => n.estado === "lendo"));
  }

  async function lerTextoColado() {
    const t = texto.replace(/\u0000/g, "").trim();
    if (!t) return;
    const novo: Item = { key: chave(), name: "Texto colado", text: t, estado: "lendo" };
    setItems((prev) => [...prev, novo]);
    setTexto("");
    setColar(false);
    await analisar([novo]);
  }

  async function registrar() {
    const prontos = items.filter((i) => i.estado === "pronto");
    if (prontos.length === 0) return;
    setOcupado("registrando");
    prontos.forEach((p) => atualizar(p.key, { estado: "registrando" }));
    try {
      for (let i = 0; i < prontos.length; i += LOTE) {
        const lote = prontos.slice(i, i + LOTE);
        try {
          const res = await registrarRelatorios(lote.map(({ name, text }) => ({ name, text })));
          lote.forEach((it, k) => {
            const r = res[k];
            if (!r) return;
            atualizar(it.key, {
              result: r,
              estado: r.status === "registrado" ? "registrado" : r.status === "duplicado" ? "duplicado" : "erro",
              erros: r.errors,
            });
          });
        } catch {
          lote.forEach((it) => atualizar(it.key, { estado: "erro", erros: ["Falha de conexão ao registrar. Nada foi gravado para este arquivo — tente de novo."] }));
        }
      }
    } finally {
      setOcupado(null);
    }
  }

  const prontos = items.filter((i) => i.estado === "pronto").length;
  const registrados = items.filter((i) => i.estado === "registrado").length;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 rounded border border-line bg-surface px-3.5 py-3 text-[12.5px]">
        <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} />
        <p className="text-graphite">
          Os fechamentos serão registrados em <b className="text-ink">{empresa}</b>{" "}
          <span className="font-mono text-[11.5px] text-muted">({cnpj})</span>. Para outra empresa, troque no seletor do
          menu lateral antes de importar.
        </p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          if (e.dataTransfer.files?.length) adicionarArquivos(e.dataTransfer.files);
        }}
        className={`rounded border-[1.5px] border-dashed px-6 py-9 text-center transition-colors ${
          arrastando ? "border-accent bg-accent-soft" : "border-line bg-surface"
        }`}
      >
        <Upload className="mx-auto h-6 w-6 text-muted" strokeWidth={1.6} />
        <p className="mt-2.5 text-[13.5px] font-semibold">Arraste o relatório aqui</p>
        <p className="mt-1 text-[12px] text-muted">Arquivo de texto do fechamento (.txt). Pode enviar vários dias de uma vez.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button type="button" className="btn btn-primary" onClick={() => input.current?.click()} disabled={ocupado !== null}>
            <FileText className="h-3.5 w-3.5" /> Selecionar arquivos
          </button>
          <button type="button" className="btn" onClick={() => setColar((v) => !v)} aria-expanded={colar}>
            <ClipboardPaste className="h-3.5 w-3.5" /> Colar o texto
          </button>
        </div>
        <input
          ref={input}
          type="file"
          accept=".txt,text/plain"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) adicionarArquivos(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {colar && (
        <div className="card p-4">
          <label className="label" htmlFor="colar">Cole aqui o conteúdo do relatório de caixa</label>
          <textarea
            id="colar"
            rows={10}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            className="field h-auto py-2 font-mono text-[12px]"
            placeholder={"RELATORIO DE CAIXA\n------------------------------\nDATA DE ABERTURA  : ..."}
          />
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn btn-primary" onClick={lerTextoColado} disabled={!texto.trim() || ocupado !== null}>
              Ler texto
            </button>
            <button type="button" className="btn" onClick={() => { setColar(false); setTexto(""); }}>Cancelar</button>
          </div>
        </div>
      )}

      {items.length > 0 && (
        <ul className="space-y-3" aria-live="polite">
          {items.map((it) => (
            <li key={it.key}>
              <ItemCard item={it} onRemove={ocupado ? undefined : () => setItems((p) => p.filter((x) => x.key !== it.key))} />
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <div className="sticky bottom-0 z-10 -mx-6 flex flex-wrap items-center gap-3 border-t border-line bg-surface/95 px-6 py-3 backdrop-blur">
          <p className="text-[12.5px] text-graphite">
            {ocupado === "lendo" && "Lendo os arquivos…"}
            {ocupado === "registrando" && "Registrando…"}
            {!ocupado && (prontos > 0
              ? `${prontos} ${prontos === 1 ? "fechamento pronto" : "fechamentos prontos"} para registrar em ${empresa}.`
              : registrados > 0
                ? `${registrados} ${registrados === 1 ? "fechamento registrado" : "fechamentos registrados"}.`
                : "Nenhum arquivo pronto para registrar.")}
          </p>
          <div className="ml-auto flex gap-2">
            {registrados > 0 && !ocupado && (
              <Link href="/financeiro/caixa" className="btn">Ver fechamentos</Link>
            )}
            {!ocupado && (
              <button type="button" className="btn" onClick={() => setItems([])}>Limpar lista</button>
            )}
            <button type="button" className="btn btn-primary" onClick={registrar} disabled={prontos === 0 || ocupado !== null}>
              {ocupado === "registrando" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Registrar {prontos > 0 ? prontos : ""} {prontos === 1 ? "fechamento" : "fechamentos"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Selo({ estado }: { estado: Estado }) {
  const mapa: Record<Estado, { cls: string; txt: string; icon: React.ReactNode }> = {
    lendo: { cls: "bg-line-soft text-graphite", txt: "Lendo", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    pronto: { cls: "bg-info-soft text-info", txt: "Pronto para registrar", icon: <CheckCircle2 className="h-3 w-3" /> },
    registrando: { cls: "bg-line-soft text-graphite", txt: "Registrando", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    registrado: { cls: "bg-accent-soft text-accent-ink", txt: "Registrado", icon: <CheckCircle2 className="h-3 w-3" /> },
    duplicado: { cls: "bg-line-soft text-graphite", txt: "Já importado", icon: <Copy className="h-3 w-3" /> },
    erro: { cls: "bg-danger-soft text-danger", txt: "Não lido", icon: <XCircle className="h-3 w-3" /> },
  };
  const s = mapa[estado];
  return <span className={`badge ${s.cls}`}>{s.icon} {s.txt}</span>;
}

function ItemCard({ item, onRemove }: { item: Item; onRemove?: () => void }) {
  const p = item.preview;
  const lido = p?.ok && p.business_date && p.opened_at && p.closed_at;
  const falhas = (p?.checks ?? []).filter((c) => !c.ok);
  const dup = item.estado === "duplicado" ? (item.result?.status === "duplicado" ? item.result : p?.duplicate) : undefined;

  return (
    <div className="card">
      <div className="flex items-center gap-2.5 border-b border-line-soft px-4 py-2.5">
        <FileText className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.6} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{item.name}</span>
        <Selo estado={item.estado} />
        {onRemove && item.estado !== "registrado" && (
          <button type="button" onClick={onRemove} aria-label={`Remover ${item.name} da lista`}
                  className="grid h-7 w-7 place-items-center rounded-sm text-muted hover:bg-line-soft hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="px-4 py-3">
        {item.estado === "erro" && (
          <ul className="space-y-1 rounded-sm bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
            {(item.erros ?? ["Não foi possível ler este arquivo."]).map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}

        {lido && (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <h3 className="text-[15px] font-semibold">
                Caixa de {dateBR(p.business_date)} <span className="font-normal text-muted">· {weekdayBR(p.business_date!)}</span>
              </h3>
              <span className="text-[12px] text-muted">
                {timeBR(p.opened_at)} → {timeBR(p.closed_at)} · {duration(p.opened_at!, p.closed_at!)} aberto
                {p.operations_count != null && ` · ${p.operations_count} operações`}
              </span>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px] sm:grid-cols-4">
              {[
                ["Pedidos pagos", money(p.receipts_total)],
                ["Soma das formas", money(p.tenders_total)],
                ["Dinheiro", money(p.cash_total)],
                ["Troco na gaveta", money(p.drawer_balance)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[11px] text-muted">{k}</dt>
                  <dd className="font-mono font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>

            {(p.payments?.length ?? 0) > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {p.payments!.map((m) => (
                  <span key={m.code} className="rounded-full border border-line px-2.5 py-0.5 text-[11.5px] text-graphite">
                    {m.label} <b className="font-mono font-medium tabular-nums text-ink">{money(m.amount)}</b>
                  </span>
                ))}
              </div>
            )}

            {p.check_ok ? (
              <p className="mt-3 flex items-center gap-1.5 text-[12px] text-accent-ink">
                <CheckCircle2 className="h-3.5 w-3.5" /> As somas do relatório fecham ({p.checks?.length ?? 0} conferências).
              </p>
            ) : (
              <div className="mt-3 rounded-sm bg-warn-soft px-3 py-2 text-[12px] text-warn">
                <p className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5" /> Divergência na conferência — será registrado com essa marcação.
                </p>
                <ul className="mt-1 space-y-0.5">
                  {falhas.map((c) => (
                    <li key={c.key}>
                      {c.label}: no relatório {money(c.found)}, esperado {money(c.expected)}
                      {" "}(diferença {money(c.found - c.expected)}).
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(p.warnings?.length ?? 0) > 0 && (
              <ul className="mt-2 space-y-0.5 text-[11.5px] text-muted">
                {p.warnings!.map((w) => <li key={w}>• {w}</li>)}
              </ul>
            )}
          </>
        )}

        {dup && (
          <p className="mt-3 rounded-sm bg-line-soft px-3 py-2 text-[12px] text-graphite">
            Este caixa já foi importado em {dateTimeBR(dup.created_at ?? null)}
            {dup.uploaded_by ? ` por ${dup.uploaded_by}` : ""} — não será registrado de novo.{" "}
            {dup.id && <Link href={`/financeiro/caixa/${dup.id}`} className="font-medium text-accent hover:underline">Abrir o registro</Link>}
          </p>
        )}

        {item.estado === "registrado" && item.result?.id && (
          <p className="mt-3 text-[12px]">
            <Link href={`/financeiro/caixa/${item.result.id}`} className="font-medium text-accent hover:underline">
              Abrir o fechamento registrado
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
