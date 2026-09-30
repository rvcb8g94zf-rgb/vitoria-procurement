-- 0031_three_way_match.sql
-- Fase 3 · Conferência pedido × nota × recebimento.
--
-- A nota fiscal é ligada a um ou mais pedidos. A ligação nasce sozinha
-- quando o recebimento aponta a nota, ou quando o XML traz o número do
-- pedido (xPed); também pode ser feita à mão na tela da nota.
--
-- Cada item da nota é pareado com um item do pedido: pelo produto (depois
-- de validado), pelo par escolhido à mão, ou direto quando os dois lados
-- têm um item só. A quantidade é convertida pelo fator do de-para do
-- fornecedor (caixa → unidade).
--
-- Conferências (tolerâncias da empresa em company_settings):
--   preco:<item>      preço da nota acima do preço do pedido
--   recebido:<item>   faturado (acumulado) acima do que chegou
--   pedido:<item>     faturado (acumulado) acima do que foi pedido
--   sem_par:<seq>     item da nota que não corresponde a nenhum item do pedido
--   cancelado:<ped>   nota ligada a pedido cancelado
--
-- Como nas divergências, nada disso é gravado: é calculado na hora. Nota
-- com divergência fica RETIDA — o banco recusa a baixa de qualquer título
-- dela — até alguém com permissão de aprovar divergências liberar, com
-- motivo. A liberação vale para as divergências que existiam naquele
-- momento; se surgir outra, a nota volta a ficar retida.

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
create table if not exists public.invoice_order_links (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  invoice_id uuid not null references public.received_invoices(id) on delete cascade,
  order_id   uuid not null references public.purchase_orders(id) on delete cascade,
  source     text not null check (source in ('recebimento', 'xped', 'manual')),
  linked_by  uuid references public.users(id) on delete set null,
  linked_at  timestamptz not null default now(),
  unique (invoice_id, order_id)
);
create index if not exists iol_order_ix on public.invoice_order_links (order_id);
create index if not exists iol_company_ix on public.invoice_order_links (company_id);

alter table public.received_invoice_items
  add column if not exists order_item_id uuid references public.purchase_order_items(id) on delete set null;

