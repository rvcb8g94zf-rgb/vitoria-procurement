-- 0026_purchase_orders.sql
-- Fase 2 · Pedido de compra com aprovação por alçada.
--
-- Decisões (28/09/2026):
--   * o pedido nasce direto (reposição) ou de uma cotação; os dois passam
--     pela mesma aprovação por valor;
--   * a aprovação é do PEDIDO (quando o valor já é conhecido); a solicitação
--     só é aceita ou recusada pelo Compras;
--   * faixas: até R$ 2.000 Compras · até R$ 10.000 Financeiro · acima Diretoria
--     (tabela approval_rules, já semeada na 0012).
--
-- Regras de aprovação:
--   * quem lança um pedido dentro da própria alçada já aprova ao enviar
--     (fica registrado como aprovação automática);
--   * fora disso, aprova quem tem o perfil da faixa, ou Diretoria/Administrador
--     — nunca quem lançou o pedido;
--   * recusar ou pedir alteração exige justificativa; pedir alteração devolve
--     o pedido para rascunho; recusar cancela.
--
-- Tudo por funções security definer: as tabelas continuam com RLS de
-- leitura, e a escrita passa pelas regras daqui.

-- ---------------------------------------------------------------------
-- Colunas que faltavam no pedido
-- ---------------------------------------------------------------------
alter table public.purchase_orders
  add column if not exists created_by    uuid references public.users(id),
  add column if not exists total_amount  numeric(14,2) not null default 0,
  add column if not exists submitted_at  timestamptz,
  add column if not exists approved_at   timestamptz,
  add column if not exists approved_by   uuid references public.users(id),
  add column if not exists sent_at       timestamptz,
  add column if not exists cancelled_at  timestamptz,
  add column if not exists cancelled_by  uuid references public.users(id),
  add column if not exists cancel_reason text;

alter table public.approvals
  add column if not exists amount        numeric(14,2),
  add column if not exists rule_name     text,
  add column if not exists requested_by  uuid references public.users(id);

-- Compras e Financeiro aprovam as próprias faixas: precisam ver e decidir
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  join public.permissions p on p.module = 'approvals' and p.action in ('view','approve')
 where r.company_id is null and r.slug in ('compras','financeiro')
on conflict do nothing;

-- faixas padrão para empresa que ainda não tem nenhuma
insert into public.approval_rules (company_id, name, min_amount, max_amount, role_id, step)
select c.id, v.name, v.mn, v.mx, r.id, 1
  from public.companies c
 cross join (values
   ('Até R$ 2.000 — Compras',            0::numeric, 2000::numeric, 'compras'),
   ('R$ 2.000 a R$ 10.000 — Financeiro', 2000,       10000,         'financeiro'),
   ('Acima de R$ 10.000 — Diretoria',    10000,      null,          'diretoria')
 ) v(name, mn, mx, slug)
  join public.roles r on r.slug = v.slug and r.company_id is null
 where not exists (select 1 from public.approval_rules ar where ar.company_id = c.id);

