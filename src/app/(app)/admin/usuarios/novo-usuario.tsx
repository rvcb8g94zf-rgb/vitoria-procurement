"use client";

import { useActionState, useEffect, useState } from "react";
import { Check, Copy, KeyRound, RefreshCw, UserPlus } from "lucide-react";
import { criarUsuario, type FormState } from "./actions";

// Sem caracteres que se confundem lendo em voz alta (0/O, 1/l/I).
const LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
const NUMEROS = "23456789";

function sortear(alfabeto: string, quantidade: number) {
  const n = new Uint32Array(quantidade);
  crypto.getRandomValues(n);
  return Array.from(n, (v) => alfabeto[v % alfabeto.length]).join("");
}

/** Ex.: "Kfrt-8m4Q-73xz" — fácil de ditar, com letras e números. */
function gerarSenha() {
  return [sortear(LETRAS, 4), sortear(LETRAS + NUMEROS, 4), sortear(NUMEROS, 2) + sortear(LETRAS, 2)].join("-");
}

function Copiar({ texto, rotulo = "Copiar" }: { texto: string; rotulo?: string }) {
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => setCopiado(false), 2000);
    return () => clearTimeout(t);
  }, [copiado]);

  return (
    <button
      type="button"
      className="btn h-8"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto);
          setCopiado(true);
        } catch {
          setCopiado(false);
        }
      }}
    >
      {copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copiado ? "Copiado" : rotulo}
    </button>
  );
}

