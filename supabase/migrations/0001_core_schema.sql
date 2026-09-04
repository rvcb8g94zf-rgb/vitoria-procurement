-- =====================================================================
-- Vitória Procurement — Fase 1 / Migração 0001
-- Núcleo: empresas, usuários, RBAC, estrutura organizacional,
-- numeração de documentos, auditoria e notificações.
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "unaccent";

create schema if not exists app;
comment on schema app is 'Funções internas do Vitória Procurement (helpers de RLS, auditoria, numeração).';

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
do $$ begin
  create type public.user_status as enum ('ativo','inativo','bloqueado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.permission_effect as enum ('allow','deny');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.audit_action as enum ('insert','update','delete');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Helper: updated_at
-- ---------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- EMPRESAS
-- ---------------------------------------------------------------------
create table if not exists public.companies (
  id              uuid primary key default gen_random_uuid(),
  legal_name      text not null,
  trade_name      text,
  cnpj            text not null,
  state_reg       text,
  city_reg        text,
  email           text,
  phone           text,
  zip_code        text,
  street          text,
  street_number   text,
  complement      text,
  district        text,
  city            text,
  state_uf        char(2),
  logo_path       text,
  timezone        text not null default 'America/Sao_Paulo',
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  deleted_by      uuid,
  constraint companies_cnpj_digits check (cnpj ~ '^[0-9]{14}$')
);
create unique index if not exists companies_cnpj_uk on public.companies (cnpj) where deleted_at is null;
create index if not exists companies_active_ix on public.companies (is_active) where deleted_at is null;

drop trigger if exists trg_companies_touch on public.companies;
create trigger trg_companies_touch before update on public.companies
for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------
-- USUÁRIOS (espelho de auth.users)
-- ---------------------------------------------------------------------
create table if not exists public.users (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text not null default '',
  email           text not null,
  phone           text,
  job_title       text,
  avatar_path     text,
  status          public.user_status not null default 'ativo',
  is_superadmin   boolean not null default false,
  last_seen_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists users_email_ix on public.users (lower(email));

drop trigger if exists trg_users_touch on public.users;
create trigger trg_users_touch before update on public.users
for each row execute function app.touch_updated_at();

-- provisiona o perfil assim que o Supabase Auth cria a conta
create or replace function app.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.users (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1))
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trg_auth_user_created on auth.users;
create trigger trg_auth_user_created after insert on auth.users
for each row execute function app.handle_new_auth_user();

-- ---------------------------------------------------------------------
-- RBAC — perfis, permissões, vínculos
-- ---------------------------------------------------------------------
create table if not exists public.roles (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid references public.companies(id) on delete cascade, -- null = perfil de sistema
  slug         text not null,
  name         text not null,
  description  text,
  is_system    boolean not null default false,
  rank         smallint not null default 50,   -- menor = mais poder
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint roles_slug_fmt check (slug ~ '^[a-z0-9_]+$')
);
create unique index if not exists roles_scope_slug_uk
  on public.roles (coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);

drop trigger if exists trg_roles_touch on public.roles;
create trigger trg_roles_touch before update on public.roles
for each row execute function app.touch_updated_at();

create table if not exists public.permissions (
  id          uuid primary key default gen_random_uuid(),
  module      text not null,
  action      text not null,
  label       text not null,
  unique (module, action)
);

create table if not exists public.role_permissions (
  role_id       uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table if not exists public.user_companies (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  role_id     uuid not null references public.roles(id) on delete restrict,
  is_default  boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, company_id)
);
create index if not exists user_companies_company_ix on public.user_companies (company_id);
create index if not exists user_companies_user_ix on public.user_companies (user_id) where is_active;

drop trigger if exists trg_user_companies_touch on public.user_companies;
create trigger trg_user_companies_touch before update on public.user_companies
for each row execute function app.touch_updated_at();

-- exceções individuais sobre o perfil (item 13 da especificação)
create table if not exists public.user_permission_overrides (
  user_id       uuid not null references public.users(id) on delete cascade,
  company_id    uuid not null references public.companies(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  effect        public.permission_effect not null,
  granted_by    uuid references public.users(id),
  created_at    timestamptz not null default now(),
  primary key (user_id, company_id, permission_id)
);

-- ---------------------------------------------------------------------
-- ESTRUTURA ORGANIZACIONAL
-- ---------------------------------------------------------------------
create table if not exists public.departments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  code        text not null,
  name        text not null,
  manager_id  uuid references public.users(id) on delete set null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  uuid references public.users(id),
  unique (company_id, code)
);
create index if not exists departments_company_ix on public.departments (company_id) where deleted_at is null;

drop trigger if exists trg_departments_touch on public.departments;
create trigger trg_departments_touch before update on public.departments
for each row execute function app.touch_updated_at();

create table if not exists public.cost_centers (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  department_id   uuid references public.departments(id) on delete set null,
  code            text not null,
  name            text not null,
  responsible_id  uuid references public.users(id) on delete set null,
  monthly_budget  numeric(14,2) not null default 0 check (monthly_budget >= 0),
  annual_budget   numeric(14,2) not null default 0 check (annual_budget >= 0),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  deleted_by      uuid references public.users(id),
  unique (company_id, code)
);
create index if not exists cost_centers_company_ix on public.cost_centers (company_id) where deleted_at is null;

drop trigger if exists trg_cost_centers_touch on public.cost_centers;
create trigger trg_cost_centers_touch before update on public.cost_centers
for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------
-- NUMERAÇÃO AUTOMÁTICA (SC-000001, CT-, PC-, RC-)
-- ---------------------------------------------------------------------
create table if not exists public.document_sequences (
  company_id      uuid not null references public.companies(id) on delete cascade,
  doc_type        text not null,
  prefix          text not null,
  padding         smallint not null default 6 check (padding between 3 and 12),
  current_number  bigint not null default 0,
  primary key (company_id, doc_type)
);

create or replace function app.next_document_number(_company_id uuid, _doc_type text)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prefix text;
  v_pad    smallint;
  v_num    bigint;
begin
  update public.document_sequences
     set current_number = current_number + 1
   where company_id = _company_id and doc_type = _doc_type
  returning prefix, padding, current_number into v_prefix, v_pad, v_num;

  if not found then
    raise exception 'Sequência % não configurada para a empresa %', _doc_type, _company_id
      using errcode = 'no_data_found';
  end if;

  return v_prefix || '-' || lpad(v_num::text, v_pad, '0');
end $$;

-- toda empresa nova já nasce com as sequências padrão
create or replace function app.seed_company_defaults()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.document_sequences (company_id, doc_type, prefix) values
    (new.id, 'purchase_request', 'SC'),
    (new.id, 'quotation',        'CT'),
    (new.id, 'purchase_order',   'PC'),
    (new.id, 'goods_receipt',    'RC')
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists trg_company_defaults on public.companies;
create trigger trg_company_defaults after insert on public.companies
for each row execute function app.seed_company_defaults();

-- ---------------------------------------------------------------------
-- AUDITORIA, ATIVIDADES, NOTIFICAÇÕES, LOGIN
-- ---------------------------------------------------------------------
create table if not exists public.audit_logs (
  id             bigserial primary key,
  company_id     uuid references public.companies(id) on delete set null,
  user_id        uuid references public.users(id) on delete set null,
  table_name     text not null,
  record_id      uuid,
  action         public.audit_action not null,
  old_data       jsonb,
  new_data       jsonb,
  changed_fields text[],
  ip_address     inet,
  user_agent     text,
  created_at     timestamptz not null default now()
);
create index if not exists audit_logs_company_ix on public.audit_logs (company_id, created_at desc);
create index if not exists audit_logs_record_ix on public.audit_logs (table_name, record_id, created_at desc);

create table if not exists public.activity_logs (
  id           bigserial primary key,
  company_id   uuid not null references public.companies(id) on delete cascade,
  user_id      uuid references public.users(id) on delete set null,
  verb         text not null,
  entity_type  text not null,
  entity_id    uuid,
  summary      text not null,
  link         text,
  created_at   timestamptz not null default now()
);
create index if not exists activity_logs_company_ix on public.activity_logs (company_id, created_at desc);

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  title        text not null,
  message      text,
  category     text not null default 'geral',
  entity_type  text,
  entity_id    uuid,
  link         text,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists notifications_inbox_ix on public.notifications (user_id, read_at, created_at desc);

create table if not exists public.login_logs (
  id          bigserial primary key,
  user_id     uuid references public.users(id) on delete set null,
  email       text,
  success     boolean not null,
  ip_address  inet,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists login_logs_user_ix on public.login_logs (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Gatilho genérico de auditoria
-- ---------------------------------------------------------------------
create or replace function app.request_ip() returns inet
language plpgsql stable as $$
declare v text;
begin
  v := split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for',''), ',', 1);
  return nullif(trim(v),'')::inet;
exception when others then return null;
end $$;

create or replace function app.request_user_agent() returns text
language plpgsql stable as $$
begin
  return current_setting('request.headers', true)::json->>'user-agent';
exception when others then return null;
end $$;

create or replace function app.audit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_company uuid;
  v_changed text[];
  v_record uuid;
begin
  v_old := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;

  -- descobre a empresa: coluna company_id ou o próprio id em public.companies
  v_company := nullif(coalesce(v_new, v_old) ->> 'company_id', '')::uuid;
  if v_company is null and tg_table_name = 'companies' then
    v_company := nullif(coalesce(v_new, v_old) ->> 'id', '')::uuid;
  end if;

  v_record := nullif(coalesce(v_new, v_old) ->> 'id', '')::uuid;

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(key), '{}')
      into v_changed
      from jsonb_each(v_new) n(key, value)
     where n.value is distinct from (v_old -> n.key)
       and n.key not in ('updated_at');
    if v_changed = '{}' then
      return new;  -- nada material mudou
    end if;
  end if;

  insert into public.audit_logs
    (company_id, user_id, table_name, record_id, action, old_data, new_data, changed_fields, ip_address, user_agent)
  values
    (v_company, auth.uid(), tg_table_name, v_record, lower(tg_op)::public.audit_action,
     v_old, v_new, v_changed, app.request_ip(), app.request_user_agent());

  return coalesce(new, old);
end $$;

-- aplica auditoria nas tabelas sensíveis da Fase 1
do $$
declare t text;
begin
  foreach t in array array[
    'companies','users','roles','role_permissions','user_companies',
    'user_permission_overrides','departments','cost_centers'
  ] loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$I', t);
    execute format(
      'create trigger trg_audit_%1$s after insert or update or delete on public.%1$I
       for each row execute function app.audit()', t);
  end loop;
end $$;
