import { Info } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { dateTime, initials } from "@/lib/format";
import type { AppUser } from "@/types";
import { NovoUsuario } from "./novo-usuario";
import { AcoesUsuario } from "./acoes";

export const metadata = { title: "Usuários · Vitória Procurement" };

interface Perfil {
  id: string;
  name: string;
  description: string | null;
}

export default async function UsuariosPage() {
  const { company, memberships, permissions, user } = await requirePermission("users");
  const supabase = await createClient();

  const [{ data: vinculos }, { data: papeis }] = await Promise.all([
    supabase
      .from("user_companies")
      .select("is_active, is_default, user:users(*), role:roles(id, name, slug, description)")
      .eq("company_id", company.id),
    supabase
      .from("roles")
      .select("id, name, description, rank, company_id")
      .or(`company_id.is.null,company_id.eq.${company.id}`)
      .order("rank"),
  ]);

  const lista = ((vinculos ?? []) as any[])
    .filter((v) => v.user)
    .map((v) => ({
      usuario: v.user as AppUser & { must_change_password?: boolean },
      perfil: v.role as Perfil,
      ativo: Boolean(v.is_active),
    }))
    .sort((a, b) => a.usuario.full_name.localeCompare(b.usuario.full_name, "pt-BR"));

  const perfis = ((papeis ?? []) as any[]).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    description: (p.description ?? null) as string | null,
  }));

  const outrasEmpresas = memberships
    .filter((m) => m.company.id !== company.id)
    .map((m) => ({ id: m.company.id, nome: m.company.trade_name ?? m.company.legal_name }));

  const empresaNome = company.trade_name ?? company.legal_name;
  const ativos = lista.filter((l) => l.ativo && l.usuario.status === "ativo").length;
  const podeEditar = permissions.has("users.edit");

  return (
    <div className="max-w-[1100px] px-6 pb-14 pt-5">
      <PageHeader
        crumb="Administração"
        title="Usuários"
        description={`${ativos} ${ativos === 1 ? "pessoa com acesso" : "pessoas com acesso"} a ${empresaNome}.`}
        actions={
          permissions.has("users.create") ? (
            <NovoUsuario
              perfis={perfis}
              empresaAtual={{ id: company.id, nome: empresaNome }}
              outrasEmpresas={outrasEmpresas}
            />
          ) : undefined
        }
      />

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] table-fixed border-collapse">
          <thead>
            <tr>
              <th className="th">USUÁRIO</th>
              <th className="th w-40">PERFIL</th>
              <th className="th w-28">SITUAÇÃO</th>
              <th className="th w-40">ÚLTIMO ACESSO</th>
              {podeEditar && <th className="th w-[300px]" />}
            </tr>
          </thead>
          <tbody>
            {lista.map(({ usuario, perfil, ativo }) => {
              const voce = usuario.id === user.id;
              const liberado = ativo && usuario.status === "ativo";
              return (
                <tr key={usuario.id} className={`hover:bg-raise ${liberado ? "" : "opacity-60"}`}>
                  <td className="td">
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-line-soft text-[10px] font-semibold text-graphite">
                        {initials(usuario.full_name)}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold">{usuario.full_name}</span>
                          {voce && <span className="badge bg-line-soft text-graphite">você</span>}
                          {usuario.is_superadmin && <span className="badge bg-info-soft text-info">superadmin</span>}
                          {usuario.must_change_password && (
                            <span className="badge bg-warn-soft text-warn">senha provisória</span>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-muted" title={usuario.email}>
                          {usuario.email}
                          {usuario.job_title ? ` · ${usuario.job_title}` : ""}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="td">{perfil?.name ?? "—"}</td>
                  <td className="td">
                    <span className={`badge ${liberado ? "bg-accent-soft text-accent-ink" : "bg-line-soft text-graphite"}`}>
                      {liberado ? "Ativo" : "Sem acesso"}
                    </span>
                  </td>
                  <td className="td whitespace-nowrap text-graphite">{dateTime(usuario.last_seen_at)}</td>
                  {podeEditar && (
                    <td className="td whitespace-nowrap">
                      {voce ? (
                        <span className="block text-right text-[11.5px] text-muted">sua conta</span>
                      ) : (
                        <AcoesUsuario
                          id={usuario.id}
                          nome={usuario.full_name}
                          email={usuario.email}
                          perfilAtual={perfil?.id ?? ""}
                          ativo={ativo}
                          perfis={perfis}
                        />
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex gap-2.5 rounded bg-line-soft px-3.5 py-3 text-[12px] text-graphite">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted" strokeWidth={1.8} />
        <div className="space-y-1">
          <p>
            Esta lista é de <b>{empresaNome}</b>. Quem trabalha nas duas empresas aparece nas duas listas, e o perfil
            pode ser diferente em cada uma — troque a empresa no menu lateral para ver a outra.
          </p>
          <p>
            Ainda não há envio de e-mail configurado: a senha provisória é entregue por você e a pessoa troca no
            primeiro acesso. Desativar não apaga nada — o histórico do que a pessoa fez continua registrado.
          </p>
        </div>
      </div>
    </div>
  );
}
