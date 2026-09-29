-- 0025_validate_products.sql
-- Validar cadastros: item de nota cujo código do fornecedor ainda não está
-- ligado a um produto nosso.
--
-- Cada pendência (pending_registrations, kind = 'product') é um par
-- fornecedor + código dele. Três saídas:
--   ligar   → a um produto que já existe no cadastro
--   criar   → produto novo com os dados da nota (SKU é nosso, digitado)
--   ignorar → não é item de estoque (frete, serviço, brinde…), com motivo
-- Ao ligar ou criar, o código do fornecedor passa a apontar para o produto
-- (a próxima nota já casa sozinha) e os itens das notas já recebidas são
-- ligados de volta, entrando no histórico de preços e no custo real.

create or replace function public.pending_products(_company_id uuid)
returns table (
  id uuid, supplier_id uuid, supplier_name text, supplier_code text, description text,
  unit text, ncm text, ean text, unit_price numeric, created_at timestamptz,
  items_count int, last_invoice_id uuid, last_invoice_number text, last_issued_at timestamptz,
  suggested_product_id uuid, suggested_product text
)
language sql stable security invoker set search_path = public, pg_temp as $fn$
  select pr.id,
         (pr.payload->>'supplier_id')::uuid,
         coalesce(s.trade_name, s.legal_name),
         pr.payload->>'code', pr.payload->>'description', pr.payload->>'unit',
         pr.payload->>'ncm', nullif(pr.payload->>'ean', ''),
         nullif(pr.payload->>'unit_price', '')::numeric, pr.created_at,
         coalesce(it.n, 0), it.ult_id, it.ult_num, it.ult_em,
         sug.id, sug.rotulo
    from public.pending_registrations pr
    left join public.suppliers s on s.id = (pr.payload->>'supplier_id')::uuid
    left join lateral (
      select count(*)::int as n,
             (array_agg(ri.id order by ri.issued_at desc))[1]     as ult_id,
             (array_agg(ri.number order by ri.issued_at desc))[1] as ult_num,
             max(ri.issued_at)                                    as ult_em
        from public.received_invoice_items i
        join public.received_invoices ri on ri.id = i.invoice_id
       where i.company_id = pr.company_id and i.product_id is null
         and ri.supplier_id = (pr.payload->>'supplier_id')::uuid
         and (case when pr.payload->>'code' is not null then i.supplier_code = pr.payload->>'code'
                   else i.description = pr.payload->>'description' end)
    ) it on true
    left join lateral (
      select p.id, p.sku || ' — ' || p.description as rotulo
        from public.products p
       where p.company_id = pr.company_id and p.deleted_at is null
         and nullif(pr.payload->>'ean', '') is not null and p.ean = pr.payload->>'ean'
       limit 1
    ) sug on true
   where pr.company_id = _company_id and pr.kind = 'product' and pr.status = 'pendente'
   order by coalesce(it.ult_em, pr.created_at) desc;
$fn$;

