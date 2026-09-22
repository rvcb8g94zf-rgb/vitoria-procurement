import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { cnpj as fmtDoc, date, money } from "@/lib/format";
import { FornecedorDialog } from "../dialog";
import type { PaymentTerm, Supplier } from "@/types";

export default async function FornecedorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { company, permissions } = await requirePermission("suppliers");
  const supabase = await createClient();

  const { data: f } = await supabase
    .from("suppliers")
    .select("*, payment_term:payment_terms(name, days)")
    .eq("id", id)
    .maybeSingle();

  if (!f) notFound();

  const [{ data: itens }, { data: historico }, { data: condicoes }] = await Promise.all([
    supabase
      .from("supplier_products")
      .select("*, product:products(id, sku, description)")
      .eq("supplier_id", id)
      .order("supplier_code"),
    supabase
      .from("product_price_history")
      .select("occurred_on, unit_price, landed_price, quantity, document_ref, product:products(description)")
      .eq("supplier_id", id)
      .order("occurred_on", { ascending: false })
      .limit(20),
    supabase.from("payment_terms").select("*").eq("company_id", company.id).order("code"),
  ]);

  const compras = (historico ?? []) as any[];
  const totalComprado = compras.reduce(
    (s, h) => s + Number(h.landed_price ?? h.unit_price) * Number(h.quantity), 0
  );

  return (
    <div className="max-w-[1200px] px-6 pb-14 pt-5">
      <PageHeader
        crumb={<>Cadastros · <Link href="/cadastros/fornecedores" className="hover:text-ink">Fornecedores</Link></>}
        title={f.trade_name ?? f.legal_name}
        description={`${fmtDoc(f.doc_number)} · ${f.city ?? "—"}/${f.state_uf ?? "—"}`}
        actions={permissions.has("suppliers.edit")
          ? <FornecedorDialog fornecedor={f as Supplier} condicoes={(condicoes ?? []) as PaymentTerm[]} />
          : undefined}
      />

      <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded border border-line bg-line lg:grid-cols-4">
        {[
          { l: "Itens fornecidos", v: String((itens ?? []).length) },
          { l: "Compras registradas", v: String(compras.length) },
          { l: "Volume acumulado", v: money(totalComprado) },
          { l: "Condição", v: f.payment_term?.name ?? "—" },
        ].map((k) => (
          <div key={k.l} className="bg-surface px-4 py-3.5">
            <div className="text-[11px] font-medium text-muted">{k.l}</div>
            <div className="mt-1.5 font-display text-[18px] font-semibold tracking-tight">{k.v}</div>
          </div>
        ))}
      </div>

      <section className="card mb-4">
        <div className="border-b border-line-soft px-4 py-3">
          <h3 className="text-[13.5px] font-semibold">Itens deste fornecedor</h3>
          <p className="mt-0.5 text-[11.5px] text-muted">
            O código é do fornecedor. O mesmo produto costuma ter código diferente em cada um.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr>
                <th className="th w-40">CÓDIGO DELE</th>
                <th className="th">DESCRIÇÃO</th>
                <th className="th w-24">UN</th>
                <th className="th w-32 text-right">ÚLTIMO PREÇO</th>
                <th className="th w-32">ÚLTIMA COMPRA</th>
              </tr>
            </thead>
            <tbody>
              {(itens ?? []).map((i: any) => (
                <tr key={i.id} className="hover:bg-raise">
                  <td className="td font-mono">{i.supplier_code}</td>
                  <td className="td">
                    {i.product ? (
                      <Link href={`/cadastros/produtos/${i.product.id}`} className="font-medium hover:text-accent hover:underline">
                        {i.product.description}
                      </Link>
                    ) : (
                      <span className="text-muted">{i.supplier_desc} — sem produto vinculado</span>
                    )}
                  </td>
                  <td className="td font-mono">{i.supplier_unit_raw ?? "—"}</td>
                  <td className="td text-right font-mono">{money(i.last_unit_price)}</td>
                  <td className="td">{date(i.last_purchase_at)}</td>
                </tr>
              ))}
              {(itens ?? []).length === 0 && (
                <tr><td className="td text-center text-muted" colSpan={5}>Nenhum item registrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="border-b border-line-soft px-4 py-3">
          <h3 className="text-[13.5px] font-semibold">Compras recentes</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse">
            <thead>
              <tr>
                <th className="th w-28">DATA</th>
                <th className="th">PRODUTO</th>
                <th className="th w-28">DOCUMENTO</th>
                <th className="th w-24 text-right">QTD</th>
                <th className="th w-28 text-right">PREÇO</th>
                <th className="th w-28 text-right">CUSTO CHEIO</th>
              </tr>
            </thead>
            <tbody>
              {compras.map((h, i) => (
                <tr key={i} className="hover:bg-raise">
                  <td className="td">{date(h.occurred_on)}</td>
                  <td className="td">{h.product?.description}</td>
                  <td className="td font-mono text-graphite">{h.document_ref}</td>
                  <td className="td text-right font-mono">{Number(h.quantity)}</td>
                  <td className="td text-right font-mono">{money(h.unit_price)}</td>
                  <td className="td text-right font-mono font-semibold">{money(h.landed_price)}</td>
                </tr>
              ))}
              {compras.length === 0 && (
                <tr><td className="td text-center text-muted" colSpan={6}>Nenhuma compra registrada.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
