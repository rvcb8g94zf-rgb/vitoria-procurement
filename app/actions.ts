"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_COOKIE } from "@/lib/session";

export async function trocarEmpresa(companyId: string) {
  const supabase = await createClient();

  // confere o vínculo antes de gravar o cookie: cookie forjado não
  // daria acesso (o RLS barra), mas deixaria a interface incoerente
  const { data } = await supabase
    .from("user_companies")
    .select("company_id")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .maybeSingle();

  if (!data) return;

  const store = await cookies();
  store.set(COMPANY_COOKIE, companyId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });

  revalidatePath("/", "layout");
}

export async function sair() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const store = await cookies();
  store.delete(COMPANY_COOKIE);
  redirect("/login");
}
