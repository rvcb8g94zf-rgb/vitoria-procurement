import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { todayISO } from "@/lib/caixa";
import { SolicitacaoForm } from "../form";
import { opcoesSolicitacao } from "../opcoes";

export const metadata = { title: "Nova solicitação · Vitória Procurement" };

export default async function NovaSolicitacaoPage() {
  const { company } = await requirePermission("purchase_requests", "create");
  const o = await opcoesSolicitacao(company.id);
  return (
    <div className="max-w-[1100px] px-6 pb-14 pt-5">
      <PageHeader crumb={<>Compras · <Link href="/interno/compras/solicitacoes" className="hover:text-ink">Solicitações</Link></>}
                  title="Nova solicitação de compra"
                  description="Diga o que precisa e para quando. O Compras cota ou faz o pedido e você acompanha por aqui." />
      <SolicitacaoForm inicial={{}} {...o} hoje={todayISO()} />
    </div>
  );
}
