-- =====================================================================
-- Vitória Procurement — Módulo DF-e / Migração 0013
-- Coletor de NF-e recebidas via NFeDistribuicaoDFe.
--
-- Fatos que moldaram este modelo:
--  • Antes da manifestação a SEFAZ entrega só o Resumo (resNFe): sem
--    itens e sem duplicatas. O mesmo registro é enriquecido depois,
--    quando o XML completo chega — nunca vira uma segunda nota.
--  • O NSU é por ator interessado. Cada empresa tem seu cursor.
--  • Reprocessar um XML não pode duplicar parcelas.
-- =====================================================================

do $$ begin
  create type public.dfe_environment as enum ('producao','homologacao');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.dfe_doc_kind as enum ('resumo','completo');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.dfe_fiscal_status as enum ('autorizada','cancelada','denegada','desconhecida');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.dfe_manifestation as enum
    ('nenhuma','ciencia','confirmada','desconhecida','nao_realizada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.dfe_run_status as enum ('executando','concluida','sem_novidade','bloqueada','erro');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- CONEXÃO FISCAL — certificado A1 por empresa
-- O .pfx fica no Storage privado; a senha vai no Vault do Supabase e
-- aqui guardamos apenas a referência. Nem arquivo nem senha trafegam
-- pelo cliente.
-- ---------------------------------------------------------------------
create table if not exists public.fiscal_connections (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  environment        public.dfe_environment not null default 'producao',
  cert_storage_path  text,
  cert_secret_name   text,          -- nome do segredo no Vault
  cert_subject       text,
  cert_valid_from    date,
  cert_valid_to      date,
  uf_code            smallint not null default 35,   -- 35 = SP
  is_active          boolean not null default false,
  -- Manifestação automática permanece DESLIGADA. Ciência da Operação
  -- tem prazo de 10 dias e obriga manifestação conclusiva depois, com
  -- multa na maioria das UFs se ela não vier. Não é decisão do sistema.
  auto_manifest      boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (company_id, environment)
);

drop trigger if exists trg_fiscal_conn_touch on public.fiscal_connections;
create trigger trg_fiscal_conn_touch before update on public.fiscal_connections
for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------
-- CURSOR DE SINCRONIZAÇÃO
-- locked_at garante exclusão mútua: consulta manual e automática nunca
-- rodam juntas para o mesmo CNPJ.
-- ---------------------------------------------------------------------
create table if not exists public.dfe_sync_state (
  company_id    uuid not null references public.companies(id) on delete cascade,
  environment   public.dfe_environment not null default 'producao',
  ult_nsu       bigint not null default 0,
  max_nsu       bigint not null default 0,
  last_run_at   timestamptz,
  last_cstat    text,
  last_message  text,
  -- cStat=137 (sem mais documentos) exige esperar 1h; consultar antes
  -- gera rejeição 656 e bloqueia o CNPJ.
  blocked_until timestamptz,
  locked_at     timestamptz,
  locked_by     text,
  primary key (company_id, environment)
);

-- ---------------------------------------------------------------------
-- NOTAS RECEBIDAS
-- ---------------------------------------------------------------------
create table if not exists public.received_invoices (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  environment    public.dfe_environment not null default 'producao',
  access_key     text not null,
  nsu            bigint,
  doc_kind       public.dfe_doc_kind not null default 'resumo',

  emitter_cnpj   text not null,
  emitter_name   text,
  emitter_ie     text,
  supplier_id    uuid references public.suppliers(id) on delete set null,

  number         text,
  series         text,
  issued_at      timestamptz,
  total_amount   numeric(14,2),
  protocol       text,
  item_count     smallint,

  fiscal_status  public.dfe_fiscal_status not null default 'autorizada',
  manifestation  public.dfe_manifestation not null default 'nenhuma',
  cancelled_at   timestamptz,

  xml_path       text,
  first_seen_at  timestamptz not null default now(),
  completed_at   timestamptz,          -- quando o XML completo chegou
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint access_key_fmt check (access_key ~ '^[0-9]{44}$')
);

-- a chave de acesso é a identidade da nota, isolada por empresa e ambiente
create unique index if not exists received_invoices_key_uk
  on public.received_invoices (company_id, environment, access_key);
create index if not exists received_invoices_list_ix
  on public.received_invoices (company_id, issued_at desc);
create index if not exists received_invoices_pending_ix
  on public.received_invoices (company_id) where doc_kind = 'resumo';
create index if not exists received_invoices_emitter_ix
  on public.received_invoices (company_id, emitter_cnpj);

drop trigger if exists trg_received_touch on public.received_invoices;
create trigger trg_received_touch before update on public.received_invoices
for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------
-- DUPLICATAS DA NOTA
-- seq é a posição na lista; number é o nDup original do XML. Os dois
-- são coisas diferentes e não devem ser confundidos.
-- ---------------------------------------------------------------------
create table if not exists public.received_invoice_duplicates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  invoice_id  uuid not null references public.received_invoices(id) on delete cascade,
  seq         smallint not null check (seq > 0),
  number      text,
  due_date    date,
  amount      numeric(14,2) check (amount >= 0),
  created_at  timestamptz not null default now(),
  unique (invoice_id, seq)
);
create index if not exists rid_due_ix on public.received_invoice_duplicates (company_id, due_date);

