import Link from "next/link";
import { Hourglass } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { cnpj as fmtDoc } from "@/lib/format";
import { FornecedorDialog } from "./dialog";
import { RevisarFornecedor } from "./revisar";
import { BotaoReceita } from "./receita";

export const maxDuration = 60;
import type { PaymentTerm } from "@/types";

export const metadata = { title: "Fornecedores · Vitória Procurement" };

const BADGE: Record<string, string> = {
  ativo: "bg-accent-soft text-accent-ink",
  pendente: "bg-warn-soft text-warn",
  inativo: "bg-line-soft text-graphite",
  bloqueado: "bg-danger-soft text-danger",
};
const ROTULO: Record<string, string> = {
  ativo: "Ativo",
  pendente: "Aguardando aprovação",
  inativo: "Inativo",
  bloqueado: "Bloqueado",
};
const FILTROS = [
  { valor: "", rotulo: "Todos" },
  { valor: "pendente", rotulo: "Aguardando aprovação" },
  { valor: "ativo", rotulo: "Ativos" },
  { valor: "bloqueado", rotulo: "Bloqueados" },
  { valor: "inativo", rotulo: "Inativos" },
] as const;

export default async function FornecedoresPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { company, permissions } = await requirePermission("suppliers");
  const sp = await searchParams;
  const pedido = (Array.isArray(sp.situacao) ? sp.situacao[0] : sp.situacao) ?? "";
  const supabase = await createClient();

  const [{ data: lista }, { data: condicoes }] = await Promise.all([
    supabase
      .from("suppliers")
      .select("*, payment_term:payment_terms(name), category:categories(name)")
      .eq("company_id", company.id)
      .order("legal_name"),
    supabase.from("payment_terms").select("*").eq("company_id", company.id).order("code"),
  ]);

  const todos = (lista ?? []) as any[];
  const terms = (condicoes ?? []) as PaymentTerm[];
  const pendentes = todos.filter((f) => f.status === "pendente").length;
  // sem filtro escolhido e com fornecedor esperando: abre direto neles
  const situacao = FILTROS.some((f) => f.valor === pedido) ? pedido : "";
  const fornecedores = situacao ? todos.filter((f) => f.status === situacao) : todos;
  const podeAprovar = permissions.has("suppliers.edit");
  const contagem = (v: string) => (v ? todos.filter((f) => f.status === v).length : todos.length);
  const semReceita = todos.filter((f) => f.doc_type === "cnpj" && !f.registry_checked_at && ["ativo", "pendente"].includes(f.status)).length;

  return (
    <div className="max-w-[1200px] px-6 pb-14 pt-5">
      <PageHeader
        crumb="Cadastros"
        title="Fornecedores"
        description={`${todos.length} em ${company.trade_name ?? company.legal_name}.`}
        actions={
          <>
            {podeAprovar && todos.some((f) => f.doc_type === "cnpj") && <BotaoReceita rotulo="Completar pela Receita" />}
            {permissions.has("suppliers.create") && <FornecedorDialog condicoes={terms} />}
          </>
        }
      />

      {pendentes > 0 && situacao !== "pendente" && (
        <Link href="/interno/cadastros/fornecedores?situacao=pendente"
              className="mb-4 flex items-center gap-2.5 rounded bg-warn-soft px-3.5 py-3 text-[12.5px] text-warn hover:underline">
          <Hourglass className="h-4 w-4 shrink-0" strokeWidth={1.8} />
          <span>
            <b>{pendentes} {pendentes === 1 ? "fornecedor aguardando" : "fornecedores aguardando"} aprovação.</b>{" "}
            Chegaram pelas notas fiscais — confira os dados e aprove ou rejeite.
          </span>
        </Link>
      )}

      {podeAprovar && semReceita > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded border border-line bg-surface px-3.5 py-2.5 text-[12.5px] text-graphite">
          <span><b>{semReceita}</b> fornecedor(es) sem os dados da Receita (endereço, telefone, situação do CNPJ). Use “Completar pela Receita” acima; a consulta também roda sozinha depois de cada busca na SEFAZ.</span>
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTROS.map((f) => {
          const ativo = f.valor === situacao;
          const n = contagem(f.valor);
          return (
            <Link
              key={f.valor || "todos"}
              href={f.valor ? `/interno/cadastros/fornecedores?situacao=${f.valor}` : "/interno/cadastros/fornecedores"}
              aria-current={ativo ? "true" : undefined}
              className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium ${
                ativo ? "border-accent bg-accent-soft text-accent-ink"
                      : "border-line text-graphite hover:border-graphite hover:text-ink"}`}
            >
              {f.rotulo} <span className="text-muted">{n}</span>
            </Link>
          );
        })}
      </div>

      <div className="card overflow-x-auto">
        {fornecedores.length === 0 ? (
          <EmptyState
            title={situacao === "pendente" ? "Nenhum fornecedor aguardando aprovação" : "Nenhum fornecedor aqui"}
            hint={situacao
              ? "Troque o filtro acima para ver os demais."
              : "Cadastre manualmente ou importe um XML de NF-e — o fornecedor é criado a partir do emitente."}
          />
        ) : (
          <table className="w-full min-w-[860px] border-collapse">
            <thead>
              <tr>
                <th className="th">FORNECEDOR</th>
                <th className="th w-44">CNPJ / CPF</th>
                <th className="th w-28">CIDADE/UF</th>
                <th className="th w-36">CONDIÇÃO</th>
                <th className="th w-44">SITUAÇÃO</th>
                {podeAprovar && pendentes > 0 && <th className="th w-[190px]" />}
              </tr>
            </thead>
            <tbody>
              {fornecedores.map((f) => (
                <tr key={f.id} className="align-top hover:bg-raise">
                  <td className="td">
                    <Link href={`/interno/cadastros/fornecedores/${f.id}`} className="font-semibold hover:text-accent hover:underline">
                      {f.trade_name ?? f.legal_name}
                    </Link>
                    {f.trade_name && <span className="block text-[11px] text-muted">{f.legal_name}</span>}
                  </td>
                  <td className="td font-mono">{fmtDoc(f.doc_number)}</td>
                  <td className="td text-graphite">
                    {f.city ? `${f.city}/${f.state_uf ?? "—"}` : f.state_uf ?? "—"}
                  </td>
                  <td className="td text-graphite">{f.payment_term?.name ?? "—"}</td>
                  <td className="td">
                    <span className={`badge ${BADGE[f.status] ?? BADGE.inativo}`}>{ROTULO[f.status] ?? f.status}</span>
                    {f.status === "pendente" && (
                      <span className="mt-1 block text-[11px] text-muted">veio de nota fiscal</span>
                    )}
                    {f.registry_status && f.registry_status !== "ATIVA" && (
                      <span className="mt-1 block text-[11px] font-semibold text-danger">CNPJ {String(f.registry_status).toLowerCase()} na Receita</span>
                    )}
                  </td>
                  {podeAprovar && pendentes > 0 && (
                    <td className="td">
                      {f.status === "pendente" && (
                        <RevisarFornecedor id={f.id} nome={f.trade_name ?? f.legal_name} compacto />
                      )}
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
