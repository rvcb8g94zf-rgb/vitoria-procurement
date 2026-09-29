-- 0024_divergences.sql
-- Divergências: situações em que a nota fiscal e o financeiro não batem.
--
-- Não há tabela de divergências: elas são calculadas na hora a partir das
-- notas, eventos da SEFAZ e títulos. Assim nunca ficam desatualizadas —
-- cancelou o título, a divergência some sozinha. O que se grava é só a
-- revisão humana ("ciente, com motivo"), para tirar da fila o que já foi
-- tratado fora do sistema.
--
-- Tipos:
--   cancelada_com_titulo     nota cancelada/denegada na SEFAZ com título vivo   (crítica)
--   operacao_nao_realizada   evento 210220/210240 registrado para a nota        (crítica com título, atenção sem)
--   valor_duplicatas         soma das parcelas diferente do total da nota       (atenção)
--   fornecedor_bloqueado     título em aberto de fornecedor bloqueado           (atenção)
--   sem_ibscbs               regime normal, emitida desde 03/08/2026, sem IBS/CBS (informação)
--   carta_correcao           nota com carta de correção (110110)                (informação)

create table if not exists public.divergence_reviews (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  kind        text not null,
  invoice_id  uuid not null references public.received_invoices(id),
  note        text not null,
  reviewed_by uuid not null references public.users(id),
  reviewed_at timestamptz not null default now(),
  unique (company_id, kind, invoice_id)
);

alter table public.divergence_reviews enable row level security;
drop policy if exists divergence_reviews_select on public.divergence_reviews;
create policy divergence_reviews_select on public.divergence_reviews
  for select to authenticated using (app.has_permission(company_id, 'divergences', 'view'));
-- escrita só pelas funções abaixo
revoke insert, update, delete on public.divergence_reviews from authenticated, anon;

