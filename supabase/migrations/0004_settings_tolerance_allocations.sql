-- =====================================================================
-- Vitória Procurement — Fase 1 / Migração 0004
-- Decisões arquiteturais confirmadas:
--   1. Divergência pedido × NF-e: tolerância percentual E absoluta
--   2. XML: cadastro semiautomático — captura os dados, humano valida
--   3. Centro de custo: rateio por item, com padrão herdado do pedido
--   4. Grupo econômico: três empresas no mesmo banco (já contemplado)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PARÂMETROS POR EMPRESA
-- ---------------------------------------------------------------------
do $$ begin
  create type public.tolerance_rule as enum ('either','both');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.registration_status as enum ('pendente','aprovado','recusado','duplicado');
exception when duplicate_object then null; end $$;

create table if not exists public.company_settings (
  company_id            uuid primary key references public.companies(id) on delete cascade,

  -- tolerância de conferência (item 37 da especificação)
  -- 'either' = tolera se ficar dentro do percentual OU do valor absoluto
  -- 'both'   = só tolera se ficar dentro dos dois ao mesmo tempo
  tolerance_rule        public.tolerance_rule not null default 'either',
  price_tol_pct         numeric(6,3) not null default 1.000  check (price_tol_pct    >= 0),
  price_tol_abs         numeric(12,2) not null default 0.50  check (price_tol_abs    >= 0),
  total_tol_pct         numeric(6,3) not null default 0.500  check (total_tol_pct    >= 0),
  total_tol_abs         numeric(12,2) not null default 5.00  check (total_tol_abs    >= 0),
  quantity_tol_pct      numeric(6,3) not null default 0.000  check (quantity_tol_pct >= 0),
  quantity_tol_abs      numeric(12,4) not null default 0.0000 check (quantity_tol_abs >= 0),

  -- importação de XML: semiautomático por decisão de projeto
  auto_register_supplier boolean not null default false,
  auto_register_product  boolean not null default false,
  block_import_on_divergence boolean not null default false,

  -- rateio
  require_cost_center    boolean not null default true,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on column public.company_settings.auto_register_supplier is
  'false = fornecedor novo vai para pending_registrations e aguarda validação humana.';

drop trigger if exists trg_company_settings_touch on public.company_settings;
create trigger trg_company_settings_touch before update on public.company_settings
for each row execute function app.touch_updated_at();

-- toda empresa passa a nascer também com seus parâmetros
create or replace function app.seed_company_defaults()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.document_sequences (company_id, doc_type, prefix) values
    (new.id, 'purchase_request', 'SC'),
    (new.id, 'quotation',        'CT'),
    (new.id, 'purchase_order',   'PC'),
    (new.id, 'goods_receipt',    'RC')
  on conflict do nothing;

  insert into public.company_settings (company_id) values (new.id)
  on conflict do nothing;

  return new;
end $$;

-- empresas já criadas antes desta migração
insert into public.company_settings (company_id)
select id from public.companies
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Motor de tolerância
-- ---------------------------------------------------------------------
create or replace function app.within_tolerance(
  _company_id uuid,
  _expected   numeric,
  _actual     numeric,
  _kind       text default 'price'   -- 'price' | 'total' | 'quantity'
)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  s        public.company_settings%rowtype;
  v_pct    numeric;
  v_abs    numeric;
  v_diff   numeric;
  ok_pct   boolean;
  ok_abs   boolean;
begin
  if _expected is null or _actual is null then
    return false;
  end if;

  select * into s from public.company_settings where company_id = _company_id;
  if not found then
    return _expected = _actual;   -- sem parâmetros, exige igualdade
  end if;

  v_pct := case _kind when 'price' then s.price_tol_pct
                      when 'total' then s.total_tol_pct
                      else s.quantity_tol_pct end;
  v_abs := case _kind when 'price' then s.price_tol_abs
                      when 'total' then s.total_tol_abs
                      else s.quantity_tol_abs end;

  v_diff := abs(_actual - _expected);
  ok_abs := v_diff <= v_abs;
  ok_pct := case when _expected = 0 then v_diff = 0
                 else v_diff <= abs(_expected) * v_pct / 100 end;

  return case s.tolerance_rule
           when 'either' then ok_pct or ok_abs
           else               ok_pct and ok_abs
         end;
end $$;

-- versão detalhada, para alimentar o módulo de divergências
create or replace function app.tolerance_report(
  _company_id uuid, _expected numeric, _actual numeric, _kind text default 'price'
)
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'kind',      _kind,
    'expected',  _expected,
    'actual',    _actual,
    'diff',      round(coalesce(_actual,0) - coalesce(_expected,0), 4),
    'diff_pct',  case when coalesce(_expected,0) = 0 then null
                      else round((coalesce(_actual,0) - _expected) / _expected * 100, 4) end,
    'tolerated', app.within_tolerance(_company_id, _expected, _actual, _kind)
  );
