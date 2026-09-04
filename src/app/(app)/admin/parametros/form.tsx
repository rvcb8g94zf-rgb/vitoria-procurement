"use client";

import { useActionState } from "react";
import { salvarParametros, type FormState } from "./actions";
import type { CompanySettings } from "@/types";

function Secao({ titulo, nota, children }: { titulo: string; nota?: string; children: React.ReactNode }) {
  return (
    <section className="card mb-4">
      <div className="border-b border-line-soft px-4 py-3">
        <h3 className="text-[13.5px] font-semibold">{titulo}</h3>
        {nota && <p className="mt-0.5 text-[11.5px] text-muted">{nota}</p>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Num({ nome, rotulo, valor, sufixo, ro }: {
  nome: string; rotulo: string; valor: number; sufixo: string; ro: boolean;
}) {
  return (
    <div>
      <label className="label" htmlFor={nome}>{rotulo}</label>
      <div className="flex items-center gap-2">
        <input id={nome} name={nome} type="number" step="0.01" min="0"
               defaultValue={valor} disabled={ro} className="field font-mono" />
        <span className="text-[12px] text-muted">{sufixo}</span>
      </div>
    </div>
  );
}

function Check({ nome, rotulo, nota, valor, ro }: {
  nome: string; rotulo: string; nota: string; valor: boolean; ro: boolean;
}) {
  return (
    <label className="flex gap-2.5 py-2">
      <input type="checkbox" name={nome} defaultChecked={valor} disabled={ro} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
      <span>
        <span className="block text-[13px] font-medium">{rotulo}</span>
        <span className="block text-[11.5px] text-muted">{nota}</span>
      </span>
    </label>
  );
}

export function ParametrosForm({ settings, somenteLeitura }: { settings: CompanySettings; somenteLeitura: boolean }) {
  const [estado, acao, pendente] = useActionState<FormState, FormData>(salvarParametros, {});
  const ro = somenteLeitura;

  return (
    <form action={acao}>
      <Secao titulo="Tolerância de conferência" nota="Aplicada na comparação entre o pedido de compra e a NF-e.">
        <div className="mb-4">
          <label className="label" htmlFor="tolerance_rule">Como combinar percentual e valor</label>
          <select id="tolerance_rule" name="tolerance_rule" defaultValue={settings.tolerance_rule} disabled={ro} className="field">
            <option value="either">Tolerar se estiver dentro do percentual OU do valor</option>
            <option value="both">Tolerar só se estiver dentro dos dois</option>
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Num nome="price_tol_pct" rotulo="Preço unitário" valor={settings.price_tol_pct} sufixo="%" ro={ro} />
          <Num nome="price_tol_abs" rotulo="Preço unitário" valor={settings.price_tol_abs} sufixo="R$" ro={ro} />
          <Num nome="total_tol_pct" rotulo="Total do documento" valor={settings.total_tol_pct} sufixo="%" ro={ro} />
          <Num nome="total_tol_abs" rotulo="Total do documento" valor={settings.total_tol_abs} sufixo="R$" ro={ro} />
          <Num nome="quantity_tol_pct" rotulo="Quantidade" valor={settings.quantity_tol_pct} sufixo="%" ro={ro} />
          <Num nome="quantity_tol_abs" rotulo="Quantidade" valor={settings.quantity_tol_abs} sufixo="un" ro={ro} />
        </div>
      </Secao>

      <Secao titulo="Variação favorável" nota="NF-e mais barata que o pedido.">
        <Check nome="accept_favorable_variance" rotulo="Aceitar nota mais barata sem gerar divergência"
               nota="Vale para preço e total. Quantidade menor continua sendo falta de entrega."
               valor={settings.accept_favorable_variance} ro={ro} />
        <div className="mt-3 max-w-[280px]">
          <Num nome="favorable_review_pct" rotulo="Sinalizar desconto acima de"
               valor={settings.favorable_review_pct} sufixo="%" ro={ro} />
          <p className="mt-1.5 text-[11.5px] text-muted">
            Desconto muito grande costuma ser unidade ou produto trocado. Continua sendo aceito, mas aparece na conferência.
          </p>
        </div>
      </Secao>

      <Secao titulo="Importação de XML">
        <Check nome="auto_register_supplier" rotulo="Cadastrar fornecedor automaticamente"
               nota="Desligado, fornecedor novo entra na fila de validação." valor={settings.auto_register_supplier} ro={ro} />
        <Check nome="auto_register_product" rotulo="Cadastrar produto automaticamente"
               nota="Desligado, produto novo entra na fila de validação." valor={settings.auto_register_product} ro={ro} />
        <Check nome="block_import_on_divergence" rotulo="Bloquear importação com divergência"
               nota="Ligado, a nota só entra depois de resolvida." valor={settings.block_import_on_divergence} ro={ro} />
        <Check nome="require_cost_center" rotulo="Exigir centro de custo"
               nota="Item sem rateio não avança no fluxo." valor={settings.require_cost_center} ro={ro} />
      </Secao>

      {estado.erro && (
        <p role="alert" className="mb-3 rounded-sm bg-danger-soft px-3 py-2 text-[12px] text-danger">{estado.erro}</p>
      )}
      {estado.ok && (
        <p role="status" className="mb-3 rounded-sm bg-accent-soft px-3 py-2 text-[12px] text-accent-ink">Parâmetros salvos.</p>
      )}

      {!ro && (
        <button type="submit" disabled={pendente} className="btn btn-primary">
          {pendente ? "Salvando…" : "Salvar parâmetros"}
        </button>
      )}
    </form>
  );
}
