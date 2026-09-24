import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { ConsultaPreview } from "./preview";

export const metadata = { title: "Consulta NF-e · Vitória Procurement" };

/**
 * PREVIEW VISUAL. Dados fictícios, sem conexão com a SEFAZ.
 * Nada aqui consulta, manifesta ou grava. Serve para aprovar o layout
 * antes de construir a integração de verdade.
 */
export default async function ConsultaNFePage() {
  const { company } = await requirePermission("invoices");

  return (
    <div className="max-w-[1200px] px-6 pb-14 pt-5">
      <PageHeader
        crumb="Notas fiscais"
        title="Consulta NF-e"
        description={`Notas emitidas por fornecedores contra ${company.trade_name ?? company.legal_name}.`}
      />
      <ConsultaPreview empresa={company.trade_name ?? company.legal_name} />
    </div>
  );
}
