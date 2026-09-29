-- 0028_quotations.sql
-- Fase 2 · Cotação com mapa comparativo.
--
-- O comprador abre a cotação (de uma solicitação ou do zero), escolhe os
-- fornecedores e manda o pedido de cotação por WhatsApp/e-mail (texto pronto
-- na tela). As respostas são digitadas por ele: preço por item, frete, prazo,
-- condição e validade. O mapa aponta o menor preço de cada item; o comprador
-- escolhe o vencedor item a item (ou tudo de um fornecedor) e o sistema gera
-- um pedido em rascunho por fornecedor vencedor — que segue para a aprovação
-- normal do pedido.

alter table public.quotations
  add column if not exists closed_at     timestamptz,
  add column if not exists closed_by     uuid references public.users(id),
  add column if not exists cancel_reason text;

-- itens-base da cotação (o que se está cotando), um por linha
create table if not exists public.quotation_lines (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  line_no      smallint not null,
  product_id   uuid references public.products(id) on delete set null,
  description  text not null,
  quantity     numeric(14,4) not null check (quantity > 0),
  unit_id      uuid references public.units(id) on delete set null,
  unique (quotation_id, line_no)
);
alter table public.quotation_lines enable row level security;
drop policy if exists quotation_lines_select on public.quotation_lines;
create policy quotation_lines_select on public.quotation_lines for select to authenticated
  using (app.has_permission(company_id, 'quotations', 'view'));

create or replace function app.create_quotation(
  _company_id uuid, _request_id uuid, _closes_on date, _notes text, _suppliers uuid[], _itens jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_uid  uuid := auth.uid();
  v_id   uuid;
  v_num  text;
  it     jsonb;
  v_line int := 0;
  v_forn uuid;
  v_n    int;
begin
  if v_uid is null then raise exception 'Usuário não autenticado.' using errcode = '28000'; end if;
  if not app.has_permission(_company_id, 'quotations', 'create') then
    raise exception 'Sem permissão para abrir cotações nesta empresa.' using errcode = '42501';
  end if;
  select count(*) into v_n from public.suppliers s
   where s.id = any(_suppliers) and s.company_id = _company_id and s.deleted_at is null and s.status = 'ativo';
  if coalesce(array_length(_suppliers, 1), 0) = 0 or v_n = 0 then
    raise exception 'Escolha pelo menos um fornecedor ativo.' using errcode = '22023';
  end if;
  if v_n <> array_length(_suppliers, 1) then
    raise exception 'Algum fornecedor escolhido não está ativo no cadastro.' using errcode = '22023';
  end if;
  if v_n > 10 then raise exception 'Máximo de 10 fornecedores por cotação.' using errcode = '22023'; end if;
  if _itens is null or jsonb_array_length(_itens) = 0 then
    raise exception 'A cotação precisa de pelo menos um item.' using errcode = '22023';
  end if;
  if jsonb_array_length(_itens) > 200 then raise exception 'Máximo de 200 itens.' using errcode = '22023'; end if;
  for it in select * from jsonb_array_elements(_itens) loop
    if length(btrim(coalesce(it->>'description', ''))) < 2 then
      raise exception 'Todo item precisa de descrição.' using errcode = '22023';
    end if;
    if coalesce(nullif(it->>'quantity', '')::numeric, 0) <= 0 then
      raise exception 'Quantidade inválida no item "%".', it->>'description' using errcode = '22023';
    end if;
  end loop;
  if _request_id is not null and not exists (
      select 1 from public.purchase_requests where id = _request_id and company_id = _company_id
         and status in ('enviada','aprovada','em_cotacao')) then
    raise exception 'A solicitação não está disponível para cotação.' using errcode = '22023';
  end if;

  v_num := app.next_document_number(_company_id, 'quotation');
  insert into public.quotations (company_id, number, request_id, opened_by, closes_on, notes, status)
  values (_company_id, v_num, _request_id, v_uid, _closes_on, nullif(btrim(coalesce(_notes, '')), ''), 'aberta')
  returning id into v_id;

  for it in select * from jsonb_array_elements(_itens) loop
    v_line := v_line + 1;
    insert into public.quotation_lines (company_id, quotation_id, line_no, product_id, description, quantity, unit_id)
    values (_company_id, v_id, v_line,
            (select p.id from public.products p where p.id = nullif(it->>'product_id', '')::uuid and p.company_id = _company_id),
            left(btrim(it->>'description'), 200), (it->>'quantity')::numeric, nullif(it->>'unit_id', '')::uuid);
  end loop;

  foreach v_forn in array _suppliers loop
    insert into public.quotation_suppliers (company_id, quotation_id, supplier_id,
                                            payment_term_id)
    select _company_id, v_id, s.id, s.payment_term_id from public.suppliers s where s.id = v_forn;
    insert into public.quotation_items (company_id, quotation_id, supplier_id, line_no, product_id, description, quantity, unit_id)
    select _company_id, v_id, v_forn, l.line_no, l.product_id, l.description, l.quantity, l.unit_id
      from public.quotation_lines l where l.quotation_id = v_id;
  end loop;

  if _request_id is not null then
    update public.purchase_requests set status = 'em_cotacao' where id = _request_id;
  end if;

  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, v_uid, 'created', 'quotation', v_id,
          format('Cotação %s aberta com %s fornecedor(es) e %s item(ns)', v_num, v_n, v_line),
          '/interno/compras/cotacoes/' || v_id);
  return jsonb_build_object('id', v_id, 'number', v_num);
