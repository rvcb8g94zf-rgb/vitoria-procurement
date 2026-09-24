import Link from "next/link";
import { Info, KeyRound } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Card, KpiRow } from "@/components/panels";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { cnpj as cnpjFmt, date as dataBR, dateTime } from "@/lib/format";
import { EnviarCertificado, RemoverCertificado } from "./certificado";
import { ConsultarAgora } from "./consultar";

export const metadata = { title: "Consulta SEFAZ · Vitória Procurement" };
// a action "consultar agora" roda nesta rota e fala com a SEFAZ
export const maxDuration = 60;

interface Status {
  pode_configurar: boolean;
  pode_consultar: boolean;
  conexao: null | {
    ambiente: string; titular: string | null; valido_de: string | null; valido_ate: string | null;
    ativa: boolean; tem_certificado: boolean; atualizada_em: string;
  };
  estado: null | {
    ult_nsu: number | null; max_nsu: number | null; ultima: string | null; cstat: string | null;
    mensagem: string | null; bloqueado_ate: string | null; rodando: boolean;
  };
  execucoes: {
    id: number; trigger: "cron" | "manual"; started_at: string; finished_at: string | null; status: string;
    cstat: string | null; message: string | null; docs_returned: number; new_invoices: number;
    enriched: number; from_nsu: number | null; to_nsu: number | null;
  }[];
  resumos: number;
}

const STATUS_RUN: Record<string, { rotulo: string; cls: string }> = {
  concluida: { rotulo: "Concluída", cls: "bg-accent-soft text-accent-ink" },
  sem_novidade: { rotulo: "Nada novo", cls: "bg-line-soft text-graphite" },
  bloqueada: { rotulo: "Bloqueada 1 h", cls: "bg-warn-soft text-warn" },
  erro: { rotulo: "Erro", cls: "bg-danger-soft text-danger" },
  executando: { rotulo: "Em andamento", cls: "bg-line-soft text-graphite" },
};

const hora = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(iso));

