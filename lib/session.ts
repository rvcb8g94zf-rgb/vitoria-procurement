import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AppUser, Company, Membership, Role } from "@/types";
import type { PermissionSet } from "@/lib/permissions";

export const COMPANY_COOKIE = "vp_empresa";

export interface Session {
  user: AppUser;
  memberships: Membership[];
  company: Company;
  role: Role;
  permissions: PermissionSet;
}

/**
 * Carrega usuário, vínculos, empresa ativa e permissões efetivas.
 * `cache` mantém uma única execução por request, mesmo que layout e
 * página chamem separadamente.
 */
export const getSession = cache(async (): Promise<Session> => {
  const supabase = await createClient();

  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("*")
    .eq("id", authUser.id)
    .single<AppUser>();

  if (!profile) redirect("/login");
  if (profile.status !== "ativo") redirect("/sem-empresa");

  const { data: rows } = await supabase
    .from("user_companies")
    .select("is_default, company:companies(*), role:roles(*)")
    .eq("user_id", authUser.id)
    .eq("is_active", true);

  const memberships: Membership[] = (rows ?? [])
    .map((r: any) => ({
      is_default: r.is_default,
      company: r.company as Company,
      role: r.role as Role,
    }))
    .filter((m) => m.company)
    .sort((a, b) =>
      (a.company.trade_name ?? a.company.legal_name).localeCompare(
        b.company.trade_name ?? b.company.legal_name, "pt-BR"
      )
    );

  if (memberships.length === 0) redirect("/sem-empresa");

  const store = await cookies();
  const wanted = store.get(COMPANY_COOKIE)?.value;

  const active =
    memberships.find((m) => m.company.id === wanted) ??
    memberships.find((m) => m.is_default) ??
    memberships[0];

  const { data: perms } = await supabase.rpc("my_permissions", {
    _company_id: active.company.id,
  });

  return {
    user: profile,
    memberships,
    company: active.company,
    role: active.role,
    permissions: new Set<string>((perms as string[] | null) ?? []) as PermissionSet,
  };
});

/**
 * Guarda de página. Não substitui o RLS — o banco recusa a linha de
 * qualquer forma. Serve para devolver 403 legível em vez de tela vazia.
 */
export async function requirePermission(module: string, action = "view") {
  const session = await getSession();
  if (!session.permissions.has(`${module}.${action}`)) redirect("/sem-permissao");
  return session;
}
