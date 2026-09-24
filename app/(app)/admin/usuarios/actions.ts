"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

// A senha nunca é guardada aqui: vai direto para a função do banco, que
// grava só o hash. Nada de senha em log, em arquivo ou no repositório.
const senha = z
  .string()
  .min(10, "A senha precisa ter pelo menos 10 caracteres.")
  .max(72, "A senha pode ter no máximo 72 caracteres.")
  .refine((s) => /[A-Za-z]/.test(s) && /[0-9]/.test(s), "A senha precisa misturar letras e números.");

const novo = z.object({
  nome: z.string().trim().min(3, "Informe o nome completo.").max(120),
  email: z.string().trim().email("E-mail inválido.").max(200),
  cargo: z.string().trim().max(120).optional(),
  telefone: z.string().trim().max(40).optional(),
  perfil: z.string().uuid("Escolha o perfil de acesso."),
  senha,
  empresas: z.array(z.string().uuid()).max(10).optional(),
});

export type FormState = { erro?: string; ok?: boolean; status?: string; nome?: string };

function mensagem(error: { code?: string; message?: string }) {
  if (error.code === "42501") return "Você não tem permissão para isso nesta empresa.";
  if (error.code === "28000") return "Sua sessão expirou. Entre de novo.";
  // 22023 são as recusas com texto pronto do banco (senha fraca, e-mail inválido…)
  if (error.code === "22023") return error.message ?? "Dados inválidos.";
  console.error("[usuarios] rpc", error);
  return "Não foi possível concluir agora. Tente novamente.";
}

export async function criarUsuario(_prev: FormState, form: FormData): Promise<FormState> {
  const dados = novo.safeParse({
    nome: form.get("nome"),
    email: form.get("email"),
    cargo: form.get("cargo") ?? undefined,
    telefone: form.get("telefone") ?? undefined,
    perfil: form.get("perfil"),
    senha: form.get("senha"),
    empresas: form.getAll("empresas").map(String),
  });
  if (!dados.success) return { erro: dados.error.issues[0].message };

  const { company } = await getSession();
  const supabase = await createClient();

  const extras = (dados.data.empresas ?? []).filter((c) => c !== company.id);
  const { data, error } = await supabase.rpc("create_company_user", {
    _company_id: company.id,
    _email: dados.data.email,
    _full_name: dados.data.nome,
    _role_id: dados.data.perfil,
    _password: dados.data.senha,
    _job_title: dados.data.cargo || null,
    _phone: dados.data.telefone || null,
    _companies: extras.length ? extras : null,
  });

  if (error) return { erro: mensagem(error) };

  revalidatePath("/admin/usuarios");
  const r = data as { status?: string; full_name?: string };
  return { ok: true, status: r?.status, nome: r?.full_name ?? dados.data.nome };
}

export async function trocarPerfil(_prev: FormState, form: FormData): Promise<FormState> {
  const id = z.string().uuid().safeParse(form.get("id"));
  const perfil = z.string().uuid().safeParse(form.get("perfil"));
  if (!id.success || !perfil.success) return { erro: "Dados inválidos." };

  const { company } = await getSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_user_role", {
    _user_id: id.data,
    _company_id: company.id,
    _role_id: perfil.data,
  });
  if (error) return { erro: mensagem(error) };

  revalidatePath("/admin/usuarios");
  return { ok: true };
}

export async function redefinirSenha(_prev: FormState, form: FormData): Promise<FormState> {
  const id = z.string().uuid().safeParse(form.get("id"));
  const nova = senha.safeParse(form.get("senha"));
  if (!id.success) return { erro: "Usuário inválido." };
  if (!nova.success) return { erro: nova.error.issues[0].message };

  const { company } = await getSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("reset_user_password", {
    _user_id: id.data,
    _company_id: company.id,
    _password: nova.data,
  });
  if (error) return { erro: mensagem(error) };

  revalidatePath("/admin/usuarios");
  return { ok: true };
}

export async function alternarAcesso(_prev: FormState, form: FormData): Promise<FormState> {
  const id = z.string().uuid().safeParse(form.get("id"));
  const ativo = form.get("ativo") === "1";
  if (!id.success) return { erro: "Usuário inválido." };

  const { company } = await getSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_company_access", {
    _user_id: id.data,
    _company_id: company.id,
    _active: ativo,
  });
  if (error) return { erro: mensagem(error) };

  revalidatePath("/admin/usuarios");
  return { ok: true };
}
