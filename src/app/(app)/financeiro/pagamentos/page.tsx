import Link from "next/link";
import { Wallet } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/page-header";
import { KpiRow } from "@/components/panels";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { date as dataBR, money } from "@/lib/format";
import { todayISO } from "@/lib/caixa";
import {
  addDays, METODOS, METODO_LABEL, normalizePayments, type PaymentRow,
} from "@/lib/financeiro";
import { Estornar } from "./estorno";

export const metadata = { title: "Pagamentos · Vitória Procurement" };

const isISO = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const LIMITE = 500;

export default async function PagamentosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { company, permissions } = await requirePermission("payments");
  const sp = await searchParams;
  const hoje = todayISO();
  const de = isISO(um(sp.de)) ? (um(sp.de) as string) : addDays(hoje, -30);
  const ate = isISO(um(sp.ate)) ? (um(sp.ate) as string) : hoje;
  const forma = (um(sp.forma) ?? "").slice(0, 20);
  const busca = (um(sp.busca) ?? "").slice(0, 60);
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("search_payments", {
    _company_id: company.id,
    _from: de, _to: ate,
    _supplier: null,
    _method: forma || null,
    _search: busca || null,
    _limit: LIMITE,
  });
  if (error) console.error("[pagamentos] busca", error);

  const rows: PaymentRow[] = normalizePayments(data);
  const validos = rows.filter((r) => !r.cancelled_at);
  const total = Math.round(validos.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  const estornados = rows.length - validos.length;
  const porForma = new Map<string, number>();
  for (const r of validos) porForma.set(r.method, (porForma.get(r.method) ?? 0) + r.amount);
  const maior = [...porForma.entries()].sort((a, b) => b[1] - a[1])[0];
  const podeEstornar = permissions.has("payments.cancel");

  return (
    <div className="max-w-[1240px] px-6 pb-14 pt-5">
      <PageHeader
        crumb="Financeiro"
        title="Pagamentos"
        description="Extrato das baixas feitas nas contas a pagar."
        actions={
          <Link href="/financeiro/contas-a-pagar" className="btn">
            <Wallet className="h-3.5 w-3.5" /> Contas a pagar
          </Link>
        }
      />

      <div className="card mb-4 print:hidden">
        <form method="get" action="/financeiro/pagamentos"
              className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1.4fr_auto]">
          <div>
            <label className="label" htmlFor="pg-de">Pago de</label>
            <input id="pg-de" name="de" type="date" defaultValue={de} className="field" />
          </div>
          <div>
            <label className="label" htmlFor="pg-ate">até</label>
            <input id="pg-ate" name="ate" type="date" defaultValue={ate} className="field" />
          </div>
          <div>
            <label className="label" htmlFor="pg-forma">Forma</label>
            <select id="pg-forma" name="forma" defaultValue={forma} className="field">
              <option value="">Todas</option>
              {METODOS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="pg-busca">Título, comprovante ou nota</label>
            <input id="pg-busca" name="busca" defaultValue={busca} className="field" placeholder="ex.: 9426" />
          </div>
          <div className="flex items-end gap-2">
            <button type="submit" className="btn btn-primary">Filtrar</button>
            <Link href="/financeiro/pagamentos" className="btn">Limpar</Link>
          </div>
        </form>
      </div>

      <KpiRow
        items={[
          { label: "Pago no período", value: money(total), note: `${dataBR(de)} a ${dataBR(ate)}` },
          { label: "Lançamentos", value: String(validos.length) },
          ...(maior ? [{ label: "Mais usada", value: METODO_LABEL[maior[0]] ?? maior[0], note: money(maior[1]) }] : []),
          ...(estornados > 0 ? [{ label: "Estornados", value: String(estornados), tone: "warn" as const }] : []),
        ]}
      />

      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState
            title="Nenhum pagamento no período"
            hint="Assim que uma conta a pagar for baixada, ela aparece aqui."
            action={
              <Link href="/financeiro/contas-a-pagar" className="btn inline-flex">Ir para contas a pagar</Link>
            }
          />
        ) : (
          <table className={`w-full border-collapse ${podeEstornar ? "min-w-[1020px]" : "min-w-[860px]"}`}>
            <thead>
              <tr>
                <th className="th w-28">DATA</th>
                <th className="th">TÍTULO</th>
                <th className="th w-52">FORNECEDOR</th>
                <th className="th w-32">FORMA</th>
                <th className="th w-40">COMPROVANTE</th>
                <th className="th w-32 text-right">VALOR</th>
                {podeEstornar && <th className="th w-28" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`align-top hover:bg-raise ${r.cancelled_at ? "opacity-60" : ""}`}>
                  <td className="td whitespace-nowrap">
                    {dataBR(r.paid_at)}
                    {r.paid_by && <span className="block text-[11px] text-muted">{r.paid_by}</span>}
                  </td>
                  <td className="td">
                    <div className="min-w-0 truncate font-medium" title={r.description}>{r.description}</div>
                    <div className="text-[11px] text-muted">
                      {r.invoice_number ? `NF ${r.invoice_number}` : r.document ?? "título avulso"}
                      {r.cancelled_at && (
                        <span className="ml-1.5 font-medium text-danger">
                          estornado — {r.cancel_reason}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="td">
                    <div className="min-w-0 truncate" title={r.supplier_name ?? ""}>
                      {r.supplier_name ?? <span className="text-muted">—</span>}
                    </div>
                  </td>
                  <td className="td">
                    <span className="badge bg-line-soft text-graphite">{METODO_LABEL[r.method] ?? r.method}</span>
                  </td>
                  <td className="td font-mono text-[11.5px]">{r.reference ?? "—"}</td>
                  <td className={`td text-right font-mono font-semibold tabular-nums ${r.cancelled_at ? "line-through" : ""}`}>
                    {money(r.amount)}
                  </td>
                  {podeEstornar && (
                    <td className="td text-right">
                      {!r.cancelled_at && (
                        <Estornar id={r.id} descricao={r.description} valor={r.amount} />
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows.length > 0 && (
          <div className="border-t border-line-soft px-4 py-2.5 text-[11.5px] text-muted">
            {rows.length === LIMITE
              ? `Mostrando os ${LIMITE} pagamentos mais recentes — reduza o período para ver todos.`
              : `${rows.length} ${rows.length === 1 ? "lançamento" : "lançamentos"} no filtro.`}
          </div>
        )}
      </div>
    </div>
  );
}
