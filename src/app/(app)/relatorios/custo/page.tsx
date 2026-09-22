import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";

export const metadata = { title: "Custo real · Vitória Procurement" };

/**
 * O relatório que os XMLs pediram: comparar fornecedor pelo preço de
 * tabela leva à decisão errada quando há ICMS-ST ou frete. Aqui os dois
 * valores aparecem lado a lado, e o acréscimo é destacado.
 */
export default async function CustoPage() {
  const { company } = await requirePermission("reports");
  const supabase = await createClient();

  const { data } = await supabase
    .from("product_price_history")
    .select("unit_price, landed_price, quantity, occurred_on, document_ref, product:products(id, description), supplier:suppliers(id, trade_name, legal_name)")
    .eq("company_id", company.id)
    .order("occurred_on", { ascending: false });

  const linhas = ((data ?? []) as any[]).map((h) => {
    const preco = Number(h.unit_price);
    const cheio = Number(h.landed_price ?? h.unit_price);
    return { ...h, preco, cheio, acrescimo: preco > 0 ? (cheio / preco - 1) * 100 : 0 };
  });

  const comAcrescimo = linhas.filter((l) => l.acrescimo >= 0.05);
  const media = comAcrescimo.length
    ? comAcrescimo.reduce((s, l) => s + l.acrescimo, 0) / comAcrescimo.length
    : 0;

  return (
    <div className="max-w-[1100px] px-6 pb-14 pt-5">
      <PageHeader
        crumb={<>Gestão · <Link href="/relatorios" className="hover:text-ink">Relatórios</Link></>}
        title="Custo real por produto"
        description="Preço de nota contra o que de fato saiu do caixa."
      />

      <div className="mb-4 grid grid-cols-3 gap-px overflow-hidden rounded border border-line bg-line">
        {[
          { l: "Compras analisadas", v: String(linhas.length) },
          { l: "Com acréscimo", v: String(comAcrescimo.length) },
          { l: "Acréscimo médio", v: `${media.toFixed(1)}%` },
        ].map((k) => (
          <div key={k.l} className="bg-surface px-4 py-3.5">
            <div className="text-[11px] font-medium text-muted">{k.l}</div>
            <div className="mt-1.5 font-display text-[18px] font-semibold tracking-tight">{k.v}</div>
          </div>
        ))}
      </div>

      <div className="card overflow-x-auto">
        {linhas.length === 0 ? (
          <EmptyState title="Sem dados ainda" hint="O histórico é alimentado pela importação de NF-e." />
        ) : (
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr>
                <th className="th">PRODUTO</th>
                <th className="th w-44">FORNECEDOR</th>
                <th className="th w-28 text-right">PREÇO NOTA</th>
                <th className="th w-28 text-right">CUSTO CHEIO</th>
                <th className="th w-28 text-right">ACRÉSCIMO</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, i) => (
                <tr key={i} className="hover:bg-raise">
                  <td className="td">
                    <Link href={`/cadastros/produtos/${l.product?.id}`} className="font-medium hover:text-accent hover:underline">
                      {l.product?.description}
                    </Link>
                    <span className="block font-mono text-[10.5px] text-muted">{l.document_ref}</span>
                  </td>
                  <td className="td text-graphite">{l.supplier?.trade_name ?? l.supplier?.legal_name ?? "—"}</td>
                  <td className="td text-right font-mono">{money(l.preco)}</td>
                  <td className="td text-right font-mono font-semibold">{money(l.cheio)}</td>
                  <td className="td text-right">
                    {l.acrescimo >= 0.05 ? (
                      <span className={`badge ${l.acrescimo >= 15 ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn"}`}>
                        +{l.acrescimo.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
