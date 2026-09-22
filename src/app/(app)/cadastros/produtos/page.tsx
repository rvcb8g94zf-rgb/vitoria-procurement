import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";

export const metadata = { title: "Produtos · Vitória Procurement" };

export default async function ProdutosPage() {
  const { company } = await requirePermission("products");
  const supabase = await createClient();

  const { data } = await supabase
    .from("products")
    .select("*, unit:units(code), fornecedores:supplier_products(id, last_unit_price)")
    .eq("company_id", company.id)
    .order("description");

  const lista = (data ?? []) as any[];

  return (
    <div className="max-w-[1200px] px-6 pb-14 pt-5">
      <PageHeader
        crumb="Cadastros"
        title="Produtos"
        description={`${lista.length} em ${company.trade_name ?? company.legal_name}.`}
      />

      <div className="card overflow-x-auto">
        {lista.length === 0 ? (
          <EmptyState
            title="Nenhum produto cadastrado"
            hint="Produtos entram pela importação de XML e ficam aguardando validação antes de virar cadastro."
          />
        ) : (
          <table className="w-full min-w-[820px] border-collapse">
            <thead>
              <tr>
                <th className="th w-24">SKU</th>
                <th className="th">DESCRIÇÃO</th>
                <th className="th w-14">UN</th>
                <th className="th w-32">NCM</th>
                <th className="th w-24 text-right">FORNEC.</th>
                <th className="th w-32 text-right">ÚLTIMO PREÇO</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => {
                const precos = (p.fornecedores ?? [])
                  .map((f: any) => Number(f.last_unit_price))
                  .filter((n: number) => n > 0);
                return (
                  <tr key={p.id} className="hover:bg-raise">
                    <td className="td font-mono">{p.sku}</td>
                    <td className="td">
                      <Link href={`/cadastros/produtos/${p.id}`} className="font-medium hover:text-accent hover:underline">
                        {p.description}
                      </Link>
                    </td>
                    <td className="td font-mono">{p.unit?.code}</td>
                    <td className="td font-mono text-graphite">{p.ncm ?? "—"}</td>
                    <td className="td text-right font-mono">{(p.fornecedores ?? []).length}</td>
                    <td className="td text-right font-mono">
                      {precos.length ? money(Math.min(...precos)) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