end $fn$;

-- _respostas: [{supplier_id, freight_amount, lead_days, payment_term_id, valid_until, notes,
--               prices: [{line_no, unit_price}]}]  (preço vazio = não cotou o item)
create or replace function app.save_quotation_answers(_company_id uuid, _id uuid, _respostas jsonb)
returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_uid uuid := auth.uid();
  q     record;
  r     jsonb;
  pr    jsonb;
  v_tem boolean;
begin
  if not app.has_permission(_company_id, 'quotations', 'edit') then
    raise exception 'Sem permissão para editar cotações.' using errcode = '42501';
  end if;
  select * into q from public.quotations where id = _id and company_id = _company_id for update;
  if q.id is null then raise exception 'Cotação não encontrada.' using errcode = 'P0002'; end if;
  if q.status not in ('aberta','respondida') then
    raise exception 'Cotação encerrada não pode ser alterada.' using errcode = '22023';
  end if;

  for r in select * from jsonb_array_elements(coalesce(_respostas, '[]'::jsonb)) loop
    v_tem := false;
    for pr in select * from jsonb_array_elements(coalesce(r->'prices', '[]'::jsonb)) loop
      if nullif(pr->>'unit_price', '') is not null and (pr->>'unit_price')::numeric < 0 then
        raise exception 'Preço negativo não vale.' using errcode = '22023';
      end if;
      update public.quotation_items set unit_price = nullif(pr->>'unit_price', '')::numeric
       where quotation_id = _id and supplier_id = (r->>'supplier_id')::uuid and line_no = (pr->>'line_no')::smallint;
      v_tem := v_tem or nullif(pr->>'unit_price', '') is not null;
    end loop;
    update public.quotation_suppliers set
      freight_amount  = coalesce(nullif(r->>'freight_amount', '')::numeric, 0),
      lead_days       = nullif(r->>'lead_days', '')::smallint,
      payment_term_id = nullif(r->>'payment_term_id', '')::uuid,
      valid_until     = nullif(r->>'valid_until', '')::date,
      notes           = nullif(btrim(coalesce(r->>'notes', '')), ''),
      responded_at    = case when v_tem then coalesce(responded_at, now()) else null end
    where quotation_id = _id and supplier_id = (r->>'supplier_id')::uuid;
  end loop;

  update public.quotations set status = case
      when not exists (select 1 from public.quotation_suppliers s where s.quotation_id = _id and s.responded_at is null)
      then 'respondida'::quotation_status else 'aberta'::quotation_status end
   where id = _id;
end $fn$;

