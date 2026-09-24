import Link from "next/link";
import { payableFiltersToQuery, payablePresets, STATUS_PAGAR, type PayableFilters } from "@/lib/financeiro";

/**
 * Filtros numa linha, acima da lista. Formulário GET: o recorte fica na
 * URL, dá para voltar, recarregar e mandar o link para alguém.
 */
export function FiltrosPagar({
  filtros, fornecedores, hoje, action = "/financeiro/contas-a-pagar",
}: {
  filtros: PayableFilters;
  fornecedores: { id: string; nome: string }[];
  hoje: string;
  action?: "/financeiro/contas-a-pagar";
}) {
  return (
    <div className="card mb-4 print:hidden">
      <div className="flex flex-wrap gap-1.5 border-b border-line-soft px-4 py-2.5">
        {payablePresets(hoje).map((p) => {
          const ativo = p.de === filtros.de && p.ate === filtros.ate && p.situacao === filtros.situacao;
          return (
            <Link
              key={p.label}
              href={{ pathname: action, query: payableFiltersToQuery({ ...filtros, de: p.de, ate: p.ate, situacao: p.situacao }) }}
              aria-current={ativo ? "true" : undefined}
              className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium ${
                ativo ? "border-accent bg-accent-soft text-accent-ink"
                      : "border-line text-graphite hover:border-graphite hover:text-ink"}`}
            >
              {p.label}
            </Link>
          );
        })}
      </div>

      <form method="get" action={action}
            className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.4fr_1fr_1.2fr_auto]">
        <div>
          <label className="label" htmlFor="p-de">Vencimento de</label>
          <input id="p-de" name="de" type="date" defaultValue={filtros.de} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="p-ate">até</label>
          <input id="p-ate" name="ate" type="date" defaultValue={filtros.ate} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="p-forn">Fornecedor</label>
          <select id="p-forn" name="fornecedor" defaultValue={filtros.fornecedor} className="field">
            <option value="">Todos</option>
            {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="p-sit">Situação</label>
          <select id="p-sit" name="situacao" defaultValue={filtros.situacao} className="field">
            {STATUS_PAGAR.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="p-busca">Descrição, documento ou nota</label>
          <input id="p-busca" name="busca" defaultValue={filtros.busca} className="field" placeholder="ex.: 9426" />
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" className="btn btn-primary">Filtrar</button>
          <Link href={action} className="btn">Limpar</Link>
        </div>
      </form>
    </div>
  );
}
