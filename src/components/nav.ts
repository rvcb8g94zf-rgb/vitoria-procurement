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
    items: [{ label: "Visão geral", href: "/interno", module: "dashboard", icon: "LayoutGrid" }],
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
      { label: "Todas as notas", href: "/interno/notas", module: "invoices", icon: "Receipt" },
      { label: "Consulta SEFAZ", href: "/interno/notas/consulta", module: "dfe", icon: "RadioTower" },
      { label: "Importar XML", href: "/interno/notas/importar", module: "xml_import", icon: "Upload" },
      { label: "Divergências", href: "/interno/notas/divergencias", module: "divergences", icon: "TriangleAlert", soon: true },
      { label: "Validar cadastros", href: "/interno/notas/validacao", module: "pending_registrations", icon: "UserRoundCheck", soon: true },
    ],
  },
  {
    title: "FINANCEIRO",
    items: [
      { label: "Fechamento de caixa", href: "/interno/financeiro/caixa", module: "cash", icon: "Banknote" },
      { label: "Duplicatas", href: "/interno/financeiro/duplicatas", module: "installments", icon: "CreditCard" },
      { label: "Contas a pagar", href: "/interno/financeiro/contas-a-pagar", module: "accounts_payable", icon: "Wallet" },
      { label: "Pagamentos", href: "/interno/financeiro/pagamentos", module: "payments", icon: "ArrowLeftRight" },
      { label: "Calendário", href: "/interno/financeiro/calendario", module: "accounts_payable", icon: "CalendarDays" },
    ],
  },
  {
    title: "CADASTROS",
    items: [
      { label: "Fornecedores", href: "/interno/cadastros/fornecedores", module: "suppliers", icon: "Users" },
      { label: "Produtos", href: "/interno/cadastros/produtos", module: "products", icon: "Boxes" },
      { label: "Departamentos", href: "/interno/cadastros/departamentos", module: "departments", icon: "Building2" },
      { label: "Centros de custo", href: "/interno/cadastros/centros-de-custo", module: "cost_centers", icon: "Landmark" },
    ],
  },
  {
    title: "GESTÃO",
    items: [
      { label: "Relatórios", href: "/interno/relatorios", module: "reports", icon: "BarChart3" },
      { label: "Usuários", href: "/interno/admin/usuarios", module: "users", icon: "UserCog" },
      { label: "Perfis de acesso", href: "/interno/admin/perfis", module: "roles", icon: "ShieldCheck", soon: true },
      { label: "Auditoria", href: "/interno/admin/auditoria", module: "audit", icon: "History", soon: true },
      { label: "Parâmetros", href: "/interno/admin/parametros", module: "settings", icon: "Settings" },
    ],
  },
];