-- _escolha: [{line_no, supplier_id}] — gera um pedido em rascunho por fornecedor
create or replace function app.close_quotation(_company_id uuid, _id uuid, _escolha jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_uid   uuid := auth.uid();
  q       record;
  e       jsonb;
  v_forn  uuid;
  qs      record;
  v_po    uuid;
  v_num   text;
  v_tot   numeric(14,2);
  v_ped   jsonb := '[]'::jsonb;
  v_line  int;
begin
  if v_uid is null then raise exception 'Usuário não autenticado.' using errcode = '28000'; end if;
  if not app.has_permission(_company_id, 'quotations', 'edit')
     or not app.has_permission(_company_id, 'purchase_orders', 'create') then
    raise exception 'Sem permissão para encerrar cotações e gerar pedidos.' using errcode = '42501';
  end if;
  select * into q from public.quotations where id = _id and company_id = _company_id for update;
  if q.id is null then raise exception 'Cotação não encontrada.' using errcode = 'P0002'; end if;
  if q.status not in ('aberta','respondida') then
    raise exception 'Esta cotação já foi encerrada.' using errcode = '22023';
  end if;
  if _escolha is null or jsonb_array_length(_escolha) = 0 then
    raise exception 'Escolha o fornecedor de pelo menos um item.' using errcode = '22023';
  end if;

  update public.quotation_items set is_selected = false where quotation_id = _id;
  for e in select * from jsonb_array_elements(_escolha) loop
    update public.quotation_items set is_selected = true
     where quotation_id = _id and line_no = (e->>'line_no')::smallint and supplier_id = (e->>'supplier_id')::uuid
       and unit_price is not null;
    if not found then
      raise exception 'O item % não tem preço do fornecedor escolhido.', e->>'line_no' using errcode = '22023';
    end if;
  end loop;

  for v_forn in select distinct supplier_id from public.quotation_items where quotation_id = _id and is_selected loop
    select * into qs from public.quotation_suppliers where quotation_id = _id and supplier_id = v_forn;
    v_num := app.next_document_number(_company_id, 'purchase_order');
    insert into public.purchase_orders (company_id, number, supplier_id, request_id, quotation_id, buyer_id,
                                        cost_center_id, payment_term_id, expected_on, freight_amount, status, created_by, notes)
    values (_company_id, v_num, v_forn, q.request_id, _id, v_uid,
            (select cost_center_id from public.purchase_requests where id = q.request_id),
            qs.payment_term_id, case when qs.lead_days is not null then current_date + qs.lead_days end,
            coalesce(qs.freight_amount, 0), 'rascunho', v_uid, format('Conforme cotação %s.', q.number))
    returning id into v_po;
    v_line := 0;
    insert into public.purchase_order_items (company_id, order_id, line_no, product_id, description, quantity, unit_id, unit_price, discount)
    select _company_id, v_po, row_number() over (order by i.line_no), i.product_id, i.description, i.quantity, i.unit_id, i.unit_price, i.discount
      from public.quotation_items i where i.quotation_id = _id and i.supplier_id = v_forn and i.is_selected;
    select round(coalesce(sum(total), 0) + coalesce(qs.freight_amount, 0), 2) into v_tot
      from public.purchase_order_items where order_id = v_po;
    update public.purchase_orders set total_amount = v_tot where id = v_po;
    v_ped := v_ped || jsonb_build_object('id', v_po, 'number', v_num, 'total', v_tot);
  end loop;

  update public.quotations set status = 'encerrada', closed_at = now(), closed_by = v_uid where id = _id;

  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, v_uid, 'updated', 'quotation', _id,
          format('Cotação %s encerrada: %s pedido(s) em rascunho', q.number, jsonb_array_length(v_ped)),
          '/interno/compras/cotacoes/' || _id);
  return jsonb_build_object('pedidos', v_ped);
end $fn$;

