-- =====================================================================
-- Vitória Procurement — Fase 2 / Migração 0010
-- Fornecedores, contatos, dados bancários, categorias e condições
-- de pagamento.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Validação de CPF (fornecedor pessoa física: autônomo, frete, serviço)
-- ---------------------------------------------------------------------
create or replace function app.is_valid_cpf(_cpf text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare d text; s int; i int; dv1 int; dv2 int;
begin
  d := regexp_replace(coalesce(_cpf,''), '\D', '', 'g');
  if length(d) <> 11 then return false; end if;
  if d ~ '^(\d)\1{10}$' then return false; end if;

  s := 0;
  for i in 1..9 loop s := s + substr(d,i,1)::int * (11 - i); end loop;
  dv1 := 11 - (s % 11);
  if dv1 >= 10 then dv1 := 0; end if;

  s := 0;
  for i in 1..10 loop s := s + substr(d,i,1)::int * (12 - i); end loop;
  dv2 := 11 - (s % 11);
  if dv2 >= 10 then dv2 := 0; end if;

  return dv1 = substr(d,10,1)::int and dv2 = substr(d,11,1)::int;
end $$;

do $$ begin
  create type public.party_doc_type as enum ('cnpj','cpf');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.supplier_status as enum ('ativo','inativo','bloqueado','pendente');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- CATEGORIAS — uma tabela, dois usos (fornecedor e produto)
-- ---------------------------------------------------------------------
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  kind        text not null check (kind in ('supplier','product')),
  parent_id   uuid references public.categories(id) on delete set null,
  code        text,
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  uuid references public.users(id),
  unique (company_id, kind, name)
);
create index if not exists categories_company_ix on public.categories (company_id, kind) where deleted_at is null;

drop trigger if exists trg_categories_touch on public.categories;
create trigger trg_categories_touch before update on public.categories
for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------
-- CONDIÇÕES DE PAGAMENTO
-- days guarda os vencimentos em dias: {28,35,42} = 28/35/42 dias.
-- À vista é '{0}'. Guardar o vetor evita ter que interpretar texto
-- livre na hora de gerar duplicata na Fase 5.
-- ---------------------------------------------------------------------
create table if not exists public.payment_terms (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  code        text not null,
  name        text not null,
  days        smallint[] not null default '{0}',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, code),
  constraint payment_terms_days_ok check (array_length(days,1) between 1 and 36)
);
create index if not exists payment_terms_company_ix on public.payment_terms (company_id) where is_active;

drop trigger if exists trg_payment_terms_touch on public.payment_terms;
create trigger trg_payment_terms_touch before update on public.payment_terms
for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------
-- FORNECEDORES
-- ---------------------------------------------------------------------
create table if not exists public.suppliers (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  code              text,
  doc_type          public.party_doc_type not null default 'cnpj',
  doc_number        text not null,
  legal_name        text not null,
  trade_name        text,
  state_reg         text,
  city_reg          text,
  state_reg_exempt  boolean not null default false,

  zip_code      text,
  street        text,
  street_number text,
  complement    text,
  district      text,
  city          text,
  state_uf      char(2),

  phone     text,
  whatsapp  text,
  email     text,
  website   text,

  category_id      uuid references public.categories(id) on delete set null,
  payment_term_id  uuid references public.payment_terms(id) on delete set null,
  avg_lead_days    smallint check (avg_lead_days >= 0),
  credit_limit     numeric(14,2) not null default 0 check (credit_limit >= 0),

  notes      text,
  status     public.supplier_status not null default 'ativo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.users(id),

  constraint suppliers_doc_valid check (
    case doc_type
      when 'cnpj' then app.is_valid_cnpj(doc_number)
      when 'cpf'  then app.is_valid_cpf(doc_number)
    end
  )
);

-- mesmo CNPJ pode existir nas duas empresas do grupo, mas não duplicado dentro de uma
create unique index if not exists suppliers_doc_uk
  on public.suppliers (company_id, doc_number) where deleted_at is null;
create unique index if not exists suppliers_code_uk
  on public.suppliers (company_id, code) where code is not null and deleted_at is null;
create index if not exists suppliers_company_ix on public.suppliers (company_id, status) where deleted_at is null;
create index if not exists suppliers_name_ix
  on public.suppliers using gin (to_tsvector('portuguese', coalesce(legal_name,'') || ' ' || coalesce(trade_name,'')));

drop trigger if exists trg_suppliers_touch on public.suppliers;
create trigger trg_suppliers_touch before update on public.suppliers
for each row execute function app.touch_updated_at();

-- normaliza o documento antes de gravar: a validação exige só dígitos
create or replace function app.normalize_supplier_doc()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.doc_number := regexp_replace(coalesce(new.doc_number,''), '\D', '', 'g');
  return new;
end $$;

drop trigger if exists trg_suppliers_doc on public.suppliers;
create trigger trg_suppliers_doc before insert or update of doc_number on public.suppliers
for each row execute function app.normalize_supplier_doc();

-- ---------------------------------------------------------------------
-- CONTATOS DO FORNECEDOR (vendedor, financeiro, expedição)
-- ---------------------------------------------------------------------
create table if not exists public.supplier_contacts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  supplier_id  uuid not null references public.suppliers(id) on delete cascade,
  name         text not null,
  role         text,
  phone        text,
  whatsapp     text,
  email        text,
  is_primary   boolean not null default false,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists supplier_contacts_ix on public.supplier_contacts (supplier_id);
