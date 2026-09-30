"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { Ban, Link2, Plus } from "lucide-react";
import { Modal, Aviso } from "@/components/modal";
import { validarItem, type ValidarState } from "./actions";

type Produto = { id: string; sku: string; description: string };
type Pend = {
  id: string; supplier_code: string | null; description: string; unit: string | null;
  suggested_product_id: string | null; suggested_product: string | null;
};

export function AcoesValidacao({
  item, produtos, unidades, podeCriar,
}: { item: Pend; produtos: Produto[]; unidades: { code: string; name: string }[]; podeCriar: boolean }) {
  const [modo, setModo] = useState<null | "ligar" | "criar" | "ignorar">(null);
  const [st, acao, pend] = useActionState<ValidarState, FormData>(validarItem, {});
  const [texto, setTexto] = useState(item.suggested_product ?? "");
  useEffect(() => { if (st.ok) setModo(null); }, [st]);

  const rotulo = (p: Produto) => `${p.sku} — ${p.description}`;
  const escolhido = useMemo(() => produtos.find((p) => rotulo(p) === texto), [texto, produtos]);
  const listaId = `prods-${item.id}`;
  const unidadeNota = (item.unit ?? "").toUpperCase();
  const unidadePadrao = unidades.find((u) => u.code === unidadeNota)?.code ?? "";

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <button type="button" className="btn btn-primary h-7 px-2 text-[11.5px]" onClick={() => setModo("ligar")}>
        <Link2 className="h-3.5 w-3.5" /> Ligar
      </button>
      {podeCriar && (
        <button type="button" className="btn h-7 px-2 text-[11.5px]" onClick={() => setModo("criar")}>
          <Plus className="h-3.5 w-3.5" /> Criar produto
        </button>
      )}
      <button type="button" className="btn h-7 px-2 text-[11.5px]" onClick={() => setModo("ignorar")}>
        <Ban className="h-3.5 w-3.5" /> Ignorar
      </button>
      {st.ok && st.msg && <span role="status" className="w-full text-right text-[11.5px] text-accent-ink">{st.msg}</span>}

      {modo && (
        <Modal
          title={modo === "ligar" ? "Ligar a um produto do cadastro" : modo === "criar" ? "Criar produto" : "Ignorar item"}
          onClose={() => setModo(null)}
          width="max-w-[520px]"
        >
          <form action={acao} className="grid gap-3 px-4 py-4">
            <input type="hidden" name="id" value={item.id} />
            <input type="hidden" name="acao" value={modo} />
            <p className="text-[12.5px] text-graphite">
              <b>{item.description}</b>
              {item.supplier_code && <> · código do fornecedor <span className="font-mono">{item.supplier_code}</span></>}
            </p>

            {modo === "ligar" && (
              <div>
                <label className="label" htmlFor={`p-${item.id}`}>Produto</label>
                <input id={`p-${item.id}`} name="produto" list={listaId} className="field" autoFocus required
                       value={texto} onChange={(e) => setTexto(e.target.value)}
                       placeholder="Digite o SKU ou parte da descrição" />
                <datalist id={listaId}>
                  {produtos.map((p) => <option key={p.id} value={rotulo(p)} />)}
                </datalist>
                <input type="hidden" name="produto_id" value={escolhido?.id ?? ""} />
                <p className="mt-1 text-[11.5px] text-muted">
                  As próximas notas deste fornecedor com este código já entram ligadas.
                </p>
              </div>
            )}

            {modo === "criar" && (
              <>
                <div className="grid grid-cols-[1fr_120px] gap-3">
                  <div>
                    <label className="label" htmlFor={`s-${item.id}`}>Código (SKU) no nosso cadastro</label>
                    <input id={`s-${item.id}`} name="sku" required maxLength={40} className="field font-mono" autoFocus />
                  </div>
                  <div>
                    <label className="label" htmlFor={`u-${item.id}`}>Unidade</label>
                    <select id={`u-${item.id}`} name="unidade" className="field" defaultValue={unidadePadrao}>
                      <option value="">pela nota ({item.unit ?? "—"})</option>
                      {unidades.map((u) => <option key={u.code} value={u.code}>{u.code} · {u.name}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor={`d-${item.id}`}>Descrição</label>
                  <input id={`d-${item.id}`} name="descricao" required minLength={3} maxLength={200}
                         className="field" defaultValue={item.description} />
                </div>
                <p className="text-[11.5px] text-muted">NCM e EAN vêm da nota.</p>
              </>
            )}

            {modo === "ignorar" && (
              <div>
                <label className="label" htmlFor={`m-${item.id}`}>Por que não entra no cadastro?</label>
                <input id={`m-${item.id}`} name="motivo" required minLength={5} maxLength={500} className="field" autoFocus
                       placeholder="ex.: frete / serviço / material de uso interno" />
              </div>
            )}

            <Aviso erro={st.erro} />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setModo(null)}>Voltar</button>
              <button type="submit" className="btn btn-primary" disabled={pend}>
                {pend ? "Salvando…" : modo === "ligar" ? "Ligar" : modo === "criar" ? "Criar e ligar" : "Ignorar"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
