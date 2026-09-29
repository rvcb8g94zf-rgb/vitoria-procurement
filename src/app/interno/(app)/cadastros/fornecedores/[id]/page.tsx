import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { cnpj as fmtDoc, date, money } from "@/lib/format";
import { Hourglass } from "lucide-react";
import { FornecedorDialog } from "../dialog";
import { RevisarFornecedor } from "../revisar";
import { BotaoReceita } from "../receita";

export const maxDuration = 60;
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
        crumb={<>Cadastros · <Link href="/interno/cadastros/fornecedores" className="hover:text-ink">Fornecedores</Link></>}
        title={f.trade_name ?? f.legal_name}
        description={`${fmtDoc(f.doc_number)} · ${f.city ?? "—"}/${f.state_uf ?? "—"}`}
        actions={permissions.has("suppliers.edit")
          ? <FornecedorDialog fornecedor={f as Supplier} condicoes={(condicoes ?? []) as PaymentTerm[]} />
          : undefined}
      />

      {f.status === "pendente" && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded bg-warn-soft px-3.5 py-3 text-[12.5px] text-warn">
          <Hourglass className="h-4 w-4 shrink-0" strokeWidth={1.8} />
          <p className="min-w-0 flex-1">
            <b>Aguardando aprovação.</b> Este fornecedor foi cadastrado automaticamente a partir de uma nota fiscal.
            Confira os dados (use <b>Editar</b> para completar condição de pagamento, contato etc.) e aprove.
          </p>
          {permissions.has("suppliers.edit") && (
            <RevisarFornecedor id={f.id} nome={f.trade_name ?? f.legal_name} />
          )}
        </div>
      )}
      {f.status === "bloqueado" && (
        <div className="mb-4 rounded bg-danger-soft px-3.5 py-3 text-[12.5px] text-danger">
          <b>Fornecedor bloqueado.</b> O motivo está nas observações abaixo.
        </div>
      )}
      {f.registry_status && f.registry_status !== "ATIVA" && (
        <div className="mb-4 rounded bg-danger-soft px-3.5 py-3 text-[12.5px] text-danger">
          <b>CNPJ {String(f.registry_status).toLowerCase()} na Receita Federal</b>
          {f.registry_status_date ? ` desde ${date(f.registry_status_date)}` : ""}. Confira antes de comprar ou pagar.
        </div>
      )}
      {f.notes && (
        <p className="mb-4 whitespace-pre-line rounded border border-line bg-surface px-3.5 py-2.5 text-[12px] text-graphite">
          {f.notes}
        </p>
      )}

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

      {f.doc_type === "cnpj" && (
        <section className="card mb-4">
          <div className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-3">
            <div>
              <h3 className="text-[13.5px] font-semibold">Receita Federal</h3>
              <p className="mt-0.5 text-[11.5px] text-muted">
                {f.registry_checked_at
                  ? `Consultado em ${date(f.registry_checked_at)}${f.registry_error ? ` — ${f.registry_error}` : ""}. Só completa campos vazios; nada que foi digitado é trocado.`
                  : "Ainda não consultado. A consulta completa endereço, telefone e e-mail que o resumo da nota não traz."}
              </p>
            </div>
            {permissions.has("suppliers.edit") && (
              <div className="ml-auto"><BotaoReceita id={f.id} rotulo={f.registry_checked_at ? "Consultar de novo" : "Buscar dados na Receita"} /></div>
            )}
          </div>
          {f.registry_checked_at && !f.registry_error && (
            <div className="grid grid-cols-2 gap-px bg-line lg:grid-cols-4">
              {[
                { l: "Situação cadastral", v: f.registry_status ?? "—" },
                { l: "Atividade principal", v: f.cnae_desc ? `${f.cnae_code} · ${f.cnae_desc}` : "—" },
                { l: "Porte", v: f.company_size ?? "—" },
                { l: "Simples Nacional", v: f.mei_opt ? "MEI" : f.simples_opt === true ? "Optante" : f.simples_opt === false ? "Não optante" : "—" },
              ].map((k) => (
                <div key={k.l} className="bg-surface px-4 py-3">
                  <div className="text-[11px] font-medium text-muted">{k.l}</div>
                  <div className={`mt-1 text-[12.5px] font-semibold ${k.l === "Situação cadastral" && f.registry_status && f.registry_status !== "ATIVA" ? "text-danger" : ""}`}>{k.v}</div>
                </div>
              ))}
            </div>
          )}
          {(f.street || f.city || f.phone || f.email) && (
            <p className="border-t border-line-soft px-4 py-2.5 text-[12px] text-graphite">
              {[ [f.street, f.street_number].filter(Boolean).join(", "), f.complement, f.district,
                 [f.city, f.state_uf].filter(Boolean).join("/"), f.zip_code ? `CEP ${String(f.zip_code).replace(/(\d{5})(\d{3})/, "$1-$2")}` : null,
               ].filter(Boolean).join(" · ")}
              {f.phone && <> · tel. {f.phone}</>}{f.email && <> · {f.email}</>}
            </p>
          )}
        </section>
      )}

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
                      <Link href={`/interno/cadastros/produtos/${i.product.id}`} className="font-medium hover:text-accent hover:underline">
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
