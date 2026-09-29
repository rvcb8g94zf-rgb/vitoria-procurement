"use client";

import { useActionState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw } from "lucide-react";
import { consultarAgora, type EstadoConsulta } from "./actions";

/** Botão manual. O servidor é quem decide se pode consultar agora. */
export function ConsultarAgora({ bloqueio }: { bloqueio: string | null }) {
  const [estado, acao, pendente] = useActionState<EstadoConsulta, FormData>(consultarAgora, {});
  const r = estado.resultado;

  const tom =
    !r ? null
    : r.status === "concluida" || r.status === "sem_novidade" ? "ok"
    : r.status === "aguardando" || r.status === "ignorada" ? "espera"
    : "erro";

  return (
    <div>
      <form action={acao}>
        <button type="submit" className="btn btn-primary" disabled={pendente || !!bloqueio}
                title={bloqueio ?? undefined}>
          <RefreshCw className={`h-3.5 w-3.5 ${pendente ? "animate-spin" : ""}`} />
          {pendente ? "Consultando a SEFAZ…" : "Consultar agora"}
        </button>
      </form>
      {bloqueio && !r && (
        <p className="mt-1.5 flex items-center gap-1 text-[11.5px] text-muted">
          <Clock3 className="h-3 w-3" /> {bloqueio}
        </p>
      )}
      {estado.erro && (
        <p role="alert" className="mt-2 rounded bg-danger-soft px-3 py-2 text-[12px] text-danger">{estado.erro}</p>
      )}
      {r && (
        <div role="status" className={`mt-2 flex gap-2 rounded px-3 py-2 text-[12px] ${
          tom === "ok" ? "bg-accent-soft text-accent-ink" : tom === "espera" ? "bg-warn-soft text-warn" : "bg-danger-soft text-danger"}`}>
          {tom === "ok" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            : tom === "espera" ? <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <span>{r.mensagem}</span>
        </div>
      )}
    </div>
  );
}
