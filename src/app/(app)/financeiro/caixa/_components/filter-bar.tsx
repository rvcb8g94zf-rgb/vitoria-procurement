import Link from "next/link";
import {
  filtersToQuery, methodOptions, moneyInputValue, presets,
  type CashFilters, type PaymentMethod,
} from "@/lib/caixa";

/**
 * Filtros numa linha, acima de tudo o que eles afetam. Formulário GET
 * comum: os filtros ficam na URL — dá para voltar, recarregar e mandar o
 * link para alguém com o mesmo recorte.
 */
export function FilterBar({
  filters, methods, action, today,
}: {
  filters: CashFilters;
  methods: PaymentMethod[];
  action: "/financeiro/caixa" | "/financeiro/caixa/relatorio";
  today: string;
}) {
  const groups = methodOptions(methods);

  return (
    <div className="card mb-4 print:hidden">
      <div className="flex flex-wrap gap-1.5 border-b border-line-soft px-4 py-2.5">
        {presets(today).map((p) => {
          const active = p.de === filters.de && p.ate === filters.ate;
          return (
            <Link
              key={p.label}
              href={{ pathname: action, query: filtersToQuery({ ...filters, de: p.de, ate: p.ate }) }}
              aria-current={active ? "true" : undefined}
              className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium ${
                active ? "border-accent bg-accent-soft text-accent-ink" : "border-line text-graphite hover:border-graphite hover:text-ink"
              }`}
            >
              {p.label}
            </Link>
          );
        })}
      </div>

      <form method="get" action={action} className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.4fr_1fr_1fr_auto]">
        <div>
          <label className="label" htmlFor="f-de">De</label>
          <input id="f-de" name="de" type="date" defaultValue={filters.de} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="f-ate">Até</label>
          <input id="f-ate" name="ate" type="date" defaultValue={filters.ate} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="f-mod">Modalidade de pagamento</label>
          <select id="f-mod" name="modalidade" defaultValue={filters.modalidade} className="field">
            <option value="">Todas as modalidades</option>
            {groups.map((g) =>
              g.methods.length === 1 ? (
                <option key={g.kind} value={g.methods[0].code}>{g.methods[0].label}</option>
              ) : (
                <optgroup key={g.kind} label={g.label}>
                  <option value={`kind:${g.kind}`}>{g.label} — todas</option>
                  {g.methods.map((m) => (
                    <option key={m.code} value={m.code}>{m.label}</option>
                  ))}
                </optgroup>
              )
            )}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-min">Valor mínimo (R$)</label>
          <input id="f-min" name="min" inputMode="decimal" placeholder="0,00"
                 defaultValue={moneyInputValue(filters.min)} className="field font-mono" />
        </div>
        <div>
          <label className="label" htmlFor="f-max">Valor máximo (R$)</label>
          <input id="f-max" name="max" inputMode="decimal" placeholder="sem limite"
                 defaultValue={moneyInputValue(filters.max)} className="field font-mono" />
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" className="btn btn-primary h-9">Filtrar</button>
          <Link href={action} className="btn h-9">Limpar</Link>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 sm:col-span-2 lg:col-span-6">
          <label className="flex items-center gap-2 text-[12px] text-graphite">
            <input type="checkbox" name="cancelados" value="1" defaultChecked={filters.cancelados}
                   className="h-4 w-4 accent-[var(--accent)]" />
            Incluir fechamentos cancelados
          </label>
          <span className="text-[11.5px] text-muted">
            O valor filtra o total de pedidos pagos do dia — ou, com uma modalidade escolhida, o valor dela.
          </span>
        </div>
      </form>
    </div>
  );
}
