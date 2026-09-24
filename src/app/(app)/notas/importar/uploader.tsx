"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, Building2, CheckCircle2, Copy, FileCode, Loader2, Package, Upload, X, XCircle,
} from "lucide-react";
import { money, date as dataBR, cnpj as formatarCnpj } from "@/lib/format";
import { analisarNotas, registrarNotas, type PreviewNota, type ResultadoNota } from "./actions";

type Estado = "lendo" | "pronto" | "duplicado" | "erro" | "registrando" | "registrado";

interface Item {
  key: string;
  name: string;
  text: string;
  estado: Estado;
  preview?: PreviewNota;
  result?: ResultadoNota;
  erros?: string[];
}

const MAX_BYTES = 2 * 1024 * 1024;
const LOTE = 5;
const MAX_ARQUIVOS = 200;

/** XML de NF-e costuma vir em UTF-8; alguns emissores mandam ISO-8859-1. */
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

function estadoDaPrevia(p: PreviewNota): Pick<Item, "estado" | "erros"> {
  if (!p.ok) return { estado: "erro", erros: p.errors?.length ? p.errors : ["Não foi possível ler este arquivo."] };
  if (p.existing && p.existing.kind === "completo") return { estado: "duplicado" };
  return { estado: "pronto" };
}

export function Uploader({ empresa, cnpj }: { empresa: string; cnpj: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [arrastando, setArrastando] = useState(false);
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
          const res = await analisarNotas(lote.map(({ name, text }) => ({ name, text })));
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
        novos.push({ key: chave(), name: f.name, text: "", estado: "erro", erros: ["Arquivo maior que 2 MB."] });
        continue;
      }
      novos.push({ key: chave(), name: f.name, text: decodificar(await f.arrayBuffer()), estado: "lendo" });
    }
    setItems((prev) => [...prev, ...novos]);
    await analisar(novos.filter((n) => n.estado === "lendo"));
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
          const res = await registrarNotas(lote.map(({ name, text }) => ({ name, text })));
          lote.forEach((it, k) => {
            const r = res[k];
            if (!r) return;
            atualizar(it.key, {
              result: r,
              estado: r.status === "erro" ? "erro" : r.status === "duplicado" ? "duplicado" : "registrado",
              erros: r.errors,
            });
          });
        } catch {
          lote.forEach((it) => atualizar(it.key, { estado: "erro", erros: ["Falha de conexão ao registrar. Nada foi gravado para este arquivo."] }));
        }
      }
    } finally {
      setOcupado(null);
    }
  }

  const prontos = items.filter((i) => i.estado === "pronto").length;
  const registrados = items.filter((i) => i.estado === "registrado").length;
  const pendencias = items.reduce((s, i) => s + (i.result?.pendencias ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 rounded border border-line bg-surface px-3.5 py-3 text-[12.5px]">
        <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} />
        <p className="text-graphite">
          As notas entram em <b className="text-ink">{empresa}</b>{" "}
          <span className="font-mono text-[11.5px] text-muted">({cnpj})</span>. Para a outra empresa, troque no seletor
          do menu lateral antes de importar.
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
        <p className="mt-2.5 text-[13.5px] font-semibold">Arraste os XMLs aqui</p>
        <p className="mt-1 text-[12px] text-muted">
          Arquivos .xml de NF-e (procNFe). Pode mandar a pasta inteira do mês de uma vez.
        </p>
        <div className="mt-4">
          <button type="button" className="btn btn-primary" onClick={() => input.current?.click()} disabled={ocupado !== null}>
            <FileCode className="h-3.5 w-3.5" /> Selecionar arquivos
          </button>
        </div>
        <input
          ref={input}
          type="file"
          accept=".xml,text/xml,application/xml"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) adicionarArquivos(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {items.length > 0 && (
        <ul className="space-y-3" aria-live="polite">
          {items.map((it) => (
            <li key={it.key}>
              <NotaCard item={it} onRemove={ocupado ? undefined : () => setItems((p) => p.filter((x) => x.key !== it.key))} />
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <div className="sticky bottom-0 z-10 -mx-6 flex flex-wrap items-center gap-3 border-t border-line bg-surface/95 px-6 py-3 backdrop-blur">
          <p className="text-[12.5px] text-graphite">
            {ocupado === "lendo" && "Lendo os XMLs…"}
            {ocupado === "registrando" && "Registrando…"}
            {!ocupado && (prontos > 0
              ? `${prontos} ${prontos === 1 ? "nota pronta" : "notas prontas"} para registrar em ${empresa}.`
              : registrados > 0
                ? `${registrados} ${registrados === 1 ? "nota registrada" : "notas registradas"}${pendencias ? ` · ${pendencias} pendência(s) de cadastro` : ""}.`
                : "Nenhuma nota pronta para registrar.")}
          </p>
          <div className="ml-auto flex gap-2">
            {registrados > 0 && !ocupado && <Link href="/notas" className="btn">Ver notas</Link>}
            {!ocupado && <button type="button" className="btn" onClick={() => setItems([])}>Limpar lista</button>}
            <button type="button" className="btn btn-primary" onClick={registrar} disabled={prontos === 0 || ocupado !== null}>
              {ocupado === "registrando" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Registrar {prontos > 0 ? prontos : ""} {prontos === 1 ? "nota" : "notas"}
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
    pronto: { cls: "bg-info-soft text-info", txt: "Pronta para registrar", icon: <CheckCircle2 className="h-3 w-3" /> },
    registrando: { cls: "bg-line-soft text-graphite", txt: "Registrando", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    registrado: { cls: "bg-accent-soft text-accent-ink", txt: "Registrada", icon: <CheckCircle2 className="h-3 w-3" /> },
    duplicado: { cls: "bg-line-soft text-graphite", txt: "Já importada", icon: <Copy className="h-3 w-3" /> },
    erro: { cls: "bg-danger-soft text-danger", txt: "Não lida", icon: <XCircle className="h-3 w-3" /> },
  };
  const s = mapa[estado];
  return <span className={`badge ${s.cls}`}>{s.icon} {s.txt}</span>;
}

function NotaCard({ item, onRemove }: { item: Item; onRemove?: () => void }) {
  const p = item.preview;
  const lida = p?.ok && p.access_key;
  const itens = p?.items ?? [];
  const semProduto = p?.unmatched_items ?? 0;
  const dups = p?.duplicates ?? [];

  return (
    <div className="card">
      <div className="flex items-center gap-2.5 border-b border-line-soft px-4 py-2.5">
        <FileCode className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.6} />
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

        {lida && (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <h3 className="text-[15px] font-semibold">
                NF-e {p!.number ?? "s/nº"}{p!.series ? `/${p!.series}` : ""}
              </h3>
              <span className="text-[12.5px] text-graphite">{p!.emitter_name}</span>
              <span className="font-mono text-[11.5px] text-muted">{formatarCnpj(p!.emitter_cnpj)}</span>
            </div>
            <p className="mt-0.5 text-[12px] text-muted">
              Emitida em {dataBR(p!.issued_at)}
              {p!.operation ? ` · ${p!.operation}` : ""}
            </p>

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px] sm:grid-cols-4">
              {[
                ["Total da nota", money(Number(p!.total_amount ?? 0))],
                ["Produtos", money(Number(p!.products_total ?? 0))],
                ["ICMS-ST", money(Number(p!.icms_st_total ?? 0))],
                ["Itens", `${itens.length}${semProduto ? ` · ${semProduto} sem cadastro` : ""}`],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[11px] text-muted">{k}</dt>
                  <dd className="font-mono font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>

            <p className="mt-3 flex items-center gap-1.5 text-[12px]">
              {p!.supplier ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-accent-ink" />
                  <span className="text-accent-ink">Fornecedor no cadastro: {p!.supplier.name}</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-3.5 w-3.5 text-warn" />
                  <span className="text-warn">Fornecedor não cadastrado — vira pendência para validação.</span>
                </>
              )}
            </p>

            {semProduto > 0 && (
              <p className="mt-1 flex items-center gap-1.5 text-[12px] text-warn">
                <Package className="h-3.5 w-3.5" />
                {semProduto} {semProduto === 1 ? "item sem produto ligado" : "itens sem produto ligado"} ao cadastro.
              </p>
            )}

            {dups.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {dups.map((d) => (
                  <span key={d.seq} className="rounded-full border border-line px-2.5 py-0.5 text-[11.5px] text-graphite">
                    {d.number ?? `parcela ${d.seq}`} · {dataBR(d.due_date)} ·{" "}
                    <b className="font-mono font-medium tabular-nums text-ink">{money(Number(d.amount))}</b>
                  </span>
                ))}
              </div>
            )}

            {(p!.warnings?.length ?? 0) > 0 && (
              <ul className="mt-2 space-y-0.5 text-[11.5px] text-warn">
                {p!.warnings.map((w) => <li key={w}>• {w}</li>)}
              </ul>
            )}
          </>
        )}

        {item.estado === "duplicado" && (
          <p className="mt-3 rounded-sm bg-line-soft px-3 py-2 text-[12px] text-graphite">
            Esta nota já está no sistema — não será gravada de novo.{" "}
            {(item.result?.id ?? p?.existing?.id) && (
              <Link href={`/notas/${item.result?.id ?? p?.existing?.id}`} className="font-medium text-accent hover:underline">
                Abrir a nota
              </Link>
            )}
          </p>
        )}

        {item.estado === "registrado" && item.result?.id && (
          <p className="mt-3 text-[12px]">
            <Link href={`/notas/${item.result.id}`} className="font-medium text-accent hover:underline">
              Abrir a nota registrada
            </Link>
            {item.result.pendencias ? (
              <span className="ml-2 text-warn">
                {item.result.pendencias} {item.result.pendencias === 1 ? "pendência de cadastro" : "pendências de cadastro"}
              </span>
            ) : null}
          </p>
        )}
      </div>
    </div>
  );
}
