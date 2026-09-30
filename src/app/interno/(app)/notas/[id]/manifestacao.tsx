import { Card } from "@/components/panels";
import { createClient } from "@/lib/supabase/server";
import { date as dataBR, dateTime } from "@/lib/format";
import { EnviarManifestacao } from "../manifestacao/enviar";
import { EVENTOS, type TipoEvento } from "@/lib/manifestacao";

type Painel = {
  manifestation: string;
  can_manifest: boolean;
  has_cert: boolean;
  deadline_ciencia: string;
  deadline_conclusiva: string;
  options: { tipo: TipoEvento; label: string; ok: boolean; reason: string | null; late: boolean; deadline: string }[];
  events: { tipo: string; label: string; seq: number; at: string | null; description: string | null }[];
  history: { tipo: string; label: string; status: string; cstat: string | null; message: string | null;
             protocol: string | null; at: string; by: string; justification: string | null }[];
};

const ATUAL: Record<string, { rot: string; cls: string }> = {
  nenhuma: { rot: "Sem manifestação", cls: "bg-line-soft text-graphite" },
  ciencia: { rot: "Ciência da Operação", cls: "bg-info-soft text-info" },
  confirmada: { rot: "Operação confirmada", cls: "bg-accent-soft text-accent-ink" },
  desconhecida: { rot: "Operação desconhecida", cls: "bg-danger-soft text-danger" },
  nao_realizada: { rot: "Operação não realizada", cls: "bg-warn-soft text-warn" },
};
const HIST: Record<string, string> = {
  registrado: "text-accent-ink", rejeitado: "text-danger", erro: "text-danger", enviando: "text-muted",
};

/** Card "Manifestação do destinatário" da página da nota. */
export async function ManifestacaoNota({
  companyId, nota,
}: { companyId: string; nota: { id: string; number: string | null; fiscal_status: string } }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("manifest_panel", { _company_id: companyId, _invoice_id: nota.id });
  if (error || !data) {
    if (error && error.code !== "42501") console.error("[nota] manifestação", error);
    return null;
  }
  const p = data as Painel;
  const atual = ATUAL[p.manifestation] ?? ATUAL.nenhuma;
  const hoje = new Date().toISOString().slice(0, 10);
  const conclusiva = ["confirmada", "desconhecida", "nao_realizada"].includes(p.manifestation);
  const podeAgir = p.can_manifest && p.has_cert && nota.fiscal_status === "autorizada";
  const alvo = [{ id: nota.id, numero: nota.number }];

  const nota90 = conclusiva
    ? "A manifestação conclusiva já está registrada; ainda dá para trocá-la por outra dentro do prazo."
    : p.deadline_conclusiva >= hoje
    ? `Manifestação conclusiva até ${dataBR(p.deadline_conclusiva)}. Sem ela, pela regra atual, a operação passa a ser considerada confirmada.`
    : `O prazo da manifestação conclusiva terminou em ${dataBR(p.deadline_conclusiva)}.`;

  return (
    <Card
      title="Manifestação do destinatário"
      note="Eventos da NF-e registrados na SEFAZ pela empresa (pelo sistema ou pela contabilidade)."
      actions={<span className={`badge ${atual.cls}`}>{atual.rot}</span>}
      className="mb-4"
    >
      <div className="grid gap-3 px-4 py-3">
        <p className="text-[12.5px] text-graphite">
          Prazos contados da emissão: Ciência até <b>{dataBR(p.deadline_ciencia)}</b> · Confirmação, Desconhecimento
          ou Operação não Realizada até <b>{dataBR(p.deadline_conclusiva)}</b>. {nota90}
        </p>

        {podeAgir && (
          <div className="flex flex-wrap gap-2">
            {p.options.map((o) => {
              const atrasado = o.late
                ? `O prazo terminou em ${dataBR(o.deadline)}. A SEFAZ deve rejeitar (596), mas você pode tentar.`
                : null;
              return (
                <EnviarManifestacao
                  key={o.tipo}
                  tipo={o.tipo}
                  notas={alvo}
                  aviso={atrasado}
                  variante={o.tipo === "210200" ? "primario" : o.tipo === "210210" ? "normal" : "perigo"}
                  rotulo={EVENTOS[o.tipo].curto}
                  desabilitado={o.ok ? null : o.reason}
                />
              );
            })}
          </div>
        )}
        {!p.can_manifest && (
          <p className="text-[11.5px] text-muted">Só Administrador, Diretoria e Fiscal podem manifestar notas.</p>
        )}
        {p.can_manifest && !p.has_cert && (
          <p className="text-[11.5px] text-warn">Para manifestar pelo sistema, configure o certificado A1 em Consulta SEFAZ.</p>
        )}
        {p.can_manifest && nota.fiscal_status !== "autorizada" && (
          <p className="text-[11.5px] text-muted">Nota {nota.fiscal_status} na SEFAZ: não cabe manifestação.</p>
        )}
      </div>

      {(p.events.length > 0 || p.history.length > 0) && (
        <div className="grid gap-4 border-t border-line-soft px-4 py-3 text-[12.5px] md:grid-cols-2">
          <div>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Registrados na SEFAZ</h4>
            {p.events.length === 0 ? <p className="text-muted">Nenhum ainda.</p> : (
              <ul className="grid gap-1">
                {p.events.map((e, i) => (
                  <li key={i}>
                    <b>{e.label}</b>{e.seq > 1 ? ` (${e.seq}ª)` : ""}
                    <span className="ml-1 text-muted">{e.at ? dateTime(e.at) : ""}</span>
                    {e.description && /enviada pelo sistema/.test(e.description) && (
                      <span className="block text-[11px] text-muted">enviada pelo sistema</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {p.history.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Envios pelo sistema</h4>
              <ul className="grid gap-1.5">
                {p.history.map((h, i) => (
                  <li key={i}>
                    <b>{h.label}</b> · {h.by} · <span className="text-muted">{dateTime(h.at)}</span>
                    <span className={`block text-[11.5px] ${HIST[h.status] ?? ""}`}>
                      {h.status === "registrado"
                        ? `Registrado${h.protocol ? ` — protocolo ${h.protocol}` : ""}${h.cstat === "573" ? " (já existia)" : ""}`
                        : h.status === "enviando" ? "Enviando…" : `${h.cstat ? `${h.cstat} — ` : ""}${h.message ?? "sem resposta"}`}
                    </span>
                    {h.justification && <span className="block text-[11px] text-muted">“{h.justification}”</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
