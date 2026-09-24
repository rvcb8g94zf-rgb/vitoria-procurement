import Link from "next/link";
import { invoiceFiltersToQuery, addDays, type InvoiceFilters } from "@/lib/notas";

/** Filtros na URL: dá para voltar, recarregar e mandar o link para alguém. */
export function FiltrosNotas({
  filters,
  fornecedores,
  hoje,
}: {
  filters: InvoiceFilters;
  fornecedores: { id: string; nome: string }[];
  hoje: string;
}) {
  const atalhos = [
    { label: "30 dias", de: addDays(hoje, -29), ate: hoje },
    { label: "90 dias", de: addDays(hoje, -89), ate: hoje },
    { label: "Este ano", de: hoje.slice(0, 4) + "-01-01", ate: hoje },
  ];

  return (
    <div className="card mb-4">
      <div className="flex flex-wrap gap-1.5 border-b border-line-soft px-4 py-2.5">
        {atalhos.map((a) => {
          const ativo = a.de === filters.de && a.ate === filters.ate;
          return (
            <Link
              key={a.label}
              href={{ pathname: "/notas", query: invoiceFiltersToQuery({ ...filters, de: a.de, ate: a.ate }) }}
              aria-current={ativo ? "true" : undefined}
              className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium ${
                ativo ? "border-accent bg-accent-soft text-accent-ink" : "border-line text-graphite hover:border-graphite hover:text-ink"
              }`}
            >
              {a.label}
            </Link>
          );
        })}
      </div>

      <form method="get" action="/notas" className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.4fr_1fr_1.4fr_auto]">
        <div>
          <label className="label" htmlFor="n-de">Emissão de</label>
          <input id="n-de" name="de" type="date" defaultValue={filters.de} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="n-ate">até</label>
          <input id="n-ate" name="ate" type="date" defaultValue={filters.ate} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="n-forn">Fornecedor</label>
          <select id="n-forn" name="fornecedor" defaultValue={filters.fornecedor} className="field">
            <option value="">Todos</option>
            {fornecedores.map((f) => (
              <option key={f.id} value={f.id}>{f.nome}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="n-sit">Situação</label>
          <select id="n-sit" name="situacao" defaultValue={filters.situacao} className="field">
            <option value="">Todas</option>
            <option value="autorizada">Autorizada</option>
            <option value="cancelada">Cancelada</option>
            <option value="sem_fornecedor">Sem fornecedor cadastrado</option>
            <option value="resumo">Só o resumo (falta o XML)</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="n-busca">Número, chave ou emitente</label>
          <input id="n-busca" name="busca" defaultValue={filters.busca} className="field" placeholder="ex.: 9426" />
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" className="btn btn-primary h-9">Filtrar</button>
          <Link href="/notas" className="btn h-9">Limpar</Link>
        </div>
      </form>
    </div>
  );
}
