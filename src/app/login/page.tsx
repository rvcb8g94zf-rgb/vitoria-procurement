import { LoginForm } from "./login-form";

export const metadata = { title: "Entrar · Vitória Procurement" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ proximo?: string }>;
}) {
  const { proximo } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-5">
      <div className="w-full max-w-[360px]">
        <div className="mb-8 flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-[7px] bg-accent font-display text-[15px] font-bold text-white">
            V
          </div>
          <div className="leading-tight">
            <div className="font-display text-[16px] font-semibold">Vitória</div>
            <div className="text-[10px] tracking-wide text-muted">PROCUREMENT</div>
          </div>
        </div>

        <h1 className="text-[19px] font-semibold">Entrar</h1>
        <p className="mb-6 mt-1 text-[12.5px] text-muted">
          Acesse com o e-mail cadastrado pela sua empresa.
        </p>

        <LoginForm proximo={proximo} />
      </div>
    </main>
  );
}