-- ---------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------
create or replace function app.my_role_slug(_company_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select r.slug from public.user_companies uc join public.roles r on r.id = uc.role_id
   where uc.user_id = auth.uid() and uc.company_id = _company_id and uc.is_active
   limit 1;
$$;

-- faixa que vale para um valor: até 2.000 é Compras; 2.000,01 já é Financeiro
create or replace function app.approval_rule_for(_company_id uuid, _amount numeric)
returns public.approval_rules language sql stable security definer set search_path = public, pg_temp as $$
  select ar.* from public.approval_rules ar
   where ar.company_id = _company_id and ar.is_active
     and (_amount > ar.min_amount or ar.min_amount = 0)
     and (ar.max_amount is null or _amount <= ar.max_amount)
   order by ar.min_amount desc, ar.step
   limit 1;
$$;

create or replace function app.brl(_v numeric)
returns text language sql immutable set search_path = public, pg_temp as $$
  select 'R$ ' || translate(to_char(coalesce(_v, 0), 'FM999G999G990D00'), ',.', '.,');
$$;

-- ---------------------------------------------------------------------
-- Salvar (criar ou editar rascunho)
-- ---------------------------------------------------------------------
-- _h: supplier_id, payment_term_id, cost_center_id, expected_on, carrier,
--     freight_amount, discount, notes, request_id, quotation_id
-- _itens: [{product_id, description, quantity, unit_id, unit_price, discount}]
create or replace function app.save_purchase_order(_company_id uuid, _id uuid, _h jsonb, _itens jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_uid   uuid := auth.uid();
  po      record;
  forn    record;
  v_id    uuid := _id;
  v_num   text;
  it      jsonb;
  v_line  int := 0;
  v_tot   numeric(14,2);
begin
  if v_uid is null then raise exception 'Usuário não autenticado.' using errcode = '28000'; end if;

  if _id is null then
    if not app.has_permission(_company_id, 'purchase_orders', 'create') then
      raise exception 'Sem permissão para criar pedidos nesta empresa.' using errcode = '42501';
    end if;
  else
    if not app.has_permission(_company_id, 'purchase_orders', 'edit') then
      raise exception 'Sem permissão para editar pedidos nesta empresa.' using errcode = '42501';
    end if;
    select * into po from public.purchase_orders
     where id = _id and company_id = _company_id and deleted_at is null for update;
    if po.id is null then raise exception 'Pedido não encontrado.' using errcode = 'P0002'; end if;
    if po.status <> 'rascunho' then
      raise exception 'Só dá para editar pedido em rascunho. Este está "%".', po.status using errcode = '22023';
    end if;
  end if;

  select * into forn from public.suppliers
   where id = nullif(_h->>'supplier_id', '')::uuid and company_id = _company_id and deleted_at is null;
  if forn.id is null then raise exception 'Escolha o fornecedor.' using errcode = '22023'; end if;
  if forn.status = 'pendente' then
    raise exception 'O fornecedor % está aguardando aprovação no cadastro. Aprove-o antes de fazer o pedido.',
      coalesce(forn.trade_name, forn.legal_name) using errcode = '22023';
  end if;
  if forn.status in ('bloqueado', 'inativo') then
    raise exception 'O fornecedor % está %.', coalesce(forn.trade_name, forn.legal_name), forn.status using errcode = '22023';
  end if;

  if _itens is null or jsonb_typeof(_itens) <> 'array' or jsonb_array_length(_itens) = 0 then
    raise exception 'O pedido precisa de pelo menos um item.' using errcode = '22023';
  end if;
  if jsonb_array_length(_itens) > 300 then
    raise exception 'Máximo de 300 itens por pedido.' using errcode = '22023';
  end if;
  for it in select * from jsonb_array_elements(_itens) loop
    if length(btrim(coalesce(it->>'description', ''))) < 2 then
      raise exception 'Todo item precisa de descrição.' using errcode = '22023';
    end if;
    if coalesce(nullif(it->>'quantity', '')::numeric, 0) <= 0 then
      raise exception 'Quantidade inválida no item "%".', it->>'description' using errcode = '22023';
    end if;
    if coalesce(nullif(it->>'unit_price', '')::numeric, -1) < 0 then
      raise exception 'Preço inválido no item "%".', it->>'description' using errcode = '22023';
    end if;
  end loop;

  if v_id is null then
    v_num := app.next_document_number(_company_id, 'purchase_order');
    insert into public.purchase_orders (
      company_id, number, supplier_id, request_id, quotation_id, buyer_id, cost_center_id,
      payment_term_id, expected_on, carrier, freight_amount, discount, notes, status, created_by)
    values (
      _company_id, v_num, forn.id, nullif(_h->>'request_id', '')::uuid, nullif(_h->>'quotation_id', '')::uuid,
      v_uid, nullif(_h->>'cost_center_id', '')::uuid, nullif(_h->>'payment_term_id', '')::uuid,
      nullif(_h->>'expected_on', '')::date, nullif(btrim(coalesce(_h->>'carrier', '')), ''),
      coalesce(nullif(_h->>'freight_amount', '')::numeric, 0), coalesce(nullif(_h->>'discount', '')::numeric, 0),
      nullif(btrim(coalesce(_h->>'notes', '')), ''), 'rascunho', v_uid)
    returning id into v_id;
  else
    update public.purchase_orders set
      supplier_id = forn.id, cost_center_id = nullif(_h->>'cost_center_id', '')::uuid,
      payment_term_id = nullif(_h->>'payment_term_id', '')::uuid, expected_on = nullif(_h->>'expected_on', '')::date,
      carrier = nullif(btrim(coalesce(_h->>'carrier', '')), ''),
      freight_amount = coalesce(nullif(_h->>'freight_amount', '')::numeric, 0),
      discount = coalesce(nullif(_h->>'discount', '')::numeric, 0),
      notes = nullif(btrim(coalesce(_h->>'notes', '')), '')
    where id = v_id;
    v_num := po.number;
  end if;

  delete from public.purchase_order_items where order_id = v_id;
  for it in select * from jsonb_array_elements(_itens) loop
    v_line := v_line + 1;
    insert into public.purchase_order_items (company_id, order_id, line_no, product_id, description,
                                             quantity, unit_id, unit_price, discount)
    values (_company_id, v_id, v_line,
            (select p.id from public.products p where p.id = nullif(it->>'product_id', '')::uuid
                and p.company_id = _company_id and p.deleted_at is null),
            left(btrim(it->>'description'), 200), (it->>'quantity')::numeric,
            nullif(it->>'unit_id', '')::uuid, (it->>'unit_price')::numeric,
            coalesce(nullif(it->>'discount', '')::numeric, 0));
  end loop;

  select round(coalesce(sum(i.total), 0) + po2.freight_amount - po2.discount, 2) into v_tot
    from public.purchase_orders po2 left join public.purchase_order_items i on i.order_id = po2.id
   where po2.id = v_id group by po2.freight_amount, po2.discount;
  if v_tot < 0 then raise exception 'O desconto é maior que o valor do pedido.' using errcode = '22023'; end if;
  update public.purchase_orders set total_amount = v_tot where id = v_id;

  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, v_uid, case when _id is null then 'created' else 'updated' end, 'purchase_order', v_id,
          format('Pedido %s %s — %s, %s', v_num, case when _id is null then 'criado' else 'alterado' end,
                 coalesce(forn.trade_name, forn.legal_name), app.brl(v_tot)),
          '/interno/compras/pedidos/' || v_id);

  return jsonb_build_object('id', v_id, 'number', v_num, 'total', v_tot);
end $fn$;

-- ---------------------------------------------------------------------
-- Enviar para aprovação
-- ---------------------------------------------------------------------
create or replace function app.submit_purchase_order(_company_id uuid, _id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_uid  uuid := auth.uid();
  po     record;
  regra  public.approval_rules;
  v_meu  text;
  v_slug text;
  v_auto boolean;
begin
  if v_uid is null then raise exception 'Usuário não autenticado.' using errcode = '28000'; end if;
  if not app.has_permission(_company_id, 'purchase_orders', 'edit') then
    raise exception 'Sem permissão para enviar pedidos nesta empresa.' using errcode = '42501';
  end if;
  select * into po from public.purchase_orders
   where id = _id and company_id = _company_id and deleted_at is null for update;
  if po.id is null then raise exception 'Pedido não encontrado.' using errcode = 'P0002'; end if;
  if po.status <> 'rascunho' then
    raise exception 'Este pedido já foi enviado (situação "%").', po.status using errcode = '22023';
  end if;
  if not exists (select 1 from public.purchase_order_items where order_id = _id) then
    raise exception 'O pedido não tem itens.' using errcode = '22023';
  end if;

  regra := app.approval_rule_for(_company_id, po.total_amount);
  if regra.id is null then
    raise exception 'Não há faixa de aprovação cadastrada para %.', app.brl(po.total_amount) using errcode = '22023';
  end if;
  select slug into v_slug from public.roles where id = regra.role_id;
  v_meu  := app.my_role_slug(_company_id);
  v_auto := v_meu = v_slug;

  insert into public.approvals (company_id, entity_type, entity_id, step, role_id, decision, comment,
                                decided_by, decided_at, amount, rule_name, requested_by)
  values (_company_id, 'purchase_order', _id, 1, regra.role_id,
          case when v_auto then 'aprovado'::approval_decision else 'pendente'::approval_decision end,
          case when v_auto then 'Aprovado ao enviar: o valor está na alçada de quem lançou.' end,
          case when v_auto then v_uid end, case when v_auto then now() end,
          po.total_amount, regra.name, v_uid);

  update public.purchase_orders set
    status = case when v_auto then 'aprovado'::order_status else 'aguardando_aprovacao'::order_status end,
    submitted_at = now(),
    approved_at = case when v_auto then now() end,
    approved_by = case when v_auto then v_uid end
  where id = _id;

  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, v_uid, 'updated', 'purchase_order', _id,
          case when v_auto then format('Pedido %s aprovado na alçada de quem lançou (%s)', po.number, app.brl(po.total_amount))
               else format('Pedido %s enviado para aprovação — %s (%s)', po.number, regra.name, app.brl(po.total_amount)) end,
          '/interno/compras/pedidos/' || _id);

  return jsonb_build_object('status', case when v_auto then 'aprovado' else 'aguardando_aprovacao' end,
                            'rule', regra.name);
end $fn$;

-- ---------------------------------------------------------------------
-- Quem pode decidir um pedido pendente
-- ---------------------------------------------------------------------
create or replace function app.can_decide_order(_company_id uuid, _order_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
      from public.approvals a
      join public.purchase_orders po on po.id = a.entity_id
      join public.roles r on r.id = a.role_id
     where a.company_id = _company_id and a.entity_type = 'purchase_order' and a.entity_id = _order_id
       and a.decision = 'pendente' and po.status = 'aguardando_aprovacao'
       and app.has_permission(_company_id, 'approvals', 'approve')
       and coalesce(a.requested_by, po.created_by) is distinct from auth.uid()
       and po.created_by is distinct from auth.uid()
       and app.my_role_slug(_company_id) in (r.slug, 'diretoria', 'administrador'));
$$;

create or replace function app.decide_purchase_order(_company_id uuid, _id uuid, _decisao text, _comentario text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_uid uuid := auth.uid();
  po    record;
  ap    record;
begin
  if v_uid is null then raise exception 'Usuário não autenticado.' using errcode = '28000'; end if;
  if _decisao not in ('aprovar', 'recusar', 'alterar') then
    raise exception 'Decisão inválida.' using errcode = '22023';
  end if;
  select * into po from public.purchase_orders
   where id = _id and company_id = _company_id and deleted_at is null for update;
  if po.id is null then raise exception 'Pedido não encontrado.' using errcode = 'P0002'; end if;
  if po.status <> 'aguardando_aprovacao' then
    raise exception 'Este pedido não está aguardando aprovação.' using errcode = '22023';
  end if;
  if not app.can_decide_order(_company_id, _id) then
    if po.created_by = v_uid then
      raise exception 'Quem lançou o pedido não pode aprovar o próprio pedido.' using errcode = '42501';
    end if;
    raise exception 'Este pedido está fora da sua alçada de aprovação.' using errcode = '42501';
  end if;
  if _decisao <> 'aprovar' and length(btrim(coalesce(_comentario, ''))) < 5 then
    raise exception 'Escreva a justificativa (pelo menos 5 letras).' using errcode = '22023';
  end if;

  select * into ap from public.approvals
   where entity_type = 'purchase_order' and entity_id = _id and decision = 'pendente'
   order by created_at desc limit 1 for update;

  update public.approvals set
    decision = case _decisao when 'aprovar' then 'aprovado'::approval_decision
                             when 'recusar' then 'recusado'::approval_decision
                             else 'alteracao_solicitada'::approval_decision end,
    comment = nullif(btrim(coalesce(_comentario, '')), ''), decided_by = v_uid, decided_at = now()
  where id = ap.id;

  update public.purchase_orders set
    status = case _decisao when 'aprovar' then 'aprovado'::order_status
                           when 'recusar' then 'cancelado'::order_status
                           else 'rascunho'::order_status end,
    approved_at   = case when _decisao = 'aprovar' then now() end,
    approved_by   = case when _decisao = 'aprovar' then v_uid end,
    cancelled_at  = case when _decisao = 'recusar' then now() end,
    cancelled_by  = case when _decisao = 'recusar' then v_uid end,
    cancel_reason = case when _decisao = 'recusar' then 'Recusado na aprovação: ' || btrim(_comentario) end
  where id = _id;

  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, v_uid, 'updated', 'purchase_order', _id,
          format('Pedido %s %s%s', po.number,
                 case _decisao when 'aprovar' then 'aprovado' when 'recusar' then 'recusado' else 'devolvido para alteração' end,
                 case when _decisao = 'aprovar' then '' else ': ' || left(btrim(_comentario), 120) end),
          '/interno/compras/pedidos/' || _id);

  return jsonb_build_object('decisao', _decisao);
end $fn$;

-- ---------------------------------------------------------------------
-- Enviado ao fornecedor · cancelar
-- ---------------------------------------------------------------------
create or replace function app.mark_order_sent(_company_id uuid, _id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_uid uuid := auth.uid(); po record;
begin
  if not app.has_permission(_company_id, 'purchase_orders', 'edit') then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  select * into po from public.purchase_orders where id = _id and company_id = _company_id for update;
  if po.id is null then raise exception 'Pedido não encontrado.' using errcode = 'P0002'; end if;
  if po.status <> 'aprovado' then
    raise exception 'Só pedido aprovado pode ser enviado ao fornecedor.' using errcode = '22023';
  end if;
  update public.purchase_orders set status = 'enviado', sent_at = now() where id = _id;
  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, v_uid, 'updated', 'purchase_order', _id,
          format('Pedido %s enviado ao fornecedor', po.number), '/interno/compras/pedidos/' || _id);
end $fn$;

create or replace function app.cancel_purchase_order(_company_id uuid, _id uuid, _motivo text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_uid uuid := auth.uid(); po record;
begin
  if not app.has_permission(_company_id, 'purchase_orders', 'cancel') then
    raise exception 'Sem permissão para cancelar pedidos.' using errcode = '42501';
  end if;
  select * into po from public.purchase_orders where id = _id and company_id = _company_id for update;
  if po.id is null then raise exception 'Pedido não encontrado.' using errcode = 'P0002'; end if;
  if po.status in ('cancelado', 'recebido', 'parcialmente_recebido') then
    raise exception 'Pedido "%" não pode ser cancelado.', po.status using errcode = '22023';
  end if;
  if length(btrim(coalesce(_motivo, ''))) < 5 then
    raise exception 'Escreva o motivo do cancelamento (pelo menos 5 letras).' using errcode = '22023';
  end if;
  update public.approvals set decision = 'recusado', comment = 'Pedido cancelado: ' || btrim(_motivo),
         decided_by = v_uid, decided_at = now()
   where entity_type = 'purchase_order' and entity_id = _id and decision = 'pendente';
  update public.purchase_orders set status = 'cancelado', cancelled_at = now(), cancelled_by = v_uid,
         cancel_reason = btrim(_motivo) where id = _id;
  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, v_uid, 'cancelled', 'purchase_order', _id,
          format('Pedido %s cancelado: %s', po.number, left(btrim(_motivo), 120)), '/interno/compras/pedidos/' || _id);
end $fn$;

-- ---------------------------------------------------------------------
-- Consultas
-- ---------------------------------------------------------------------
create or replace function public.search_purchase_orders(
  _company_id uuid, _status text default null, _supplier uuid default null,
  _search text default null, _from date default null, _to date default null, _limit int default 500)
returns table (
  id uuid, number text, supplier_id uuid, supplier_name text, issued_on date, expected_on date,
  status text, total_amount numeric, items_count int, buyer_name text, pending_rule text,
  can_decide boolean, created_at timestamptz
)
language sql stable security invoker set search_path = public, pg_temp as $fn$
  select po.id, po.number, po.supplier_id, coalesce(s.trade_name, s.legal_name), po.issued_on, po.expected_on,
         po.status::text, po.total_amount,
         (select count(*)::int from public.purchase_order_items i where i.order_id = po.id),
         u.full_name,
         (select a.rule_name from public.approvals a where a.entity_type = 'purchase_order'
             and a.entity_id = po.id and a.decision = 'pendente' order by a.created_at desc limit 1),
         app.can_decide_order(_company_id, po.id),
         po.created_at
    from public.purchase_orders po
    join public.suppliers s on s.id = po.supplier_id
    left join public.users u on u.id = po.buyer_id
   where po.company_id = _company_id and po.deleted_at is null
     and (coalesce(_status, '') = '' or po.status::text = _status
          or (_status = 'abertos' and po.status in ('rascunho','aguardando_aprovacao','aprovado','enviado','confirmado','parcialmente_recebido')))
     and (_supplier is null or po.supplier_id = _supplier)
     and (_from is null or po.issued_on >= _from)
     and (_to is null or po.issued_on <= _to)
     and (coalesce(btrim(_search), '') = '' or po.number ilike '%' || btrim(_search) || '%'
          or coalesce(s.trade_name, s.legal_name) ilike '%' || btrim(_search) || '%'
          or exists (select 1 from public.purchase_order_items i where i.order_id = po.id
                      and i.description ilike '%' || btrim(_search) || '%'))
   order by po.created_at desc
   limit greatest(1, least(coalesce(_limit, 500), 2000));
$fn$;

-- fila do usuário: o que ele pode aprovar agora
create or replace function public.my_pending_approvals(_company_id uuid)
returns table (
  order_id uuid, number text, supplier_name text, total_amount numeric, rule_name text,
  requested_by_name text, submitted_at timestamptz, items_count int, expected_on date
)
language sql stable security invoker set search_path = public, pg_temp as $fn$
  select po.id, po.number, coalesce(s.trade_name, s.legal_name), po.total_amount, a.rule_name,
         u.full_name, po.submitted_at,
         (select count(*)::int from public.purchase_order_items i where i.order_id = po.id), po.expected_on
    from public.purchase_orders po
    join public.approvals a on a.entity_type = 'purchase_order' and a.entity_id = po.id and a.decision = 'pendente'
    join public.suppliers s on s.id = po.supplier_id
    left join public.users u on u.id = coalesce(a.requested_by, po.created_by)
   where po.company_id = _company_id and po.status = 'aguardando_aprovacao'
     and app.can_decide_order(_company_id, po.id)
   order by po.submitted_at;
$fn$;

-- histórico de aprovação de um pedido (com nomes)
create or replace function public.order_approvals(_company_id uuid, _order_id uuid)
returns table (
  created_at timestamptz, rule_name text, role_name text, amount numeric, decision text,
  comment text, decided_by_name text, decided_at timestamptz, requested_by_name text
)
language sql stable security invoker set search_path = public, pg_temp as $fn$
  select a.created_at, a.rule_name, r.name, a.amount, a.decision::text, a.comment,
         ud.full_name, a.decided_at, ur.full_name
    from public.approvals a
    left join public.roles r on r.id = a.role_id
    left join public.users ud on ud.id = a.decided_by
    left join public.users ur on ur.id = a.requested_by
   where a.company_id = _company_id and a.entity_type = 'purchase_order' and a.entity_id = _order_id
   order by a.created_at;
$fn$;

-- ---------------------------------------------------------------------
-- Permissões e wrappers
-- ---------------------------------------------------------------------
revoke all on function app.my_role_slug(uuid) from public, anon;
revoke all on function app.approval_rule_for(uuid, numeric) from public, anon;
revoke all on function app.save_purchase_order(uuid, uuid, jsonb, jsonb) from public, anon;
revoke all on function app.submit_purchase_order(uuid, uuid) from public, anon;
revoke all on function app.can_decide_order(uuid, uuid) from public, anon;
revoke all on function app.decide_purchase_order(uuid, uuid, text, text) from public, anon;
revoke all on function app.mark_order_sent(uuid, uuid) from public, anon;
revoke all on function app.cancel_purchase_order(uuid, uuid, text) from public, anon;
grant execute on function app.my_role_slug(uuid), app.approval_rule_for(uuid, numeric),
  app.save_purchase_order(uuid, uuid, jsonb, jsonb), app.submit_purchase_order(uuid, uuid),
  app.can_decide_order(uuid, uuid), app.decide_purchase_order(uuid, uuid, text, text),
  app.mark_order_sent(uuid, uuid), app.cancel_purchase_order(uuid, uuid, text) to authenticated;

create or replace function public.save_purchase_order(_company_id uuid, _id uuid, _h jsonb, _itens jsonb)
returns jsonb language sql security invoker set search_path = public, pg_temp as $$
  select app.save_purchase_order(_company_id, _id, _h, _itens); $$;
create or replace function public.submit_purchase_order(_company_id uuid, _id uuid)
returns jsonb language sql security invoker set search_path = public, pg_temp as $$
  select app.submit_purchase_order(_company_id, _id); $$;
create or replace function public.decide_purchase_order(_company_id uuid, _id uuid, _decisao text, _comentario text)
returns jsonb language sql security invoker set search_path = public, pg_temp as $$
  select app.decide_purchase_order(_company_id, _id, _decisao, _comentario); $$;
create or replace function public.mark_order_sent(_company_id uuid, _id uuid)
returns void language sql security invoker set search_path = public, pg_temp as $$
  select app.mark_order_sent(_company_id, _id); $$;
create or replace function public.cancel_purchase_order(_company_id uuid, _id uuid, _motivo text)
returns void language sql security invoker set search_path = public, pg_temp as $$
  select app.cancel_purchase_order(_company_id, _id, _motivo); $$;

create or replace function public.can_decide_order(_company_id uuid, _order_id uuid)
returns boolean language sql stable security invoker set search_path = public, pg_temp as $$
  select app.can_decide_order(_company_id, _order_id); $$;

revoke all on function public.can_decide_order(uuid, uuid) from public, anon;
grant execute on function public.can_decide_order(uuid, uuid) to authenticated;

revoke all on function public.save_purchase_order(uuid, uuid, jsonb, jsonb),
  public.submit_purchase_order(uuid, uuid), public.decide_purchase_order(uuid, uuid, text, text),
  public.mark_order_sent(uuid, uuid), public.cancel_purchase_order(uuid, uuid, text),
  public.search_purchase_orders(uuid, text, uuid, text, date, date, int),
  public.my_pending_approvals(uuid), public.order_approvals(uuid, uuid) from public, anon;
grant execute on function public.save_purchase_order(uuid, uuid, jsonb, jsonb),
  public.submit_purchase_order(uuid, uuid), public.decide_purchase_order(uuid, uuid, text, text),
  public.mark_order_sent(uuid, uuid), public.cancel_purchase_order(uuid, uuid, text),
  public.search_purchase_orders(uuid, text, uuid, text, date, date, int),
  public.my_pending_approvals(uuid), public.order_approvals(uuid, uuid) to authenticated;
