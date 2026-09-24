"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CheckCircle2, KeyRound, ShieldCheck, Trash2, Upload } from "lucide-react";
import { Modal, Aviso } from "@/components/modal";
import { removerCertificado, salvarCertificado, type EstadoCert } from "./actions";

/**
 * Envio do certificado A1. O arquivo e a senha vão direto para a action
 * no servidor — não ficam no navegador depois do envio, não vão para o
 * chat nem para o GitHub.
 */
export function EnviarCertificado({ temCertificado }: { temCertificado: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao, pendente] = useActionState<EstadoCert, FormData>(salvarCertificado, {});
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (estado.ok) { form.current?.reset(); setAberto(false); }
  }, [estado]);

  return (
    <>
      {estado.ok && estado.mensagem && (
        <div role="status" className="mb-3 flex gap-2 rounded bg-accent-soft px-3 py-2.5 text-[12.5px] text-accent-ink">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {estado.mensagem}
        </div>
      )}
      <button type="button" className={`btn ${temCertificado ? "" : "btn-primary"}`} onClick={() => setAberto(true)}>
        <Upload className="h-3.5 w-3.5" /> {temCertificado ? "Trocar certificado" : "Enviar certificado A1"}
      </button>

      {aberto && (
        <Modal title="Certificado digital A1" onClose={() => setAberto(false)} width="max-w-[520px]">
          <form ref={form} action={acao} className="grid gap-3 px-4 py-4" autoComplete="off">
            <div className="flex gap-2.5 rounded bg-raise px-3 py-2.5 text-[12px] text-graphite">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <p>
                O arquivo vai para um armazenamento privado e a senha para o cofre do banco. Ninguém
                consegue baixar o certificado pelo sistema — nem administradores.
              </p>
            </div>
            <div>
              <label className="label" htmlFor="c-arq">Arquivo do certificado (.pfx ou .p12)</label>
              <input id="c-arq" name="arquivo" type="file" accept=".pfx,.p12,application/x-pkcs12" required className="field py-1.5" />
            </div>
            <div>
              <label className="label" htmlFor="c-senha">Senha do certificado</label>
              <input id="c-senha" name="senha" type="password" required autoComplete="new-password" className="field" />
            </div>
            <Aviso erro={estado.erro} />
            <p className="text-[11.5px] text-muted">
              Só o e-CNPJ A1 da própria empresa é aceito. O sistema confere o CNPJ e a validade antes de ativar.
              Se o certificado está instalado no Windows e você não tem o arquivo, exporte-o pelo Windows
              com a opção <b>"Sim, exportar a chave privada"</b>.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setAberto(false)}>Voltar</button>
              <button type="submit" className="btn btn-primary" disabled={pendente}>
                <KeyRound className="h-3.5 w-3.5" /> {pendente ? "Conferindo…" : "Conferir e ativar"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function RemoverCertificado() {
  const [aberto, setAberto] = useState(false);
  const [estado, acao, pendente] = useActionState<EstadoCert, FormData>(removerCertificado, {});
  useEffect(() => { if (estado.ok) setAberto(false); }, [estado]);

  return (
    <>
      <button type="button" className="btn" onClick={() => setAberto(true)}>
        <Trash2 className="h-3.5 w-3.5" /> Remover
      </button>
      {aberto && (
        <Modal title="Remover certificado" onClose={() => setAberto(false)}>
          <form action={acao} className="grid gap-3 px-4 py-4">
            <p className="text-[12.5px] text-graphite">
              O arquivo e a senha são apagados do servidor e a consulta automática desta empresa para. As notas
              já recebidas continuam no sistema.
            </p>
            <Aviso erro={estado.erro} />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setAberto(false)}>Voltar</button>
              <button type="submit" className="btn btn-primary" disabled={pendente}>
                {pendente ? "Removendo…" : "Remover certificado"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
