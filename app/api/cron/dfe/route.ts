import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sincronizarEmpresa } from "@/lib/fiscal/sync";

// TLS mútuo com o certificado A1 exige o runtime Node.
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * O Vercel chama o cron com "Authorization: Bearer <CRON_SECRET>".
 * Sem a variável configurada (ou curta demais) a rota recusa tudo —
 * antes, "Bearer undefined" passava quando a variável não existia.
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

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: conexoes } = await db
    .from("fiscal_connections")
    .select("company_id")
    .eq("is_active", true);

  const resultados = [];
  for (const c of conexoes ?? []) {
    resultados.push({
      company_id: c.company_id,
      ...(await sincronizarEmpresa(c.company_id, "cron", `cron-${Date.now()}`)),
    });
  }

  return NextResponse.json({ executadas: resultados.length, resultados });
}
