import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { date, money } from "@/lib/format";
import { CONF_FILTROS, CONF_STATUS } from "@/lib/conferencia";

export const metadata = { title: "Conferência com o pedido · Vitória Procurement" };

type Linha = {
  invoice_id: string; number: string | null; supplier_name: string | null; issued_at: string | null;
  total_amount: number | null; orders: string | null; status: string; n_issues: number; open_amount: number;
};

export default async function ConferenciaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { company } = await requirePermission("invoices");
  const sp = await searchParams;
  const pedido = (Array.isArray(sp.situacao) ? sp.situacao[0] : sp.situacao) ?? "";
  const situacao = CONF_FILTROS.some((f) => f.valor === pedido) ? pedido : "";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invoice_matches", { _company_id: company.id, _filtro: situacao });
  if (error) console.error("[conferencia] lista", error);
  const lista = (data ?? []) as Linha[];
  const retidas = lista.filter((l) => l.status === "divergente");
  const valorRetido = retidas.reduce((s, l) => s + Number(l.open_amount ?? 0), 0);

  return (
    <div className="max-w-[1240px] px-6 pb-14 pt-5">
      <PageHeader
        crumb="Notas fiscais"
        title="Conferência com o pedido"
        description={
          situacao === "" && retidas.length > 0
            ? `${retidas.length} nota(s) com pagamento retido · ${money(valorRetido)} em títulos abertos`
            : "Nota × pedido × recebimento. Nota que não bate fica com o pagamento retido até ser resolvida ou liberada."
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {CONF_FILTROS.map((f) => (
          <Link key={f.valor || "tudo"} href={`/interno/notas/conferencia${f.valor ? `?situacao=${f.valor}` : ""}` as any}
                aria-current={f.valor === situacao ? "true" : undefined}
                className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium ${f.valor === situacao
                  ? "border-accent bg-accent-soft text-accent-ink" : "border-line text-graphite hover:border-graphite hover:text-ink"}`}>
            {f.rotulo}
          </Link>
        ))}
      </div>

      <section className="card overflow-x-auto">
        {lista.length === 0 ? (
          <EmptyState
            title={situacao === "divergente" ? "Nenhuma nota retida" : "Nada para conferir"}
            hint="Aparecem aqui as notas ligadas a pedidos (pelo recebimento, pelo número do pedido no XML ou à mão) e as notas recentes de fornecedores com pedido em aberto."
          />
        ) : (
          <table className="w-full min-w-[900px] border-collapse">
            <thead>
              <tr>
                <th className="th w-28">NOTA</th>
                <th className="th">FORNECEDOR</th>
                <th className="th w-28">EMISSÃO</th>
                <th className="th w-36">PEDIDO(S)</th>
                <th className="th w-32 text-right">TOTAL</th>
                <th className="th w-32 text-right">EM ABERTO</th>
                <th className="th w-52">SITUAÇÃO</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((l) => {
                const st = CONF_STATUS[l.status] ?? CONF_STATUS.sem_pedido;
                return (
                  <tr key={l.invoice_id} className="align-top hover:bg-raise">
                    <td className="td">
                      <Link href={`/interno/notas/${l.invoice_id}` as any} className="font-mono font-semibold hover:text-accent hover:underline">
                        {l.number ?? "s/nº"}
                      </Link>
                    </td>
                    <td className="td">{l.supplier_name ?? "—"}</td>
                    <td className="td whitespace-nowrap">{l.issued_at ? date(l.issued_at) : "—"}</td>
                    <td className="td font-mono text-[12px]">{l.orders ?? <span className="text-muted">—</span>}</td>
                    <td className="td text-right font-mono tabular-nums">{money(Number(l.total_amount ?? 0))}</td>
                    <td className="td text-right font-mono tabular-nums">
                      {Number(l.open_amount) > 0 ? money(Number(l.open_amount)) : <span className="text-muted">—</span>}
                    </td>
                    <td className="td">
                      <span className={`badge ${st.cls}`} title={st.dica}>{st.rot}</span>
                      {l.n_issues > 0 && l.status !== "conferida" && (
                        <span className="block text-[11px] text-muted">
                          {l.n_issues} {l.n_issues === 1 ? "divergência" : "divergências"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
