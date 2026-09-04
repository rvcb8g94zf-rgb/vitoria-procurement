// Espelho tipado do RBAC. Serve para esconder o que o usuário não pode
// ver — nunca para autorizar. A decisão real está em app.has_permission()
// e nas policies de RLS; isto aqui só evita mostrar porta que não abre.

export const MODULES = [
  "dashboard", "purchase_requests", "quotations", "purchase_orders",
  "approvals", "goods_receipts", "invoices", "xml_import", "divergences",
  "installments", "accounts_payable", "payments", "suppliers", "products",
  "categories", "departments", "cost_centers", "companies", "users", "roles",
  "approval_flows", "documents", "reports", "audit", "settings",
  "pending_registrations", "cost_allocations",
] as const;

export const ACTIONS = [
  "view", "create", "edit", "delete",
  "approve", "cancel", "export", "pay", "import",
] as const;

export type Module = (typeof MODULES)[number];
export type Action = (typeof ACTIONS)[number];

/** Conjunto de permissões efetivas, no formato "modulo.acao". */
export type PermissionSet = ReadonlySet<string>;

export function can(perms: PermissionSet, module: Module, action: Action = "view") {
  return perms.has(`${module}.${action}`);
}

export function canAny(perms: PermissionSet, module: Module, actions: Action[]) {
  return actions.some((a) => can(perms, module, a));
}
