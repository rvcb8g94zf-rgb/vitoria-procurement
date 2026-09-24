import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { cnpj as fmtDoc } from "@/lib/format";
import { FornecedorDialog } from "./dialog";
import type { PaymentTerm } from "@/types";

export const metadata = { title: "Fornecedores · Vitória Procurement" };

const BADGE: Record<string, string> = {
  ativo: "bg-accent-soft text-accent-ink",
  pendente: "bg-warn-soft text-warn",
  inativo: "bg-line-soft text-graphite",
  bloqueado: "bg-danger-soft text-danger",
};

export default async function FornecedoresPage() {
  const { company, permissions } = await requirePermission("suppliers");
  const supabase = await createClient();

  const [{ data: lista }, { data: condicoes }] = await Promise.all([
    supabase
      .from("suppliers")
      .select("*, payment_term:payment_terms(name), category:categories(name)")
      .eq("company_id", company.id)
      .order("legal_name"),
    supabase.from("payment_terms").select("*").eq("company_id", company.id).order("code"),
  ]);

  const fornecedores = (lista ?? []) as any[];
  const terms = (condicoes ?? []) as PaymentTerm[];

  return (
    <div className="max-w-[1200px] px-6 pb-14 pt-5">
      <PageHeader
        crumb="Cadastros"
        title="Fornecedores"
        description={`${fornecedores.length} em ${company.trade_name ?? company.legal_name}.`}
        actions={permissions.has("suppliers.create") ? <FornecedorDialog condicoes={terms} /> : undefined}
      />

      <div className="card overflow-x-auto">
        {fornecedores.length === 0 ? (
          <EmptyState
            title="Nenhum fornecedor cadastrado"
            hint="Cadastre manualmente ou importe um XML de NF-e — o fornecedor é criado a partir do emitente."
          />
        ) : (
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr>
                <th className="th">FORNECEDOR</th>
                <th className="th w-44">CNPJ / CPF</th>
                <th className="th w-14">UF</th>
                <th className="th w-40">CONDIÇÃO</th>
                <th className="th w-24 text-right">PRAZO</th>
                <th className="th w-28">SITUAÇÃO</th>
              </tr>
            </thead>
            <tbody>
              {fornecedores.map((f) => (
                <tr key={f.id} className="hover:bg-raise">
                  <td className="td">
                    <Link href={`/cadastros/fornecedores/${f.id}`} className="font-semibold hover:text-accent hover:underline">
                      {f.trade_name ?? f.legal_name}
                    </Link>
                    {f.trade_name && <span className="block text-[11px] text-muted">{f.legal_name}</span>}
                  </td>
                  <td className="td font-mono">{fmtDoc(f.doc_number)}</td>
                  <td className="td">{f.state_uf ?? "—"}</td>
                  <td className="td text-graphite">{f.payment_term?.name ?? "—"}</td>
                  <td className="td text-right font-mono">{f.avg_lead_days ? `${f.avg_lead_days} d` : "—"}</td>
                  <td className="td">
                    <span className={`badge ${BADGE[f.status] ?? BADGE.inativo}`}>{f.status}</span>
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
