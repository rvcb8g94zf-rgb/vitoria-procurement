import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vitória Procurement",
  description: "Gestão inteligente de compras e documentos fiscais",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" data-theme="light" suppressHydrationWarning>
      <head>
        {/* Fontes por <link> em vez de next/font: evita o download no build
            e mantém o deploy funcionando em ambiente sem rede aberta. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
