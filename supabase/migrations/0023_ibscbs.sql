-- 0023_ibscbs.sql
-- Reforma tributária na NF-e (NT 2025.002): IBS, CBS e Imposto Seletivo.
--
-- Desde 03/08/2026 os grupos IBSCBS são obrigatórios nas notas de emitentes
-- do regime regular (CRT 3); o Simples entra em 04/01/2027. Em 2026 as
-- alíquotas são de teste (0,1% IBS + 0,9% CBS) e o valor é só informativo.
--
-- IBS e CBS não entram no custo cheio: para a empresa no regime regular são
-- crédito (não cumulativos), como o ICMS próprio. Ficam gravados por item e
-- nos totais da nota para conferência e para a apuração futura.
--
-- A leitura é separada da parse_nfe: app.apply_ibscbs(nota) lê o XML já
-- gravado e preenche as colunas. save_invoice passa a chamá-la, e as notas
-- que já estão no banco são reprocessadas no fim deste arquivo.

alter table public.received_invoice_items
  add column if not exists ibscbs_cst     text,
  add column if not exists ibscbs_class   text,      -- cClassTrib
  add column if not exists ibscbs_base    numeric(15,2),
  add column if not exists ibs_uf_rate    numeric(9,4),
  add column if not exists ibs_uf_amount  numeric(15,2),
  add column if not exists ibs_mun_rate   numeric(9,4),
  add column if not exists ibs_mun_amount numeric(15,2),
  add column if not exists ibs_amount     numeric(15,2),
  add column if not exists cbs_rate       numeric(9,4),
  add column if not exists cbs_amount     numeric(15,2),
  add column if not exists is_amount      numeric(15,2);  -- Imposto Seletivo

alter table public.received_invoices
  add column if not exists emitter_crt       text,          -- 1/2/4 Simples · 3 regime normal
  add column if not exists ibscbs_base_total numeric(15,2),
  add column if not exists ibs_total         numeric(15,2),
  add column if not exists cbs_total         numeric(15,2),
  add column if not exists is_total          numeric(15,2),
  add column if not exists ibscbs_credpres   numeric(15,2), -- crédito presumido (IBS + CBS)
  add column if not exists nf_total_reform   numeric(15,2); -- vNFTot

comment on column public.received_invoices.nf_total_reform is
  'vNFTot da NF-e (reforma). O valor a pagar continua sendo total_amount (vNF) em 2026.';

