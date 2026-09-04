"use client";

import { useState } from "react";
import { Bell, Menu, Moon, Search, Sun } from "lucide-react";
import { Sidebar } from "./sidebar";
import { sair } from "@/app/actions";
import { initials } from "@/lib/format";
import type { AppUser, Company, Membership, Role } from "@/types";

export function AppShell({
  user, role, company, memberships, permissions, children,
}: {
  user: AppUser;
  role: Role;
  company: Company;
  memberships: Membership[];
  permissions: string[];
  children: React.ReactNode;
}) {
  const [menuAberto, setMenuAberto] = useState(false);
  const [escuro, setEscuro] = useState(false);

  function alternarTema() {
    const proximo = !escuro;
    setEscuro(proximo);
    document.documentElement.dataset.theme = proximo ? "dark" : "light";
  }

  return (
    <div className="flex h-screen">
      <Sidebar
        permissions={permissions}
        memberships={memberships}
        company={company}
        open={menuAberto}
        onNavigate={() => setMenuAberto(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[58px] shrink-0 items-center gap-2.5 border-b border-line bg-surface px-4">
          <button
            onClick={() => setMenuAberto((v) => !v)}
            aria-label="Abrir menu"
            className="grid h-[30px] w-[30px] place-items-center rounded-sm text-graphite hover:bg-line-soft hover:text-ink md:hidden"
          >
            <Menu className="h-4 w-4" strokeWidth={1.6} />
          </button>

          <button className="flex h-8 max-w-[420px] flex-1 items-center gap-2 rounded-sm border border-line bg-raise px-2.5 text-[12.5px] text-muted hover:border-graphite">
            <Search className="h-3.5 w-3.5" strokeWidth={1.6} />
            <span className="truncate">Buscar fornecedor, NF-e, pedido…</span>
            <kbd className="ml-auto hidden rounded border border-line px-1.5 font-mono text-[10.5px] sm:block">
              Ctrl K
            </kbd>
          </button>

          <div className="flex-1" />

          <button
            onClick={alternarTema}
            aria-label={escuro ? "Tema claro" : "Tema escuro"}
            className="grid h-[30px] w-[30px] place-items-center rounded-sm text-graphite hover:bg-line-soft hover:text-ink"
          >
            {escuro ? <Sun className="h-4 w-4" strokeWidth={1.6} /> : <Moon className="h-4 w-4" strokeWidth={1.6} />}
          </button>

          <button aria-label="Notificações" className="grid h-[30px] w-[30px] place-items-center rounded-sm text-graphite hover:bg-line-soft hover:text-ink">
            <Bell className="h-4 w-4" strokeWidth={1.6} />
          </button>

          <div className="ml-1 flex items-center gap-2.5 border-l border-line-soft pl-3">
            <div className="hidden text-right leading-tight sm:block">
              <div className="text-[12px] font-semibold">{user.full_name}</div>
              <div className="text-[10.5px] text-muted">{role.name}</div>
            </div>
            <span className="grid h-7 w-7 place-items-center rounded-full bg-ink text-[11px] font-semibold text-surface">
              {initials(user.full_name)}
            </span>
            <form action={sair}>
              <button className="text-[11.5px] text-muted hover:text-ink">Sair</button>
            </form>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
