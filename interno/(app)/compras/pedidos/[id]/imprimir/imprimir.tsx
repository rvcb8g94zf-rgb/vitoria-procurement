"use client";

import { Printer } from "lucide-react";

export function Imprimir() {
  return (
    <div className="mb-4 flex justify-end print:hidden">
      <button type="button" className="btn btn-primary" onClick={() => window.print()}>
        <Printer className="h-3.5 w-3.5" /> Imprimir ou salvar em PDF
      </button>
    </div>
  );
}
