// Entidades da Fase 1. Espelham o schema aplicado nas migrações 0001–0007.

export type UserStatus = "ativo" | "inativo" | "bloqueado";
export type ToleranceRule = "either" | "both";

export interface AppUser {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  job_title: string | null;
  avatar_path: string | null;
  status: UserStatus;
  is_superadmin: boolean;
  last_seen_at: string | null;
}

export interface Company {
  id: string;
  legal_name: string;
  trade_name: string | null;
  cnpj: string;
  state_reg: string | null;
  city: string | null;
  state_uf: string | null;
  timezone: string;
  is_active: boolean;
}

export interface Role {
  id: string;
  company_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  is_system: boolean;
  rank: number;
}

export interface Department {
  id: string;
  company_id: string;
  code: string;
  name: string;
  manager_id: string | null;
  is_active: boolean;
}

export interface CostCenter {
  id: string;
  company_id: string;
  department_id: string | null;
  code: string;
  name: string;
  responsible_id: string | null;
  monthly_budget: number;
  annual_budget: number;
  is_active: boolean;
}

export interface CompanySettings {
  company_id: string;
  tolerance_rule: ToleranceRule;
  price_tol_pct: number;
  price_tol_abs: number;
  total_tol_pct: number;
  total_tol_abs: number;
  quantity_tol_pct: number;
  quantity_tol_abs: number;
  accept_favorable_variance: boolean;
  favorable_review_pct: number;
  auto_register_supplier: boolean;
  auto_register_product: boolean;
  block_import_on_divergence: boolean;
  require_cost_center: boolean;
}

/** Vínculo do usuário com uma empresa, já com o perfil resolvido. */
export interface Membership {
  company: Company;
  role: Role;
  is_default: boolean;
}
