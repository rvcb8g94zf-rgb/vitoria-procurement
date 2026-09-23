import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TrocarSenhaForm } from "./form";

export const metadata = { title: "Trocar senha · Vitória Procurement" };

export default async function TrocarSenhaPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: perfil } = await supabase
    .from("users")
    .select("full_name, must_change_password")
    .eq("id", user.id)
    .maybeSingle<{ full_name: string; must_change_password: boolean }>();

  const obrigatorio = Boolean(perfil?.must_change_password);

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-5">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-[7px] bg-accent font-display text-[15px] font-bold text-white">
            V
          </div>
          <div className="leading-tight">
            <div className="font-display text-[16px] font-semibold">Vitória</div>
            <div className="text-[10px] tracking-wide text-muted">PROCUREMENT</div>
          </div>
        </div>

        <h1 className="text-[19px] font-semibold">
          {obrigatorio ? "Crie a sua senha" : "Trocar senha"}
        </h1>
        <p className="mb-6 mt-1 text-[12.5px] text-muted">
          {obrigatorio
            ? "A senha atual foi criada por um administrador. Escolha uma que só você saiba para continuar."
            : `Você está em ${user.email}. A senha nova passa a valer na hora.`}
        </p>

        <TrocarSenhaForm obrigatorio={obrigatorio} />
      </div>
    </main>
  );
}
