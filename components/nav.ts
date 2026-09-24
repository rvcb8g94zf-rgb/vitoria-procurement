import type { Module } from "@/lib/permissions";

export interface NavItem {
  label: string;
  href: string;
  module: Module;
  icon: string;   // nome do ícone em lucide-react
  soon?: boolean; // tela ainda não construída: aparece no menu, sem link
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/**
 * Árvore completa do menu. Cada item declara o módulo que o libera —
 * a sidebar filtra pelo que o usuário realmente tem.
 */
export const NAV: NavGroup[] = [
  {
    title: "GERAL",
    items: [{ label: "Visão geral", href: "/", module: "dashboard", icon: "LayoutGrid" }],
  },
  {
    title: "COMPRAS",
    items: [
      { label: "Solicitações", href: "/compras/solicitacoes", module: "purchase_requests", icon: "FileText", soon: true },
      { label: "Cotações", href: "/compras/cotacoes", module: "quotations", icon: "ListChecks", soon: true },
      { label: "Pedidos de compra", href: "/compras/pedidos", module: "purchase_orders", icon: "ClipboardList", soon: true },
      { label: "Aprovações", href: "/compras/aprovacoes", module: "approvals", icon: "CheckCheck", soon: true },
      { label: "Recebimentos", href: "/compras/recebimentos", module: "goods_receipts", icon: "PackageCheck", soon: true },
    ],
  },
  {
    title: "NOTAS FISCAIS",
    items: [
      { label: "Todas as notas", href: "/notas", module: "invoices", icon: "Receipt", soon: true },
      { label: "Consulta automática", href: "/notas/consulta", module: "invoices", icon: "RadioTower" },
      { label: "Importar XML", href: "/notas/importar", module: "xml_import", icon: "Upload", soon: true },
      { label: "Divergências", href: "/notas/divergencias", module: "divergences", icon: "TriangleAlert", soon: true },
      { label: "Validar cadastros", href: "/notas/validacao", module: "pending_registrations", icon: "UserRoundCheck", soon: true },
    ],
  },
  {
    title: "FINANCEIRO",
    items: [
      { label: "Fechamento de caixa", href: "/financeiro/caixa", module: "cash", icon: "Banknote" },
      { label: "Duplicatas", href: "/financeiro/duplicatas", module: "installments", icon: "CreditCard", soon: true },
      { label: "Contas a pagar", href: "/financeiro/contas-a-pagar", module: "accounts_payable", icon: "Wallet", soon: true },
      { label: "Pagamentos", href: "/financeiro/pagamentos", module: "payments", icon: "ArrowLeftRight", soon: true },
      { label: "Calendário", href: "/financeiro/calendario", module: "accounts_payable", icon: "CalendarDays", soon: true },
    ],
  },
  {
    title: "CADASTROS",
    items: [
      { label: "Fornecedores", href: "/cadastros/fornecedores", module: "suppliers", icon: "Users" },
      { label: "Produtos", href: "/cadastros/produtos", module: "products", icon: "Boxes" },
      { label: "Departamentos", href: "/cadastros/departamentos", module: "departments", icon: "Building2" },
      { label: "Centros de custo", href: "/cadastros/centros-de-custo", module: "cost_centers", icon: "Landmark" },
    ],
  },
  {
    title: "GESTÃO",
    items: [
      { label: "Relatórios", href: "/relatorios", module: "reports", icon: "BarChart3" },
      { label: "Usuários", href: "/admin/usuarios", module: "users", icon: "UserCog" },
      { label: "Perfis de acesso", href: "/admin/perfis", module: "roles", icon: "ShieldCheck", soon: true },
      { label: "Auditoria", href: "/admin/auditoria", module: "audit", icon: "History", soon: true },
      { label: "Parâmetros", href: "/admin/parametros", module: "settings", icon: "Settings" },
    ],
  },
];