-- ---------------------------------------------------------------------
-- EVENTOS FISCAIS (cancelamento, manifestação, carta de correção)
-- ---------------------------------------------------------------------
create table if not exists public.fiscal_events (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  environment  public.dfe_environment not null default 'producao',
  access_key   text not null,
  event_type   text not null,           -- tpEvento
  sequence     smallint not null default 1,
  occurred_at  timestamptz,
  nsu          bigint,
  description  text,
  xml_path     text,
  created_at   timestamptz not null default now(),
  unique (company_id, environment, access_key, event_type, sequence)
);

-- ---------------------------------------------------------------------
-- EXECUÇÕES
-- ---------------------------------------------------------------------
create table if not exists public.dfe_sync_runs (
  id            bigserial primary key,
  company_id    uuid not null references public.companies(id) on delete cascade,
  environment   public.dfe_environment not null default 'producao',
  trigger       text not null check (trigger in ('cron','manual')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        public.dfe_run_status not null default 'executando',
  cstat         text,
  message       text,
  docs_returned smallint not null default 0,
  new_invoices  smallint not null default 0,
  enriched      smallint not null default 0,
  from_nsu      bigint,
  to_nsu        bigint
);
create index if not exists dfe_runs_ix on public.dfe_sync_runs (company_id, started_at desc);

-- ---------------------------------------------------------------------
-- Permissões do módulo
-- ---------------------------------------------------------------------
insert into public.permissions (module, action, label)
select m.module, a.action, m.label || ' — ' || a.action
from (values
  ('dfe', 'Consulta NF-e (DF-e)', array['view','import','edit','export'])
) as m(module, label, actions),
lateral unnest(m.actions) as a(action)
on conflict (module, action) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.company_id is null and p.module = 'dfe'
  and (r.slug = 'administrador'
       or (r.slug in ('fiscal','financeiro') and p.action in ('view','import','export'))
       or (r.slug in ('compras','diretoria') and p.action in ('view','export')))
on conflict do nothing;

-- ---------------------------------------------------------------------
-- RLS — nada aqui é escrito pelo cliente. A gravação é do worker,
-- que usa service_role. O usuário só lê.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'fiscal_connections','dfe_sync_state','received_invoices',
    'received_invoice_duplicates','fiscal_events','dfe_sync_runs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- conexão: só quem administra configurações vê, e sem expor segredo
drop policy if exists fiscal_conn_select on public.fiscal_connections;
create policy fiscal_conn_select on public.fiscal_connections for select to authenticated
using (app.has_permission(company_id, 'settings', 'edit'));

drop policy if exists dfe_state_select on public.dfe_sync_state;
create policy dfe_state_select on public.dfe_sync_state for select to authenticated
using (app.has_permission(company_id, 'dfe', 'view'));

drop policy if exists received_select on public.received_invoices;
create policy received_select on public.received_invoices for select to authenticated
using (app.has_permission(company_id, 'dfe', 'view'));

drop policy if exists rid_select on public.received_invoice_duplicates;
create policy rid_select on public.received_invoice_duplicates for select to authenticated
using (app.has_permission(company_id, 'dfe', 'view'));

drop policy if exists fiscal_events_select on public.fiscal_events;
create policy fiscal_events_select on public.fiscal_events for select to authenticated
using (app.has_permission(company_id, 'dfe', 'view'));

drop policy if exists dfe_runs_select on public.dfe_sync_runs;
create policy dfe_runs_select on public.dfe_sync_runs for select to authenticated
using (app.has_permission(company_id, 'dfe', 'view'));

-- ---------------------------------------------------------------------
-- Storage privado para os XMLs coletados
-- Caminho: {company_id}/dfe/{ano}/{chave}.xml
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('fiscal', 'fiscal', false, 10485760)
on conflict (id) do nothing;

drop policy if exists fiscal_read on storage.objects;
create policy fiscal_read on storage.objects for select to authenticated
using (bucket_id = 'fiscal' and app.has_permission(app.folder_company(name), 'dfe', 'view'));

-- ---------------------------------------------------------------------
-- Trava de concorrência por CNPJ/ambiente
-- ---------------------------------------------------------------------
create or replace function app.dfe_acquire_lock(
  _company_id uuid, _env public.dfe_environment, _owner text, _ttl_minutes int default 15
)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare ok boolean;
begin
  insert into public.dfe_sync_state (company_id, environment)
  values (_company_id, _env)
  on conflict do nothing;

  update public.dfe_sync_state
     set locked_at = now(), locked_by = _owner
   where company_id = _company_id and environment = _env
     and (locked_at is null or locked_at < now() - make_interval(mins => _ttl_minutes))
     and (blocked_until is null or blocked_until < now())
  returning true into ok;

  return coalesce(ok, false);
end $$;

create or replace function app.dfe_release_lock(
  _company_id uuid, _env public.dfe_environment
)
returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.dfe_sync_state
     set locked_at = null, locked_by = null
   where company_id = _company_id and environment = _env;
$$;
