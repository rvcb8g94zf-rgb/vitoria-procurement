import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { cnpj } from "@/lib/format";
import { Uploader } from "./uploader";

export const metadata = { title: "Importar XML · Vitória Procurement" };

export default async function ImportarNotasPage() {
  const { company } = await requirePermission("xml_import", "import");

  return (
    <div className="max-w-[1000px] px-6 pb-14 pt-5">
      <PageHeader
        crumb={<>Notas fiscais · <Link href="/notas" className="hover:text-ink">Notas recebidas</Link></>}
        title="Importar XML de NF-e"
        description="O sistema lê a nota, separa os itens, guarda as duplicatas e liga fornecedor e produtos ao cadastro."
      />
      <Uploader empresa={company.trade_name ?? company.legal_name} cnpj={cnpj(company.cnpj)} />
    </div>
  );
}