export default async function ConsultaSefazPage() {
  const { company } = await requirePermission("dfe");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dfe_status", { _company_id: company.id });
  if (error) console.error("[consulta] status", error);
  const s = (data ?? { pode_configurar: false, pode_consultar: false, conexao: null, estado: null, execucoes: [], resumos: 0 }) as Status;

  const agora = Date.now();
  const cert = s.conexao?.tem_certificado && s.conexao.ativa ? s.conexao : null;
  const diasCert = cert?.valido_ate
    ? Math.floor((new Date(cert.valido_ate + "T23:59:59-03:00").getTime() - agora) / 86_400_000) : null;

  // por que o botão está desligado agora (a regra de verdade é do servidor)
  let bloqueio: string | null = null;
  if (s.estado?.rodando) bloqueio = "Há uma consulta em andamento.";
  else if (s.estado?.bloqueado_ate && new Date(s.estado.bloqueado_ate).getTime() > agora)
    bloqueio = `A SEFAZ pede espera: liberado às ${hora(s.estado.bloqueado_ate)}.`;
  else if (s.estado?.ultima && new Date(s.estado.ultima).getTime() + 60 * 60_000 > agora)
    bloqueio = `Intervalo mínimo de 1 h: liberado às ${hora(new Date(new Date(s.estado.ultima).getTime() + 60 * 60_000).toISOString())}.`;

  const empresa = company.trade_name ?? company.legal_name;

  return (
    <div className="max-w-[1240px] px-6 pb-14 pt-5">
      <PageHeader
        crumb="Notas fiscais"
        title="Consulta na SEFAZ"
        description={`Notas emitidas contra ${empresa} (${cnpjFmt(company.cnpj)}), buscadas na distribuição DF-e do Ambiente Nacional.`}
      />

      <div className="mb-4 flex gap-2.5 rounded border border-line bg-surface px-3.5 py-3 text-[12.5px] text-graphite">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <p>
          A contabilidade também consulta este CNPJ. Para não gerar bloqueio na SEFAZ, o sistema consulta
          sozinho <b>uma vez por dia</b>, a consulta manual exige <b>1 hora</b> desde a anterior e qualquer
          rejeição por excesso (656) faz o sistema parar por 1 hora. O sistema <b>só lê</b>: a Ciência da
          Operação continua com a contabilidade e aparece aqui quando ela registrar.
        </p>
      </div>

      {error ? (
        <div className="card">
          <EmptyState
            title="Não foi possível carregar a consulta agora"
            hint="Recarregue a página em alguns instantes. Se continuar, avise o administrador do sistema."
          />
        </div>
      ) : !cert ? (
        <div className="card">
          <EmptyState
            title="Nenhum certificado configurado"
            hint={s.pode_configurar
              ? `Envie o certificado digital A1 (e-CNPJ) de ${empresa} para ligar a consulta automática.`
              : "Peça a um administrador para enviar o certificado A1 da empresa."}
            action={s.pode_configurar ? <div className="flex justify-center"><EnviarCertificado temCertificado={false} /></div> : undefined}
          />
        </div>
      ) : (
        <>
          <KpiRow
            items={[
              {
                label: "Certificado válido até",
                value: dataBR(cert.valido_ate),
                note: diasCert !== null ? (diasCert < 0 ? "vencido" : `faltam ${diasCert} dias`) : undefined,
                ...(diasCert !== null && diasCert < 30 ? { tone: "warn" as const } : {}),
              },
              { label: "Última consulta", value: s.estado?.ultima ? dateTime(s.estado.ultima) : "nunca", note: s.estado?.cstat ? `SEFAZ ${s.estado.cstat}` : undefined },
              { label: "Posição na fila (NSU)", value: String(s.estado?.ult_nsu ?? 0), note: s.estado?.max_nsu ? `de ${s.estado.max_nsu}` : undefined },
              { label: "Só resumo", value: String(s.resumos), note: "aguardando o XML completo" },
            ]}
          />

          <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
            <Card title="Consultar agora" note="Busca o que a SEFAZ tem de novo desde a última consulta.">
              <div className="px-4 py-3">
                {s.pode_consultar
                  ? <ConsultarAgora bloqueio={bloqueio} />
                  : <p className="text-[12.5px] text-muted">Você pode ver o histórico, mas não consultar.</p>}
                {s.estado?.mensagem && (
                  <p className="mt-3 text-[11.5px] text-muted">Última resposta: {s.estado.mensagem}</p>
                )}
                {s.resumos > 0 && (
                  <p className="mt-2 text-[11.5px] text-muted">
                    {s.resumos} {s.resumos === 1 ? "nota chegou" : "notas chegaram"} só como resumo. O XML completo vem
                    depois que a contabilidade registra a Ciência da Operação.{" "}
                    <Link href="/notas?situacao=resumo" className="underline underline-offset-2">Ver notas</Link>
                  </p>
                )}
              </div>
            </Card>

            <Card
              title="Certificado A1"
              actions={s.pode_configurar ? <><EnviarCertificado temCertificado /><RemoverCertificado /></> : undefined}
            >
              <dl className="grid gap-x-6 gap-y-3 px-4 py-3 text-[12.5px] sm:grid-cols-2">
                <div className="sm:col-span-2 min-w-0">
                  <dt className="text-[11px] text-muted">Titular</dt>
                  <dd className="flex items-center gap-1.5 font-medium">
                    <KeyRound className="h-3.5 w-3.5 shrink-0 text-accent" />
                    <span className="truncate" title={cert.titular ?? ""}>{cert.titular ?? "—"}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted">Validade</dt>
                  <dd>{dataBR(cert.valido_de)} a {dataBR(cert.valido_ate)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted">Ambiente</dt>
                  <dd>{cert.ambiente === "producao" ? "Produção" : "Homologação"}</dd>
                </div>
              </dl>
            </Card>
          </div>

          <Card title="Histórico de consultas" note="As 15 mais recentes, automáticas e manuais.">
            {s.execucoes.length === 0 ? (
              <EmptyState title="Nenhuma consulta ainda" hint="A primeira consulta traz as notas dos últimos 90 dias." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse">
                  <thead>
                    <tr>
                      <th className="th w-36">QUANDO</th>
                      <th className="th w-24">ORIGEM</th>
                      <th className="th w-32">SITUAÇÃO</th>
                      <th className="th">RESULTADO</th>
                      <th className="th w-24 text-right">DOCS</th>
                      <th className="th w-32 text-right">NSU</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.execucoes.map((e) => {
                      const st = STATUS_RUN[e.status] ?? { rotulo: e.status, cls: "bg-line-soft text-graphite" };
                      return (
                        <tr key={e.id} className="align-top">
                          <td className="td whitespace-nowrap">{dateTime(e.started_at)}</td>
                          <td className="td">{e.trigger === "cron" ? "Automática" : "Manual"}</td>
                          <td className="td"><span className={`badge ${st.cls}`}>{st.rotulo}</span></td>
                          <td className="td text-[12px]">
                            {e.message ?? "—"}
                            {e.cstat && <span className="ml-1 text-muted">(cStat {e.cstat})</span>}
                          </td>
                          <td className="td text-right font-mono tabular-nums">{e.docs_returned}</td>
                          <td className="td text-right font-mono text-[11.5px] tabular-nums text-graphite">
                            {e.from_nsu ?? 0} → {e.to_nsu ?? e.from_nsu ?? 0}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
