import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { date, money } from "@/lib/format";

export default async function ProdutoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("products");
  const supabase = await createClient();

  const { data: p } = await supabase
    .from("products")
    .select("*, unit:units(code, name), category:categories(name)")
    .eq("id", id)
    .maybeSingle();

  if (!p) notFound();

  const [{ data: vinculos }, { data: historico }] = await Promise.all([
    supabase
      .from("supplier_products")
      .select("*, supplier:suppliers(id, trade_name, legal_name)")
      .eq("product_id", id),
    supabase
      .from("product_price_history")
      .select("*, supplier:suppliers(trade_name, legal_name)")
      .eq("product_id", id)
      .order("occurred_on", { ascending: false }),
  ]);

  const hist = (historico ?? []) as any[];
  const custos = hist.map((h) => Number(h.landed_price ?? h.unit_price));
  const menor = custos.length ? Math.min(...custos) : null;
  const maior = custos.length ? Math.max(...custos) : null;

  return (
    <div className="max-w-[1100px] px-6 pb-14 pt-5">
      <PageHeader
        crumb={<>Cadastros · <Link href="/cadastros/produtos" className="hover:text-ink">Produtos</Link></>}
        title={p.description}
        description={`SKU ${p.sku} · ${p.unit?.name ?? ""}${p.ncm ? ` · NCM ${p.ncm}` : ""}${p.cest ? ` · CEST ${p.cest}` : ""}`}
      />

      <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded border border-line bg-line lg:grid-cols-4">
        {[
          { l: "Fornecedores", v: String((vinculos ?? []).length) },
          { l: "Compras", v: String(hist.length) },
          { l: "Menor custo cheio", v: menor !== null ? money(menor) : "—" },
          { l: "Maior custo cheio", v: maior !== null ? money(maior) : "—" },
        ].map((k) => (
          <div key={k.l} className="bg-surface px-4 py-3.5">
            <div className="text-[11px] font-medium text-muted">{k.l}</div>
            <div className="mt-1.5 font-display text-[18px] font-semibold tracking-tight">{k.v}</div>
          </div>
        ))}
      </div>

      <section className="card mb-4">
        <div className="border-b border-line-soft px-4 py-3">
          <h3 className="text-[13.5px] font-semibold">Códigos por fornecedor</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr>
                <th className="th">FORNECEDOR</th>
                <th className="th w-40">CÓDIGO DELE</th>
                <th className="th w-20">UN DELE</th>
                <th className="th w-24 text-right">FATOR</th>
                <th className="th w-32 text-right">ÚLTIMO PREÇO</th>
              </tr>
            </thead>
            <tbody>
              {(vinculos ?? []).map((v: any) => (
                <tr key={v.id} className="hover:bg-raise">
                  <td className="td">
                    <Link href={`/cadastros/fornecedores/${v.supplier.id}`} className="font-medium hover:text-accent hover:underline">
                      {v.supplier.trade_name ?? v.supplier.legal_name}
                    </Link>
                  </td>
                  <td className="td font-mono">{v.supplier_code}</td>
                  <td className="td font-mono">{v.supplier_unit_raw ?? "—"}</td>
                  <td className="td text-right font-mono">{Number(v.conversion_factor)}</td>
                  <td className="td text-right font-mono">{money(v.last_unit_price)}</td>
                </tr>
              ))}
              {(vinculos ?? []).length === 0 && (
                <tr><td className="td text-center text-muted" colSpan={5}>Nenhum fornecedor vinculado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="border-b border-line-soft px-4 py-3">
          <h3 className="text-[13.5px] font-semibold">Evolução de preço</h3>
          <p className="mt-0.5 text-[11.5px] text-muted">
            Custo cheio inclui ICMS-ST e frete rateados — é o que saiu do caixa, e pode inverter qual fornecedor está mais barato.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse">
            <thead>
              <tr>
                <th className="th w-28">DATA</th>
                <th className="th">FORNECEDOR</th>
                <th className="th w-28">DOCUMENTO</th>
                <th className="th w-24 text-right">QTD</th>
                <th className="th w-28 text-right">PREÇO</th>
                <th className="th w-32 text-right">CUSTO CHEIO</th>
              </tr>
            </thead>
            <tbody>
              {hist.map((h) => {
                const cheio = Number(h.landed_price ?? h.unit_price);
                const dif = Number(h.unit_price) > 0 ? (cheio / Number(h.unit_price) - 1) * 100 : 0;
                return (
                  <tr key={h.id} className="hover:bg-raise">
                    <td className="td">{date(h.occurred_on)}</td>
                    <td className="td">{h.supplier?.trade_name ?? h.supplier?.legal_name ?? "—"}</td>
                    <td className="td font-mono text-graphite">{h.document_ref ?? "—"}</td>
                    <td className="td text-right font-mono">{Number(h.quantity)}</td>
                    <td className="td text-right font-mono">{money(h.unit_price)}</td>
                    <td className="td text-right font-mono font-semibold">
                      {money(cheio)}
                      {dif >= 0.05 && (
                        <span className="ml-1.5 text-[10.5px] font-normal text-warn">+{dif.toFixed(1)}%</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {hist.length === 0 && (
                <tr><td className="td text-center text-muted" colSpan={6}>Sem histórico ainda.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
