-- 0027_purchase_requests.sql
-- Fase 2 · Solicitação de compra.
--
-- Quem precisa de algo (qualquer perfil com purchase_requests.create) lança
-- a solicitação e envia. O Compras (quem pode criar pedido) atende:
--   aceitar → vira cotação ou pedido direto
--   recusar → com justificativa
-- Não há alçada aqui: a aprovação por valor é no pedido.
--
-- Situações: rascunho → enviada → aprovada (aceita pelo Compras)
--            → em_cotacao → concluida (virou pedido) | recusada | cancelada

alter table public.purchase_requests
  add column if not exists decision_note text,
  add column if not exists decided_by    uuid references public.users(id),
  add column if not exists decided_at    timestamptz,
  add column if not exists cancel_reason text;

create or replace function app.save_purchase_request(_company_id uuid, _id uuid, _h jsonb, _itens jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_uid  uuid := auth.uid();
  r      record;
  v_id   uuid := _id;
  v_num  text;
  it     jsonb;
  v_line int := 0;
begin
  if v_uid is null then raise exception 'Usuário não autenticado.' using errcode = '28000'; end if;
  if not app.has_permission(_company_id, 'purchase_requests', 'create') then
    raise exception 'Sem permissão para criar solicitações nesta empresa.' using errcode = '42501';
  end if;
  if _id is not null then
    select * into r from public.purchase_requests
     where id = _id and company_id = _company_id and deleted_at is null for update;
    if r.id is null then raise exception 'Solicitação não encontrada.' using errcode = 'P0002'; end if;
    if r.status <> 'rascunho' then
      raise exception 'Só dá para editar solicitação em rascunho.' using errcode = '22023';
    end if;
    if r.requester_id <> v_uid and not app.has_permission(_company_id, 'purchase_orders', 'create') then
      raise exception 'Só quem pediu pode editar esta solicitação.' using errcode = '42501';
    end if;
  end if;

  if _itens is null or jsonb_typeof(_itens) <> 'array' or jsonb_array_length(_itens) = 0 then
    raise exception 'A solicitação precisa de pelo menos um item.' using errcode = '22023';
  end if;
  if jsonb_array_length(_itens) > 200 then
    raise exception 'Máximo de 200 itens por solicitação.' using errcode = '22023';
  end if;
  for it in select * from jsonb_array_elements(_itens) loop
    if length(btrim(coalesce(it->>'description', ''))) < 2 then
      raise exception 'Todo item precisa de descrição.' using errcode = '22023';
    end if;
    if coalesce(nullif(it->>'quantity', '')::numeric, 0) <= 0 then
      raise exception 'Quantidade inválida no item "%".', it->>'description' using errcode = '22023';
    end if;
  end loop;
  if coalesce(_h->>'priority', 'normal') not in ('baixa','normal','alta','urgente') then
    raise exception 'Prioridade inválida.' using errcode = '22023';
  end if;

  if v_id is null then
    v_num := app.next_document_number(_company_id, 'purchase_request');
    insert into public.purchase_requests (company_id, number, requester_id, department_id, cost_center_id,
                                          needed_by, priority, justification, notes, status)
    values (_company_id, v_num, v_uid, nullif(_h->>'department_id', '')::uuid, nullif(_h->>'cost_center_id', '')::uuid,
            nullif(_h->>'needed_by', '')::date, coalesce(_h->>'priority', 'normal')::priority_level,
            nullif(btrim(coalesce(_h->>'justification', '')), ''), nullif(btrim(coalesce(_h->>'notes', '')), ''), 'rascunho')
    returning id into v_id;
  else
    update public.purchase_requests set
      department_id = nullif(_h->>'department_id', '')::uuid, cost_center_id = nullif(_h->>'cost_center_id', '')::uuid,
      needed_by = nullif(_h->>'needed_by', '')::date, priority = coalesce(_h->>'priority', 'normal')::priority_level,
      justification = nullif(btrim(coalesce(_h->>'justification', '')), ''), notes = nullif(btrim(coalesce(_h->>'notes', '')), '')
    where id = v_id;
    v_num := r.number;
  end if;

  delete from public.purchase_request_items where request_id = v_id;
  for it in select * from jsonb_array_elements(_itens) loop
    v_line := v_line + 1;
    insert into public.purchase_request_items (company_id, request_id, line_no, product_id, description, spec, quantity, unit_id)
    values (_company_id, v_id, v_line,
            (select p.id from public.products p where p.id = nullif(it->>'product_id', '')::uuid
                and p.company_id = _company_id and p.deleted_at is null),
            left(btrim(it->>'description'), 200), nullif(left(btrim(coalesce(it->>'spec', '')), 500), ''),
            (it->>'quantity')::numeric, nullif(it->>'unit_id', '')::uuid);
  end loop;

  return jsonb_build_object('id', v_id, 'number', v_num);
end $fn$;

-- enviar · cancelar (quem pediu) · aceitar/recusar (Compras)
create or replace function app.act_purchase_request(_company_id uuid, _id uuid, _acao text, _nota text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_uid uuid := auth.uid();
  r     record;
  v_comprador boolean := app.has_permission(_company_id, 'purchase_orders', 'create');
  v_novo text;
  v_txt  text;
begin
  if v_uid is null then raise exception 'Usuário não autenticado.' using errcode = '28000'; end if;
  select * into r from public.purchase_requests
   where id = _id and company_id = _company_id and deleted_at is null for update;
  if r.id is null then raise exception 'Solicitação não encontrada.' using errcode = 'P0002'; end if;

  if _acao = 'enviar' then
    if r.status <> 'rascunho' then raise exception 'Esta solicitação já foi enviada.' using errcode = '22023'; end if;
    if r.requester_id <> v_uid and not v_comprador then
      raise exception 'Só quem pediu pode enviar.' using errcode = '42501';
    end if;
    if not exists (select 1 from public.purchase_request_items where request_id = _id) then
      raise exception 'A solicitação não tem itens.' using errcode = '22023';
    end if;
    v_novo := 'enviada'; v_txt := 'enviada ao Compras';
  elsif _acao = 'cancelar' then
    if r.status not in ('rascunho','enviada','aprovada') then
      raise exception 'Esta solicitação não pode mais ser cancelada.' using errcode = '22023';
    end if;
    if r.requester_id <> v_uid and not app.has_permission(_company_id, 'purchase_requests', 'cancel') then
      raise exception 'Só quem pediu ou o Compras pode cancelar.' using errcode = '42501';
    end if;
    if length(btrim(coalesce(_nota, ''))) < 5 then
      raise exception 'Escreva o motivo (pelo menos 5 letras).' using errcode = '22023';
    end if;
    v_novo := 'cancelada'; v_txt := 'cancelada';
  elsif _acao in ('aceitar', 'recusar') then
    if not v_comprador then
      raise exception 'Só o Compras atende solicitações.' using errcode = '42501';
    end if;
    if r.status <> 'enviada' then
      raise exception 'Só solicitação enviada pode ser atendida.' using errcode = '22023';
    end if;
    if _acao = 'recusar' and length(btrim(coalesce(_nota, ''))) < 5 then
      raise exception 'Escreva a justificativa (pelo menos 5 letras).' using errcode = '22023';
    end if;
    v_novo := case _acao when 'aceitar' then 'aprovada' else 'recusada' end;
    v_txt  := case _acao when 'aceitar' then 'aceita pelo Compras' else 'recusada' end;
  else
    raise exception 'Ação inválida.' using errcode = '22023';
  end if;

  update public.purchase_requests set
    status = v_novo::request_status,
    submitted_at  = case when _acao = 'enviar' then now() else submitted_at end,
    decision_note = case when _acao in ('aceitar','recusar') then nullif(btrim(coalesce(_nota, '')), '') else decision_note end,
    decided_by    = case when _acao in ('aceitar','recusar') then v_uid else decided_by end,
    decided_at    = case when _acao in ('aceitar','recusar') then now() else decided_at end,
    cancel_reason = case when _acao = 'cancelar' then btrim(_nota) else cancel_reason end
  where id = _id;

  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, v_uid, case when _acao = 'cancelar' then 'cancelled' else 'updated' end, 'purchase_request', _id,
          format('Solicitação %s %s%s', r.number, v_txt, case when _acao in ('recusar','cancelar') then ': ' || left(btrim(_nota), 120) else '' end),
          '/interno/compras/solicitacoes/' || _id);
  return jsonb_build_object('status', v_novo);
end $fn$;

-- pedido feito a partir da solicitação: ela está atendida
create or replace function app.request_done_on_order()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.request_id is not null and new.status <> 'cancelado' then
    update public.purchase_requests set status = 'concluida'
     where id = new.request_id and status in ('enviada','aprovada','em_cotacao');
  end if;
  return new;
end $$;
drop trigger if exists trg_request_done on public.purchase_orders;
create trigger trg_request_done after insert or update of request_id, status on public.purchase_orders
  for each row execute function app.request_done_on_order();

create or replace function public.search_purchase_requests(
  _company_id uuid, _status text default null, _mine boolean default false, _search text default null, _limit int default 500)
returns table (
  id uuid, number text, requester_id uuid, requester_name text, department_name text, requested_on date,
  needed_by date, priority text, status text, items_count int, first_item text, created_at timestamptz
)
language sql stable security invoker set search_path = public, pg_temp as $fn$
  select r.id, r.number, r.requester_id, u.full_name, d.name, r.requested_on, r.needed_by, r.priority::text,
         r.status::text,
         (select count(*)::int from public.purchase_request_items i where i.request_id = r.id),
         (select i.description from public.purchase_request_items i where i.request_id = r.id order by i.line_no limit 1),
         r.created_at
    from public.purchase_requests r
    left join public.users u on u.id = r.requester_id
    left join public.departments d on d.id = r.department_id
   where r.company_id = _company_id and r.deleted_at is null
     and (not coalesce(_mine, false) or r.requester_id = auth.uid())
     and (coalesce(_status, '') = '' or r.status::text = _status
          or (_status = 'abertas' and r.status in ('rascunho','enviada','aprovada','em_cotacao')))
     and (coalesce(btrim(_search), '') = '' or r.number ilike '%' || btrim(_search) || '%'
          or exists (select 1 from public.purchase_request_items i where i.request_id = r.id
                      and i.description ilike '%' || btrim(_search) || '%'))
   order by case r.priority when 'urgente' then 0 when 'alta' then 1 else 2 end, r.created_at desc
   limit greatest(1, least(coalesce(_limit, 500), 2000));
$fn$;

revoke all on function app.save_purchase_request(uuid, uuid, jsonb, jsonb), app.act_purchase_request(uuid, uuid, text, text) from public, anon;
grant execute on function app.save_purchase_request(uuid, uuid, jsonb, jsonb), app.act_purchase_request(uuid, uuid, text, text) to authenticated;

create or replace function public.save_purchase_request(_company_id uuid, _id uuid, _h jsonb, _itens jsonb)
returns jsonb language sql security invoker set search_path = public, pg_temp as $$
  select app.save_purchase_request(_company_id, _id, _h, _itens); $$;
create or replace function public.act_purchase_request(_company_id uuid, _id uuid, _acao text, _nota text default null)
returns jsonb language sql security invoker set search_path = public, pg_temp as $$
  select app.act_purchase_request(_company_id, _id, _acao, _nota); $$;

revoke all on function public.save_purchase_request(uuid, uuid, jsonb, jsonb), public.act_purchase_request(uuid, uuid, text, text),
  public.search_purchase_requests(uuid, text, boolean, text, int) from public, anon;
grant execute on function public.save_purchase_request(uuid, uuid, jsonb, jsonb), public.act_purchase_request(uuid, uuid, text, text),
  public.search_purchase_requests(uuid, text, boolean, text, int) to authenticated;

-- quem pediu acompanha o que virou a solicitação, mesmo sem acesso a cotações e pedidos
create or replace function app.request_followup(_company_id uuid, _request_id uuid)
returns table (kind text, id uuid, number text, status text, total numeric, supplier_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  with ok as (
    select 1 from public.purchase_requests r
     where r.id = _request_id and r.company_id = _company_id
       and (r.requester_id = auth.uid() or app.has_permission(_company_id, 'purchase_requests', 'view'))
  )
  select 'cotacao', q.id, q.number, q.status::text, null::numeric, null::text
    from public.quotations q where q.request_id = _request_id and q.company_id = _company_id and exists (select 1 from ok)
  union all
  select 'pedido', po.id, po.number, po.status::text, po.total_amount, coalesce(s.trade_name, s.legal_name)
    from public.purchase_orders po join public.suppliers s on s.id = po.supplier_id
   where po.request_id = _request_id and po.company_id = _company_id and exists (select 1 from ok);
$$;
revoke all on function app.request_followup(uuid, uuid) from public, anon;
grant execute on function app.request_followup(uuid, uuid) to authenticated;
create or replace function public.request_followup(_company_id uuid, _request_id uuid)
returns table (kind text, id uuid, number text, status text, total numeric, supplier_name text)
language sql stable security invoker set search_path = public, pg_temp as $$
  select * from app.request_followup(_company_id, _request_id); $$;
revoke all on function public.request_followup(uuid, uuid) from public, anon;
grant execute on function public.request_followup(uuid, uuid) to authenticated;
