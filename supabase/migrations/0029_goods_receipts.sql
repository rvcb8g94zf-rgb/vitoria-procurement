-- 0029_goods_receipts.sql
-- Fase 2 · Recebimento: conferir o que chegou contra o pedido.
--
-- Pode ser parcial (várias entregas por pedido). Receber mais do que falta
-- exige uma observação no item. O pedido passa a "recebido em parte" ou
-- "recebido" conforme o total conferido. A nota fiscal da entrega pode ser
-- ligada ao recebimento — é a base da conferência pedido × nota × recebimento
-- da fase 3.

alter table public.goods_receipts
  add column if not exists invoice_id    uuid references public.received_invoices(id) on delete set null,
  add column if not exists invoice_ref   text,
  add column if not exists cancelled_at  timestamptz,
  add column if not exists cancelled_by  uuid references public.users(id),
  add column if not exists cancel_reason text;

create index if not exists gri_order_item_ix on public.goods_receipt_items (order_item_id);

-- quanto já chegou de cada item do pedido (recebimentos não cancelados)
create or replace function public.order_item_progress(_company_id uuid, _order_id uuid)
returns table (order_item_id uuid, line_no smallint, description text, unit text, ordered numeric, received numeric, pending numeric)
language sql stable security invoker set search_path = public, pg_temp as $fn$
  select i.id, i.line_no, i.description, u.code, i.quantity,
         coalesce(sum(gi.quantity_received) filter (where g.cancelled_at is null), 0),
         greatest(i.quantity - coalesce(sum(gi.quantity_received) filter (where g.cancelled_at is null), 0), 0)
    from public.purchase_order_items i
    left join public.units u on u.id = i.unit_id
    left join public.goods_receipt_items gi on gi.order_item_id = i.id
    left join public.goods_receipts g on g.id = gi.receipt_id
   where i.company_id = _company_id and i.order_id = _order_id
   group by i.id, i.line_no, i.description, u.code, i.quantity
   order by i.line_no;
$fn$;

