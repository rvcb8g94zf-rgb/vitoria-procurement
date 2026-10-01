import { RecuperarForm } from "./form";

export const metadata = { title: "Esqueci minha senha · Vitória Procurement" };

export default async function RecuperarSenhaPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-5">
      <div className="w-full max-w-[360px]">
        <div className="mb-8 flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-[7px] bg-accent font-display text-[15px] font-bold text-white">V</div>
          <div className="leading-tight">
            <div className="font-display text-[16px] font-semibold">Vitória</div>
            <div className="text-[10px] tracking-wide text-muted">PROCUREMENT</div>
          </div>
        </div>
        <h1 className="text-[19px] font-semibold">Esqueci minha senha</h1>
        <p className="mb-6 mt-1 text-[12.5px] text-muted">
          Digite o e-mail que você usa para entrar. Vamos mandar um link para criar uma senha nova.
        </p>
        {erro === "link" && (
          <p role="alert" className="mb-4 rounded bg-warn-soft px-3 py-2 text-[12px] text-warn">
            O link expirou ou já foi usado. Peça um novo abaixo.
          </p>
        )}
        <RecuperarForm />
      </div>
    </main>
  );
}