create table if not exists public.invoice_match_releases (
  invoice_id  uuid primary key references public.received_invoices(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  keys        text[] not null,
  note        text not null check (length(btrim(note)) >= 5),
  released_by uuid not null references public.users(id),
  released_at timestamptz not null default now()
);

alter table public.invoice_order_links    enable row level security;
alter table public.invoice_match_releases enable row level security;
drop policy if exists iol_select on public.invoice_order_links;
create policy iol_select on public.invoice_order_links for select to authenticated
  using (app.has_permission(company_id, 'invoices', 'view') or app.has_permission(company_id, 'purchase_orders', 'view'));
drop policy if exists imr_select on public.invoice_match_releases;
create policy imr_select on public.invoice_match_releases for select to authenticated
  using (app.has_permission(company_id, 'invoices', 'view') or app.has_permission(company_id, 'purchase_orders', 'view'));
revoke insert, update, delete on public.invoice_order_links, public.invoice_match_releases from authenticated, anon;

-- ---------------------------------------------------------------------
-- Pareamento dos itens (interno)
-- ---------------------------------------------------------------------
create or replace function app.invoice_pairs(_invoice_id uuid)
returns table (seq smallint, item_id uuid, description text, product_id uuid, unit_raw text,
               order_item_id uuid, pair_source text, factor numeric, qty numeric, net_price numeric, net_total numeric)
language sql stable security definer set search_path = public, pg_temp as $fn$
  with ri as (select r.id, r.supplier_id from public.received_invoices r where r.id = _invoice_id),
  po_items as (
    select i.id, i.product_id, i.line_no, po.issued_on
      from public.invoice_order_links l
      join public.purchase_orders po on po.id = l.order_id and po.deleted_at is null
      join public.purchase_order_items i on i.order_id = po.id
     where l.invoice_id = _invoice_id),
  n as (select (select count(*) from po_items) as po_n,
               (select count(*) from public.received_invoice_items x where x.invoice_id = _invoice_id) as nf_n)
  select it.seq, it.id, it.description, it.product_id, it.unit_raw,
         coalesce(m.id, p.id, u.id),
         case when m.id is not null then 'manual' when p.id is not null then 'produto'
              when u.id is not null then 'unico' end,
         f.factor,
         round(it.quantity * f.factor, 4),
         case when it.quantity > 0 then round((it.line_total - it.discount) / (it.quantity * f.factor), 6) end,
         (it.line_total - it.discount)
    from public.received_invoice_items it
    cross join ri
    cross join n
    cross join lateral (select coalesce((select sp.conversion_factor from public.supplier_products sp
                                          where sp.supplier_id = ri.supplier_id and sp.supplier_code = it.supplier_code
                                          limit 1), 1) as factor) f
    left join po_items m on m.id = it.order_item_id
    left join lateral (select pi.id from po_items pi
                        where m.id is null and it.product_id is not null and pi.product_id = it.product_id
                        order by pi.issued_on, pi.line_no limit 1) p on true
    left join lateral (select pi.id from po_items pi
                        where m.id is null and p.id is null and n.po_n = 1 and n.nf_n = 1) u on true
   where it.invoice_id = _invoice_id
   order by it.seq;
$fn$;

-- linha a linha, com as conferências de cada uma (interno)
create or replace function app.invoice_match_lines(_invoice_id uuid)
returns table (seq smallint, description text, unit_raw text, order_item_id uuid, order_id uuid, order_number text,
               order_desc text, order_unit text, pair_source text, factor numeric, qty_invoice numeric,
               price_invoice numeric, price_order numeric, qty_ordered numeric, qty_received numeric,
               qty_invoiced_cum numeric, issues text[])
language sql stable security definer set search_path = public, pg_temp as $fn$
  with ri as (
    select r.id, r.company_id, coalesce(r.issued_at, r.created_at) as quando from public.received_invoices r where r.id = _invoice_id),
  pares as (select * from app.invoice_pairs(_invoice_id)),
  -- notas (autorizadas) ligadas aos mesmos pedidos, até esta
  irmas as (
    select distinct r2.id
      from public.invoice_order_links l
      join public.invoice_order_links l2 on l2.order_id = l.order_id
      join public.received_invoices r2 on r2.id = l2.invoice_id and r2.fiscal_status = 'autorizada'
      cross join ri
     where l.invoice_id = _invoice_id
       and (coalesce(r2.issued_at, r2.created_at), r2.id) <= (ri.quando, ri.id)),
  acum as (
    select pr.order_item_id, sum(pr.qty) as qtd
      from irmas cross join lateral app.invoice_pairs(irmas.id) pr
     where pr.order_item_id is not null
     group by pr.order_item_id),
  rec as (
    select gi.order_item_id, sum(gi.quantity_received) as qtd
      from public.goods_receipt_items gi
      join public.goods_receipts g on g.id = gi.receipt_id and g.cancelled_at is null
     where gi.order_item_id in (select p.order_item_id from pares p)
     group by gi.order_item_id)
  select p.seq, p.description, p.unit_raw, p.order_item_id, oi.order_id, po.number, oi.description, u.code,
         p.pair_source, p.factor, p.qty, p.net_price,
         case when oi.quantity > 0 then round(oi.total / oi.quantity, 6) end,
         oi.quantity, coalesce(rc.qtd, 0), coalesce(ac.qtd, p.qty),
         array_remove(array[
           case when p.order_item_id is null then 'sem_par:' || p.seq end,
           case when p.order_item_id is not null and oi.quantity > 0 and p.net_price > round(oi.total / oi.quantity, 6)
                 and not app.within_tolerance(ri.company_id, round(oi.total / oi.quantity, 6), p.net_price, 'price')
                then 'preco:' || p.order_item_id end,
           case when p.order_item_id is not null and coalesce(ac.qtd, p.qty) > coalesce(rc.qtd, 0)
                 and not app.within_tolerance(ri.company_id, coalesce(rc.qtd, 0), coalesce(ac.qtd, p.qty), 'quantity')
                then 'recebido:' || p.order_item_id end,
           case when p.order_item_id is not null and coalesce(ac.qtd, p.qty) > oi.quantity
                 and not app.within_tolerance(ri.company_id, oi.quantity, coalesce(ac.qtd, p.qty), 'quantity')
                then 'pedido:' || p.order_item_id end
         ], null)
    from pares p
    cross join ri
    left join public.purchase_order_items oi on oi.id = p.order_item_id
    left join public.purchase_orders po on po.id = oi.order_id
    left join public.units u on u.id = oi.unit_id
    left join acum ac on ac.order_item_id = p.order_item_id
    left join rec rc on rc.order_item_id = p.order_item_id
   order by p.seq;
$fn$;

-- situação da conferência de uma nota (interno)
--   cancelada · sem_pedido · aguardando_xml · conferida · liberada · divergente
create or replace function app.invoice_match_state(_invoice_id uuid)
returns table (status text, issues text[], n_orders int)
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
#variable_conflict use_column
declare
  ri    record;
  v_n   int;
  v_iss text[];
  v_rel text[];
begin
  select r.id, r.fiscal_status, r.doc_kind into ri from public.received_invoices r where r.id = _invoice_id;
  if ri.id is null then return; end if;
  select count(*)::int into v_n from public.invoice_order_links l where l.invoice_id = _invoice_id;
  if ri.fiscal_status <> 'autorizada' then
    return query select 'cancelada'::text, '{}'::text[], v_n; return;
  end if;
  if v_n = 0 then
    return query select 'sem_pedido'::text, '{}'::text[], 0; return;
  end if;
  if ri.doc_kind = 'resumo' or not exists (select 1 from public.received_invoice_items x where x.invoice_id = _invoice_id) then
    return query select 'aguardando_xml'::text, '{}'::text[], v_n; return;
  end if;

  select coalesce(array_agg(distinct k order by k), '{}') into v_iss
    from (select unnest(m.issues) as k from app.invoice_match_lines(_invoice_id) m
          union all
          select 'cancelado:' || po.id from public.invoice_order_links l
            join public.purchase_orders po on po.id = l.order_id
           where l.invoice_id = _invoice_id and (po.status = 'cancelado' or po.deleted_at is not null)) x;

  if cardinality(v_iss) = 0 then
    return query select 'conferida'::text, v_iss, v_n; return;
  end if;
  select r.keys into v_rel from public.invoice_match_releases r where r.invoice_id = _invoice_id;
  if v_rel is not null and v_iss <@ v_rel then
    return query select 'liberada'::text, v_iss, v_n; return;
  end if;
  return query select 'divergente'::text, v_iss, v_n;
end $fn$;

create or replace function app.invoice_on_hold(_invoice_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select s.status = 'divergente' from app.invoice_match_state(_invoice_id) s), false);
$$;

