"use client";

import { Download, Printer } from "lucide-react";
import { toCsv, type ClosingRow } from "@/lib/caixa";

/** Baixa o CSV (abre direto no Excel em português). */
export function ExportCsvButton({ rows, filename }: { rows: ClosingRow[]; filename: string }) {
  return (
    <button
      type="button"
      className="btn"
      disabled={rows.length === 0}
      onClick={() => {
        const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}
    >
      <Download className="h-3.5 w-3.5" /> Exportar CSV
    </button>
  );
}

/** Impressão do navegador — é também o caminho para salvar em PDF. */
export function PrintButton({ label = "Imprimir ou salvar PDF", primary = true }: { label?: string; primary?: boolean }) {
  return (
    <button type="button" className={primary ? "btn btn-primary" : "btn"} onClick={() => window.print()}>
      <Printer className="h-3.5 w-3.5" /> {label}
    </button>
  );
}
