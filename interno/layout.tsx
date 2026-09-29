import type { Metadata } from "next";

// Área dos funcionários: fora do Google e com o título do sistema.
export const metadata: Metadata = {
  title: "Vitória Procurement",
  description: "Gestão de compras, notas fiscais e financeiro — uso interno",
  robots: { index: false, follow: false },
};

export default function InternoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
