"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CheckCircle2, Send, XCircle } from "lucide-react";
import { Modal, Aviso } from "@/components/modal";
import { manifestar, type ManifState } from "./actions";

import { EVENTOS, type TipoEvento } from "@/lib/manifestacao";

const SITUACAO = {
  registrado: { rot: "Registrada", cls: "text-accent-ink", icone: CheckCircle2 },
  rejeitado: { rot: "Rejeitada pela SEFAZ", cls: "text-danger", icone: XCircle },
  erro: { rot: "Não enviada", cls: "text-danger", icone: XCircle },
  recusado: { rot: "Não enviada", cls: "text-warn", icone: XCircle },
} as const;

/**
 * Botão + janela de confirmação para enviar um evento de manifestação.
 * Nada vai para a SEFAZ sem a pessoa marcar que conferiu e confirmar.
 */
export function EnviarManifestacao({
  tipo, notas, aviso, variante = "normal", rotulo, desabilitado, onFeito,
}: {
  tipo: TipoEvento;
  notas: { id: string; numero: string | null }[];
  aviso?: string | null;
  variante?: "normal" | "primario" | "perigo";
  rotulo?: string;
  desabilitado?: string | null;
  onFeito?: () => void;
}) {
  const ev = EVENTOS[tipo];
  const [aberto, setAberto] = useState(false);
  const cls = variante === "primario" ? "btn btn-primary" : variante === "perigo" ? "btn text-danger" : "btn";

  return (
    <>
      <button type="button" className={`${cls} h-8 px-2.5 text-[12px]`} disabled={!!desabilitado || notas.length === 0}
              title={desabilitado ?? undefined} onClick={() => setAberto(true)}>
        {rotulo ?? ev.curto}
      </button>
      {aberto && <Janela tipo={tipo} notas={notas} aviso={aviso} onFechar={() => setAberto(false)} onFeito={onFeito} />}
    </>
  );
}

/** A janela nasce a cada abertura: o resultado do envio anterior não fica preso nela. */
function Janela({
  tipo, notas, aviso, onFechar, onFeito,
}: {
  tipo: TipoEvento; notas: { id: string; numero: string | null }[]; aviso?: string | null;
  onFechar: () => void; onFeito?: () => void;
}) {
  const ev = EVENTOS[tipo];
  const [st, acao, pend] = useActionState<ManifState, FormData>(manifestar, {});
  const feito = useRef(onFeito);
  feito.current = onFeito;
  // uma vez por envio concluído (onFeito muda a cada render de quem chama)
  useEffect(() => { if (st.ok) feito.current?.(); }, [st]);
  const plural = notas.length > 1;
  const setAberto = (_: boolean) => onFechar();

  return (
    <>
      {(
        <Modal title={ev.nome} onClose={onFechar} width="max-w-[520px]">
          {st.ok && st.resultados ? (
            <div className="grid gap-3 px-4 py-4">
              <ul className="grid gap-1.5 text-[12.5px]">
                {st.resultados.map((r) => {
                  const s = SITUACAO[r.situacao];
                  const Icone = s.icone;
                  return (
                    <li key={r.invoiceId} className="flex gap-2">
                      <Icone className={`mt-0.5 h-4 w-4 shrink-0 ${s.cls}`} />
                      <span>
                        <b>NF {r.numero ?? "s/nº"}</b> — <span className={s.cls}>{s.rot}</span>
                        <span className="block text-[11.5px] text-muted">{r.mensagem}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              {st.resultados.some((r) => r.situacao === "registrado") && tipo === "210210" && (
                <p className="rounded bg-info-soft px-3 py-2 text-[12px] text-info">
                  O XML completo chega na próxima consulta à SEFAZ (respeitando o intervalo de 1 hora entre consultas).
                </p>
              )}
              {st.resultados.some((r) => r.situacao === "erro") && (
                <p className="text-[11.5px] text-muted">
                  Se a SEFAZ chegou a registrar antes de a resposta se perder, um novo envio volta como “já registrada”.
                </p>
              )}
              <div className="flex justify-end">
                <button type="button" className="btn" onClick={() => setAberto(false)}>Fechar</button>
              </div>
            </div>
          ) : (
            <form action={acao} className="grid gap-3 px-4 py-4">
              <input type="hidden" name="tipo" value={tipo} />
              {notas.map((n) => <input key={n.id} type="hidden" name="nota" value={n.id} />)}
              <p className="text-[12.5px] text-graphite">{ev.explica}</p>
              <p className="text-[12.5px]">
                {plural ? <>Vai para a SEFAZ em nome da empresa, para <b>{notas.length} notas</b>.</>
                        : <>Vai para a SEFAZ em nome da empresa, para a <b>NF {notas[0]?.numero ?? "s/nº"}</b>.</>}{" "}
                Depois de registrado, o evento não se apaga — só pode ser substituído por outra manifestação conclusiva.
              </p>
              {aviso && <p className="rounded bg-warn-soft px-3 py-2 text-[12px] text-warn">{aviso}</p>}
              {tipo === "210240" && (
                <div>
                  <label className="label" htmlFor={`just-${tipo}`}>Justificativa (15 a 255 caracteres)</label>
                  <textarea id={`just-${tipo}`} name="justificativa" required minLength={15} maxLength={255} rows={3}
                            className="field h-auto py-2" placeholder="ex.: mercadoria recusada na entrega por avaria; devolvida no mesmo caminhão" />
                </div>
              )}
              <label className="flex items-start gap-2 text-[12.5px]">
                <input type="checkbox" name="confirmo" value="1" required className="mt-0.5" />
                <span>Conferi {plural ? "as notas" : "a nota"} e quero registrar <b>{ev.nome}</b>.</span>
              </label>
              <Aviso erro={st.erro} />
              <div className="flex justify-end gap-2">
                <button type="button" className="btn" onClick={() => setAberto(false)}>Voltar</button>
                <button type="submit" className="btn btn-primary" disabled={pend}>
                  <Send className="h-3.5 w-3.5" /> {pend ? "Enviando à SEFAZ…" : "Enviar à SEFAZ"}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
