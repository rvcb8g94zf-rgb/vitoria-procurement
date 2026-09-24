import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { cnpj } from "@/lib/format";
import { Uploader } from "./uploader";

export const metadata = { title: "Importar relatório de caixa · Vitória Procurement" };

export default async function ImportarCaixaPage() {
  const { company } = await requirePermission("cash", "create");

  return (
    <div className="max-w-[980px] px-6 pb-14 pt-5">
      <PageHeader
        crumb={<>Financeiro · <Link href="/financeiro/caixa" className="hover:text-ink">Fechamento de caixa</Link></>}
        title="Importar relatório de caixa"
        description="O sistema lê o arquivo, confere se as somas fecham e mostra o resultado antes de registrar."
      />
      <Uploader empresa={company.trade_name ?? company.legal_name} cnpj={cnpj(company.cnpj)} />
    </div>
  );
}