create or replace function app.list_divergences(_company_id uuid, _incluir_revisadas boolean default false)
returns table (
  kind text, severity text, invoice_id uuid, invoice_number text, emitter_name text,
  supplier_id uuid, issued_at timestamptz, total_amount numeric, detail text,
  open_amount numeric, paid_amount numeric, event_at timestamptz,
  reviewed boolean, review_note text, reviewed_by_name text, reviewed_at timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
begin
  if not app.has_permission(_company_id, 'divergences', 'view') then
    raise exception 'Sem permissão para ver divergências nesta empresa.' using errcode = '42501';
  end if;

  return query
  with titulos as (
    select p.invoice_id,
           count(*) filter (where p.cancelled_at is null)                              as vivos,
           coalesce(sum(p.amount - p.paid_amount) filter (where p.cancelled_at is null), 0) as aberto,
           coalesce(sum(p.paid_amount) filter (where p.cancelled_at is null), 0)        as pago,
           count(*) filter (where p.cancelled_at is null and p.status in ('aberto','parcial')) as em_aberto
      from public.payables p
     where p.company_id = _company_id and p.invoice_id is not null
     group by p.invoice_id
  ),
  eventos as (
    select fe.access_key, fe.event_type, max(fe.occurred_at) as quando,
           (array_agg(fe.description order by fe.occurred_at desc))[1] as descricao
      from public.fiscal_events fe
     where fe.company_id = _company_id and fe.event_type in ('210220','210240','110110')
     group by fe.access_key, fe.event_type
  ),
  base as (
    -- 1. nota cancelada ou denegada com título que ainda vale
    select 'cancelada_com_titulo'::text as kind, 'critica'::text as severity, ri.id,
           case when t.pago > 0
             then format('Nota %s na SEFAZ, mas há %s título(s) valendo e R$ %s já pago. Estorne o pagamento ou peça a devolução ao fornecedor e cancele os títulos.',
                         ri.fiscal_status, t.vivos, translate(to_char(t.pago, 'FM999G999G990D00'), ',.', '.,'))
             else format('Nota %s na SEFAZ, mas há %s título(s) a pagar. Cancele os títulos no contas a pagar.',
                         ri.fiscal_status, t.vivos) end as detail,
           t.aberto, t.pago, ri.cancelled_at as quando
      from public.received_invoices ri
      join titulos t on t.invoice_id = ri.id and t.vivos > 0
     where ri.company_id = _company_id and ri.fiscal_status in ('cancelada','denegada')

    union all
    -- 2. contabilidade registrou desconhecimento / operação não realizada
    select 'operacao_nao_realizada', case when coalesce(t.vivos, 0) > 0 then 'critica' else 'atencao' end, ri.id,
           format('%s registrada na SEFAZ%s.',
                  case e.event_type when '210220' then 'Desconhecimento da operação' else 'Operação não realizada' end,
                  case when coalesce(t.vivos, 0) > 0
                       then format(' e há %s título(s) valendo — confira antes de pagar', t.vivos)
                       else ' — a nota não deve virar pagamento' end),
           coalesce(t.aberto, 0), coalesce(t.pago, 0), e.quando
      from public.received_invoices ri
      join eventos e on e.access_key = ri.access_key and e.event_type in ('210220','210240')
      left join titulos t on t.invoice_id = ri.id
     where ri.company_id = _company_id and ri.fiscal_status = 'autorizada'

    union all
    -- 3. parcelas não fecham com o total da nota
    select 'valor_duplicatas', 'atencao', ri.id,
           format('As parcelas somam R$ %s e a nota é de R$ %s.',
                  translate(to_char(d.soma, 'FM999G999G990D00'), ',.', '.,'),
                  translate(to_char(ri.total_amount, 'FM999G999G990D00'), ',.', '.,')),
           coalesce(t.aberto, 0), coalesce(t.pago, 0), null::timestamptz
      from public.received_invoices ri
      join lateral (select sum(x.amount) as soma, count(*) as n
                      from public.received_invoice_duplicates x where x.invoice_id = ri.id) d on d.n > 0
      left join titulos t on t.invoice_id = ri.id
     where ri.company_id = _company_id and ri.doc_kind = 'completo' and ri.fiscal_status = 'autorizada'
       and abs(d.soma - ri.total_amount) > 0.05

    union all
    -- 4. título em aberto de fornecedor rejeitado no cadastro
    select 'fornecedor_bloqueado', 'atencao', ri.id,
           format('O fornecedor %s está bloqueado e há %s título(s) em aberto desta nota.',
                  coalesce(s.trade_name, s.legal_name), t.em_aberto),
           t.aberto, t.pago, null::timestamptz
      from public.received_invoices ri
      join public.suppliers s on s.id = ri.supplier_id and s.status = 'bloqueado'
      join titulos t on t.invoice_id = ri.id and t.em_aberto > 0
     where ri.company_id = _company_id and ri.fiscal_status = 'autorizada'

    union all
    -- 5. reforma tributária: faltou IBS/CBS
    select 'sem_ibscbs', 'info', ri.id,
           'Emitente do regime normal, nota de depois de 03/08/2026 sem IBS/CBS. Vale avisar o fornecedor.',
           0::numeric, 0::numeric, null::timestamptz
      from public.received_invoices ri
     where ri.company_id = _company_id and ri.doc_kind = 'completo' and ri.fiscal_status = 'autorizada'
       and ri.emitter_crt = '3' and ri.issued_at >= '2026-08-03'::timestamptz
       and ri.ibs_total is null and ri.cbs_total is null

    union all
    -- 6. carta de correção
    select 'carta_correcao', 'info', ri.id,
           coalesce('Carta de correção: ' || nullif(btrim(e.descricao), ''), 'A nota recebeu carta de correção. Leia antes de conferir a mercadoria.'),
           0::numeric, 0::numeric, e.quando
      from public.received_invoices ri
      join eventos e on e.access_key = ri.access_key and e.event_type = '110110'
     where ri.company_id = _company_id
  )
  select b.kind, b.severity, ri.id, ri.number, coalesce(s.trade_name, s.legal_name, ri.emitter_name),
         ri.supplier_id, ri.issued_at, ri.total_amount, b.detail, b.aberto, b.pago, b.quando,
         (r.id is not null), r.note, u.full_name, r.reviewed_at
    from base b
    join public.received_invoices ri on ri.id = b.id
    left join public.suppliers s on s.id = ri.supplier_id
    left join public.divergence_reviews r on r.company_id = _company_id and r.kind = b.kind and r.invoice_id = b.id
    left join public.users u on u.id = r.reviewed_by
   where _incluir_revisadas or r.id is null
   order by case b.severity when 'critica' then 0 when 'atencao' then 1 else 2 end,
            ri.issued_at desc nulls last;
end $fn$;

create or replace function app.review_divergence(_company_id uuid, _kind text, _invoice_id uuid, _note text, _reabrir boolean default false)
returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_uid uuid := auth.uid();
  v_num text;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  if not app.has_permission(_company_id, 'divergences', 'edit') then
    raise exception 'Sem permissão para tratar divergências nesta empresa.' using errcode = '42501';
  end if;
  select number into v_num from public.received_invoices where id = _invoice_id and company_id = _company_id;
  if not found then
    raise exception 'Nota não encontrada.' using errcode = 'P0002';
  end if;

  if _reabrir then
    delete from public.divergence_reviews
     where company_id = _company_id and kind = _kind and invoice_id = _invoice_id;
    return;
  end if;

  if _kind not in ('cancelada_com_titulo','operacao_nao_realizada','valor_duplicatas',
                   'fornecedor_bloqueado','sem_ibscbs','carta_correcao') then
    raise exception 'Tipo de divergência desconhecido.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(_note, ''))) < 5 then
    raise exception 'Escreva o que foi feito (pelo menos 5 letras).' using errcode = '22023';
  end if;

  insert into public.divergence_reviews (company_id, kind, invoice_id, note, reviewed_by)
  values (_company_id, _kind, _invoice_id, left(btrim(_note), 500), v_uid)
  on conflict (company_id, kind, invoice_id)
  do update set note = excluded.note, reviewed_by = excluded.reviewed_by, reviewed_at = now();

  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, v_uid, 'updated', 'received_invoice', _invoice_id,
          format('Divergência da NF-e %s marcada como tratada: %s', coalesce(v_num, 's/nº'), left(btrim(_note), 120)),
          '/interno/notas/divergencias');
