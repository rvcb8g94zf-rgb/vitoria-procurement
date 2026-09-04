"use client";

import { useState, useTransition } from "react";
import { Check, ChevronDown } from "lucide-react";
import { trocarEmpresa } from "@/app/actions";
import { cnpj as fmtCnpj } from "@/lib/format";
import type { Company, Membership } from "@/types";

export function CompanySwitcher({
  memberships,
  current,
}: {
  memberships: Membership[];
  current: Company;
}) {
  const [aberto, setAberto] = useState(false);
  const [pendente, startTransition] = useTransition();

  const nome = (c: Company) => c.trade_name ?? c.legal_name;
  const sigla = (c: Company) =>
    nome(c).split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");

  return (
    <div className="relative mx-3 mb-1.5 mt-3">
      <button
        onClick={() => setAberto((v) => !v)}
        disabled={pendente}
        aria-expanded={aberto}
        className="flex w-full items-center gap-2.5 rounded-sm border border-line bg-raise px-2.5 py-2 text-left hover:border-accent"
      >
        <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[5px] bg-accent-soft text-[10px] font-semibold text-accent">
          {sigla(current)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-semibold">{nome(current)}</span>
          <span className="block font-mono text-[10px] text-muted">{fmtCnpj(current.cnpj)}</span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" />
      </button>

      {aberto && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded border border-line bg-surface shadow-lg">
          {memberships.map(({ company, role }) => (
            <button
              key={company.id}
              onClick={() => {
                setAberto(false);
                startTransition(() => { trocarEmpresa(company.id); });
              }}
              className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left hover:bg-raise"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium">{nome(company)}</span>
                <span className="block text-[10.5px] text-muted">{role.name}</span>
              </span>
              {company.id === current.id && <Check className="h-3.5 w-3.5 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
