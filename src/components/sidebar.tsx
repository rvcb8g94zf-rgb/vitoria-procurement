"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Icons from "lucide-react";
import { NAV } from "./nav";
import { CompanySwitcher } from "./company-switcher";
import type { Company, Membership } from "@/types";

function Icon({ name, className }: { name: string; className?: string }) {
  const C = (Icons as any)[name] ?? Icons.Circle;
  return <C className={className} strokeWidth={1.6} />;
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

  return (
    <aside
      className={`fixed z-40 flex h-full w-[264px] flex-col border-r border-line bg-surface
                  transition-transform md:static md:translate-x-0
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

      <nav className="flex-1 overflow-y-auto px-2 pb-4 pt-1.5">
        {groups.map((g) => (
          <div key={g.title}>
            <div className="px-2.5 pb-1.5 pt-3.5 text-[10px] font-semibold tracking-[0.09em] text-muted">
              {g.title}
            </div>
            {g.items.map((item) => {
              const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
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
        ))}
      </nav>
    </aside>
  );
}
