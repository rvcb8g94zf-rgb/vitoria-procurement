-- 0032_manifestation.sql
-- Manifestação do Destinatário feita pelo sistema (opcional).
--
-- Decisão de 30/09/2026 (contabilidade + diretoria): além de consultar a
-- SEFAZ, a empresa pode registrar ela mesma os eventos de manifestação,
-- sem esperar o escritório de contabilidade. Continua sendo sempre um ato
-- de uma pessoa, nota a nota (ou lote escolhido por ela) — nada é enviado
-- sozinho. fiscal_connections.auto_manifest segue desligado.
--
-- Eventos (NT 2020.001, v1.60 — prazos do Ajuste SINIEF 14/26, em vigor
-- desde 01/06/2026, contados da autorização da NF-e):
--   210210 Ciência da Operação         até 10 dias · não é conclusiva · uma vez
--   210200 Confirmação da Operação     até 90 dias · conclusiva
--   210220 Desconhecimento da Operação até 90 dias · conclusiva
--   210240 Operação não Realizada      até 90 dias · conclusiva · justificativa 15–255
-- Cada evento conclusivo pode ser registrado no máximo 2 vezes
-- (nSeqEvento 1 e 2); vale a última manifestação conclusiva.
-- Ciência depois de conclusiva é rejeitada pela SEFAZ (655).
--
-- Quem manifesta: permissão dfe.manifest (Administrador, Diretoria, Fiscal).
-- A assinatura e o envio são feitos pelo servidor com o certificado A1; o
-- resultado só pode ser gravado pela chave de serviço (quem usa o sistema
-- não consegue "declarar" que a SEFAZ aceitou).

-- ---------------------------------------------------------------------
-- Permissão
-- ---------------------------------------------------------------------
insert into public.permissions (module, action, label)
values ('dfe', 'manifest', 'Consulta NF-e (DF-e) — manifest')
on conflict (module, action) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
 where r.company_id is null and p.module = 'dfe' and p.action = 'manifest'
   and r.slug in ('administrador', 'diretoria', 'fiscal')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Histórico de envios (cada tentativa fica registrada)
-- ---------------------------------------------------------------------
create table if not exists public.manifestation_requests (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  environment   public.dfe_environment not null,
  invoice_id    uuid not null references public.received_invoices(id) on delete cascade,
  access_key    text not null,
  event_type    text not null check (event_type in ('210210', '210200', '210220', '210240')),
  sequence      smallint not null check (sequence between 1 and 2),
  justification text,
  requested_by  uuid not null references public.users(id),
  requested_at  timestamptz not null default now(),
  status        text not null default 'enviando' check (status in ('enviando', 'registrado', 'rejeitado', 'erro')),
  cstat         text,
  message       text,
  protocol      text,
  registered_at timestamptz,
  event_xml     text,       -- evento assinado + retorno da SEFAZ (procEventoNFe)
  finished_at   timestamptz
);
create index if not exists mreq_invoice_ix on public.manifestation_requests (invoice_id, requested_at desc);
create index if not exists mreq_company_ix on public.manifestation_requests (company_id, requested_at desc);

alter table public.manifestation_requests enable row level security;
drop policy if exists mreq_select on public.manifestation_requests;
create policy mreq_select on public.manifestation_requests for select to authenticated
  using (app.has_permission(company_id, 'dfe', 'view') or app.has_permission(company_id, 'invoices', 'view'));
revoke insert, update, delete on public.manifestation_requests from authenticated, anon;

-- ---------------------------------------------------------------------
-- Regras
-- ---------------------------------------------------------------------
create or replace function app.manifest_label(_tipo text)
returns text language sql immutable set search_path = pg_catalog, pg_temp as $$
  select case _tipo when '210210' then 'Ciência da Operação' when '210200' then 'Confirmação da Operação'
                    when '210220' then 'Desconhecimento da Operação' when '210240' then 'Operação não Realizada' end;
$$;

-- prazo (conta da emissão, que é igual ou anterior à autorização — ou seja,
-- nunca promete mais prazo do que a SEFAZ dá)
create or replace function app.manifest_deadline(_issued timestamptz, _tipo text)
returns date language sql immutable set search_path = pg_catalog, pg_temp as $$
  select ((_issued at time zone 'America/Sao_Paulo')::date
          + case when _tipo = '210210' then 10 else 90 end);