-- ---------------------------------------------------------------------
-- Retenção: o banco recusa baixa de título de nota retida
-- ---------------------------------------------------------------------
create or replace function app.block_held_payment()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_inv uuid; v_num text;
begin
  select p.invoice_id into v_inv from public.payables p where p.id = new.payable_id;
  if v_inv is not null and app.invoice_on_hold(v_inv) then
    select number into v_num from public.received_invoices where id = v_inv;
    raise exception 'Pagamento retido: a NF % não bate com o pedido ou com o que foi recebido. Abra a nota, veja a conferência e peça a liberação.',
      coalesce(v_num, 's/nº') using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists trg_payment_hold on public.payable_payments;
create trigger trg_payment_hold before insert on public.payable_payments
for each row execute function app.block_held_payment();

-- ---------------------------------------------------------------------
-- Ligação automática
-- ---------------------------------------------------------------------
-- 1. recebimento que aponta a nota
create or replace function app.link_from_receipt()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.invoice_id is not null and new.order_id is not null and new.cancelled_at is null then
    insert into public.invoice_order_links (company_id, invoice_id, order_id, source, linked_by)
    values (new.company_id, new.invoice_id, new.order_id, 'recebimento', auth.uid())
    on conflict (invoice_id, order_id) do update set source = 'recebimento';
  end if;
  return new;
end $$;

drop trigger if exists trg_receipt_link on public.goods_receipts;
create trigger trg_receipt_link after insert or update of invoice_id on public.goods_receipts
for each row execute function app.link_from_receipt();

-- 2. número do pedido no XML (xPed do item ou do grupo compra)
create or replace function app.auto_link_xped(_invoice_id uuid)
returns int language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  ri     record;
  v_txt  text;
  v_x    xml;
  v_peds text[];
  v_n    int := 0;