end $fn$;

revoke all on function app.list_divergences(uuid, boolean) from public, anon;
revoke all on function app.review_divergence(uuid, text, uuid, text, boolean) from public, anon;
grant execute on function app.list_divergences(uuid, boolean) to authenticated;
grant execute on function app.review_divergence(uuid, text, uuid, text, boolean) to authenticated;

create or replace function public.list_divergences(_company_id uuid, _incluir_revisadas boolean default false)
returns table (
  kind text, severity text, invoice_id uuid, invoice_number text, emitter_name text,
  supplier_id uuid, issued_at timestamptz, total_amount numeric, detail text,
  open_amount numeric, paid_amount numeric, event_at timestamptz,
  reviewed boolean, review_note text, reviewed_by_name text, reviewed_at timestamptz
)
language sql stable security invoker set search_path = public, pg_temp as $$
  select * from app.list_divergences(_company_id, _incluir_revisadas);
$$;

create or replace function public.review_divergence(_company_id uuid, _kind text, _invoice_id uuid, _note text, _reabrir boolean default false)
returns void
language sql security invoker set search_path = public, pg_temp as $$
  select app.review_divergence(_company_id, _kind, _invoice_id, _note, _reabrir);
$$;

revoke all on function public.list_divergences(uuid, boolean) from public, anon;
revoke all on function public.review_divergence(uuid, text, uuid, text, boolean) from public, anon;
grant execute on function public.list_divergences(uuid, boolean) to authenticated;
grant execute on function public.review_divergence(uuid, text, uuid, text, boolean) to authenticated;