export function NovoUsuario({
  perfis,
  empresaAtual,
  outrasEmpresas,
}: {
  perfis: { id: string; name: string; description: string | null }[];
  empresaAtual: { id: string; nome: string };
  outrasEmpresas: { id: string; nome: string }[];
}) {
  const [aberto, setAberto] = useState(false);
  const [painel, setPainel] = useState<"form" | "sucesso">("form");
  const [senha, setSenha] = useState("");
  const [email, setEmail] = useState("");
  const [perfil, setPerfil] = useState(perfis[0]?.id ?? "");
  const [estado, acao, pendente] = useActionState<FormState, FormData>(criarUsuario, {});

  // o estado da action não tem reset; o painel é controlado à parte para
  // "Criar outro" voltar ao formulário
  useEffect(() => {
    if (estado.ok) setPainel("sucesso");
  }, [estado]);

  function abrir() {
    setSenha(gerarSenha());
    setEmail("");
    setPerfil(perfis[0]?.id ?? "");
    setPainel("form");
    setAberto(true);
  }

  const descricao = perfis.find((p) => p.id === perfil)?.description;
  const criado = estado.ok && estado.status !== "ja_tinha_acesso";
  const acesso = `Sistema: ${typeof window !== "undefined" ? window.location.origin : ""}\nE-mail: ${email}\nSenha: ${senha}`;

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={abrir}>
        <UserPlus className="h-3.5 w-3.5" /> Novo usuário
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
          onClick={(e) => e.target === e.currentTarget && !pendente && setAberto(false)}
        >
          {painel === "sucesso" ? (
            <div className="my-10 w-full max-w-[460px] rounded border border-line bg-surface p-5" role="dialog" aria-modal="true">
              <h2 className="text-[16px] font-semibold">
                {criado ? "Usuário criado" : "Acesso concedido"}
              </h2>
              <p className="mt-1.5 text-[12.5px] text-graphite">
                {criado ? (
                  <>
                    Entregue estes dados para <b>{estado.nome}</b>. A senha é provisória: o sistema vai pedir uma nova
                    no primeiro acesso. Esta é a última vez que ela aparece aqui.
                  </>
                ) : (
                  <>
                    <b>{estado.nome}</b> já tinha conta no sistema — agora tem acesso a {empresaAtual.nome} com o perfil
                    escolhido. A senha dessa pessoa continua a mesma.
                  </>
                )}
              </p>

              {criado && (
                <div className="mt-4 rounded-sm border border-line bg-raise px-3.5 py-3 font-mono text-[12.5px]">
                  <div className="text-muted">E-mail</div>
                  <div className="mb-2 break-all font-medium">{email}</div>
                  <div className="text-muted">Senha provisória</div>
                  <div className="font-medium">{senha}</div>
                </div>
              )}

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                {criado && <Copiar texto={acesso} rotulo="Copiar acesso" />}
                <button type="button" className="btn" onClick={abrir}>Criar outro</button>
                <button type="button" className="btn btn-primary" onClick={() => setAberto(false)}>Fechar</button>
              </div>
            </div>
          ) : (
            <form action={acao} className="my-10 w-full max-w-[520px] rounded border border-line bg-surface p-5" role="dialog" aria-modal="true">
              <h2 className="text-[16px] font-semibold">Novo usuário</h2>
              <p className="mt-1 text-[12.5px] text-muted">
                A pessoa entra com e-mail e a senha provisória, e troca a senha no primeiro acesso.
              </p>

              <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="nome">Nome completo</label>
                  <input id="nome" name="nome" required maxLength={120} className="field" autoFocus />
                </div>

                <div className="sm:col-span-2">
                  <label className="label" htmlFor="email">E-mail</label>
                  <input
                    id="email" name="email" type="email" required maxLength={200} className="field"
                    value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="nome@empresa.com.br"
                  />
                </div>

                <div>
                  <label className="label" htmlFor="cargo">Cargo (opcional)</label>
                  <input id="cargo" name="cargo" maxLength={120} className="field" />
                </div>
                <div>
                  <label className="label" htmlFor="telefone">Telefone (opcional)</label>
                  <input id="telefone" name="telefone" maxLength={40} className="field" />
                </div>

                <div className="sm:col-span-2">
                  <label className="label" htmlFor="perfil">Perfil de acesso</label>
                  <select id="perfil" name="perfil" className="field" value={perfil} onChange={(e) => setPerfil(e.target.value)}>
                    {perfis.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  {descricao && <p className="mt-1.5 text-[11.5px] text-muted">{descricao}</p>}
                </div>

                <div className="sm:col-span-2">
                  <span className="label">Empresas</span>
                  <label className="flex items-center gap-2 text-[12.5px] text-graphite">
                    <input type="checkbox" checked disabled className="h-4 w-4 accent-[var(--accent)]" />
                    {empresaAtual.nome} <span className="text-muted">(empresa ativa)</span>
                  </label>
                  {outrasEmpresas.map((c) => (
                    <label key={c.id} className="mt-1.5 flex items-center gap-2 text-[12.5px] text-graphite">
                      <input type="checkbox" name="empresas" value={c.id} className="h-4 w-4 accent-[var(--accent)]" />
                      {c.nome}
                    </label>
                  ))}
                </div>

                <div className="sm:col-span-2">
                  <label className="label" htmlFor="senha">Senha provisória</label>
                  <div className="flex gap-2">
                    <input
                      id="senha" name="senha" required minLength={10} maxLength={72}
                      className="field font-mono" value={senha} onChange={(e) => setSenha(e.target.value)}
                    />
                    <button type="button" className="btn shrink-0" onClick={() => setSenha(gerarSenha())} title="Gerar outra">
                      <RefreshCw className="h-3.5 w-3.5" /> Gerar
                    </button>
                  </div>
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-muted">
                    <KeyRound className="h-3.5 w-3.5" /> Mínimo de 10 caracteres, com letras e números.
                  </p>
                </div>
              </div>

              {estado.erro && (
                <p role="alert" className="mt-3 rounded-sm bg-danger-soft px-3 py-2 text-[12px] text-danger">
                  {estado.erro}
                </p>
              )}

              <div className="mt-5 flex justify-end gap-2">
                <button type="button" className="btn" onClick={() => setAberto(false)} disabled={pendente}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={pendente}>
                  {pendente ? "Criando…" : "Criar usuário"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </>
  );
}