$$;

-- ---------------------------------------------------------------------
-- 2. FILA DE VALIDAÇÃO (cadastro semiautomático)
-- ---------------------------------------------------------------------
create table if not exists public.pending_registrations (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  kind               text not null check (kind in ('supplier','product')),
  status             public.registration_status not null default 'pendente',

  -- de onde veio
  source             text not null default 'xml_import',
  source_ref         text,                    -- chave de acesso da NF-e
  dedup_key          text not null,           -- CNPJ, ou cProd do fornecedor

  -- o que o parser capturou, cru
  payload            jsonb not null,

  -- possível correspondência já existente na base
  match_entity_id    uuid,
  match_score        numeric(5,2),

  -- desfecho
  resolved_entity_id uuid,
  reviewed_by        uuid references public.users(id) on delete set null,
  reviewed_at        timestamptz,
  review_notes       text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists pending_registrations_open_uk
  on public.pending_registrations (company_id, kind, dedup_key)
  where status = 'pendente';
create index if not exists pending_registrations_queue_ix
  on public.pending_registrations (company_id, status, created_at);

drop trigger if exists trg_pending_registrations_touch on public.pending_registrations;
create trigger trg_pending_registrations_touch before update on public.pending_registrations
for each row execute function app.touch_updated_at();

-- carimba quem validou
create or replace function app.stamp_registration_review()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status is distinct from old.status and new.status <> 'pendente' then
    new.reviewed_by := coalesce(new.reviewed_by, auth.uid());
    new.reviewed_at := coalesce(new.reviewed_at, now());
  end if;
  return new;
end $$;

drop trigger if exists trg_pending_review on public.pending_registrations;
create trigger trg_pending_review before update on public.pending_registrations
for each row execute function app.stamp_registration_review();

-- ---------------------------------------------------------------------
-- 3. RATEIO DE CENTRO DE CUSTO — por item
-- Polimórfico de propósito: a mesma tabela serve item de solicitação,
-- item de pedido, item de NF-e e lançamento manual do contas a pagar.
-- ---------------------------------------------------------------------
create table if not exists public.cost_center_allocations (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  source_type    text not null check (source_type in (
                   'purchase_request_item','purchase_order_item',
                   'invoice_item','accounts_payable')),
  source_id      uuid not null,
  cost_center_id uuid not null references public.cost_centers(id) on delete restrict,
  percentage     numeric(7,4) not null check (percentage > 0 and percentage <= 100),
  amount         numeric(14,2) check (amount >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (source_type, source_id, cost_center_id)
);
create index if not exists cc_alloc_source_ix on public.cost_center_allocations (source_type, source_id);
create index if not exists cc_alloc_center_ix on public.cost_center_allocations (cost_center_id, company_id);

drop trigger if exists trg_cc_alloc_touch on public.cost_center_allocations;
create trigger trg_cc_alloc_touch before update on public.cost_center_allocations
for each row execute function app.touch_updated_at();

-- o rateio de um item nunca pode passar de 100%
create or replace function app.check_allocation_total()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_type text;
  v_id   uuid;
  v_sum  numeric;
begin
  v_type := coalesce(new.source_type, old.source_type);
  v_id   := coalesce(new.source_id,   old.source_id);

  select coalesce(sum(percentage), 0) into v_sum
    from public.cost_center_allocations
   where source_type = v_type and source_id = v_id;

  if v_sum > 100.0001 then
    raise exception 'Rateio de % excede 100%% (soma: %).', v_type, v_sum
      using errcode = 'check_violation';
  end if;

  return null;
end $$;

drop trigger if exists trg_cc_alloc_total on public.cost_center_allocations;
create constraint trigger trg_cc_alloc_total
after insert or update or delete on public.cost_center_allocations
deferrable initially deferred
for each row execute function app.check_allocation_total();

-- ---------------------------------------------------------------------
-- Permissões novas
-- ---------------------------------------------------------------------
insert into public.permissions (module, action, label)
select m.module, a.action, m.label || ' — ' || a.action
from (values
  ('pending_registrations', 'Validação de cadastros', array['view','approve','edit','delete']),
  ('cost_allocations',      'Rateio de centro de custo', array['view','edit'])
) as m(module, label, actions),
lateral unnest(m.actions) as a(action)
on conflict (module, action) do nothing;

-- Administrador recebe tudo que for criado daqui pra frente
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.slug = 'administrador' and r.company_id is null
on conflict do nothing;

-- Fiscal e Compras validam cadastros vindos do XML
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.company_id is null and r.slug in ('fiscal','compras')
  and p.module in ('pending_registrations','cost_allocations')
  and p.action in ('view','approve','edit')
on conflict do nothing;

-- Diretoria e Financeiro apenas acompanham
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.company_id is null and r.slug in ('diretoria','financeiro')
  and p.module in ('pending_registrations','cost_allocations') and p.action = 'view'
on conflict do nothing;

-- Financeiro também rateia o contas a pagar
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.company_id is null and r.slug = 'financeiro'
  and p.module = 'cost_allocations' and p.action = 'edit'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.company_settings         enable row level security;
alter table public.pending_registrations    enable row level security;
alter table public.cost_center_allocations  enable row level security;

drop policy if exists company_settings_select on public.company_settings;
create policy company_settings_select on public.company_settings for select to authenticated
using (app.is_member(company_id));

drop policy if exists company_settings_update on public.company_settings;
create policy company_settings_update on public.company_settings for update to authenticated
using (app.has_permission(company_id, 'settings', 'edit'))
with check (app.has_permission(company_id, 'settings', 'edit'));

drop policy if exists pending_select on public.pending_registrations;
create policy pending_select on public.pending_registrations for select to authenticated
using (app.has_permission(company_id, 'pending_registrations', 'view'));

drop policy if exists pending_insert on public.pending_registrations;
create policy pending_insert on public.pending_registrations for insert to authenticated
with check (app.has_permission(company_id, 'xml_import', 'import'));

drop policy if exists pending_update on public.pending_registrations;
create policy pending_update on public.pending_registrations for update to authenticated
using (app.has_permission(company_id, 'pending_registrations', 'approve'))
with check (app.has_permission(company_id, 'pending_registrations', 'approve'));

drop policy if exists cc_alloc_select on public.cost_center_allocations;
create policy cc_alloc_select on public.cost_center_allocations for select to authenticated
using (app.is_member(company_id));

drop policy if exists cc_alloc_write on public.cost_center_allocations;
create policy cc_alloc_write on public.cost_center_allocations for all to authenticated
using (app.has_permission(company_id, 'cost_allocations', 'edit'))
with check (
  app.has_permission(company_id, 'cost_allocations', 'edit')
  and exists (select 1 from public.cost_centers c
               where c.id = cost_center_id and c.company_id = cost_center_allocations.company_id
                 and c.is_active and c.deleted_at is null)
);

-- ---------------------------------------------------------------------
-- Auditoria nas novas tabelas
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['company_settings','pending_registrations','cost_center_allocations'] loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$I', t);
    execute format(
      'create trigger trg_audit_%1$s after insert or update or delete on public.%1$I
       for each row execute function app.audit()', t);
  end loop;
end $$;

grant execute on function
  app.within_tolerance(uuid, numeric, numeric, text),
  app.tolerance_report(uuid, numeric, numeric, text)
to authenticated;