$$;

-- avaliação de uma nota para um evento: pode? com qual sequência? por que não?
create or replace function app.manifest_eval(_invoice_id uuid, _tipo text)
returns table (ok boolean, sequence smallint, reason text, deadline date, late boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  ri      record;
  v_feitos int;
  v_conc   boolean;
  v_prazo  date;
  v_pend   boolean;
begin
  select r.id, r.company_id, r.environment, r.access_key, r.fiscal_status, r.issued_at, r.manifestation
    into ri from public.received_invoices r where r.id = _invoice_id;
  if ri.id is null then
    return query select false, null::smallint, 'Nota não encontrada.', null::date, false; return;
  end if;
  v_prazo := app.manifest_deadline(coalesce(ri.issued_at, now()), _tipo);

  if ri.fiscal_status in ('cancelada', 'denegada') then
    return query select false, null::smallint, format('A nota está %s na SEFAZ.', ri.fiscal_status), v_prazo, false; return;
  end if;

  select exists (select 1 from public.manifestation_requests m
                  where m.invoice_id = _invoice_id and m.status = 'enviando'
                    and m.requested_at > now() - interval '3 minutes') into v_pend;
  if v_pend then
    return query select false, null::smallint, 'Já há um envio desta nota em andamento.', v_prazo, false; return;
  end if;

  -- eventos já registrados (vindos da SEFAZ pela consulta ou enviados daqui)
  select count(*) into v_feitos from public.fiscal_events e
   where e.company_id = ri.company_id and e.environment = ri.environment and e.access_key = ri.access_key
     and e.event_type = _tipo;
  v_conc := ri.manifestation in ('confirmada', 'desconhecida', 'nao_realizada')
            or exists (select 1 from public.fiscal_events e
                        where e.company_id = ri.company_id and e.environment = ri.environment
                          and e.access_key = ri.access_key and e.event_type in ('210200', '210220', '210240'));

  if _tipo = '210210' then
    if v_feitos > 0 or ri.manifestation = 'ciencia' then
      return query select false, null::smallint, 'A Ciência da Operação já foi registrada.', v_prazo, false; return;
    end if;
    if v_conc then
      return query select false, null::smallint, 'A nota já tem manifestação conclusiva; a SEFAZ não aceita ciência depois dela.', v_prazo, false; return;
    end if;
  else
    if v_feitos >= 2 then
      return query select false, null::smallint, format('%s já foi registrada 2 vezes (o máximo).', app.manifest_label(_tipo)), v_prazo, false; return;
    end if;
    if (_tipo = '210200' and ri.manifestation = 'confirmada')
       or (_tipo = '210220' and ri.manifestation = 'desconhecida')
       or (_tipo = '210240' and ri.manifestation = 'nao_realizada') then
      return query select false, null::smallint, 'Esta já é a manifestação atual da nota.', v_prazo, false; return;
    end if;
  end if;

  return query select true, (v_feitos + 1)::smallint, null::text, v_prazo,
                      (now() at time zone 'America/Sao_Paulo')::date > v_prazo;
end $fn$;

-- ---------------------------------------------------------------------
-- Início do envio (com o usuário): confere tudo e reserva as linhas
-- ---------------------------------------------------------------------
create or replace function app.manifest_begin(_company_id uuid, _invoice_ids uuid[], _tipo text, _just text default null)
returns table (request_id uuid, invoice_id uuid, access_key text, sequence smallint, number text, ok boolean, reason text)
language plpgsql security definer set search_path = public, pg_temp as $fn$
#variable_conflict use_column
declare
  v_uid  uuid := auth.uid();
  v_just text := nullif(btrim(regexp_replace(coalesce(_just, ''), '\s+', ' ', 'g')), '');
  v_id   uuid;
  r      record;
  ev     record;
begin
  if v_uid is null then raise exception 'Usuário não autenticado.' using errcode = '28000'; end if;
  if not app.has_permission(_company_id, 'dfe', 'manifest') then
    raise exception 'Sem permissão para manifestar notas nesta empresa.' using errcode = '42501';
  end if;
  if _tipo not in ('210210', '210200', '210220', '210240') then
    raise exception 'Evento inválido.' using errcode = '22023';
  end if;
  if coalesce(array_length(_invoice_ids, 1), 0) = 0 then
    raise exception 'Escolha pelo menos uma nota.' using errcode = '22023';
  end if;
  if array_length(_invoice_ids, 1) > 20 then
    raise exception 'No máximo 20 notas por envio (limite da SEFAZ).' using errcode = '22023';
  end if;
  if _tipo = '210240' and (v_just is null or length(v_just) < 15) then
    raise exception 'Operação não Realizada exige justificativa de pelo menos 15 caracteres.' using errcode = '22023';
  end if;
  if _tipo <> '210240' then v_just := null; end if;
  v_just := left(v_just, 255);
  if not exists (select 1 from public.fiscal_connections c where c.company_id = _company_id and c.is_active) then
    raise exception 'Nenhum certificado A1 configurado nesta empresa (Notas fiscais › Consulta SEFAZ).' using errcode = '22023';
  end if;

  for r in select ri.* from public.received_invoices ri
            where ri.id = any(_invoice_ids) and ri.company_id = _company_id
            order by ri.issued_at loop
    select * into ev from app.manifest_eval(r.id, _tipo);
    if not ev.ok then
      return query select null::uuid, r.id, r.access_key, null::smallint, r.number, false, ev.reason;
      continue;
    end if;
    insert into public.manifestation_requests (company_id, environment, invoice_id, access_key, event_type,
                                               sequence, justification, requested_by)
    values (_company_id, r.environment, r.id, r.access_key, _tipo, ev.sequence, v_just, v_uid)
    returning id into v_id;
    return query select v_id, r.id, r.access_key, ev.sequence, r.number, true, null::text;
  end loop;
end $fn$;

-- ---------------------------------------------------------------------
-- Fim do envio (só a chave de serviço): grava o que a SEFAZ respondeu
-- ---------------------------------------------------------------------
create or replace function app.manifest_finish(
  _request_id uuid, _cstat text, _message text, _protocol text, _registered_at timestamptz, _xml text)
returns text language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  m        record;
  ri       record;
  v_status text;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Só o servidor grava o retorno da SEFAZ.' using errcode = '42501';
  end if;
  select * into m from public.manifestation_requests where id = _request_id for update;
  if m.id is null then raise exception 'Envio não encontrado.' using errcode = 'P0002'; end if;
  if m.status <> 'enviando' then return m.status; end if;

  -- 135 registrado e vinculado · 136 registrado, não vinculado
  -- 573 duplicidade: o evento já existia na SEFAZ — vale como registrado
  v_status := case when _cstat in ('135', '136', '573') then 'registrado'
                   when _cstat is null or _cstat = '' then 'erro'
                   else 'rejeitado' end;

  update public.manifestation_requests
     set status = v_status, cstat = nullif(_cstat, ''), message = left(_message, 500),
         protocol = nullif(_protocol, ''), registered_at = _registered_at,
         event_xml = _xml, finished_at = now()
   where id = _request_id;

  select id, number into ri from public.received_invoices where id = m.invoice_id;

  if v_status = 'registrado' then
    insert into public.fiscal_events (company_id, environment, access_key, event_type, sequence, occurred_at, description)
    values (m.company_id, m.environment, m.access_key, m.event_type, m.sequence, coalesce(_registered_at, now()),
            app.manifest_label(m.event_type) || coalesce(' — ' || m.justification, '') || ' (enviada pelo sistema)')
    on conflict (company_id, environment, access_key, event_type, sequence) do nothing;

    update public.received_invoices
       set manifestation = case m.event_type
             when '210210' then 'ciencia'::dfe_manifestation
             when '210200' then 'confirmada'::dfe_manifestation
             when '210220' then 'desconhecida'::dfe_manifestation
             when '210240' then 'nao_realizada'::dfe_manifestation end
     where id = m.invoice_id
       and not (m.event_type = '210210' and manifestation in ('confirmada', 'desconhecida', 'nao_realizada'));
  end if;

  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (m.company_id, m.requested_by, case when v_status = 'registrado' then 'approved' else 'updated' end,
          'invoice', m.invoice_id,
          case when v_status = 'registrado'
               then format('%s registrada na SEFAZ para a NF %s%s', app.manifest_label(m.event_type),
                           coalesce(ri.number, 's/nº'), coalesce(' (protocolo ' || nullif(_protocol, '') || ')', ''))
               else format('%s da NF %s não foi registrada: %s %s', app.manifest_label(m.event_type),
                           coalesce(ri.number, 's/nº'), coalesce(_cstat, ''), left(coalesce(_message, ''), 150)) end,
          '/interno/notas/' || m.invoice_id);
  return v_status;
end $fn$;

-- ---------------------------------------------------------------------
-- Leitura
-- ---------------------------------------------------------------------
-- situação da manifestação de uma nota, para a tela
create or replace function app.manifest_panel(_company_id uuid, _invoice_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare ri record; v jsonb;
begin
  if not (app.has_permission(_company_id, 'invoices', 'view') or app.has_permission(_company_id, 'dfe', 'view')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  select * into ri from public.received_invoices where id = _invoice_id and company_id = _company_id;
  if ri.id is null then raise exception 'Nota não encontrada.' using errcode = 'P0002'; end if;

  select jsonb_build_object(
    'manifestation', ri.manifestation,
    'can_manifest', app.has_permission(_company_id, 'dfe', 'manifest'),
    'has_cert', exists (select 1 from public.fiscal_connections c where c.company_id = _company_id and c.is_active),
    'deadline_ciencia', app.manifest_deadline(coalesce(ri.issued_at, now()), '210210'),
    'deadline_conclusiva', app.manifest_deadline(coalesce(ri.issued_at, now()), '210200'),
    'options', (select jsonb_agg(jsonb_build_object('tipo', t, 'label', app.manifest_label(t),
                                   'ok', e.ok, 'reason', e.reason, 'late', e.late, 'deadline', e.deadline))
                  from unnest(array['210210', '210200', '210220', '210240']) t
                  cross join lateral app.manifest_eval(_invoice_id, t) e),
    'events', coalesce((select jsonb_agg(jsonb_build_object('tipo', fe.event_type, 'label', coalesce(app.manifest_label(fe.event_type), fe.description),
                                   'seq', fe.sequence, 'at', fe.occurred_at, 'description', fe.description)
                                 order by fe.occurred_at)
                          from public.fiscal_events fe
                         where fe.company_id = _company_id and fe.environment = ri.environment and fe.access_key = ri.access_key
                           and fe.event_type in ('210210', '210200', '210220', '210240')), '[]'),
    'history', coalesce((select jsonb_agg(jsonb_build_object('tipo', m.event_type, 'label', app.manifest_label(m.event_type),
                                   'status', m.status, 'cstat', m.cstat, 'message', m.message, 'protocol', m.protocol,
                                   'at', m.requested_at, 'by', u.full_name, 'justification', m.justification)
                                 order by m.requested_at desc)
                          from public.manifestation_requests m join public.users u on u.id = m.requested_by
                         where m.invoice_id = _invoice_id), '[]')
  ) into v;
  return v;
end $fn$;

-- notas que só têm o resumo e ainda cabem na Ciência (para o envio em lote)
create or replace function app.awaiting_ciencia(_company_id uuid)
returns table (invoice_id uuid, number text, emitter_name text, issued_at timestamptz, total_amount numeric,
               deadline date, days_left int)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select ri.id, ri.number, coalesce(s.trade_name, s.legal_name, ri.emitter_name), ri.issued_at, ri.total_amount,
         app.manifest_deadline(ri.issued_at, '210210'),
         (app.manifest_deadline(ri.issued_at, '210210') - (now() at time zone 'America/Sao_Paulo')::date)::int
    from public.received_invoices ri
    left join public.suppliers s on s.id = ri.supplier_id
   where ri.company_id = _company_id and app.has_permission(_company_id, 'dfe', 'view')
     and ri.doc_kind = 'resumo' and ri.fiscal_status = 'autorizada' and ri.manifestation = 'nenhuma'
     and ri.issued_at is not null
     and app.manifest_deadline(ri.issued_at, '210210') >= (now() at time zone 'America/Sao_Paulo')::date
     and not exists (select 1 from public.fiscal_events e where e.company_id = ri.company_id
                        and e.access_key = ri.access_key and e.event_type in ('210210', '210200', '210220', '210240'))
     and not exists (select 1 from public.manifestation_requests m where m.invoice_id = ri.id
                        and m.status = 'enviando' and m.requested_at > now() - interval '3 minutes')
   order by ri.issued_at
   limit 200;
$fn$;

-- conclusivas vencendo: notas sem manifestação conclusiva perto dos 90 dias
create or replace function app.awaiting_conclusive(_company_id uuid)
returns table (invoice_id uuid, number text, emitter_name text, issued_at timestamptz, total_amount numeric,
               manifestation text, deadline date, days_left int)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select ri.id, ri.number, coalesce(s.trade_name, s.legal_name, ri.emitter_name), ri.issued_at, ri.total_amount,
         ri.manifestation::text, app.manifest_deadline(ri.issued_at, '210200'),
         (app.manifest_deadline(ri.issued_at, '210200') - (now() at time zone 'America/Sao_Paulo')::date)::int
    from public.received_invoices ri
    left join public.suppliers s on s.id = ri.supplier_id
   where ri.company_id = _company_id and app.has_permission(_company_id, 'dfe', 'view')
     and ri.fiscal_status = 'autorizada' and ri.manifestation in ('nenhuma', 'ciencia')
     and ri.issued_at is not null
     and app.manifest_deadline(ri.issued_at, '210200') between (now() at time zone 'America/Sao_Paulo')::date
                                                           and (now() at time zone 'America/Sao_Paulo')::date + 15
   order by ri.issued_at
   limit 200;
$fn$;

-- ---------------------------------------------------------------------
-- Permissões e wrappers
-- ---------------------------------------------------------------------
revoke all on function app.manifest_label(text), app.manifest_deadline(timestamptz, text),
  app.manifest_eval(uuid, text), app.manifest_begin(uuid, uuid[], text, text),
  app.manifest_finish(uuid, text, text, text, timestamptz, text), app.manifest_panel(uuid, uuid),
  app.awaiting_ciencia(uuid), app.awaiting_conclusive(uuid)
from public, anon;
grant execute on function app.manifest_label(text), app.manifest_deadline(timestamptz, text),
  app.manifest_begin(uuid, uuid[], text, text), app.manifest_panel(uuid, uuid),
  app.awaiting_ciencia(uuid), app.awaiting_conclusive(uuid)
to authenticated;
grant execute on function app.manifest_label(text), app.manifest_eval(uuid, text), app.manifest_deadline(timestamptz, text),
  app.manifest_finish(uuid, text, text, text, timestamptz, text) to service_role;

create or replace function public.manifest_begin(_company_id uuid, _invoice_ids uuid[], _tipo text, _just text default null)
returns table (request_id uuid, invoice_id uuid, access_key text, sequence smallint, number text, ok boolean, reason text)
language sql security invoker set search_path = public, pg_temp as $$
  select * from app.manifest_begin(_company_id, _invoice_ids, _tipo, _just); $$;
create or replace function public.manifest_panel(_company_id uuid, _invoice_id uuid)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select app.manifest_panel(_company_id, _invoice_id); $$;
create or replace function public.awaiting_ciencia(_company_id uuid)
returns table (invoice_id uuid, number text, emitter_name text, issued_at timestamptz, total_amount numeric, deadline date, days_left int)
language sql stable security invoker set search_path = public, pg_temp as $$
  select * from app.awaiting_ciencia(_company_id); $$;
create or replace function public.awaiting_conclusive(_company_id uuid)
returns table (invoice_id uuid, number text, emitter_name text, issued_at timestamptz, total_amount numeric,
               manifestation text, deadline date, days_left int)
language sql stable security invoker set search_path = public, pg_temp as $$
  select * from app.awaiting_conclusive(_company_id); $$;
-- retorno da SEFAZ: só o servidor
create or replace function public.manifest_finish(
  _request_id uuid, _cstat text, _message text, _protocol text, _registered_at timestamptz, _xml text)
returns text language sql security invoker set search_path = public, pg_temp as $$
  select app.manifest_finish(_request_id, _cstat, _message, _protocol, _registered_at, _xml); $$;

revoke all on function public.manifest_begin(uuid, uuid[], text, text), public.manifest_panel(uuid, uuid),
  public.awaiting_ciencia(uuid), public.awaiting_conclusive(uuid),
  public.manifest_finish(uuid, text, text, text, timestamptz, text)
from public, anon, authenticated;
grant execute on function public.manifest_begin(uuid, uuid[], text, text), public.manifest_panel(uuid, uuid),
  public.awaiting_ciencia(uuid), public.awaiting_conclusive(uuid)
to authenticated;
grant execute on function public.manifest_finish(uuid, text, text, text, timestamptz, text) to service_role;

notify pgrst, 'reload schema';
