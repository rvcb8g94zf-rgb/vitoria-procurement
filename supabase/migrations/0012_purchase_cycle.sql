-- =====================================================================
-- Vitória Procurement — Fase 3 / Migração 0012
-- Solicitação → aprovação → cotação → pedido → recebimento.
-- =====================================================================

do $$ begin
  create type public.request_status as enum
    ('rascunho','enviada','aguardando_aprovacao','aprovada','recusada','em_cotacao','concluida','cancelada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.priority_level as enum ('baixa','normal','alta','urgente');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.approval_decision as enum ('pendente','aprovado','recusado','alteracao_solicitada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_status as enum
    ('rascunho','aguardando_aprovacao','aprovado','enviado','confirmado',
     'parcialmente_recebido','recebido','cancelado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.quotation_status as enum ('aberta','respondida','encerrada','cancelada');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- SOLICITAÇÃO DE COMPRA
-- ---------------------------------------------------------------------
create table if not exists public.purchase_requests (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  number         text not null,
  requester_id   uuid not null references public.users(id) on delete restrict,
  department_id  uuid references public.departments(id) on delete set null,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  requested_on   date not null default (now() at time zone 'America/Sao_Paulo')::date,
  needed_by      date,
  priority       public.priority_level not null default 'normal',
  justification  text,
  notes          text,
  status         public.request_status not null default 'rascunho',
  submitted_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  deleted_by     uuid references public.users(id),
  unique (company_id, number)
);
create index if not exists pr_company_ix on public.purchase_requests (company_id, status, requested_on desc) where deleted_at is null;
create index if not exists pr_requester_ix on public.purchase_requests (requester_id, status);

create table if not exists public.purchase_request_items (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  request_id  uuid not null references public.purchase_requests(id) on delete cascade,
  line_no     smallint not null,
  product_id  uuid references public.products(id) on delete set null,
  description text not null,
  spec        text,
  quantity    numeric(14,4) not null check (quantity > 0),
  unit_id     uuid references public.units(id) on delete set null,
  needed_by   date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (request_id, line_no)
);
create index if not exists pri_request_ix on public.purchase_request_items (request_id);

-- ---------------------------------------------------------------------
-- FLUXO DE APROVAÇÃO — regras por faixa de valor
-- ---------------------------------------------------------------------
create table if not exists public.approval_rules (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  min_amount  numeric(14,2) not null default 0 check (min_amount >= 0),
  max_amount  numeric(14,2),
  role_id     uuid not null references public.roles(id) on delete restrict,
  step        smallint not null default 1,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint approval_range_ok check (max_amount is null or max_amount > min_amount)
);
create index if not exists approval_rules_ix on public.approval_rules (company_id, min_amount) where is_active;

create table if not exists public.approvals (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  entity_type  text not null check (entity_type in ('purchase_request','purchase_order')),
  entity_id    uuid not null,
  step         smallint not null default 1,
  role_id      uuid references public.roles(id) on delete set null,
  decided_by   uuid references public.users(id) on delete set null,
  decision     public.approval_decision not null default 'pendente',
  comment      text,
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists approvals_entity_ix on public.approvals (entity_type, entity_id, step);
create index if not exists approvals_pending_ix on public.approvals (company_id, decision) where decision = 'pendente';

-- recusa exige justificativa (item 98 da especificação)
create or replace function app.require_rejection_comment()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.decision in ('recusado','alteracao_solicitada')
     and coalesce(btrim(new.comment),'') = '' then
    raise exception 'Justificativa obrigatória ao recusar ou pedir alteração.'
      using errcode = 'check_violation';
  end if;
  if new.decision <> 'pendente' and new.decided_at is null then
    new.decided_at := now();
    new.decided_by := coalesce(new.decided_by, auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists trg_approvals_comment on public.approvals;
create trigger trg_approvals_comment before insert or update on public.approvals
for each row execute function app.require_rejection_comment();

-- ---------------------------------------------------------------------
-- COTAÇÕES
-- ---------------------------------------------------------------------
create table if not exists public.quotations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  number      text not null,
  request_id  uuid references public.purchase_requests(id) on delete set null,
  opened_by   uuid references public.users(id) on delete set null,
  opened_on   date not null default (now() at time zone 'America/Sao_Paulo')::date,
  closes_on   date,
  status      public.quotation_status not null default 'aberta',
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, number)
);

create table if not exists public.quotation_suppliers (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  quotation_id    uuid not null references public.quotations(id) on delete cascade,
  supplier_id     uuid not null references public.suppliers(id) on delete cascade,
  payment_term_id uuid references public.payment_terms(id) on delete set null,
  freight_amount  numeric(14,2) not null default 0 check (freight_amount >= 0),
  lead_days       smallint check (lead_days >= 0),
  valid_until     date,
  responded_at    timestamptz,
  notes           text,
  unique (quotation_id, supplier_id)
);

create table if not exists public.quotation_items (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  quotation_id  uuid not null references public.quotations(id) on delete cascade,
  supplier_id   uuid not null references public.suppliers(id) on delete cascade,
  line_no       smallint not null,
  product_id    uuid references public.products(id) on delete set null,
  description   text not null,
  quantity      numeric(14,4) not null check (quantity > 0),
  unit_id       uuid references public.units(id) on delete set null,
  unit_price    numeric(14,6) check (unit_price >= 0),
  discount      numeric(14,2) not null default 0 check (discount >= 0),
  tax_amount    numeric(14,2) not null default 0 check (tax_amount >= 0),
  is_selected   boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (quotation_id, supplier_id, line_no)
);
create index if not exists qi_quotation_ix on public.quotation_items (quotation_id, line_no);

-- ---------------------------------------------------------------------
-- PEDIDO DE COMPRA
-- ---------------------------------------------------------------------
create table if not exists public.purchase_orders (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  number          text not null,
  supplier_id     uuid not null references public.suppliers(id) on delete restrict,
  request_id      uuid references public.purchase_requests(id) on delete set null,
  quotation_id    uuid references public.quotations(id) on delete set null,
  buyer_id        uuid references public.users(id) on delete set null,
  cost_center_id  uuid references public.cost_centers(id) on delete set null,
  payment_term_id uuid references public.payment_terms(id) on delete set null,
  issued_on       date not null default (now() at time zone 'America/Sao_Paulo')::date,
  expected_on     date,
  carrier         text,
  freight_amount  numeric(14,2) not null default 0 check (freight_amount >= 0),
  discount        numeric(14,2) not null default 0 check (discount >= 0),
  notes           text,
  status          public.order_status not null default 'rascunho',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  deleted_by      uuid references public.users(id),
  unique (company_id, number)
);
create index if not exists po_company_ix on public.purchase_orders (company_id, status, issued_on desc) where deleted_at is null;
create index if not exists po_supplier_ix on public.purchase_orders (supplier_id, issued_on desc);

create table if not exists public.purchase_order_items (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  order_id    uuid not null references public.purchase_orders(id) on delete cascade,
  line_no     smallint not null,
  product_id  uuid references public.products(id) on delete set null,
  description text not null,
  quantity    numeric(14,4) not null check (quantity > 0),
  unit_id     uuid references public.units(id) on delete set null,
  unit_price  numeric(14,6) not null check (unit_price >= 0),
  discount    numeric(14,2) not null default 0 check (discount >= 0),
  -- total sempre derivado: nunca aceita um valor que não fecha com a conta
  total       numeric(14,2) generated always as
                (round(quantity * unit_price - discount, 2)) stored,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (order_id, line_no)
);
create index if not exists poi_order_ix on public.purchase_order_items (order_id, line_no);

-- ---------------------------------------------------------------------
-- RECEBIMENTO (permite parcial)
-- ---------------------------------------------------------------------
create table if not exists public.goods_receipts (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  number        text not null,
  order_id      uuid references public.purchase_orders(id) on delete set null,
  received_by   uuid references public.users(id) on delete set null,
  received_on   date not null default (now() at time zone 'America/Sao_Paulo')::date,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, number)
);

create table if not exists public.goods_receipt_items (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  receipt_id        uuid not null references public.goods_receipts(id) on delete cascade,
  order_item_id     uuid references public.purchase_order_items(id) on delete set null,
  product_id        uuid references public.products(id) on delete set null,
  quantity_ordered  numeric(14,4),
  quantity_received numeric(14,4) not null check (quantity_received >= 0),
  divergence_note   text,
  created_at        timestamptz not null default now()
);
create index if not exists gri_receipt_ix on public.goods_receipt_items (receipt_id);

-- ---------------------------------------------------------------------
-- Numeração das cotações e recebimentos já existia em document_sequences
-- (SC / CT / PC / RC, semeadas na 0001).
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'purchase_requests','purchase_request_items','approval_rules','approvals',
    'quotations','quotation_suppliers','quotation_items',
    'purchase_orders','purchase_order_items','goods_receipts','goods_receipt_items'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Solicitação: o Solicitante enxerga as próprias; quem tem view enxerga todas.
drop policy if exists pr_select on public.purchase_requests;
create policy pr_select on public.purchase_requests for select to authenticated
using (deleted_at is null and (
  requester_id = auth.uid() or app.has_permission(company_id, 'purchase_requests', 'view')
));

drop policy if exists pr_insert on public.purchase_requests;
create policy pr_insert on public.purchase_requests for insert to authenticated
with check (app.has_permission(company_id, 'purchase_requests', 'create') and requester_id = auth.uid());

-- rascunho o autor edita; depois de enviada, só quem tem permissão de edição
drop policy if exists pr_update on public.purchase_requests;
create policy pr_update on public.purchase_requests for update to authenticated
using (
  (requester_id = auth.uid() and status = 'rascunho')
  or app.has_permission(company_id, 'purchase_requests', 'edit')
)
with check (
  (requester_id = auth.uid() and status in ('rascunho','enviada'))
  or app.has_permission(company_id, 'purchase_requests', 'edit')
);

drop policy if exists pri_select on public.purchase_request_items;
create policy pri_select on public.purchase_request_items for select to authenticated
using (exists (select 1 from public.purchase_requests r where r.id = request_id));

drop policy if exists pri_write on public.purchase_request_items;
create policy pri_write on public.purchase_request_items for all to authenticated
using (exists (
  select 1 from public.purchase_requests r
   where r.id = request_id
     and ((r.requester_id = auth.uid() and r.status = 'rascunho')
          or app.has_permission(r.company_id, 'purchase_requests', 'edit'))))
with check (exists (
  select 1 from public.purchase_requests r
   where r.id = request_id
     and ((r.requester_id = auth.uid() and r.status = 'rascunho')
          or app.has_permission(r.company_id, 'purchase_requests', 'edit'))));

drop policy if exists approval_rules_select on public.approval_rules;
create policy approval_rules_select on public.approval_rules for select to authenticated
using (app.is_member(company_id));

drop policy if exists approval_rules_write on public.approval_rules;
create policy approval_rules_write on public.approval_rules for all to authenticated
using (app.has_permission(company_id, 'approval_flows', 'edit'))
with check (app.has_permission(company_id, 'approval_flows', 'edit'));

drop policy if exists approvals_select on public.approvals;
create policy approvals_select on public.approvals for select to authenticated
using (app.is_member(company_id));

drop policy if exists approvals_insert on public.approvals;
create policy approvals_insert on public.approvals for insert to authenticated
with check (app.has_permission(company_id, 'approvals', 'approve'));

drop policy if exists approvals_update on public.approvals;
create policy approvals_update on public.approvals for update to authenticated
using (app.has_permission(company_id, 'approvals', 'approve'))
with check (app.has_permission(company_id, 'approvals', 'approve'));

-- Cotações, pedidos e recebimentos: leitura e escrita pelo módulo próprio
do $$
declare
  t text; m text;
  pares text[][] := array[
    ['quotations','quotations'], ['quotation_suppliers','quotations'], ['quotation_items','quotations'],
    ['purchase_orders','purchase_orders'], ['purchase_order_items','purchase_orders'],
    ['goods_receipts','goods_receipts'], ['goods_receipt_items','goods_receipts']
  ];
  i int;
begin
  for i in 1..array_length(pares,1) loop
    t := pares[i][1]; m := pares[i][2];
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format(
      'create policy %1$s_select on public.%1$I for select to authenticated
       using (app.has_permission(company_id, %2$L, ''view''))', t, m);
    execute format('drop policy if exists %1$s_write on public.%1$I', t);
    execute format(
      'create policy %1$s_write on public.%1$I for all to authenticated
       using (app.has_permission(company_id, %2$L, ''edit''))
       with check (app.has_permission(company_id, %2$L, ''edit''))', t, m);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- updated_at + auditoria
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'purchase_requests','purchase_request_items','approval_rules',
    'quotations','purchase_orders','purchase_order_items','goods_receipts'
  ] loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$I', t);
    execute format('create trigger trg_touch_%1$s before update on public.%1$I
                    for each row execute function app.touch_updated_at()', t);
  end loop;

  foreach t in array array[
    'purchase_requests','approvals','quotations','purchase_orders',
    'purchase_order_items','goods_receipts'
  ] loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$I', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I
                    for each row execute function app.audit()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Regras de aprovação padrão (item 20): faixas por valor
-- ---------------------------------------------------------------------
insert into public.approval_rules (company_id, name, min_amount, max_amount, role_id, step)
select c.id, v.name, v.mn, v.mx, r.id, v.step
from public.companies c
cross join (values
  ('Até R$ 2.000 — Compras',           0::numeric,     2000::numeric, 'compras',      1::smallint),
  ('R$ 2.000 a R$ 10.000 — Financeiro', 2000,          10000,         'financeiro',   1),
  ('Acima de R$ 10.000 — Diretoria',    10000,         null,          'diretoria',    1)
) as v(name, mn, mx, role_slug, step)
join public.roles r on r.slug = v.role_slug and r.company_id is null
on conflict do nothing;
