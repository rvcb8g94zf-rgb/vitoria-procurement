import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/session";

export const metadata = { title: "Relatórios · Vitória Procurement" };

const RELATORIOS = [
  {
    href: "/relatorios/custo",
    titulo: "Custo real por produto",
    nota: "Preço de nota contra custo cheio, com ICMS-ST e frete rateados. Disponível agora.",
    pronto: true,
  },
  { href: "#", titulo: "Compras por período", nota: "Depende dos pedidos da Fase 3.", pronto: false },
  { href: "#", titulo: "Posição financeira", nota: "Depende das duplicatas da Fase 5.", pronto: false },
  { href: "#", titulo: "Auditoria", nota: "Trilha completa de alterações.", pronto: false },
];

export default async function RelatoriosPage() {
  await requirePermission("reports");

  return (
    <div className="max-w-[820px] px-6 pb-14 pt-5">
      <PageHeader crumb="Gestão" title="Relatórios" />

      <div className="card divide-y divide-line-soft">
        {RELATORIOS.map((r) =>
          r.pronto ? (
            <Link key={r.titulo} href={r.href as any} className="flex items-center gap-3 px-4 py-3.5 hover:bg-raise">
              <div>
                <div className="text-[13.5px] font-semibold">{r.titulo}</div>
                <div className="text-[11.5px] text-muted">{r.nota}</div>
              </div>
              <ArrowRight className="ml-auto h-4 w-4 text-muted" strokeWidth={1.6} />
            </Link>
          ) : (
            <div key={r.titulo} className="flex items-center gap-3 px-4 py-3.5 opacity-55">
              <div>
                <div className="text-[13.5px] font-semibold">{r.titulo}</div>
                <div className="text-[11.5px] text-muted">{r.nota}</div>
              </div>
              <span className="badge ml-auto bg-line-soft text-graphite">em breve</span>
            </div>
          )
        )}
      </div>
    </div>
  );
}