create or replace function app.refresh_order_receipt_status(_order_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pend numeric; v_rec numeric;
begin
  select coalesce(sum(greatest(i.quantity - coalesce(r.qtd, 0), 0)), 0), coalesce(sum(coalesce(r.qtd, 0)), 0)
    into v_pend, v_rec
    from public.purchase_order_items i
    left join lateral (select sum(gi.quantity_received) as qtd from public.goods_receipt_items gi
                        join public.goods_receipts g on g.id = gi.receipt_id and g.cancelled_at is null
                       where gi.order_item_id = i.id) r on true
   where i.order_id = _order_id;
  update public.purchase_orders set status = case
      when v_rec = 0 then (case when sent_at is not null then 'enviado' else 'aprovado' end)::order_status
      when v_pend = 0 then 'recebido'::order_status
      else 'parcialmente_recebido'::order_status end
   where id = _order_id and status in ('aprovado','enviado','confirmado','parcialmente_recebido','recebido');
end $$;

create or replace function app.create_goods_receipt(
  _company_id uuid, _order_id uuid, _received_on date, _invoice_id uuid, _invoice_ref text, _notes text, _itens jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_uid uuid := auth.uid();
  po    record;
  it    jsonb;
  oi    record;
  v_id  uuid;
  v_num text;
  v_q   numeric;
  v_tot numeric := 0;
  v_pend numeric;
begin
  if v_uid is null then raise exception 'Usuário não autenticado.' using errcode = '28000'; end if;
  if not app.has_permission(_company_id, 'goods_receipts', 'create') then
    raise exception 'Sem permissão para registrar recebimentos.' using errcode = '42501';
  end if;
  select * into po from public.purchase_orders where id = _order_id and company_id = _company_id and deleted_at is null for update;
  if po.id is null then raise exception 'Pedido não encontrado.' using errcode = 'P0002'; end if;
  if po.status not in ('aprovado','enviado','confirmado','parcialmente_recebido') then
    raise exception 'Só pedido aprovado ou enviado pode ser recebido (este está "%").', po.status using errcode = '22023';
  end if;
  if _received_on is null or _received_on > current_date then
    raise exception 'Data do recebimento inválida.' using errcode = '22023';
  end if;
  if _invoice_id is not null and not exists (
      select 1 from public.received_invoices ri where ri.id = _invoice_id and ri.company_id = _company_id
         and ri.supplier_id = po.supplier_id) then
    raise exception 'A nota escolhida não é deste fornecedor.' using errcode = '22023';
  end if;

  for it in select * from jsonb_array_elements(coalesce(_itens, '[]'::jsonb)) loop
    v_q := coalesce(nullif(it->>'quantity_received', '')::numeric, 0);
    if v_q < 0 then raise exception 'Quantidade negativa não vale.' using errcode = '22023'; end if;
    v_tot := v_tot + v_q;
  end loop;
  if v_tot <= 0 then raise exception 'Informe a quantidade recebida de pelo menos um item.' using errcode = '22023'; end if;

  v_num := app.next_document_number(_company_id, 'goods_receipt');
  insert into public.goods_receipts (company_id, number, order_id, received_by, received_on, notes, invoice_id, invoice_ref)
  values (_company_id, v_num, _order_id, v_uid, _received_on, nullif(btrim(coalesce(_notes, '')), ''), _invoice_id,
          nullif(btrim(coalesce(_invoice_ref, '')), ''))
  returning id into v_id;

  for it in select * from jsonb_array_elements(_itens) loop
    v_q := coalesce(nullif(it->>'quantity_received', '')::numeric, 0);
    select i.*, (select coalesce(sum(gi.quantity_received), 0) from public.goods_receipt_items gi
                   join public.goods_receipts g on g.id = gi.receipt_id and g.cancelled_at is null
                  where gi.order_item_id = i.id and g.id <> v_id) as ja
      into oi from public.purchase_order_items i
     where i.id = (it->>'order_item_id')::uuid and i.order_id = _order_id;
    if oi.id is null then raise exception 'Item não pertence a este pedido.' using errcode = '22023'; end if;
    v_pend := greatest(oi.quantity - oi.ja, 0);
    if v_q > v_pend and length(btrim(coalesce(it->>'divergence_note', ''))) < 3 then
      raise exception 'O item "%" chegou a mais do que faltava (% de %). Explique na observação do item.',
        oi.description, v_q, v_pend using errcode = '22023';
    end if;
    if v_q > 0 or nullif(btrim(coalesce(it->>'divergence_note', '')), '') is not null then
      insert into public.goods_receipt_items (company_id, receipt_id, order_item_id, product_id, quantity_ordered, quantity_received, divergence_note)
      values (_company_id, v_id, oi.id, oi.product_id, oi.quantity, v_q, nullif(btrim(coalesce(it->>'divergence_note', '')), ''));
    end if;
  end loop;

  perform app.refresh_order_receipt_status(_order_id);

  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, v_uid, 'created', 'goods_receipt', v_id,
          format('Recebimento %s do pedido %s registrado', v_num, po.number), '/interno/compras/recebimentos/' || v_id);
  return jsonb_build_object('id', v_id, 'number', v_num,
                            'status', (select status from public.purchase_orders where id = _order_id));
end $fn$;

create or replace function app.cancel_goods_receipt(_company_id uuid, _id uuid, _motivo text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_uid uuid := auth.uid(); g record;
begin
  if not app.has_permission(_company_id, 'goods_receipts', 'cancel') then
    raise exception 'Sem permissão para cancelar recebimentos.' using errcode = '42501';
  end if;
  select * into g from public.goods_receipts where id = _id and company_id = _company_id for update;
  if g.id is null then raise exception 'Recebimento não encontrado.' using errcode = 'P0002'; end if;
  if g.cancelled_at is not null then raise exception 'Este recebimento já está cancelado.' using errcode = '22023'; end if;
  if length(btrim(coalesce(_motivo, ''))) < 5 then
    raise exception 'Escreva o motivo (pelo menos 5 letras).' using errcode = '22023';
  end if;
  update public.goods_receipts set cancelled_at = now(), cancelled_by = v_uid, cancel_reason = btrim(_motivo) where id = _id;
  if g.order_id is not null then perform app.refresh_order_receipt_status(g.order_id); end if;
  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, v_uid, 'cancelled', 'goods_receipt', _id, format('Recebimento %s cancelado: %s', g.number, left(btrim(_motivo), 120)),
          '/interno/compras/recebimentos/' || _id);
end $fn$;

-- pedidos esperando entrega (com o que falta)
create or replace function public.orders_awaiting_delivery(_company_id uuid)
returns table (id uuid, number text, supplier_name text, status text, expected_on date, total_amount numeric,
               items int, pending_items int, days_late int)
language sql stable security invoker set search_path = public, pg_temp as $fn$
  select po.id, po.number, coalesce(s.trade_name, s.legal_name), po.status::text, po.expected_on, po.total_amount,
         (select count(*)::int from public.purchase_order_items i where i.order_id = po.id),
         (select count(*)::int from public.order_item_progress(_company_id, po.id) p where p.pending > 0),
         case when po.expected_on < current_date then (current_date - po.expected_on)::int else 0 end
    from public.purchase_orders po
    join public.suppliers s on s.id = po.supplier_id
   where po.company_id = _company_id and po.deleted_at is null
     and po.status in ('aprovado','enviado','confirmado','parcialmente_recebido')
   order by po.expected_on nulls last, po.created_at;
$fn$;

revoke all on function app.create_goods_receipt(uuid, uuid, date, uuid, text, text, jsonb), app.cancel_goods_receipt(uuid, uuid, text),
  app.refresh_order_receipt_status(uuid) from public, anon;
grant execute on function app.create_goods_receipt(uuid, uuid, date, uuid, text, text, jsonb), app.cancel_goods_receipt(uuid, uuid, text) to authenticated;

create or replace function public.create_goods_receipt(_company_id uuid, _order_id uuid, _received_on date, _invoice_id uuid, _invoice_ref text, _notes text, _itens jsonb)
returns jsonb language sql security invoker set search_path = public, pg_temp as $$
  select app.create_goods_receipt(_company_id, _order_id, _received_on, _invoice_id, _invoice_ref, _notes, _itens); $$;
create or replace function public.cancel_goods_receipt(_company_id uuid, _id uuid, _motivo text)
returns void language sql security invoker set search_path = public, pg_temp as $$
  select app.cancel_goods_receipt(_company_id, _id, _motivo); $$;

revoke all on function public.create_goods_receipt(uuid, uuid, date, uuid, text, text, jsonb), public.cancel_goods_receipt(uuid, uuid, text),
  public.order_item_progress(uuid, uuid), public.orders_awaiting_delivery(uuid) from public, anon;
grant execute on function public.create_goods_receipt(uuid, uuid, date, uuid, text, text, jsonb), public.cancel_goods_receipt(uuid, uuid, text),
  public.order_item_progress(uuid, uuid), public.orders_awaiting_delivery(uuid) to authenticated;
