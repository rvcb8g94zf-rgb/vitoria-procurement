"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

/**
 * Janela simples usada pelas ações das listas. Fecha no Esc e no clique
 * fora; o conteúdo vem de quem chama, normalmente um <form>.
 */
export function Modal({
  title, onClose, children, width = "max-w-[460px]",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label={title}
           className={`card mt-10 w-full ${width} shadow-xl`}>
        <div className="flex items-center gap-2 border-b border-line-soft px-4 py-3">
          <h3 className="text-[13.5px] font-semibold">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Fechar"
                  className="ml-auto text-muted hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Aviso({ erro }: { erro?: string }) {
  if (!erro) return null;
  return (
    <p role="alert" className="rounded bg-danger-soft px-3 py-2 text-[12px] text-danger">{erro}</p>
  );
}
