"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Icons from "lucide-react";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { NAV } from "./nav";
import { CompanySwitcher } from "./company-switcher";
import type { Company, Membership } from "@/types";

function Icon({ name, className }: { name: string; className?: string }) {
  const C = (Icons as any)[name] ?? Icons.Circle;
  return <C className={className} strokeWidth={1.6} />;
}

// Grupos recolhidos ficam guardados neste navegador. É só conveniência:
// se o armazenamento falhar (aba anônima, bloqueio), tudo abre normalmente.
const CHAVE = "vp.menu.recolhidos";
function lerRecolhidos(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(CHAVE) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function gravarRecolhidos(v: string[]) {
  try {
    window.localStorage.setItem(CHAVE, JSON.stringify(v));
  } catch {
    /* sem armazenamento: o menu segue funcionando, só não lembra */
  }
}

export function Sidebar({
  permissions,
  memberships,
  company,
  open,
  onNavigate,
}: {
  permissions: string[];
  memberships: Membership[];
  company: Company;
  open: boolean;
  onNavigate: () => void;
}) {
  const path = usePathname();
  const allowed = new Set(permissions);

  const groups = NAV
    .map((g) => ({ ...g, items: g.items.filter((i) => allowed.has(`${i.module}.view`)) }))
    .filter((g) => g.items.length > 0);

  // Item ativo = o de endereço mais longo que casa com a página. Assim, em
  // /notas/importar fica marcado "Importar XML", e não "Todas as notas".
  const ativo = groups
    .flatMap((g) => g.items)
    .filter((i) => !i.soon && (i.href === "/" ? path === "/" : path === i.href || path.startsWith(i.href + "/")))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const grupoAtivo = groups.find((g) => g.items.some((i) => i.href === ativo))?.title;

  // Começa tudo aberto (igual no servidor e no navegador); depois de montar,
  // aplica o que o usuário tinha recolhido.
  const [recolhidos, setRecolhidos] = useState<string[]>([]);
  useEffect(() => { setRecolhidos(lerRecolhidos()); }, []);

  // ao entrar numa página, o grupo dela abre sozinho
  useEffect(() => {
    if (!grupoAtivo) return;
    setRecolhidos((r) => {
      if (!r.includes(grupoAtivo)) return r;
      const novo = r.filter((t) => t !== grupoAtivo);
      gravarRecolhidos(novo);
      return novo;
    });
  }, [grupoAtivo]);

  const alternar = (titulo: string) =>
    setRecolhidos((r) => {
      const novo = r.includes(titulo) ? r.filter((t) => t !== titulo) : [...r, titulo];
      gravarRecolhidos(novo);
      return novo;
    });

  const todosRecolhidos = groups.every((g) => recolhidos.includes(g.title) || g.title === grupoAtivo);
  const alternarTodos = () => {
    // "recolher tudo" mantém aberto o grupo da página em que a pessoa está
    const novo = todosRecolhidos ? [] : groups.map((g) => g.title).filter((t) => t !== grupoAtivo);
    gravarRecolhidos(novo);
    setRecolhidos(novo);
  };

  return (
    <aside
      className={`fixed z-40 flex h-full w-[264px] flex-col border-r border-line bg-surface
                  transition-transform md:static md:translate-x-0 print:hidden
                  ${open ? "translate-x-0 shadow-[0_0_0_100vw_rgba(0,0,0,0.35)] md:shadow-none" : "-translate-x-full"}`}
    >
      <div className="flex h-[58px] items-center gap-2.5 border-b border-line-soft px-4">
        <div className="grid h-[26px] w-[26px] place-items-center rounded-[7px] bg-accent font-display text-[13px] font-bold text-white">
          V
        </div>
        <div className="leading-tight">
          <div className="font-display text-[14px] font-semibold">Vitória</div>
          <div className="text-[10px] text-muted">PROCUREMENT</div>
        </div>
      </div>

      <CompanySwitcher memberships={memberships} current={company} />

      <div className="flex justify-end px-3 pt-1">
        <button
          type="button"
          onClick={alternarTodos}
          className="inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-[10.5px] font-medium text-muted hover:bg-line-soft hover:text-ink"
        >
          {todosRecolhidos
            ? <><ChevronsUpDown className="h-3 w-3" /> Expandir tudo</>
            : <><ChevronsDownUp className="h-3 w-3" /> Recolher tudo</>}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {groups.map((g) => {
          const fechado = recolhidos.includes(g.title);
          const idLista = `menu-${g.title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
          const prontos = g.items.filter((i) => !i.soon).length;
          return (
            <div key={g.title}>
              <button
                type="button"
                onClick={() => alternar(g.title)}
                aria-expanded={!fechado}
                aria-controls={idLista}
                className="group flex w-full items-center gap-1.5 rounded-sm px-2.5 pb-1.5 pt-3 text-left
                           text-[10px] font-semibold tracking-[0.09em] text-muted hover:text-ink"
              >
                <span>{g.title}</span>
                {fechado && (
                  <span className="rounded-full bg-line-soft px-1.5 text-[9.5px] font-medium tracking-normal">
                    {prontos > 0 ? prontos : "em breve"}
                  </span>
                )}
                {fechado && g.title === grupoAtivo && (
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="página atual neste grupo" />
                )}
                {fechado
                  ? <ChevronRight className="ml-auto h-3.5 w-3.5" strokeWidth={2} />
                  : <ChevronDown className="ml-auto h-3.5 w-3.5" strokeWidth={2} />}
              </button>

              <div id={idLista} hidden={fechado}>
                {g.items.map((item) => {
                  // tela ainda não construída: fica visível, mas não leva a lugar nenhum
                  if (item.soon) {
                    return (
                      <div
                        key={item.href}
                        aria-disabled="true"
                        className="flex cursor-default items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-[13px] text-muted"
                      >
                        <Icon name={item.icon} className="h-4 w-4 shrink-0 opacity-60" />
                        <span className="truncate">{item.label}</span>
                        <span className="ml-auto shrink-0 rounded-full bg-line-soft px-1.5 py-0.5 text-[9.5px] font-medium text-muted">
                          em breve
                        </span>
                      </div>
                    );
                  }

                  const active = item.href === ativo;
                  return (
                    <Link
                      key={item.href}
                      href={item.href as any}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={`relative flex items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-[13px]
                        ${active
                          ? "bg-accent-soft font-semibold text-accent-ink before:absolute before:-left-2 before:bottom-1.5 before:top-1.5 before:w-0.5 before:rounded-r before:bg-accent"
                          : "text-graphite hover:bg-line-soft hover:text-ink"}`}
                    >
                      <Icon name={item.icon} className="h-4 w-4 shrink-0" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