begin
  select r.id, r.company_id, r.supplier_id, r.xml_content into ri from public.received_invoices r where r.id = _invoice_id;
  if ri.id is null or ri.supplier_id is null or ri.xml_content is null then return 0; end if;
  v_txt := regexp_replace(ri.xml_content, '<\?xml[^>]*\?>', '', 'g');
  v_txt := regexp_replace(v_txt, 'xmlns(:[A-Za-z0-9_.-]+)?="[^"]*"', '', 'g');
  v_txt := regexp_replace(v_txt, '<(/?)[A-Za-z0-9_.-]+:', '<\1', 'g');
  begin
    v_x := v_txt::xml;
  exception when others then
    return 0;
  end;
  select array_agg(distinct upper(regexp_replace(t::text, '[^A-Za-z0-9]', '', 'g'))) into v_peds
    from unnest(xpath('//det/prod/xPed/text() | //compra/xPed/text()', v_x)) t
   where btrim(t::text) <> '';
  if v_peds is null then return 0; end if;

  insert into public.invoice_order_links (company_id, invoice_id, order_id, source)
  select ri.company_id, ri.id, po.id, 'xped'
    from public.purchase_orders po
   where po.company_id = ri.company_id and po.supplier_id = ri.supplier_id and po.deleted_at is null
     and po.status not in ('rascunho', 'aguardando_aprovacao', 'cancelado')
     and exists (select 1 from unnest(v_peds) p
                  where p = upper(regexp_replace(po.number, '[^A-Za-z0-9]', '', 'g'))
                     or (p ~ '^[0-9]+$' and ltrim(p, '0') <> ''
                         and ltrim(p, '0') = ltrim(regexp_replace(po.number, '\D', '', 'g'), '0')))
  on conflict (invoice_id, order_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

create or replace function app.trg_auto_link_xped()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    perform app.auto_link_xped(new.id);
  exception when others then
    null;   -- ligar é conveniência: nunca impede a nota de ser gravada
  end;
  return null;
end $$;

drop trigger if exists trg_invoice_xped on public.received_invoices;
create constraint trigger trg_invoice_xped
  after insert or update of xml_content, supplier_id on public.received_invoices
  deferrable initially deferred
  for each row execute function app.trg_auto_link_xped();

-- ---------------------------------------------------------------------
-- Ações
-- ---------------------------------------------------------------------
create or replace function app.can_link_invoice(_company_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select app.has_permission(_company_id, 'divergences', 'edit')
      or app.has_permission(_company_id, 'goods_receipts', 'create');
$$;

create or replace function app.link_invoice_order(_company_id uuid, _invoice_id uuid, _order_id uuid, _remover boolean default false)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_uid uuid := auth.uid();
  ri    record;
  po    record;
  g     record;
begin
  if not app.can_link_invoice(_company_id) then
    raise exception 'Sem permissão para ligar notas a pedidos.' using errcode = '42501';
  end if;
  select * into ri from public.received_invoices where id = _invoice_id and company_id = _company_id;
  if ri.id is null then raise exception 'Nota não encontrada.' using errcode = 'P0002'; end if;
  select * into po from public.purchase_orders where id = _order_id and company_id = _company_id and deleted_at is null;
  if po.id is null then raise exception 'Pedido não encontrado.' using errcode = 'P0002'; end if;

  if _remover then
    select * into g from public.goods_receipts
     where order_id = _order_id and invoice_id = _invoice_id and cancelled_at is null limit 1;
    if g.id is not null then
      raise exception 'Esta ligação vem do recebimento %. Para desfazer, cancele ou corrija o recebimento.', g.number using errcode = '22023';
    end if;
    delete from public.invoice_order_links where invoice_id = _invoice_id and order_id = _order_id;
    update public.received_invoice_items set order_item_id = null
     where invoice_id = _invoice_id
       and order_item_id in (select i.id from public.purchase_order_items i where i.order_id = _order_id);
    insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
    values (_company_id, v_uid, 'updated', 'invoice', _invoice_id,
            format('NF %s desligada do pedido %s', coalesce(ri.number, 's/nº'), po.number), '/interno/notas/' || _invoice_id);
    return;
  end if;

  if ri.supplier_id is distinct from po.supplier_id then
    raise exception 'O pedido % é de outro fornecedor.', po.number using errcode = '22023';
  end if;
  if po.status in ('rascunho', 'aguardando_aprovacao', 'cancelado') then
    raise exception 'O pedido % ainda não foi aprovado (ou foi cancelado).', po.number using errcode = '22023';
  end if;
  insert into public.invoice_order_links (company_id, invoice_id, order_id, source, linked_by)
  values (_company_id, _invoice_id, _order_id, 'manual', v_uid)
  on conflict (invoice_id, order_id) do nothing;
  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, v_uid, 'updated', 'invoice', _invoice_id,
          format('NF %s ligada ao pedido %s', coalesce(ri.number, 's/nº'), po.number), '/interno/notas/' || _invoice_id);
end $fn$;

-- par escolhido à mão (null devolve ao pareamento automático)
create or replace function app.pair_invoice_item(_company_id uuid, _invoice_id uuid, _seq smallint, _order_item_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if not app.can_link_invoice(_company_id) then
    raise exception 'Sem permissão para conferir notas.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.received_invoice_items where invoice_id = _invoice_id and company_id = _company_id and seq = _seq) then
    raise exception 'Item da nota não encontrado.' using errcode = 'P0002';
  end if;
  if _order_item_id is not null and not exists (
      select 1 from public.purchase_order_items i
        join public.invoice_order_links l on l.order_id = i.order_id and l.invoice_id = _invoice_id
       where i.id = _order_item_id) then
    raise exception 'Esse item não é de um pedido ligado a esta nota.' using errcode = '22023';
  end if;
  update public.received_invoice_items set order_item_id = _order_item_id
   where invoice_id = _invoice_id and seq = _seq;
end $fn$;

-- liberar o pagamento de uma nota divergente (ou desfazer a liberação)
create or replace function app.release_invoice_match(_company_id uuid, _invoice_id uuid, _note text, _desfazer boolean default false)
returns text language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_uid uuid := auth.uid();
  ri    record;
  st    record;
begin
  if not app.has_permission(_company_id, 'divergences', 'approve') then
    raise exception 'Só quem aprova divergências pode liberar o pagamento.' using errcode = '42501';
  end if;
  select * into ri from public.received_invoices where id = _invoice_id and company_id = _company_id;
  if ri.id is null then raise exception 'Nota não encontrada.' using errcode = 'P0002'; end if;

  if _desfazer then
    delete from public.invoice_match_releases where invoice_id = _invoice_id;
    insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
    values (_company_id, v_uid, 'updated', 'invoice', _invoice_id,
            format('Liberação da NF %s desfeita — pagamento volta a ficar retido', coalesce(ri.number, 's/nº')),
            '/interno/notas/' || _invoice_id);
    return (select s.status from app.invoice_match_state(_invoice_id) s);
  end if;

  select * into st from app.invoice_match_state(_invoice_id);
  if st.status <> 'divergente' then
    raise exception 'Esta nota não tem divergência para liberar.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(_note, ''))) < 5 then
    raise exception 'Escreva o motivo da liberação (pelo menos 5 letras).' using errcode = '22023';
  end if;
  insert into public.invoice_match_releases (invoice_id, company_id, keys, note, released_by)
  values (_invoice_id, _company_id, st.issues, btrim(_note), v_uid)
  on conflict (invoice_id) do update
    set keys = excluded.keys, note = excluded.note, released_by = excluded.released_by, released_at = now();
  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, v_uid, 'approved', 'invoice', _invoice_id,
          format('Pagamento da NF %s liberado apesar da divergência: %s', coalesce(ri.number, 's/nº'), left(btrim(_note), 120)),
          '/interno/notas/' || _invoice_id);
  return 'liberada';
end $fn$;

-- ---------------------------------------------------------------------
-- Leitura
-- ---------------------------------------------------------------------
create or replace function app.can_view_match(_company_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select app.has_permission(_company_id, 'invoices', 'view') or app.has_permission(_company_id, 'purchase_orders', 'view');
$$;

-- resumo de uma nota: situação, pedidos ligados, liberação
create or replace function app.invoice_match_summary(_company_id uuid, _invoice_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare st record; v jsonb;
begin
  if not app.can_view_match(_company_id) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.received_invoices where id = _invoice_id and company_id = _company_id) then
    raise exception 'Nota não encontrada.' using errcode = 'P0002';
  end if;
  select * into st from app.invoice_match_state(_invoice_id);
  select jsonb_build_object(
    'status', st.status,
    'issues', to_jsonb(coalesce(st.issues, '{}')),
    'orders', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', po.id, 'number', po.number, 'status', po.status, 'source', l.source,
                  'total', po.total_amount, 'issued_on', po.issued_on,
                  'from_receipt', exists (select 1 from public.goods_receipts g where g.order_id = po.id
                                             and g.invoice_id = _invoice_id and g.cancelled_at is null))
                  order by po.issued_on, po.number)
                from public.invoice_order_links l join public.purchase_orders po on po.id = l.order_id
               where l.invoice_id = _invoice_id), '[]'),
    'release', (select jsonb_build_object('note', r.note, 'at', r.released_at, 'by', u.full_name,
                                          'keys', to_jsonb(r.keys), 'covers', coalesce(st.issues, '{}') <@ r.keys)
                  from public.invoice_match_releases r join public.users u on u.id = r.released_by
                 where r.invoice_id = _invoice_id),
    'can_link', app.can_link_invoice(_company_id),
    'can_release', app.has_permission(_company_id, 'divergences', 'approve'),
    'open_amount', (select coalesce(sum(p.amount - p.paid_amount), 0) from public.payables p
                     where p.invoice_id = _invoice_id and p.cancelled_at is null)
  ) into v;
  return v;