create or replace function app.apply_ibscbs(_invoice_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_x   xml;
  v_det xml;
  v_seq int := 0;
begin
  select xml_content::xml into v_x
    from public.received_invoices where id = _invoice_id and xml_content is not null;
  if v_x is null then return; end if;

  update public.received_invoices set
    emitter_crt       = app.nfe_txt(v_x, '//emit/CRT/text()'),
    ibscbs_base_total = app.nfe_num(app.nfe_txt(v_x, '//total/IBSCBSTot/vBCIBSCBS/text()')),
    ibs_total         = app.nfe_num(app.nfe_txt(v_x, '//total/IBSCBSTot/gIBS/vIBS/text()')),
    cbs_total         = app.nfe_num(app.nfe_txt(v_x, '//total/IBSCBSTot/gCBS/vCBS/text()')),
    is_total          = app.nfe_num(app.nfe_txt(v_x, '//total/ISTot/vIS/text()')),
    ibscbs_credpres   = nullif(coalesce(app.nfe_num(app.nfe_txt(v_x, '//total/IBSCBSTot/gIBS/vCredPres/text()')), 0)
                             + coalesce(app.nfe_num(app.nfe_txt(v_x, '//total/IBSCBSTot/gCBS/vCredPres/text()')), 0), 0),
    nf_total_reform   = app.nfe_num(app.nfe_txt(v_x, '//total/vNFTot/text()'))
  where id = _invoice_id;

  foreach v_det in array xpath('//det', v_x) loop
    v_seq := v_seq + 1;
    update public.received_invoice_items set
      ibscbs_cst     = app.nfe_txt(v_det, './/imposto/IBSCBS/CST/text()'),
      ibscbs_class   = app.nfe_txt(v_det, './/imposto/IBSCBS/cClassTrib/text()'),
      ibscbs_base    = app.nfe_num(app.nfe_txt(v_det, './/imposto/IBSCBS/gIBSCBS/vBC/text()')),
      ibs_uf_rate    = app.nfe_num(app.nfe_txt(v_det, './/imposto/IBSCBS/gIBSCBS/gIBSUF/pIBSUF/text()')),
      ibs_uf_amount  = app.nfe_num(app.nfe_txt(v_det, './/imposto/IBSCBS/gIBSCBS/gIBSUF/vIBSUF/text()')),
      ibs_mun_rate   = app.nfe_num(app.nfe_txt(v_det, './/imposto/IBSCBS/gIBSCBS/gIBSMun/pIBSMun/text()')),
      ibs_mun_amount = app.nfe_num(app.nfe_txt(v_det, './/imposto/IBSCBS/gIBSCBS/gIBSMun/vIBSMun/text()')),
      ibs_amount     = app.nfe_num(app.nfe_txt(v_det, './/imposto/IBSCBS/gIBSCBS/vIBS/text()')),
      cbs_rate       = app.nfe_num(app.nfe_txt(v_det, './/imposto/IBSCBS/gIBSCBS/gCBS/pCBS/text()')),
      cbs_amount     = app.nfe_num(app.nfe_txt(v_det, './/imposto/IBSCBS/gIBSCBS/gCBS/vCBS/text()')),
      is_amount      = app.nfe_num(app.nfe_txt(v_det, './/imposto/IS/vIS/text()'))
    where invoice_id = _invoice_id
      and seq = coalesce(app.nfe_num(app.nfe_txt(v_det, '/det/@nItem')), v_seq)::smallint;
  end loop;
end $$;

revoke all on function app.apply_ibscbs(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- save_invoice: igual à 0022, mais a leitura do IBS/CBS
-- ---------------------------------------------------------------------
create or replace function app.save_invoice(
  _company_id uuid, v jsonb, _filename text, _user uuid, _source text, _nsu bigint default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_cnpj   text;
  forn     record;
  ja       record;
  v_id     uuid;
  v_status text;
  it       jsonb;
  v_pid    uuid;
  v_emi    timestamptz;
  v_pend   int := 0;
  v_novo   uuid;
  v_fornecedor_novo boolean := false;
begin
  select regexp_replace(cnpj, '\D', '', 'g') into v_cnpj from public.companies where id = _company_id;

  select s.id into forn
    from public.suppliers s
   where s.company_id = _company_id and s.deleted_at is null
     and regexp_replace(s.doc_number, '\D', '', 'g') = v->>'emitter_cnpj'
   limit 1;

  -- emitente desconhecido: vira fornecedor "aguardando aprovação" já
  -- ligado à nota (os dados vêm do próprio XML; a decisão continua humana)
  if forn.id is null then
    v_novo := app.ensure_supplier(
      _company_id, v->>'emitter_cnpj', v->>'emitter_name', v->>'emitter_ie', v->>'emitter_uf',
      app.nfe_emitente(v->>'clean_xml'),
      format('NF-e %s (chave %s)', coalesce(v->>'number', 's/nº'), v->>'access_key'));
    if v_novo is not null then
      select s.id into forn from public.suppliers s where s.id = v_novo;
      v_fornecedor_novo := true;
    end if;
  end if;

  v_emi := case when v->>'issued_at' is null then null else (v->>'issued_at')::timestamptz end;

  select ri.id, ri.doc_kind::text as doc_kind into ja
    from public.received_invoices ri
   where ri.company_id = _company_id and ri.access_key = v->>'access_key'
   limit 1;

  if ja.id is not null and ja.doc_kind = 'completo' then
    return jsonb_build_object('status', 'duplicado', 'id', ja.id, 'access_key', v->>'access_key');
  end if;

  if ja.id is null then
    insert into public.received_invoices (
      company_id, access_key, doc_kind, emitter_cnpj, emitter_name, emitter_ie, emitter_uf,
      supplier_id, number, series, issued_at, total_amount, protocol, item_count,
      fiscal_status, dest_cnpj, operation, products_total, discount_total, freight_total,
      insurance_total, other_total, icms_st_total, ipi_total, xml_content, source,
      imported_by, source_filename, completed_at, nsu)
    values (
      _company_id, v->>'access_key', 'completo', v->>'emitter_cnpj', v->>'emitter_name',
      v->>'emitter_ie', nullif(left(coalesce(v->>'emitter_uf', ''), 2), ''), forn.id, v->>'number', v->>'series',
      v_emi, (v->>'total_amount')::numeric, v->>'protocol',
      jsonb_array_length(v->'items'), (v->>'fiscal_status')::dfe_fiscal_status,
      v->>'dest_cnpj', v->>'operation',
      (v->>'products_total')::numeric, (v->>'discount_total')::numeric, (v->>'freight_total')::numeric,
      (v->>'insurance_total')::numeric, (v->>'other_total')::numeric, (v->>'icms_st_total')::numeric,
      (v->>'ipi_total')::numeric, v->>'clean_xml', _source, _user,
      left(nullif(btrim(coalesce(_filename, '')), ''), 200), now(), _nsu)
    returning id into v_id;
    v_status := 'registrado';
  else
    -- o coletor já tinha o resumo: vira nota completa
    update public.received_invoices set
      doc_kind = 'completo', emitter_name = coalesce(v->>'emitter_name', emitter_name),
      emitter_ie = coalesce(v->>'emitter_ie', emitter_ie), emitter_uf = nullif(left(coalesce(v->>'emitter_uf', emitter_uf, ''), 2), ''),
      supplier_id = coalesce(supplier_id, forn.id), number = v->>'number', series = v->>'series',
      issued_at = coalesce(v_emi, issued_at), total_amount = (v->>'total_amount')::numeric,
      protocol = coalesce(v->>'protocol', protocol), item_count = jsonb_array_length(v->'items'),
      fiscal_status = (v->>'fiscal_status')::dfe_fiscal_status, dest_cnpj = v->>'dest_cnpj',
      operation = v->>'operation', products_total = (v->>'products_total')::numeric,
      discount_total = (v->>'discount_total')::numeric, freight_total = (v->>'freight_total')::numeric,
      insurance_total = (v->>'insurance_total')::numeric, other_total = (v->>'other_total')::numeric,
      icms_st_total = (v->>'icms_st_total')::numeric, ipi_total = (v->>'ipi_total')::numeric,
      xml_content = v->>'clean_xml', source_filename = left(nullif(btrim(coalesce(_filename, '')), ''), 200),
      imported_by = coalesce(_user, imported_by), completed_at = now(),
      nsu = coalesce(_nsu, nsu), source = case when source = 'xml' then source else _source end
    where id = ja.id
    returning id into v_id;
    v_status := 'completado';
  end if;

  -- fornecedor não cadastrado vira pendência (a decisão é humana)
  -- CPF inválido, CNPJ da própria empresa ou sem documento: aí sim fica
  -- como pendência para alguém olhar
  if forn.id is null then
    insert into public.pending_registrations (company_id, kind, source, source_ref, dedup_key, payload)
    values (_company_id, 'supplier', 'nfe', v->>'access_key',
            'fornecedor:' || coalesce(v->>'emitter_cnpj', ''),
            jsonb_build_object('cnpj', v->>'emitter_cnpj', 'legal_name', v->>'emitter_name',
                               'ie', v->>'emitter_ie', 'uf', v->>'emitter_uf'))
    on conflict do nothing;
    v_pend := v_pend + 1;
  elsif v_fornecedor_novo then
    v_pend := v_pend + 1;
  end if;

  delete from public.received_invoice_items where invoice_id = v_id;

  for it in select * from jsonb_array_elements(v->'items') loop
    v_pid := null;
    if forn.id is not null and it->>'code' is not null then
      select sp.product_id into v_pid from public.supplier_products sp
       where sp.company_id = _company_id and sp.supplier_id = forn.id
         and sp.supplier_code = it->>'code' and sp.product_id is not null
       limit 1;
    end if;
    if v_pid is null and nullif(it->>'ean', '') is not null then
      select p.id into v_pid from public.products p
       where p.company_id = _company_id and p.deleted_at is null and p.ean = it->>'ean'
       limit 1;
    end if;

    insert into public.received_invoice_items (
      company_id, invoice_id, seq, product_id, supplier_code, ean, description, ncm, cfop,
      unit_raw, quantity, unit_price, line_total, discount, freight, insurance, other,
      icms_st, ipi, landed_total, landed_price)
    values (
      _company_id, v_id, (it->>'seq')::smallint, v_pid, it->>'code', it->>'ean',
      it->>'description', it->>'ncm', it->>'cfop', it->>'unit',
      (it->>'quantity')::numeric, (it->>'unit_price')::numeric, (it->>'line_total')::numeric,
      (it->>'discount')::numeric, (it->>'freight')::numeric, (it->>'insurance')::numeric,
      (it->>'other')::numeric, (it->>'icms_st')::numeric, (it->>'ipi')::numeric,
      (it->>'landed_total')::numeric, (it->>'landed_price')::numeric);

    if v_pid is not null then
     if (it->>'quantity')::numeric > 0 then
      -- histórico de preço alimenta o relatório de custo real
      insert into public.product_price_history (
        company_id, product_id, supplier_id, occurred_on, unit_price, quantity,
        landed_price, source_type, source_id, document_ref)
      values (
        _company_id, v_pid, forn.id, coalesce(v_emi::date, current_date),
        (it->>'unit_price')::numeric, (it->>'quantity')::numeric,
        (it->>'landed_price')::numeric, 'invoice', v_id,
        'NF-e ' || coalesce(v->>'number', '') || case when v->>'series' is null then '' else '/' || (v->>'series') end);
     end if;

      -- guarda o código que o fornecedor usa: a próxima nota já casa direto
      if forn.id is not null and nullif(it->>'code', '') is not null then
        insert into public.supplier_products (
          company_id, supplier_id, product_id, supplier_code, supplier_desc,
          supplier_unit_raw, ean, ncm, last_unit_price, last_purchase_at, is_confirmed)
        values (
          _company_id, forn.id, v_pid, it->>'code', it->>'description',
          it->>'unit', nullif(it->>'ean', ''), it->>'ncm',
          (it->>'unit_price')::numeric, coalesce(v_emi::date, current_date), false)
        on conflict (supplier_id, supplier_code) do update
           set product_id = coalesce(public.supplier_products.product_id, excluded.product_id),
               last_unit_price = excluded.last_unit_price,
               last_purchase_at = excluded.last_purchase_at,
               supplier_desc = coalesce(public.supplier_products.supplier_desc, excluded.supplier_desc),
               updated_at = now();
      end if;
    elsif forn.id is not null then
      insert into public.pending_registrations (company_id, kind, source, source_ref, dedup_key, payload)
      values (_company_id, 'product', 'nfe', v->>'access_key',
              'produto:' || (v->>'emitter_cnpj') || ':' || coalesce(it->>'code', it->>'description'),
              jsonb_build_object('supplier_id', forn.id, 'supplier_cnpj', v->>'emitter_cnpj',
                                 'code', it->>'code', 'description', it->>'description',
                                 'ean', it->>'ean', 'ncm', it->>'ncm', 'unit', it->>'unit',
                                 'unit_price', it->>'unit_price'))
      on conflict do nothing;
      v_pend := v_pend + 1;
    end if;
  end loop;

  -- duplicatas da cobrança
  delete from public.received_invoice_duplicates where invoice_id = v_id;
  insert into public.received_invoice_duplicates (company_id, invoice_id, seq, number, due_date, amount)
  select _company_id, v_id, (d->>'seq')::smallint, d->>'number',
         nullif(d->>'due_date', '')::date, (d->>'amount')::numeric
    from jsonb_array_elements(v->'duplicates') d;

  -- reforma tributária: IBS, CBS e IS de cada item e os totais
  perform app.apply_ibscbs(v_id);

  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, _user, case when v_status = 'registrado' then 'created' else 'updated' end,
          'received_invoice', v_id,
          format(case when _source = 'dfe' then 'NF-e %s de %s recebida da SEFAZ — R$ %s' else 'NF-e %s de %s importada — R$ %s' end,
                 coalesce(v->>'number', 's/nº'), coalesce(v->>'emitter_name', 'fornecedor'),
                 translate(to_char(coalesce((v->>'total_amount')::numeric, 0), 'FM999,999,999,990.00'), ',.', '.,')),
          '/interno/notas/' || v_id);

  return jsonb_build_object(
    'status', v_status, 'id', v_id, 'access_key', v->>'access_key',
    'number', v->>'number', 'emitter_name', v->>'emitter_name',
    'total_amount', v->>'total_amount', 'pendencias', v_pend,
    'duplicatas', jsonb_array_length(v->'duplicates'),
    'fornecedor_novo', v_fornecedor_novo, 'supplier_id', forn.id);
end $fn$;

-- ---------------------------------------------------------------------
-- Notas que já estão no banco
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select id from public.received_invoices where xml_content is not null loop
    perform app.apply_ibscbs(r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- O sistema passou para /interno
-- ---------------------------------------------------------------------
-- Várias funções antigas gravam links como '/notas/…' no histórico e nas
-- notificações. Em vez de reescrever cada uma, um gatilho acerta o link na
-- entrada, e os registros que já existem são corrigidos aqui.
create or replace function app.link_interno()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.link like '/%' and new.link not like '/interno%' and new.link not like '/api/%' then
    new.link := '/interno' || case when new.link = '/' then '' else new.link end;
  end if;
  return new;
end $$;

drop trigger if exists trg_link_interno on public.activity_logs;
create trigger trg_link_interno before insert or update of link on public.activity_logs
  for each row execute function app.link_interno();
drop trigger if exists trg_link_interno on public.notifications;
create trigger trg_link_interno before insert or update of link on public.notifications
  for each row execute function app.link_interno();

update public.activity_logs set link = link
 where link like '/%' and link not like '/interno%' and link not like '/api/%';
update public.notifications set link = link
 where link like '/%' and link not like '/interno%' and link not like '/api/%';
