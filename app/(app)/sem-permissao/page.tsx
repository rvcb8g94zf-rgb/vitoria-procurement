import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export default function SemPermissaoPage() {
  return (
    <div className="grid min-h-[70vh] place-items-center px-6">
      <div className="max-w-[380px] text-center">
        <ShieldAlert className="mx-auto mb-4 h-8 w-8 text-muted" strokeWidth={1.4} />
        <h1 className="text-[18px] font-semibold">Sem permissão</h1>
        <p className="mt-1.5 text-[12.5px] text-muted">
          Você não tem permissão para acessar este recurso nesta empresa.
          Se acredita que deveria ter, fale com o administrador.
        </p>
        <Link href="/" className="btn mt-5 inline-flex">Voltar à visão geral</Link>
      </div>
    </div>
  );
}