end $fn$;

create or replace function app.invoice_match_detail(_company_id uuid, _invoice_id uuid)
returns table (seq smallint, description text, unit_raw text, order_item_id uuid, order_id uuid, order_number text,
               order_desc text, order_unit text, pair_source text, factor numeric, qty_invoice numeric,
               price_invoice numeric, price_order numeric, qty_ordered numeric, qty_received numeric,
               qty_invoiced_cum numeric, issues text[])
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
begin
  if not app.can_view_match(_company_id) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.received_invoices r where r.id = _invoice_id and r.company_id = _company_id) then
    raise exception 'Nota não encontrada.' using errcode = 'P0002';
  end if;
  return query select * from app.invoice_match_lines(_invoice_id);
end $fn$;

-- itens dos pedidos ligados (para o par manual)
create or replace function app.invoice_order_items(_company_id uuid, _invoice_id uuid)
returns table (id uuid, order_number text, line_no smallint, description text, unit text, quantity numeric, unit_price numeric)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select i.id, po.number, i.line_no, i.description, u.code, i.quantity,
         case when i.quantity > 0 then round(i.total / i.quantity, 6) end
    from public.invoice_order_links l
    join public.purchase_orders po on po.id = l.order_id
    join public.purchase_order_items i on i.order_id = po.id
    left join public.units u on u.id = i.unit_id
   where l.invoice_id = _invoice_id and l.company_id = _company_id and app.can_view_match(_company_id)
   order by po.issued_on, po.number, i.line_no;
