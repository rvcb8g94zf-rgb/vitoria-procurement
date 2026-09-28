import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieList = { name: string; value: string; options?: CookieOptions }[];

// O sistema mora em /interno. Tudo fora dele é o site público (e /api/cron,
// que tem a própria chave, CRON_SECRET) — não passa pela sessão.
const AREA = "/interno";
// Dentro de /interno, rotas que não exigem sessão.
const PUBLIC_ROUTES = ["/interno/login", "/interno/recuperar-senha", "/interno/nova-senha"];

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path !== AREA && !path.startsWith(AREA + "/")) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list: CookieList) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser() valida o token no servidor do Supabase. getSession() apenas lê
  // o cookie e aceitaria um JWT forjado — não trocar por ele.
  const { data: { user } } = await supabase.auth.getUser();

  const isPublic = PUBLIC_ROUTES.some((r) => path.startsWith(r));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/interno/login";
    url.searchParams.set("proximo", path);
    return NextResponse.redirect(url);
  }

  if (user && path === "/interno/login") {
    const url = request.nextUrl.clone();
    url.pathname = AREA;
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
