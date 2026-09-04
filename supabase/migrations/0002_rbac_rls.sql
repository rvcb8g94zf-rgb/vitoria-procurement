-- =====================================================================
-- Vitória Procurement — Fase 1 / Migração 0002
-- Funções de autorização + Row Level Security + Storage.
--
-- Regra mestra: um usuário só enxerga registros das empresas às quais
-- possui vínculo ativo, e só age dentro das permissões do seu perfil.
-- As funções abaixo são SECURITY DEFINER de propósito: sem isso as
-- políticas que consultam user_companies entrariam em recursão.
-- =====================================================================

grant usage on schema app to authenticated;

-- ---------------------------------------------------------------------
-- Helpers de autorização
-- ---------------------------------------------------------------------
create or replace function app.is_superadmin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select u.is_superadmin and u.status = 'ativo'
                     from public.users u where u.id = auth.uid()), false);
$$;

create or replace function app.current_company_ids()
returns uuid[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(uc.company_id), '{}'::uuid[])
    from public.user_companies uc
    join public.users u on u.id = uc.user_id
   where uc.user_id = auth.uid()
     and uc.is_active
     and u.status = 'ativo';
$$;

create or replace function app.is_member(_company_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select app.is_superadmin() or _company_id = any(app.current_company_ids());
$$;

create or replace function app.has_permission(_company_id uuid, _module text, _action text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when app.is_superadmin() then true
    -- negação individual sempre vence
    when exists (
      select 1 from public.user_permission_overrides o
      join public.permissions p on p.id = o.permission_id
      where o.user_id = auth.uid() and o.company_id = _company_id
        and p.module = _module and p.action = _action and o.effect = 'deny'
    ) then false
    -- concessão individual
    when exists (
      select 1 from public.user_permission_overrides o
      join public.permissions p on p.id = o.permission_id
      where o.user_id = auth.uid() and o.company_id = _company_id
        and p.module = _module and p.action = _action and o.effect = 'allow'
    ) then true
    -- permissão vinda do perfil
    else exists (
      select 1
        from public.user_companies uc
        join public.users u on u.id = uc.user_id and u.status = 'ativo'
        join public.role_permissions rp on rp.role_id = uc.role_id
        join public.permissions p on p.id = rp.permission_id
       where uc.user_id = auth.uid() and uc.company_id = _company_id and uc.is_active
         and p.module = _module and p.action = _action
    )
  end;
$$;

create or replace function app.shares_company(_user_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select app.is_superadmin() or exists (
    select 1 from public.user_companies uc
     where uc.user_id = _user_id
       and uc.company_id = any(app.current_company_ids())
  );
$$;

-- perfil ligado a uma empresa que o usuário administra (ou perfil de sistema)
create or replace function app.can_edit_role(_role_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.roles r
     where r.id = _role_id
       and r.is_system = false
       and r.company_id is not null
       and app.has_permission(r.company_id, 'roles', 'edit')
  ) or app.is_superadmin();
$$;

grant execute on function
  app.is_superadmin(), app.current_company_ids(), app.is_member(uuid),
  app.has_permission(uuid, text, text), app.shares_company(uuid),
  app.can_edit_role(uuid), app.next_document_number(uuid, text)
to authenticated;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.companies                 enable row level security;
alter table public.users                     enable row level security;
alter table public.roles                     enable row level security;
alter table public.permissions               enable row level security;
alter table public.role_permissions          enable row level security;
alter table public.user_companies            enable row level security;
alter table public.user_permission_overrides enable row level security;
alter table public.departments               enable row level security;
alter table public.cost_centers              enable row level security;
alter table public.document_sequences        enable row level security;
alter table public.audit_logs                enable row level security;
alter table public.activity_logs             enable row level security;
alter table public.notifications             enable row level security;
alter table public.login_logs                enable row level security;

-- --- EMPRESAS --------------------------------------------------------
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select to authenticated
using (app.is_member(id) and deleted_at is null);

drop policy if exists companies_insert on public.companies;
create policy companies_insert on public.companies for insert to authenticated
with check (app.is_superadmin());

drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies for update to authenticated
using (app.has_permission(id, 'companies', 'edit'))
with check (app.has_permission(id, 'companies', 'edit'));

-- --- USUÁRIOS --------------------------------------------------------
drop policy if exists users_select on public.users;
create policy users_select on public.users for select to authenticated
using (id = auth.uid() or app.shares_company(id));

drop policy if exists users_update_self on public.users;
create policy users_update_self on public.users for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());
-- observação: status e is_superadmin são protegidos pelo gatilho abaixo

create or replace function app.protect_user_privileges()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app.is_superadmin() then
    return new;
  end if;
  if new.id = auth.uid() then
    new.is_superadmin := old.is_superadmin;
    new.status        := old.status;
  end if;
  return new;
end $$;

drop trigger if exists trg_users_protect on public.users;
create trigger trg_users_protect before update on public.users
for each row execute function app.protect_user_privileges();

-- --- PERFIS E PERMISSÕES --------------------------------------------
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles for select to authenticated
using (company_id is null or app.is_member(company_id));

drop policy if exists roles_write on public.roles;
create policy roles_write on public.roles for all to authenticated
using (company_id is not null and is_system = false and app.has_permission(company_id, 'roles', 'edit'))
with check (company_id is not null and is_system = false and app.has_permission(company_id, 'roles', 'edit'));

drop policy if exists permissions_select on public.permissions;
create policy permissions_select on public.permissions for select to authenticated
using (true);  -- catálogo estático, somente leitura

drop policy if exists role_permissions_select on public.role_permissions;
create policy role_permissions_select on public.role_permissions for select to authenticated
using (exists (select 1 from public.roles r where r.id = role_id
               and (r.company_id is null or app.is_member(r.company_id))));

drop policy if exists role_permissions_write on public.role_permissions;
create policy role_permissions_write on public.role_permissions for all to authenticated
using (app.can_edit_role(role_id))
with check (app.can_edit_role(role_id));

-- --- VÍNCULO USUÁRIO x EMPRESA --------------------------------------
drop policy if exists user_companies_select on public.user_companies;
create policy user_companies_select on public.user_companies for select to authenticated
using (user_id = auth.uid() or app.has_permission(company_id, 'users', 'view'));

drop policy if exists user_companies_write on public.user_companies;
create policy user_companies_write on public.user_companies for all to authenticated
using (app.has_permission(company_id, 'users', 'edit'))
with check (app.has_permission(company_id, 'users', 'edit'));

drop policy if exists overrides_select on public.user_permission_overrides;
create policy overrides_select on public.user_permission_overrides for select to authenticated
using (user_id = auth.uid() or app.has_permission(company_id, 'users', 'view'));

drop policy if exists overrides_write on public.user_permission_overrides;
create policy overrides_write on public.user_permission_overrides for all to authenticated
using (app.has_permission(company_id, 'users', 'edit'))
with check (app.has_permission(company_id, 'users', 'edit'));

-- --- ESTRUTURA ORGANIZACIONAL ---------------------------------------
drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments for select to authenticated
using (app.is_member(company_id) and deleted_at is null);

drop policy if exists departments_insert on public.departments;
create policy departments_insert on public.departments for insert to authenticated
with check (app.has_permission(company_id, 'departments', 'create'));

drop policy if exists departments_update on public.departments;
create policy departments_update on public.departments for update to authenticated
using (app.has_permission(company_id, 'departments', 'edit'))
with check (app.has_permission(company_id, 'departments', 'edit'));

drop policy if exists cost_centers_select on public.cost_centers;
create policy cost_centers_select on public.cost_centers for select to authenticated
using (app.is_member(company_id) and deleted_at is null);

drop policy if exists cost_centers_insert on public.cost_centers;
create policy cost_centers_insert on public.cost_centers for insert to authenticated
with check (app.has_permission(company_id, 'cost_centers', 'create'));

drop policy if exists cost_centers_update on public.cost_centers;
create policy cost_centers_update on public.cost_centers for update to authenticated
using (app.has_permission(company_id, 'cost_centers', 'edit'))
with check (app.has_permission(company_id, 'cost_centers', 'edit'));

-- Sem policy de DELETE em nenhuma das tabelas acima: exclusão é sempre
-- lógica (deleted_at / status), conforme itens 92 e 93 da especificação.

-- --- NUMERAÇÃO -------------------------------------------------------
drop policy if exists sequences_select on public.document_sequences;
create policy sequences_select on public.document_sequences for select to authenticated
using (app.is_member(company_id));
-- escrita apenas via app.next_document_number()

-- --- LOGS ------------------------------------------------------------
drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated
using (company_id is not null and app.has_permission(company_id, 'audit', 'view'));

drop policy if exists activity_select on public.activity_logs;
create policy activity_select on public.activity_logs for select to authenticated
using (app.is_member(company_id));

drop policy if exists login_logs_select on public.login_logs;
create policy login_logs_select on public.login_logs for select to authenticated
using (user_id = auth.uid() or app.is_superadmin());

-- --- NOTIFICAÇÕES ----------------------------------------------------
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
using (user_id = auth.uid());

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- STORAGE — bucket privado, isolado por empresa
-- Caminho: {company_id}/{escopo}/{arquivo}
--   ex.: 3f2a…/invoices/xml/NFe3526…-procNFe.xml
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 26214400)
on conflict (id) do nothing;

create or replace function app.folder_company(_name text)
returns uuid language plpgsql immutable as $$
declare v text;
begin
  v := (storage.foldername(_name))[1];
  if v ~ '^[0-9a-fA-F-]{36}$' then return v::uuid; end if;
  return null;
end $$;

grant execute on function app.folder_company(text) to authenticated;

drop policy if exists documents_read on storage.objects;
create policy documents_read on storage.objects for select to authenticated
using (bucket_id = 'documents' and app.is_member(app.folder_company(name)));

drop policy if exists documents_write on storage.objects;
create policy documents_write on storage.objects for insert to authenticated
with check (bucket_id = 'documents' and app.is_member(app.folder_company(name)));

drop policy if exists documents_update on storage.objects;
create policy documents_update on storage.objects for update to authenticated
using (bucket_id = 'documents' and app.is_member(app.folder_company(name)));

-- exclusão de arquivo exige permissão explícita no módulo de documentos
drop policy if exists documents_delete on storage.objects;
create policy documents_delete on storage.objects for delete to authenticated
using (bucket_id = 'documents'
       and app.has_permission(app.folder_company(name), 'documents', 'delete'));
