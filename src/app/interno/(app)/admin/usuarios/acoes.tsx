"use client";

import { useActionState, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Power, RefreshCw, UserCog } from "lucide-react";
import { alternarAcesso, redefinirSenha, trocarPerfil, type FormState } from "./actions";

const LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
const NUMEROS = "23456789";
const sortear = (alfabeto: string, n: number) => {
  const v = new Uint32Array(n);
  crypto.getRandomValues(v);
  return Array.from(v, (x) => alfabeto[x % alfabeto.length]).join("");
};
const gerarSenha = () =>
  [sortear(LETRAS, 4), sortear(LETRAS + NUMEROS, 4), sortear(NUMEROS, 2) + sortear(LETRAS, 2)].join("-");

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {children}
    </div>
  );
}

export function AcoesUsuario({
  id,
  nome,
  email,
  perfilAtual,
  ativo,
  perfis,
}: {
  id: string;
  nome: string;
  email: string;
  perfilAtual: string;
  ativo: boolean;
  perfis: { id: string; name: string; description: string | null }[];
}) {
  const [modal, setModal] = useState<null | "perfil" | "senha" | "acesso">(null);
  const [senha, setSenha] = useState("");
  const [copiado, setCopiado] = useState(false);

  const [ePerfil, aPerfil, pPerfil] = useActionState<FormState, FormData>(trocarPerfil, {});
  const [eSenha, aSenha, pSenha] = useActionState<FormState, FormData>(redefinirSenha, {});
  const [eAcesso, aAcesso, pAcesso] = useActionState<FormState, FormData>(alternarAcesso, {});

  useEffect(() => { if (ePerfil.ok) setModal(null); }, [ePerfil]);
  useEffect(() => { if (eAcesso.ok) setModal(null); }, [eAcesso]);

  const fechar = () => setModal(null);

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <button type="button" className="btn h-7 px-2 text-[11.5px]" onClick={() => setModal("perfil")}>
        <UserCog className="h-3.5 w-3.5" /> Perfil
      </button>
      <button
        type="button"
        className="btn h-7 px-2 text-[11.5px]"
        onClick={() => { setSenha(gerarSenha()); setCopiado(false); setModal("senha"); }}
      >
        <KeyRound className="h-3.5 w-3.5" /> Senha
      </button>
      <button type="button" className="btn h-7 px-2 text-[11.5px]" onClick={() => setModal("acesso")}>
        <Power className="h-3.5 w-3.5" /> {ativo ? "Desativar" : "Reativar"}
      </button>

      {modal === "perfil" && (
        <Modal onClose={fechar}>
          <form action={aPerfil} className="my-16 w-full max-w-[420px] rounded border border-line bg-surface p-5 text-left" role="dialog" aria-modal="true">
            <h2 className="text-[16px] font-semibold">Perfil de {nome}</h2>
            <p className="mt-1 text-[12.5px] text-muted">Vale para a empresa ativa. Nas outras empresas o perfil continua como está.</p>
            <input type="hidden" name="id" value={id} />
            <label className="label mt-4" htmlFor={`perfil-${id}`}>Perfil de acesso</label>
            <select id={`perfil-${id}`} name="perfil" defaultValue={perfilAtual} className="field">
              {perfis.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {ePerfil.erro && <p role="alert" className="mt-3 rounded-sm bg-danger-soft px-3 py-2 text-[12px] text-danger">{ePerfil.erro}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn" onClick={fechar} disabled={pPerfil}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={pPerfil}>{pPerfil ? "Salvando…" : "Salvar"}</button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "senha" && (
        <Modal onClose={fechar}>
          <div className="my-16 w-full max-w-[420px] rounded border border-line bg-surface p-5 text-left" role="dialog" aria-modal="true">
            {eSenha.ok ? (
              <>
                <h2 className="text-[16px] font-semibold">Senha redefinida</h2>
                <p className="mt-1.5 text-[12.5px] text-graphite">
                  Entregue a senha abaixo para <b>{nome}</b>. O sistema vai pedir uma nova no próximo acesso.
                </p>
                <div className="mt-4 rounded-sm border border-line bg-raise px-3.5 py-3 font-mono text-[12.5px]">
                  <div className="text-muted">E-mail</div>
                  <div className="mb-2 break-all font-medium">{email}</div>
                  <div className="text-muted">Senha provisória</div>
                  <div className="font-medium">{senha}</div>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button" className="btn"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(`E-mail: ${email}\nSenha: ${senha}`);
                        setCopiado(true);
                      } catch { setCopiado(false); }
                    }}
                  >
                    {copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiado ? "Copiado" : "Copiar"}
                  </button>
                  <button type="button" className="btn btn-primary" onClick={fechar}>Fechar</button>
                </div>
              </>
            ) : (
              <form action={aSenha}>
                <h2 className="text-[16px] font-semibold">Redefinir a senha de {nome}</h2>
                <p className="mt-1 text-[12.5px] text-muted">
                  A senha atual deixa de valer na hora. A nova é provisória: a pessoa troca no próximo acesso.
                </p>
                <input type="hidden" name="id" value={id} />
                <label className="label mt-4" htmlFor={`senha-${id}`}>Senha provisória</label>
                <div className="flex gap-2">
                  <input
                    id={`senha-${id}`} name="senha" required minLength={10} maxLength={72}
                    className="field font-mono" value={senha} onChange={(e) => setSenha(e.target.value)}
                  />
                  <button type="button" className="btn shrink-0" onClick={() => setSenha(gerarSenha())}>
                    <RefreshCw className="h-3.5 w-3.5" /> Gerar
                  </button>
                </div>
                {eSenha.erro && <p role="alert" className="mt-3 rounded-sm bg-danger-soft px-3 py-2 text-[12px] text-danger">{eSenha.erro}</p>}
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" className="btn" onClick={fechar} disabled={pSenha}>Cancelar</button>
                  <button type="submit" className="btn btn-primary" disabled={pSenha}>{pSenha ? "Salvando…" : "Redefinir"}</button>
                </div>
              </form>
            )}
          </div>
        </Modal>
      )}

      {modal === "acesso" && (
        <Modal onClose={fechar}>
          <form action={aAcesso} className="my-16 w-full max-w-[420px] rounded border border-line bg-surface p-5 text-left" role="dialog" aria-modal="true">
            <h2 className="text-[16px] font-semibold">
              {ativo ? `Desativar o acesso de ${nome}?` : `Reativar o acesso de ${nome}?`}
            </h2>
            <p className="mt-1.5 text-[12.5px] text-graphite">
              {ativo
                ? "A conta continua existindo e o histórico fica guardado — a pessoa só deixa de entrar nesta empresa."
                : "A pessoa volta a entrar nesta empresa com o mesmo perfil e a mesma senha."}
            </p>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="ativo" value={ativo ? "0" : "1"} />
            {eAcesso.erro && <p role="alert" className="mt-3 rounded-sm bg-danger-soft px-3 py-2 text-[12px] text-danger">{eAcesso.erro}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn" onClick={fechar} disabled={pAcesso}>Voltar</button>
              <button
                type="submit" disabled={pAcesso}
                className={ativo ? "btn border-danger bg-danger text-white hover:border-danger hover:opacity-90" : "btn btn-primary"}
              >
                {pAcesso ? "Salvando…" : ativo ? "Desativar acesso" : "Reativar acesso"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
