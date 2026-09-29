"use client";

import { useActionState, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { salvarFornecedor, type FormState } from "./actions";
import type { PaymentTerm, Supplier } from "@/types";

export function FornecedorDialog({
  fornecedor,
  condicoes,
}: {
  fornecedor?: Supplier;
  condicoes: PaymentTerm[];
}) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao, pendente] = useActionState<FormState, FormData>(salvarFornecedor, {});

  useEffect(() => { if (estado.ok) setAberto(false); }, [estado.ok]);

  return (
    <>
      <button onClick={() => setAberto(true)} className={fornecedor ? "btn" : "btn btn-primary"}>
        {fornecedor ? "Editar" : <><Plus className="h-3.5 w-3.5" /> Novo fornecedor</>}
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
          onClick={(e) => e.target === e.currentTarget && setAberto(false)}
        >
          <form action={acao} className="my-8 w-full max-w-[520px] rounded border border-line bg-surface p-5">
            <h2 className="mb-4 text-[16px] font-semibold">
              {fornecedor ? "Editar fornecedor" : "Novo fornecedor"}
            </h2>

            {fornecedor && <input type="hidden" name="id" value={fornecedor.id} />}

            <div className="grid gap-3.5 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="doc_type">Tipo</label>
                <select id="doc_type" name="doc_type" defaultValue={fornecedor?.doc_type ?? "cnpj"} className="field">
                  <option value="cnpj">Pessoa jurídica</option>
                  <option value="cpf">Pessoa física</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="doc_number">CNPJ / CPF</label>
                <input id="doc_number" name="doc_number" required defaultValue={fornecedor?.doc_number}
                       className="field font-mono" placeholder="00.000.000/0000-00" />
              </div>

              <div className="sm:col-span-2">
                <label className="label" htmlFor="legal_name">Razão social</label>
                <input id="legal_name" name="legal_name" required defaultValue={fornecedor?.legal_name} className="field" />
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="trade_name">Nome fantasia</label>
                <input id="trade_name" name="trade_name" defaultValue={fornecedor?.trade_name ?? ""} className="field" />
              </div>

              <div>
                <label className="label" htmlFor="state_reg">Inscrição estadual</label>
                <input id="state_reg" name="state_reg" defaultValue={fornecedor?.state_reg ?? ""} className="field font-mono" />
              </div>
              <div>
                <label className="label" htmlFor="phone">Telefone</label>
                <input id="phone" name="phone" defaultValue={fornecedor?.phone ?? ""} className="field" />
              </div>

              <div>
                <label className="label" htmlFor="city">Cidade</label>
                <input id="city" name="city" defaultValue={fornecedor?.city ?? ""} className="field" />
              </div>
              <div>
                <label className="label" htmlFor="state_uf">UF</label>
                <input id="state_uf" name="state_uf" maxLength={2} defaultValue={fornecedor?.state_uf ?? ""}
                       className="field uppercase" />
              </div>

              <div className="sm:col-span-2">
                <label className="label" htmlFor="email">E-mail</label>
                <input id="email" name="email" type="email" defaultValue={fornecedor?.email ?? ""} className="field" />
              </div>

              <div>
                <label className="label" htmlFor="payment_term_id">Condição de pagamento</label>
                <select id="payment_term_id" name="payment_term_id"
                        defaultValue={fornecedor?.payment_term_id ?? ""} className="field">
                  <option value="">—</option>
                  {condicoes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="avg_lead_days">Prazo médio de entrega (dias)</label>
                <input id="avg_lead_days" name="avg_lead_days" type="number" min={0} max={365}
                       defaultValue={fornecedor?.avg_lead_days ?? ""} className="field font-mono" />
              </div>

              <div className="sm:col-span-2">
                <label className="label" htmlFor="notes">Observações</label>
                <textarea id="notes" name="notes" rows={2} defaultValue={fornecedor?.notes ?? ""}
                          className="field h-auto py-2" />
              </div>
            </div>

            {estado.erro && (
              <p role="alert" className="mt-3 rounded-sm bg-danger-soft px-3 py-2 text-[12px] text-danger">
                {estado.erro}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setAberto(false)} className="btn">Cancelar</button>
              <button type="submit" disabled={pendente} className="btn btn-primary">
                {pendente ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