create unique index if not exists supplier_contacts_primary_uk
  on public.supplier_contacts (supplier_id) where is_primary;

drop trigger if exists trg_supplier_contacts_touch on public.supplier_contacts;
create trigger trg_supplier_contacts_touch before update on public.supplier_contacts
for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------
-- DADOS BANCÁRIOS
-- ---------------------------------------------------------------------
create table if not exists public.supplier_bank_accounts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  supplier_id  uuid not null references public.suppliers(id) on delete cascade,
  bank_code    text,
  bank_name    text,
  agency       text,
  account      text,
  account_type text check (account_type in ('corrente','poupanca','pagamento')),
  pix_type     text check (pix_type in ('cnpj','cpf','email','telefone','aleatoria')),
  pix_key      text,
  holder_name  text,
  holder_doc   text,
  is_default   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint bank_or_pix check (pix_key is not null or (agency is not null and account is not null))
);
create index if not exists supplier_bank_ix on public.supplier_bank_accounts (supplier_id);
create unique index if not exists supplier_bank_default_uk
  on public.supplier_bank_accounts (supplier_id) where is_default;

drop trigger if exists trg_supplier_bank_touch on public.supplier_bank_accounts;
create trigger trg_supplier_bank_touch before update on public.supplier_bank_accounts
for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.categories             enable row level security;
alter table public.payment_terms          enable row level security;
alter table public.suppliers              enable row level security;
alter table public.supplier_contacts      enable row level security;
alter table public.supplier_bank_accounts enable row level security;

drop policy if exists categories_select on public.categories;
create policy categories_select on public.categories for select to authenticated
using (app.is_member(company_id) and deleted_at is null);

drop policy if exists categories_write on public.categories;
create policy categories_write on public.categories for all to authenticated
using (app.has_permission(company_id, 'categories', 'edit'))
with check (app.has_permission(company_id, 'categories', 'edit'));

drop policy if exists payment_terms_select on public.payment_terms;
create policy payment_terms_select on public.payment_terms for select to authenticated
using (app.is_member(company_id));

drop policy if exists payment_terms_write on public.payment_terms;
create policy payment_terms_write on public.payment_terms for all to authenticated
using (app.has_permission(company_id, 'settings', 'edit'))
with check (app.has_permission(company_id, 'settings', 'edit'));

drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers for select to authenticated
using (app.has_permission(company_id, 'suppliers', 'view') and deleted_at is null);

drop policy if exists suppliers_insert on public.suppliers;
create policy suppliers_insert on public.suppliers for insert to authenticated
with check (app.has_permission(company_id, 'suppliers', 'create'));

drop policy if exists suppliers_update on public.suppliers;
create policy suppliers_update on public.suppliers for update to authenticated
using (app.has_permission(company_id, 'suppliers', 'edit'))
with check (app.has_permission(company_id, 'suppliers', 'edit'));

drop policy if exists supplier_contacts_select on public.supplier_contacts;
create policy supplier_contacts_select on public.supplier_contacts for select to authenticated
using (app.has_permission(company_id, 'suppliers', 'view'));

drop policy if exists supplier_contacts_write on public.supplier_contacts;
create policy supplier_contacts_write on public.supplier_contacts for all to authenticated
using (app.has_permission(company_id, 'suppliers', 'edit'))
with check (app.has_permission(company_id, 'suppliers', 'edit'));

-- dados bancários alimentam pagamento: leitura restrita a quem tem
-- fornecedores, escrita a quem edita fornecedores
drop policy if exists supplier_bank_select on public.supplier_bank_accounts;
create policy supplier_bank_select on public.supplier_bank_accounts for select to authenticated
using (app.has_permission(company_id, 'suppliers', 'view'));

drop policy if exists supplier_bank_write on public.supplier_bank_accounts;
create policy supplier_bank_write on public.supplier_bank_accounts for all to authenticated
using (app.has_permission(company_id, 'suppliers', 'edit'))
with check (app.has_permission(company_id, 'suppliers', 'edit'));

-- ---------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['categories','payment_terms','suppliers',
                           'supplier_contacts','supplier_bank_accounts'] loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$I', t);
    execute format(
      'create trigger trg_audit_%1$s after insert or update or delete on public.%1$I
       for each row execute function app.audit()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Condições de pagamento padrão para as empresas existentes
-- ---------------------------------------------------------------------
insert into public.payment_terms (company_id, code, name, days)
select c.id, v.code, v.name, v.days
from public.companies c,
(values
  ('AV',      'À vista',            '{0}'::smallint[]),
  ('7',       '7 dias',             '{7}'),
  ('14',      '14 dias',            '{14}'),
  ('28',      '28 dias',            '{28}'),
  ('30',      '30 dias',            '{30}'),
  ('28/35',   '28/35 dias',         '{28,35}'),
  ('28/35/42','28/35/42 dias',      '{28,35,42}'),
  ('30/60',   '30/60 dias',         '{30,60}'),
  ('30/60/90','30/60/90 dias',      '{30,60,90}')
) as v(code, name, days)
on conflict (company_id, code) do nothing;

grant execute on function app.is_valid_cpf(text) to authenticated;

create or replace function public.is_valid_cpf(_cpf text)
returns boolean language sql immutable security invoker set search_path = public, pg_temp as $$
  select app.is_valid_cpf(_cpf);
$$;
revoke execute on function public.is_valid_cpf(text) from public, anon;
grant execute on function public.is_valid_cpf(text) to authenticated;
