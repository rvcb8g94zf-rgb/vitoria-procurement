export default function SemEmpresaPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-6">
      <div className="max-w-[380px] text-center">
        <h1 className="text-[18px] font-semibold">Nenhuma empresa vinculada</h1>
        <p className="mt-1.5 text-[12.5px] text-muted">
          Sua conta existe, mas ainda não foi vinculada a nenhuma empresa.
          Peça a um administrador para liberar seu acesso.
        </p>
      </div>
    </main>
  );
}
