import Link from "next/link";
import { AlertOctagon, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { date, money } from "@/lib/format";
import { Reabrir, Tratar } from "./tratar";

export const metadata = { title: "Divergências · Vitória Procurement" };

type Div = {
  kind: string; severity: "critica" | "atencao" | "info"; invoice_id: string; invoice_number: string | null;
  emitter_name: string | null; supplier_id: string | null; issued_at: string | null; total_amount: number;
  detail: string; open_amount: number; paid_amount: number; event_at: string | null;
  reviewed: boolean; review_note: string | null; reviewed_by_name: string | null; reviewed_at: string | null;
};

const TIPO: Record<string, string> = {
  cancelada_com_titulo: "Nota cancelada com título",
  operacao_nao_realizada: "Operação não realizada",
  valor_duplicatas: "Parcelas × total da nota",
  fornecedor_bloqueado: "Fornecedor bloqueado",
  sem_ibscbs: "Sem IBS/CBS",
  carta_correcao: "Carta de correção",
};
const SEV = {
  critica: { rot: "Crítica", cls: "bg-danger-soft text-danger", Icone: AlertOctagon },
  atencao: { rot: "Atenção", cls: "bg-warn-soft text-warn", Icone: AlertTriangle },
  info: { rot: "Informação", cls: "bg-info-soft text-info", Icone: Info },
} as const;

export default async function DivergenciasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { company, permissions } = await requirePermission("divergences");
  const sp = await searchParams;
  const verTratadas = (Array.isArray(sp.ver) ? sp.ver[0] : sp.ver) === "tratadas";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_divergences", {
    _company_id: company.id, _incluir_revisadas: verTratadas,
  });
  const todas = (data ?? []) as Div[];
  const lista = verTratadas ? todas.filter((d) => d.reviewed) : todas;
  const podeTratar = permissions.has("divergences.edit");
  const verPagar = permissions.has("accounts_payable.view");
  const conta = (s: string) => lista.filter((d) => d.severity === s).length;

  return (
    <div className="max-w-[1200px] px-6 pb-14 pt-5">
      <PageHeader
        crumb="Notas fiscais"
        title="Divergências"
        description="Onde a nota fiscal e o financeiro não batem. A lista é recalculada a cada abertura: resolvido na origem, some sozinho."
      />

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Link href="/interno/notas/divergencias" aria-current={!verTratadas ? "true" : undefined}
              className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium ${!verTratadas
                ? "border-accent bg-accent-soft text-accent-ink" : "border-line text-graphite hover:border-graphite hover:text-ink"}`}>
          Em aberto
        </Link>
        <Link href="/interno/notas/divergencias?ver=tratadas" aria-current={verTratadas ? "true" : undefined}
              className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium ${verTratadas
                ? "border-accent bg-accent-soft text-accent-ink" : "border-line text-graphite hover:border-graphite hover:text-ink"}`}>
          Ver tratadas
        </Link>
        {!verTratadas && lista.length > 0 && (
          <span className="ml-auto text-[12px] text-muted">
            {conta("critica")} crítica(s) · {conta("atencao")} de atenção · {conta("info")} informativa(s)
          </span>
        )}
      </div>

      {error ? (
        <div className="card"><EmptyState title="Não foi possível carregar as divergências" hint="Tente de novo em instantes." /></div>
      ) : lista.length === 0 ? (
        <div className="card">
          <EmptyState
            title={verTratadas ? "Nenhuma divergência tratada ainda" : "Nenhuma divergência em aberto"}
            hint={verTratadas ? undefined : "Notas, parcelas e títulos estão batendo."}
          />
        </div>
      ) : (
        <div className="grid gap-2.5">
          {lista.map((d) => {
            const s = SEV[d.severity] ?? SEV.info;
            const Icone = s.Icone;
            return (
              <article key={`${d.kind}-${d.invoice_id}`} className="card px-4 py-3.5">
                <div className="flex flex-wrap items-start gap-3">
                  <span className={`badge inline-flex items-center gap-1 ${s.cls}`}>
                    <Icone className="h-3 w-3" /> {s.rot}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <h3 className="text-[13.5px] font-semibold">{TIPO[d.kind] ?? d.kind}</h3>
                      <Link href={`/interno/notas/${d.invoice_id}`} className="text-[12.5px] text-accent-ink hover:underline">
                        NF-e {d.invoice_number ?? "s/nº"}
                      </Link>
                      <span className="text-[12px] text-muted">
                        {d.emitter_name ?? "—"} · {date(d.issued_at)} · {money(Number(d.total_amount))}
                      </span>
                    </div>
                    <p className="mt-1 text-[12.5px] text-graphite">{d.detail}</p>
                    {(Number(d.open_amount) > 0 || Number(d.paid_amount) > 0) && (
                      <p className="mt-1 text-[12px] text-muted">
                        Em aberto {money(Number(d.open_amount))} · já pago {money(Number(d.paid_amount))}
                      </p>
                    )}
                    {d.reviewed && (
                      <p className="mt-2 flex items-start gap-1.5 rounded bg-accent-soft px-2.5 py-1.5 text-[12px] text-accent-ink">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>
                          Tratada por {d.reviewed_by_name ?? "—"} em {date(d.reviewed_at)}: {d.review_note}
                        </span>
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {verPagar && (Number(d.open_amount) > 0 || Number(d.paid_amount) > 0) && d.invoice_number && (
                      <Link
                        href={`/interno/financeiro/contas-a-pagar?de=2000-01-01&ate=2100-12-31&busca=${encodeURIComponent(d.invoice_number)}`}
                        className="btn h-7 px-2 text-[11.5px]"
                      >
                        Ver títulos
                      </Link>
                    )}
                    {podeTratar && (d.reviewed
                      ? <Reabrir kind={d.kind} invoiceId={d.invoice_id} />
                      : <Tratar kind={d.kind} invoiceId={d.invoice_id}
                                titulo={`${TIPO[d.kind] ?? d.kind} — NF-e ${d.invoice_number ?? "s/nº"}`} />)}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
