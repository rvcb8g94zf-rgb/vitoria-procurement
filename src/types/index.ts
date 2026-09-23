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
  must_change_password: boolean;
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

// ---------- Fase 2 ----------

export type PartyDocType = "cnpj" | "cpf";
export type SupplierStatus = "ativo" | "inativo" | "bloqueado" | "pendente";

export interface Unit {
  id: string;
  code: string;
  name: string;
}

export interface Category {
  id: string;
  company_id: string;
  kind: "supplier" | "product";
  name: string;
  is_active: boolean;
}

export interface PaymentTerm {
  id: string;
  company_id: string;
  code: string;
  name: string;
  days: number[];
  is_active: boolean;
}

export interface Supplier {
  id: string;
  company_id: string;
  code: string | null;
  doc_type: PartyDocType;
  doc_number: string;
  legal_name: string;
  trade_name: string | null;
  state_reg: string | null;
  zip_code: string | null;
  street: string | null;
  street_number: string | null;
  district: string | null;
  city: string | null;
  state_uf: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  category_id: string | null;
  payment_term_id: string | null;
  avg_lead_days: number | null;
  credit_limit: number;
  notes: string | null;
  status: SupplierStatus;
}

export interface SupplierContact {
  id: string;
  supplier_id: string;
  name: string;
  role: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  is_primary: boolean;
}

export interface SupplierBankAccount {
  id: string;
  supplier_id: string;
  bank_code: string | null;
  bank_name: string | null;
  agency: string | null;
  account: string | null;
  account_type: string | null;
  pix_type: string | null;
  pix_key: string | null;
  is_default: boolean;
}

export interface Product {
  id: string;
  company_id: string;
  sku: string;
  description: string;
  unit_id: string;
  category_id: string | null;
  brand: string | null;
  ncm: string | null;
  cest: string | null;
  ean: string | null;
  min_stock: number;
  notes: string | null;
  is_active: boolean;
}

export interface SupplierProduct {
  id: string;
  supplier_id: string;
  product_id: string | null;
  supplier_code: string;
  supplier_desc: string | null;
  supplier_unit_raw: string | null;
  conversion_factor: number;
  ean: string | null;
  ncm: string | null;
  last_unit_price: number | null;
  last_purchase_at: string | null;
  is_confirmed: boolean;
}

export interface PriceHistoryRow {
  id: string;
  product_id: string;
  supplier_id: string | null;
  occurred_on: string;
  unit_price: number;
  quantity: number;
  /** custo cheio, com ST e frete rateados */
  landed_price: number | null;
  document_ref: string | null;
}