$fn$;

-- pedidos do mesmo fornecedor que podem ser ligados à nota
create or replace function app.invoice_link_candidates(_company_id uuid, _invoice_id uuid)
returns table (id uuid, number text, status text, issued_on date, total_amount numeric, items int)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select po.id, po.number, po.status::text, po.issued_on, po.total_amount,
         (select count(*)::int from public.purchase_order_items i where i.order_id = po.id)
    from public.received_invoices ri
    join public.purchase_orders po on po.company_id = ri.company_id and po.supplier_id = ri.supplier_id
   where ri.id = _invoice_id and ri.company_id = _company_id and app.can_view_match(_company_id)
     and po.deleted_at is null
     and po.status in ('aprovado', 'enviado', 'confirmado', 'parcialmente_recebido', 'recebido')
     and not exists (select 1 from public.invoice_order_links l where l.invoice_id = ri.id and l.order_id = po.id)
   order by (po.status = 'recebido'), po.issued_on desc
   limit 30;
$fn$;

-- lista da conferência
--   _filtro: '' (tudo que importa) · divergente · sem_pedido · conferida · liberada · aguardando_xml
create or replace function app.invoice_matches(_company_id uuid, _filtro text default '')
returns table (invoice_id uuid, number text, supplier_id uuid, supplier_name text, issued_at timestamptz,
               total_amount numeric, orders text, status text, n_issues int, open_amount numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
#variable_conflict use_column
begin
  if not app.can_view_match(_company_id) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return query
  with alvo as (
    -- notas ligadas a pedido
    select ri.id from public.received_invoices ri
     where ri.company_id = _company_id
       and exists (select 1 from public.invoice_order_links l where l.invoice_id = ri.id)
    union
    -- notas recentes de fornecedor com pedido em aberto e ainda sem ligação
    select ri.id from public.received_invoices ri
     where ri.company_id = _company_id and ri.fiscal_status = 'autorizada'
       and ri.issued_at >= now() - interval '120 days'
       and not exists (select 1 from public.invoice_order_links l where l.invoice_id = ri.id)
       and exists (select 1 from public.purchase_orders po
                    where po.company_id = _company_id and po.supplier_id = ri.supplier_id and po.deleted_at is null
                      and po.status in ('aprovado', 'enviado', 'confirmado', 'parcialmente_recebido')
                      and po.issued_on <= coalesce(ri.issued_at, now())::date + 1)
  ),
  calc as (
    select a.id, s.status, cardinality(s.issues) as n
      from alvo a cross join lateral app.invoice_match_state(a.id) s
  )
  select ri.id, ri.number, ri.supplier_id, coalesce(su.trade_name, su.legal_name, ri.emitter_name), ri.issued_at,
         ri.total_amount,
         (select string_agg(po.number, ', ' order by po.number) from public.invoice_order_links l
            join public.purchase_orders po on po.id = l.order_id where l.invoice_id = ri.id),
         c.status, c.n,
         (select coalesce(sum(p.amount - p.paid_amount), 0) from public.payables p
           where p.invoice_id = ri.id and p.cancelled_at is null)
    from calc c
    join public.received_invoices ri on ri.id = c.id
    left join public.suppliers su on su.id = ri.supplier_id
   where (coalesce(_filtro, '') = '' and c.status <> 'cancelada') or c.status = _filtro
   order by case c.status when 'divergente' then 0 when 'sem_pedido' then 1 when 'aguardando_xml' then 2
                          when 'liberada' then 3 else 4 end,
            ri.issued_at desc nulls last
   limit 300;
end $fn$;

-- notas de um pedido
create or replace function app.order_invoices(_company_id uuid, _order_id uuid)
returns table (invoice_id uuid, number text, issued_at timestamptz, total_amount numeric, source text, status text, n_issues int)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select ri.id, ri.number, ri.issued_at, ri.total_amount, l.source, s.status, cardinality(s.issues)
    from public.invoice_order_links l
    join public.received_invoices ri on ri.id = l.invoice_id
    cross join lateral app.invoice_match_state(ri.id) s
   where l.order_id = _order_id and l.company_id = _company_id and app.can_view_match(_company_id)
   order by ri.issued_at;
$fn$;

-- notas com pagamento retido (para o contas a pagar e a visão geral)
create or replace function app.held_invoices(_company_id uuid)
returns table (invoice_id uuid, number text, n_issues int, open_amount numeric)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select ri.id, ri.number, cardinality(s.issues),
         (select coalesce(sum(p.amount - p.paid_amount), 0) from public.payables p
           where p.invoice_id = ri.id and p.cancelled_at is null)
    from public.received_invoices ri
    cross join lateral app.invoice_match_state(ri.id) s
   where ri.company_id = _company_id and app.can_view_match(_company_id)
     and exists (select 1 from public.invoice_order_links l where l.invoice_id = ri.id)
     and s.status = 'divergente';
$fn$;

-- ---------------------------------------------------------------------
-- Permissões e wrappers
-- ---------------------------------------------------------------------
revoke all on function
  app.invoice_pairs(uuid), app.invoice_match_lines(uuid), app.invoice_match_state(uuid), app.invoice_on_hold(uuid),
  app.block_held_payment(), app.link_from_receipt(), app.auto_link_xped(uuid), app.trg_auto_link_xped(),
  app.can_link_invoice(uuid), app.link_invoice_order(uuid, uuid, uuid, boolean),
  app.pair_invoice_item(uuid, uuid, smallint, uuid), app.release_invoice_match(uuid, uuid, text, boolean),
  app.can_view_match(uuid), app.invoice_match_summary(uuid, uuid), app.invoice_match_detail(uuid, uuid),
  app.invoice_order_items(uuid, uuid), app.invoice_link_candidates(uuid, uuid), app.invoice_matches(uuid, text),
  app.order_invoices(uuid, uuid), app.held_invoices(uuid)
from public, anon;

grant execute on function
  app.invoice_match_state(uuid), app.invoice_on_hold(uuid),
  app.can_link_invoice(uuid), app.link_invoice_order(uuid, uuid, uuid, boolean),
  app.pair_invoice_item(uuid, uuid, smallint, uuid), app.release_invoice_match(uuid, uuid, text, boolean),
  app.can_view_match(uuid), app.invoice_match_summary(uuid, uuid), app.invoice_match_detail(uuid, uuid),
  app.invoice_order_items(uuid, uuid), app.invoice_link_candidates(uuid, uuid), app.invoice_matches(uuid, text),
  app.order_invoices(uuid, uuid), app.held_invoices(uuid)
to authenticated;

create or replace function public.link_invoice_order(_company_id uuid, _invoice_id uuid, _order_id uuid, _remover boolean default false)
returns void language sql security invoker set search_path = public, pg_temp as $$
  select app.link_invoice_order(_company_id, _invoice_id, _order_id, _remover); $$;
create or replace function public.pair_invoice_item(_company_id uuid, _invoice_id uuid, _seq smallint, _order_item_id uuid)
returns void language sql security invoker set search_path = public, pg_temp as $$
  select app.pair_invoice_item(_company_id, _invoice_id, _seq, _order_item_id); $$;
create or replace function public.release_invoice_match(_company_id uuid, _invoice_id uuid, _note text, _desfazer boolean default false)
returns text language sql security invoker set search_path = public, pg_temp as $$
  select app.release_invoice_match(_company_id, _invoice_id, _note, _desfazer); $$;
create or replace function public.invoice_match_summary(_company_id uuid, _invoice_id uuid)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select app.invoice_match_summary(_company_id, _invoice_id); $$;
create or replace function public.invoice_match_detail(_company_id uuid, _invoice_id uuid)
returns table (seq smallint, description text, unit_raw text, order_item_id uuid, order_id uuid, order_number text,
               order_desc text, order_unit text, pair_source text, factor numeric, qty_invoice numeric,
               price_invoice numeric, price_order numeric, qty_ordered numeric, qty_received numeric,
               qty_invoiced_cum numeric, issues text[])
language sql stable security invoker set search_path = public, pg_temp as $$
  select * from app.invoice_match_detail(_company_id, _invoice_id); $$;
create or replace function public.invoice_order_items(_company_id uuid, _invoice_id uuid)
returns table (id uuid, order_number text, line_no smallint, description text, unit text, quantity numeric, unit_price numeric)
language sql stable security invoker set search_path = public, pg_temp as $$
  select * from app.invoice_order_items(_company_id, _invoice_id); $$;
create or replace function public.invoice_link_candidates(_company_id uuid, _invoice_id uuid)
returns table (id uuid, number text, status text, issued_on date, total_amount numeric, items int)
language sql stable security invoker set search_path = public, pg_temp as $$
  select * from app.invoice_link_candidates(_company_id, _invoice_id); $$;
create or replace function public.invoice_matches(_company_id uuid, _filtro text default '')
returns table (invoice_id uuid, number text, supplier_id uuid, supplier_name text, issued_at timestamptz,
               total_amount numeric, orders text, status text, n_issues int, open_amount numeric)
language sql stable security invoker set search_path = public, pg_temp as $$
  select * from app.invoice_matches(_company_id, _filtro); $$;
create or replace function public.order_invoices(_company_id uuid, _order_id uuid)
returns table (invoice_id uuid, number text, issued_at timestamptz, total_amount numeric, source text, status text, n_issues int)
language sql stable security invoker set search_path = public, pg_temp as $$
  select * from app.order_invoices(_company_id, _order_id); $$;
create or replace function public.held_invoices(_company_id uuid)
returns table (invoice_id uuid, number text, n_issues int, open_amount numeric)
language sql stable security invoker set search_path = public, pg_temp as $$
  select * from app.held_invoices(_company_id); $$;

revoke all on function
  public.link_invoice_order(uuid, uuid, uuid, boolean), public.pair_invoice_item(uuid, uuid, smallint, uuid),
  public.release_invoice_match(uuid, uuid, text, boolean), public.invoice_match_summary(uuid, uuid),
  public.invoice_match_detail(uuid, uuid), public.invoice_order_items(uuid, uuid),
  public.invoice_link_candidates(uuid, uuid), public.invoice_matches(uuid, text),
  public.order_invoices(uuid, uuid), public.held_invoices(uuid)
from public, anon;
grant execute on function
  public.link_invoice_order(uuid, uuid, uuid, boolean), public.pair_invoice_item(uuid, uuid, smallint, uuid),
  public.release_invoice_match(uuid, uuid, text, boolean), public.invoice_match_summary(uuid, uuid),
  public.invoice_match_detail(uuid, uuid), public.invoice_order_items(uuid, uuid),
  public.invoice_link_candidates(uuid, uuid), public.invoice_matches(uuid, text),
  public.order_invoices(uuid, uuid), public.held_invoices(uuid)
to authenticated;

-- ---------------------------------------------------------------------
-- Dados existentes
-- ---------------------------------------------------------------------
insert into public.invoice_order_links (company_id, invoice_id, order_id, source, linked_by)
select g.company_id, g.invoice_id, g.order_id, 'recebimento', g.received_by
  from public.goods_receipts g
 where g.invoice_id is not null and g.order_id is not null and g.cancelled_at is null
on conflict (invoice_id, order_id) do update set source = 'recebimento';

select app.auto_link_xped(ri.id) from public.received_invoices ri where ri.xml_content is not null;

notify pgrst, 'reload schema';
