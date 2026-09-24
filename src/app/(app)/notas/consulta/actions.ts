"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { abrirCertificado, ErroCertificado } from "@/lib/fiscal/certificado";
import { admin, caminhoCertificado, nomeSegredo, sincronizarEmpresa, type ResultadoSync } from "@/lib/fiscal/sync";

/**
 * O certificado e a senha passam só por aqui, no servidor:
 *  • o .pfx vai para o balde privado "fiscal-certs" (nenhum usuário lê);
 *  • a senha vai para o cofre (Vault) do Supabase;
 *  • nada é devolvido para a tela além de titular, CNPJ e validade;
 *  • nada disso vai para log — os erros são mensagens fixas.
 */
export type EstadoCert = { erro?: string; ok?: boolean; mensagem?: string };

const TAMANHO_MAX = 100 * 1024; // um A1 tem poucos KB

async function podeFazer(companyId: string, acao: "configurar" | "consultar") {
  const supabase = await createClient();
  const { data } = await supabase.rpc("dfe_can", { _company_id: companyId, _acao: acao });
  return data === true;
}

const soDigitos = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");
const dataCurta = (d: Date) => d.toISOString().slice(0, 10);
const br = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(d);
const cnpjFmt = (d: string) => d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

export async function salvarCertificado(_prev: EstadoCert, form: FormData): Promise<EstadoCert> {
  const { company } = await getSession();
  if (!(await podeFazer(company.id, "configurar"))) {
    return { erro: "Só quem administra os parâmetros da empresa pode enviar o certificado." };
  }

  const arquivo = form.get("arquivo");
  const senha = String(form.get("senha") ?? "");
  if (!(arquivo instanceof File) || arquivo.size === 0) return { erro: "Escolha o arquivo do certificado (.pfx ou .p12)." };
  if (arquivo.size > TAMANHO_MAX) return { erro: "Arquivo grande demais para um certificado A1." };
  if (!/\.(pfx|p12)$/i.test(arquivo.name)) return { erro: "O arquivo precisa ser .pfx ou .p12." };
  if (!senha) return { erro: "Informe a senha do certificado." };

  const bytes = Buffer.from(await arquivo.arrayBuffer());

  let cert;
  try {
    cert = abrirCertificado(bytes, senha);
  } catch (e) {
    return { erro: e instanceof ErroCertificado ? e.message : "Não foi possível abrir o certificado." };
  }

  const agora = new Date();
  if (cert.validoAte < agora) return { erro: `Este certificado venceu em ${br(cert.validoAte)}.` };
  if (cert.validoDe > agora) return { erro: `Este certificado só vale a partir de ${br(cert.validoDe)}.` };

  // a SEFAZ só entrega notas do CNPJ do certificado (mesma raiz de 8 dígitos)
  const cnpjEmpresa = soDigitos(company.cnpj);
  if (!cert.cnpj) {
    return { erro: "Não achei o CNPJ dentro do certificado. Use o e-CNPJ A1 da empresa (não o e-CPF)." };
  }
  if (cert.cnpj.slice(0, 8) !== cnpjEmpresa.slice(0, 8)) {
    return {
      erro: `Este certificado é do CNPJ ${cnpjFmt(cert.cnpj)}, que não é de ${company.trade_name ?? company.legal_name} ` +
            `(${cnpjFmt(cnpjEmpresa)}). Troque a empresa no menu lateral ou envie o certificado certo.`,
    };
  }

  let db;
  try {
    db = admin();
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Servidor sem configuração." };
  }

  const caminho = caminhoCertificado(company.id);
  const segredo = nomeSegredo(company.id);

  // bytes crus (não Blob): o arquivo é guardado exatamente como foi enviado
  const { error: eUp } = await db.storage.from("fiscal-certs").upload(
    caminho, bytes, { upsert: true, contentType: "application/x-pkcs12" });
  if (eUp) return { erro: "Não foi possível guardar o arquivo do certificado. Tente de novo." };

  const { error: eSec } = await db.rpc("store_fiscal_secret", { _name: segredo, _value: senha });
  if (eSec) return { erro: "Não foi possível guardar a senha no cofre. Tente de novo." };

  const { error: eCon } = await db.rpc("dfe_save_connection", {
    _company_id: company.id, _env: "producao", _path: caminho, _secret: segredo,
    _subject: cert.titular, _valid_from: dataCurta(cert.validoDe), _valid_to: dataCurta(cert.validoAte),
  });
  if (eCon) return { erro: "O certificado foi lido, mas não consegui ativar a consulta. Tente de novo." };

  const { user } = await getSession();
  await db.from("activity_logs").insert({
    company_id: company.id, user_id: user.id, verb: "updated", entity_type: "fiscal_connection",
    summary: `Certificado A1 atualizado (válido até ${br(cert.validoAte)})`, link: "/notas/consulta",
  });

  revalidatePath("/notas/consulta");
  return { ok: true, mensagem: `Certificado de ${cert.titular} ativado. Válido até ${br(cert.validoAte)}.` };
}

export async function removerCertificado(_prev: EstadoCert, _form: FormData): Promise<EstadoCert> {
  const { company, user } = await getSession();
  if (!(await podeFazer(company.id, "configurar"))) {
    return { erro: "Só quem administra os parâmetros da empresa pode remover o certificado." };
  }
  let db;
  try { db = admin(); } catch (e) { return { erro: e instanceof Error ? e.message : "Servidor sem configuração." }; }

  const { data: caminho, error } = await db.rpc("dfe_remove_connection", { _company_id: company.id });
  if (error) return { erro: "Não foi possível remover o certificado agora." };
  if (typeof caminho === "string" && caminho) await db.storage.from("fiscal-certs").remove([caminho]);

  await db.from("activity_logs").insert({
    company_id: company.id, user_id: user.id, verb: "deleted", entity_type: "fiscal_connection",
    summary: "Certificado A1 removido — consulta automática desligada", link: "/notas/consulta",
  });
  revalidatePath("/notas/consulta");
  return { ok: true, mensagem: "Certificado removido. A consulta automática desta empresa está desligada." };
}

export type EstadoConsulta = { resultado?: ResultadoSync; erro?: string };

export async function consultarAgora(_prev: EstadoConsulta, _form: FormData): Promise<EstadoConsulta> {
  const { company } = await getSession();
  if (!(await podeFazer(company.id, "consultar"))) {
    return { erro: "Você não tem permissão para consultar a SEFAZ nesta empresa." };
  }
  try {
    const resultado = await sincronizarEmpresa(company.id, "manual");
    revalidatePath("/notas/consulta");
    revalidatePath("/notas");
    return { resultado };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha ao consultar a SEFAZ." };
  }
}
