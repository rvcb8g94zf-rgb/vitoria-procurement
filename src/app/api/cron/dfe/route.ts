import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { admin, sincronizarEmpresa } from "@/lib/fiscal/sync";

// TLS mútuo com o certificado A1 exige o runtime Node.
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * O Vercel chama o agendamento com "Authorization: Bearer <CRON_SECRET>".
 * Sem a variável configurada (ou curta demais) a rota recusa tudo.
 */
function autorizado(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16 || !header) return false;
  const recebido = Buffer.from(header);
  const esperado = Buffer.from(`Bearer ${secret}`);
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

export async function GET(request: NextRequest) {
  if (!autorizado(request.headers.get("authorization"))) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }

  const db = admin();
  const { data: conexoes } = await db
    .from("fiscal_connections")
    .select("company_id")
    .eq("is_active", true);

  // uma empresa de cada vez: cada CNPJ tem o seu cursor e o seu limite
  // o prazo total da função (60 s) é dividido entre as empresas
  const lista = conexoes ?? [];
  const prazoMs = Math.max(8_000, Math.floor(45_000 / Math.max(lista.length, 1)));
  const resultados = [];
  for (const c of lista) {
    const r = await sincronizarEmpresa(c.company_id, "cron", { prazoMs });
    resultados.push({ company_id: c.company_id, status: r.status, mensagem: r.mensagem });
  }

  return NextResponse.json({ executadas: resultados.length, resultados });
}