create or replace function app.resolve_pending_product(
  _company_id uuid, _pending_id uuid, _acao text,
  _product_id uuid default null, _sku text default null, _description text default null,
  _unit text default null, _note text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_uid   uuid := auth.uid();
  pr      record;
  v_forn  uuid;
  v_code  text;
  v_pid   uuid;
  v_unit  uuid;
  v_ncm   text;
  v_ean   text;
  v_itens int := 0;
  v_rot   text;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  if not app.has_permission(_company_id, 'pending_registrations', 'approve') then
    raise exception 'Sem permissão para validar cadastros nesta empresa.' using errcode = '42501';
  end if;

  select * into pr from public.pending_registrations
   where id = _pending_id and company_id = _company_id and kind = 'product'
   for update;
  if pr.id is null then
    raise exception 'Pendência não encontrada.' using errcode = 'P0002';
  end if;
  if pr.status <> 'pendente' then
    raise exception 'Esta pendência já foi resolvida.' using errcode = '22023';
  end if;

  v_forn := (pr.payload->>'supplier_id')::uuid;
  v_code := nullif(pr.payload->>'code', '');

  if _acao = 'ignorar' then
    if length(btrim(coalesce(_note, ''))) < 5 then
      raise exception 'Diga por que o item não entra no cadastro (pelo menos 5 letras).' using errcode = '22023';
    end if;
    update public.pending_registrations
       set status = 'recusado', reviewed_by = v_uid, reviewed_at = now(),
           review_notes = left(btrim(_note), 500), updated_at = now()
     where id = pr.id;
    return jsonb_build_object('acao', 'ignorar');
  end if;

  if _acao = 'criar' then
    if not app.has_permission(_company_id, 'products', 'create') then
      raise exception 'Sem permissão para criar produtos nesta empresa.' using errcode = '42501';
    end if;
    if length(btrim(coalesce(_sku, ''))) < 1 or length(btrim(_sku)) > 40 then
      raise exception 'Informe o código (SKU) do produto, com até 40 caracteres.' using errcode = '22023';
    end if;
    if length(btrim(coalesce(_description, pr.payload->>'description', ''))) < 3 then
      raise exception 'Informe a descrição do produto.' using errcode = '22023';
    end if;
    if exists (select 1 from public.products p where p.company_id = _company_id
                 and p.deleted_at is null and upper(p.sku) = upper(btrim(_sku))) then
      raise exception 'Já existe um produto com o código %.', btrim(_sku) using errcode = '22023';
    end if;
    v_unit := coalesce(
      (select u.id from public.units u where u.code = upper(btrim(coalesce(_unit, '')))),
      app.resolve_unit(pr.payload->>'unit'),
      (select u.id from public.units u where u.code = 'UN'));
    v_ncm := case when regexp_replace(coalesce(pr.payload->>'ncm', ''), '\D', '', 'g') ~ '^[0-9]{8}$'
                  then regexp_replace(pr.payload->>'ncm', '\D', '', 'g') end;
    v_ean := case when coalesce(pr.payload->>'ean', '') ~ '^[0-9]{8}$|^[0-9]{12,14}$'
                  then pr.payload->>'ean' end;
    insert into public.products (company_id, sku, description, unit_id, ncm, ean, notes)
    values (_company_id, btrim(_sku), btrim(coalesce(nullif(btrim(_description), ''), pr.payload->>'description')),
            v_unit, v_ncm, v_ean,
            format('Criado a partir da NF-e (código %s do fornecedor).', coalesce(v_code, 's/ código')))
    returning id into v_pid;
  elsif _acao = 'ligar' then
    select p.id into v_pid from public.products p
     where p.id = _product_id and p.company_id = _company_id and p.deleted_at is null;
    if v_pid is null then
      raise exception 'Escolha um produto do cadastro.' using errcode = '22023';
    end if;
  else
    raise exception 'Ação inválida.' using errcode = '22023';
  end if;

  -- o código do fornecedor passa a apontar para o produto
  if v_code is not null and v_forn is not null then
    insert into public.supplier_products (
      company_id, supplier_id, product_id, supplier_code, supplier_desc, supplier_unit_raw,
      ean, ncm, last_unit_price, is_confirmed)
    values (_company_id, v_forn, v_pid, v_code, pr.payload->>'description', pr.payload->>'unit',
            nullif(pr.payload->>'ean', ''), pr.payload->>'ncm',
            nullif(pr.payload->>'unit_price', '')::numeric, true)
    on conflict (supplier_id, supplier_code) do update
       set product_id = excluded.product_id, is_confirmed = true, updated_at = now();
  end if;

  -- itens das notas já recebidas: liga e leva ao histórico de preços
  with ligados as (
    update public.received_invoice_items i
       set product_id = v_pid
      from public.received_invoices ri
     where ri.id = i.invoice_id and i.company_id = _company_id and i.product_id is null
       and ri.supplier_id = v_forn
       and (case when v_code is not null then i.supplier_code = v_code
                 else i.description = pr.payload->>'description' end)
    returning i.invoice_id, i.unit_price, i.quantity, i.landed_price
  ), hist as (
    insert into public.product_price_history (
      company_id, product_id, supplier_id, occurred_on, unit_price, quantity,
      landed_price, source_type, source_id, document_ref)
    select _company_id, v_pid, v_forn, coalesce(ri.issued_at::date, current_date),
           l.unit_price, l.quantity, l.landed_price, 'invoice', ri.id,
           'NF-e ' || coalesce(ri.number, '') || case when ri.series is null then '' else '/' || ri.series end
      from ligados l join public.received_invoices ri on ri.id = l.invoice_id
     where l.quantity > 0
    returning 1
  )
  select count(*) into v_itens from ligados;

  update public.pending_registrations
     set status = 'aprovado', resolved_entity_id = v_pid, reviewed_by = v_uid, reviewed_at = now(),
         review_notes = nullif(left(btrim(coalesce(_note, '')), 500), ''), updated_at = now()
   where id = pr.id;

  select p.sku || ' — ' || p.description into v_rot from public.products p where p.id = v_pid;
  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, v_uid, case when _acao = 'criar' then 'created' else 'updated' end, 'product', v_pid,
          format('Código %s do fornecedor ligado a %s (%s item(ns) de nota)', coalesce(v_code, 's/ código'), v_rot, v_itens),
          '/interno/cadastros/produtos/' || v_pid);

  return jsonb_build_object('acao', _acao, 'product_id', v_pid, 'itens', v_itens);
end $fn$;

revoke all on function app.resolve_pending_product(uuid, uuid, text, uuid, text, text, text, text) from public, anon;
grant execute on function app.resolve_pending_product(uuid, uuid, text, uuid, text, text, text, text) to authenticated;

create or replace function public.resolve_pending_product(
  _company_id uuid, _pending_id uuid, _acao text,
  _product_id uuid default null, _sku text default null, _description text default null,
  _unit text default null, _note text default null)
returns jsonb
language sql security invoker set search_path = public, pg_temp as $$
  select app.resolve_pending_product(_company_id, _pending_id, _acao, _product_id, _sku, _description, _unit, _note);
$$;

revoke all on function public.pending_products(uuid) from public, anon;
revoke all on function public.resolve_pending_product(uuid, uuid, text, uuid, text, text, text, text) from public, anon;
grant execute on function public.pending_products(uuid) to authenticated;
grant execute on function public.resolve_pending_product(uuid, uuid, text, uuid, text, text, text, text) to authenticated;
