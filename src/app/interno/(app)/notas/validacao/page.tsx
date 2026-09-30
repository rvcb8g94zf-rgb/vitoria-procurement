import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { date, money } from "@/lib/format";
import { AcoesValidacao } from "./acoes";

export const metadata = { title: "Validar cadastros · Vitória Procurement" };

type Pend = {
  id: string; supplier_id: string | null; supplier_name: string | null; supplier_code: string | null;
  description: string; unit: string | null; ncm: string | null; ean: string | null; unit_price: number | null;
  items_count: number; last_invoice_id: string | null; last_invoice_number: string | null;
  last_issued_at: string | null; suggested_product_id: string | null; suggested_product: string | null;
};

export default async function ValidacaoPage() {
  const { company, permissions } = await requirePermission("pending_registrations");
  const supabase = await createClient();
  const [{ data, error }, { data: prods }, { data: units }] = await Promise.all([
    supabase.rpc("pending_products", { _company_id: company.id }),
    supabase.from("products").select("id, sku, description").eq("company_id", company.id)
      .is("deleted_at", null).order("sku").limit(5000),
    supabase.from("units").select("code, name").eq("is_active", true).order("code"),
  ]);
  const lista = (data ?? []) as Pend[];
  const podeResolver = permissions.has("pending_registrations.approve");
  const podeCriar = permissions.has("products.create");

  return (
    <div className="max-w-[1200px] px-6 pb-14 pt-5">
      <PageHeader
        crumb="Notas fiscais"
        title="Validar cadastros"
        description="Itens de nota cujo código do fornecedor ainda não está ligado a um produto nosso. Ligado uma vez, as próximas notas casam sozinhas."
      />

      <div className="card overflow-x-auto">
        {error ? (
          <EmptyState title="Não foi possível carregar" hint="Tente de novo em instantes." />
        ) : lista.length === 0 ? (
          <EmptyState title="Nenhum item para validar" hint="Todo item das notas recebidas está ligado a um produto do cadastro." />
        ) : (
          <table className="w-full min-w-[980px] border-collapse">
            <thead>
              <tr>
                <th className="th">ITEM NA NOTA</th>
                <th className="th w-52">FORNECEDOR</th>
                <th className="th w-28">NCM / UN</th>
                <th className="th w-28 text-right">ÚLT. PREÇO</th>
                <th className="th w-36">ÚLTIMA NOTA</th>
                {podeResolver && <th className="th w-[260px]" />}
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.id} className="align-top hover:bg-raise">
                  <td className="td">
                    <div className="font-medium">{p.description}</div>
                    <div className="text-[11px] text-muted">
                      código <span className="font-mono">{p.supplier_code ?? "—"}</span>
                      {p.ean && <span className="ml-2 font-mono">EAN {p.ean}</span>}
                      {p.items_count > 1 && <span className="ml-2">· {p.items_count} itens de nota</span>}
                    </div>
                    {p.suggested_product && (
                      <div className="mt-1 text-[11.5px] text-accent-ink">Sugestão pelo EAN: {p.suggested_product}</div>
                    )}
                  </td>
                  <td className="td text-graphite">
                    {p.supplier_id
                      ? <Link href={`/interno/cadastros/fornecedores/${p.supplier_id}`} className="hover:text-accent hover:underline">{p.supplier_name ?? "—"}</Link>
                      : p.supplier_name ?? "—"}
                  </td>
                  <td className="td font-mono text-[11.5px] text-graphite">
                    {p.ncm ?? "—"}<span className="block text-muted">{p.unit ?? ""}</span>
                  </td>
                  <td className="td text-right font-mono tabular-nums">{p.unit_price !== null ? money(Number(p.unit_price)) : "—"}</td>
                  <td className="td">
                    {p.last_invoice_id
                      ? <Link href={`/interno/notas/${p.last_invoice_id}`} className="hover:text-accent hover:underline">NF-e {p.last_invoice_number}</Link>
                      : "—"}
                    <span className="block text-[11px] text-muted">{date(p.last_issued_at)}</span>
                  </td>
                  {podeResolver && (
                    <td className="td">
                      <AcoesValidacao item={p} produtos={(prods ?? []) as any} unidades={(units ?? []) as any} podeCriar={podeCriar} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
