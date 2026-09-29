"use client";

import { useActionState, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Modal, Aviso } from "@/components/modal";
import { criarTitulo, type FormState } from "./actions";

/**
 * Título que não vem de nota: aluguel, imposto, serviço, frete avulso.
 * O que vem de NF-e é gerado na tela de duplicatas, não aqui.
 */
export function NovoTitulo({
  fornecedores, hoje,
}: {
  fornecedores: { id: string; nome: string }[];
  hoje: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao, pendente] = useActionState<FormState, FormData>(criarTitulo, {});

  useEffect(() => { if (estado.ok) setAberto(false); }, [estado]);

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setAberto(true)}>
        <Plus className="h-3.5 w-3.5" /> Novo título
      </button>

      {aberto && (
        <Modal title="Novo título a pagar" onClose={() => setAberto(false)} width="max-w-[560px]">
          <form action={acao} className="grid gap-3 px-4 py-4">
            <div>
              <label className="label" htmlFor="n-desc">Descrição</label>
              <input id="n-desc" name="descricao" required minLength={3} maxLength={200}
                     className="field" placeholder="ex.: Aluguel da loja — outubro" autoFocus />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="n-venc">Vencimento</label>
                <input id="n-venc" name="vencimento" type="date" required className="field" />
              </div>
              <div>
                <label className="label" htmlFor="n-valor">Valor</label>
                <input id="n-valor" name="valor" type="number" step="0.01" min="0.01" required
                       className="field" placeholder="0,00" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="n-forn">Fornecedor do cadastro</label>
                <select id="n-forn" name="fornecedor" defaultValue="" className="field">
                  <option value="">Nenhum</option>
                  {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="n-cob">ou quem cobra</label>
                <input id="n-cob" name="cobrador" maxLength={160} className="field"
                       placeholder="ex.: Imobiliária Vitória" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="n-doc">Documento (opcional)</label>
                <input id="n-doc" name="documento" maxLength={80} className="field" placeholder="ex.: Contrato 12/2024" />
              </div>
              <div>
                <label className="label" htmlFor="n-emi">Emissão (opcional)</label>
                <input id="n-emi" name="emissao" type="date" max={hoje} className="field" />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="n-obs">Observação (opcional)</label>
              <input id="n-obs" name="observacao" maxLength={500} className="field" />
            </div>
            <Aviso erro={estado.erro} />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setAberto(false)}>Voltar</button>
              <button type="submit" className="btn btn-primary" disabled={pendente}>
                {pendente ? "Criando…" : "Criar título"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
