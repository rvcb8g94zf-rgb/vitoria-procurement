import Link from "next/link";
import { ChevronLeft, ChevronRight, Wallet } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiRow } from "@/components/panels";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";
import { todayISO } from "@/lib/caixa";
import {
  addMonths, mesPorExtenso, monthEnd, monthGrid, monthStart,
  payableFiltersToQuery, type CalendarDay,
} from "@/lib/financeiro";

export const metadata = { title: "Calendário de pagamentos · Vitória Procurement" };

const inicial = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const curto = (v: number) =>
  v >= 1000 ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : money(v);

export default async function CalendarioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { company } = await requirePermission("accounts_payable");
  const sp = await searchParams;
  const hoje = todayISO();
  const mesParam = um(sp.mes);
  const ancora = /^\d{4}-\d{2}$/.test(mesParam ?? "") ? `${mesParam}-01` : monthStart(hoje);
  const inicio = monthStart(ancora);
  const fim = monthEnd(ancora);
  const semanas = monthGrid(ancora);
  const supabase = await createClient();

  // a grade mostra dias dos meses vizinhos: busca o intervalo todo
  const { data, error } = await supabase.rpc("payables_calendar", {
    _company_id: company.id,
    _from: semanas[0][0],
    _to: semanas[semanas.length - 1][6],
  });
  if (error) console.error("[calendario] busca", error);

  const dias = new Map<string, CalendarDay>();
  for (const d of (data ?? []) as any[]) {
    dias.set(d.day, {
      day: d.day,
      titulos: Number(d.titulos ?? 0),
      total: Number(d.total ?? 0),
      aberto: Number(d.aberto ?? 0),
      pago: Number(d.pago ?? 0),
    });
  }

  const doMes = [...dias.values()].filter((d) => d.day >= inicio && d.day <= fim);
  const totalMes = doMes.reduce((s, d) => s + d.total, 0);
  const abertoMes = doMes.reduce((s, d) => s + d.aberto, 0);
  const pagoMes = doMes.reduce((s, d) => s + d.pago, 0);
  const titulosMes = doMes.reduce((s, d) => s + d.titulos, 0);
  const pico = doMes.slice().sort((a, b) => b.aberto - a.aberto)[0];

  const mesAnterior = addMonths(ancora, -1).slice(0, 7);
  const mesSeguinte = addMonths(ancora, 1).slice(0, 7);
  const linkDia = (dia: string) => ({
    pathname: "/financeiro/contas-a-pagar",
    query: payableFiltersToQuery({ de: dia, ate: dia, fornecedor: "", situacao: "", busca: "" }),
  });

  return (
    <div className="max-w-[1240px] px-6 pb-14 pt-5">
      <PageHeader
        crumb="Financeiro"
        title="Calendário de pagamentos"
        description="Quanto vence em cada dia, para planejar o caixa da semana."
        actions={
          <Link href="/financeiro/contas-a-pagar" className="btn">
            <Wallet className="h-3.5 w-3.5" /> Contas a pagar
          </Link>
        }
      />

      <div className="card mb-4 flex flex-wrap items-center gap-2 px-4 py-2.5">
        <Link href={{ pathname: "/financeiro/calendario", query: { mes: mesAnterior } }}
              className="btn h-7 px-2 text-[11.5px]" aria-label="Mês anterior">
          <ChevronLeft className="h-3.5 w-3.5" /> {mesPorExtenso(addMonths(ancora, -1)).split(" de ")[0]}
        </Link>
        <h2 className="px-2 text-[13.5px] font-semibold">{inicial(mesPorExtenso(ancora))}</h2>
        <Link href={{ pathname: "/financeiro/calendario", query: { mes: mesSeguinte } }}
              className="btn h-7 px-2 text-[11.5px]" aria-label="Próximo mês">
          {mesPorExtenso(addMonths(ancora, 1)).split(" de ")[0]} <ChevronRight className="h-3.5 w-3.5" />
        </Link>
        {ancora !== monthStart(hoje) && (
          <Link href="/financeiro/calendario" className="btn h-7 px-2 text-[11.5px]">Voltar para hoje</Link>
        )}
      </div>

      <KpiRow
        items={[
          { label: "Vence no mês", value: money(totalMes), note: `${titulosMes} ${titulosMes === 1 ? "título" : "títulos"}` },
          { label: "Ainda em aberto", value: money(abertoMes) },
          { label: "Já pago", value: money(pagoMes) },
          ...(pico && pico.aberto > 0
            ? [{ label: "Dia mais pesado", value: money(pico.aberto), note: `dia ${pico.day.slice(8)}` }]
            : []),
        ]}
      />

      <div className="card overflow-x-auto">
        <div className="min-w-[840px]">
          <div className="grid grid-cols-7 border-b border-line-soft">
            {DIAS.map((d) => (
              <div key={d} className="px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted">{d}</div>
            ))}
          </div>
          {semanas.map((semana) => (
            <div key={semana[0]} className="grid grid-cols-7 border-b border-line-soft last:border-b-0">
              {semana.map((dia) => {
                const info = dias.get(dia);
                const foraDoMes = dia < inicio || dia > fim;
                const ehHoje = dia === hoje;
                const atrasado = info && info.aberto > 0 && dia < hoje;
                return (
                  <div key={dia}
                       className={`min-h-[92px] border-r border-line-soft px-2.5 py-2 last:border-r-0 ${
                         foraDoMes ? "bg-raise/50 text-muted" : ""} ${ehHoje ? "bg-accent-soft/40" : ""}`}>
                    <div className={`text-[12px] ${ehHoje ? "font-semibold text-accent-ink" : foraDoMes ? "" : "text-graphite"}`}>
                      {Number(dia.slice(8))}
                    </div>
                    {info && info.titulos > 0 && (
                      <Link href={linkDia(dia)} className="mt-1.5 block rounded px-1 py-0.5 hover:bg-raise">
                        <span className={`block font-mono text-[12.5px] font-semibold tabular-nums ${
                          atrasado ? "text-danger" : info.aberto > 0 ? "text-ink" : "text-muted line-through"}`}>
                          {curto(info.aberto > 0 ? info.aberto : info.total)}
                        </span>
                        <span className="block text-[10.5px] text-muted">
                          {info.titulos} {info.titulos === 1 ? "título" : "títulos"}
                          {info.aberto === 0 && " · pago"}
                        </span>
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <p className="mt-3 text-[11.5px] text-muted">
        O valor mostrado é o que ainda falta pagar naquele dia. Dias já quitados aparecem riscados;
        dias vencidos, em vermelho. Clique num dia para ver os títulos.
      </p>
    </div>
  );
}
