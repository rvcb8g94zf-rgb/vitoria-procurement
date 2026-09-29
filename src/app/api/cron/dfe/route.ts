import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { admin, sincronizarEmpresa } from "@/lib/fiscal/sync";
import { completarPendentes } from "@/lib/cnpj";

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

  const inicio = Date.now();
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

  // depois da SEFAZ: fornecedores que chegaram só pelo resumo da nota ganham
  // endereço e contato pela base da Receita, no tempo que sobrar
  const { data: empresas } = await db.from("companies").select("id").eq("is_active", true);
  const cadastro = [];
  for (const e of empresas ?? []) {
    const sobra = 55_000 - (Date.now() - inicio);
    if (sobra < 12_000) break;
    cadastro.push({ company_id: e.id, ...(await completarPendentes(db, e.id, { limite: 5, prazoMs: sobra - 4_000 }).catch(() => ({ feitos: 0, completados: 0 }))) });
  }

  return NextResponse.json({ executadas: resultados.length, resultados, cadastro });
}