create or replace function app.cancel_quotation(_company_id uuid, _id uuid, _motivo text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_uid uuid := auth.uid(); q record;
begin
  if not app.has_permission(_company_id, 'quotations', 'cancel') then
    raise exception 'Sem permissão para cancelar cotações.' using errcode = '42501';
  end if;
  select * into q from public.quotations where id = _id and company_id = _company_id for update;
  if q.id is null then raise exception 'Cotação não encontrada.' using errcode = 'P0002'; end if;
  if q.status not in ('aberta','respondida') then raise exception 'Esta cotação já foi encerrada.' using errcode = '22023'; end if;
  if length(btrim(coalesce(_motivo, ''))) < 5 then
    raise exception 'Escreva o motivo (pelo menos 5 letras).' using errcode = '22023';
  end if;
  update public.quotations set status = 'cancelada', cancel_reason = btrim(_motivo), closed_at = now(), closed_by = v_uid where id = _id;
  -- a solicitação volta para o Compras decidir de novo
  update public.purchase_requests set status = 'aprovada' where id = q.request_id and status = 'em_cotacao';
  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, v_uid, 'cancelled', 'quotation', _id, format('Cotação %s cancelada: %s', q.number, left(btrim(_motivo), 120)),
          '/interno/compras/cotacoes/' || _id);
end $fn$;

create or replace function public.search_quotations(_company_id uuid, _status text default null)
returns table (
  id uuid, number text, request_id uuid, request_number text, opened_on date, closes_on date, status text,
  suppliers int, responded int, lines int, opened_by_name text, created_at timestamptz
)
language sql stable security invoker set search_path = public, pg_temp as $fn$
  select q.id, q.number, q.request_id, r.number, q.opened_on, q.closes_on, q.status::text,
         (select count(*)::int from public.quotation_suppliers s where s.quotation_id = q.id),
         (select count(*)::int from public.quotation_suppliers s where s.quotation_id = q.id and s.responded_at is not null),
         (select count(*)::int from public.quotation_lines l where l.quotation_id = q.id),
         u.full_name, q.created_at
    from public.quotations q
    left join public.purchase_requests r on r.id = q.request_id
    left join public.users u on u.id = q.opened_by
   where q.company_id = _company_id
     and (coalesce(_status, '') = '' or q.status::text = _status
          or (_status = 'abertas' and q.status in ('aberta','respondida')))
   order by q.created_at desc
   limit 500;
$fn$;

revoke all on function app.create_quotation(uuid, uuid, date, text, uuid[], jsonb), app.save_quotation_answers(uuid, uuid, jsonb),
  app.close_quotation(uuid, uuid, jsonb), app.cancel_quotation(uuid, uuid, text) from public, anon;
grant execute on function app.create_quotation(uuid, uuid, date, text, uuid[], jsonb), app.save_quotation_answers(uuid, uuid, jsonb),
  app.close_quotation(uuid, uuid, jsonb), app.cancel_quotation(uuid, uuid, text) to authenticated;

create or replace function public.create_quotation(_company_id uuid, _request_id uuid, _closes_on date, _notes text, _suppliers uuid[], _itens jsonb)
returns jsonb language sql security invoker set search_path = public, pg_temp as $$
  select app.create_quotation(_company_id, _request_id, _closes_on, _notes, _suppliers, _itens); $$;
create or replace function public.save_quotation_answers(_company_id uuid, _id uuid, _respostas jsonb)
returns void language sql security invoker set search_path = public, pg_temp as $$
  select app.save_quotation_answers(_company_id, _id, _respostas); $$;
create or replace function public.close_quotation(_company_id uuid, _id uuid, _escolha jsonb)
returns jsonb language sql security invoker set search_path = public, pg_temp as $$
  select app.close_quotation(_company_id, _id, _escolha); $$;
create or replace function public.cancel_quotation(_company_id uuid, _id uuid, _motivo text)
returns void language sql security invoker set search_path = public, pg_temp as $$
  select app.cancel_quotation(_company_id, _id, _motivo); $$;

revoke all on function public.create_quotation(uuid, uuid, date, text, uuid[], jsonb), public.save_quotation_answers(uuid, uuid, jsonb),
  public.close_quotation(uuid, uuid, jsonb), public.cancel_quotation(uuid, uuid, text), public.search_quotations(uuid, text) from public, anon;
grant execute on function public.create_quotation(uuid, uuid, date, text, uuid[], jsonb), public.save_quotation_answers(uuid, uuid, jsonb),
  public.close_quotation(uuid, uuid, jsonb), public.cancel_quotation(uuid, uuid, text), public.search_quotations(uuid, text) to authenticated;
