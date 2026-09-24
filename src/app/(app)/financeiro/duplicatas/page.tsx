import Link from "next/link";
import { CheckCircle2, Upload, Wallet } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/page-header";
import { KpiRow } from "@/components/panels";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { date as dataBR, money } from "@/lib/format";
import { todayISO } from "@/lib/caixa";
import { addDays, normalizePending, type PendingInvoiceRow } from "@/lib/financeiro";
import { GerarTitulos } from "./gerar";

export const metadata = { title: "Duplicatas · Vitória Procurement" };

const isISO = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function DuplicatasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { company, permissions } = await requirePermission("installments");
  const sp = await searchParams;
  const hoje = todayISO();
  const de = isISO(um(sp.de)) ? (um(sp.de) as string) : addDays(hoje, -365);
  const ate = isISO(um(sp.ate)) ? (um(sp.ate) as string) : hoje;
  const supabase = await createClient();

  const [{ data, error }, { count: notas }] = await Promise.all([
    supabase.rpc("pending_duplicates", {
      _company_id: company.id, _from: de, _to: ate, _supplier: null, _limit: 500,
    }),
    supabase.from("received_invoices").select("id", { count: "exact", head: true }).eq("company_id", company.id),
  ]);

  if (error) console.error("[duplicatas] busca", error);

  const pendentes: PendingInvoiceRow[] = normalizePending(data);
  const totalPendente = pendentes.reduce((s, n) => s + n.pending_total, 0);
  const parcelas = pendentes.reduce((s, n) => s + Math.max(n.pending_count, 1), 0);
  const semFornecedor = pendentes.filter((n) => !n.supplier_id).length;
  const podeGerar = permissions.has("accounts_payable.create");

  return (
    <div className="max-w-[1240px] px-6 pb-14 pt-5">
      <PageHeader
        crumb="Financeiro"
        title="Duplicatas das notas"
        description="As parcelas que vieram no XML e ainda não viraram conta a pagar."
        actions={
          <Link href="/financeiro/contas-a-pagar" className="btn">
            <Wallet className="h-3.5 w-3.5" /> Contas a pagar
          </Link>
        }
      />

      {(notas ?? 0) === 0 ? (
        <div className="card">
          <EmptyState
            title="Nenhuma nota importada ainda"
            hint="As duplicatas chegam junto com o XML da NF-e. Importe as notas e as parcelas aparecem aqui."
            action={
              permissions.has("xml_import.import") ? (
                <Link href="/notas/importar" className="btn btn-primary inline-flex">
                  <Upload className="h-3.5 w-3.5" /> Importar XML
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : pendentes.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Tudo em dia"
            hint="Todas as notas do período já têm conta a pagar. Nada esperando."
            action={
              <Link href="/financeiro/contas-a-pagar" className="btn btn-primary inline-flex">
                <CheckCircle2 className="h-3.5 w-3.5" /> Ver contas a pagar
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <KpiRow
            items={[
              { label: "A gerar", value: money(totalPendente), note: `${dataBR(de)} a ${dataBR(ate)}` },
              { label: "Títulos", value: String(parcelas) },
              { label: "Notas", value: String(pendentes.length) },
              ...(semFornecedor > 0
                ? [{ label: "Sem fornecedor", value: String(semFornecedor), note: "o título fica com o nome do emitente", tone: "warn" as const }]
                : []),
            ]}
          />

          {podeGerar ? (
            <GerarTitulos notas={pendentes} />
          ) : (
            <div className="card">
              <EmptyState
                title="Você não pode gerar contas a pagar"
                hint="Peça a alguém do financeiro para gerar os títulos destas notas."
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
