-- =====================================================================
-- Vitória Procurement — Consulta SEFAZ (DF-e) / Migração 0021
-- Gravação única para XML importado e para o que vem da SEFAZ.
--
-- Decisões (24/09/2026):
--  • A contabilidade também consulta a distribuição destes CNPJs. O
--    sistema consulta com cautela: no máximo uma vez por dia sozinho,
--    manual só com intervalo mínimo, e para na primeira rejeição 656.
--  • A Ciência da Operação continua com a contabilidade. O sistema só
--    lê: nenhum evento é enviado daqui. Os eventos que a contabilidade
--    registrar chegam pela distribuição e aparecem na nota.
--  • Nota da SEFAZ e nota importada usam a MESMA função de gravação
--    (app.save_invoice): itens, custo cheio, duplicatas, fornecedor e
--    pendências seguem as mesmas regras, venha a nota de onde vier.
-- =====================================================================

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
begin
  select regexp_replace(cnpj, '\D', '', 'g') into v_cnpj from public.companies where id = _company_id;

  select s.id into forn
    from public.suppliers s
   where s.company_id = _company_id and s.deleted_at is null
     and regexp_replace(s.doc_number, '\D', '', 'g') = v->>'emitter_cnpj'
   limit 1;

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
  if forn.id is null then
    insert into public.pending_registrations (company_id, kind, source, source_ref, dedup_key, payload)
    values (_company_id, 'supplier', 'nfe', v->>'access_key',
            'fornecedor:' || (v->>'emitter_cnpj'),
            jsonb_build_object('cnpj', v->>'emitter_cnpj', 'legal_name', v->>'emitter_name',
                               'ie', v->>'emitter_ie', 'uf', v->>'emitter_uf'))
    on conflict do nothing;
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

  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, _user, case when v_status = 'registrado' then 'created' else 'updated' end,
          'received_invoice', v_id,
          format(case when _source = 'dfe' then 'NF-e %s de %s recebida da SEFAZ — R$ %s' else 'NF-e %s de %s importada — R$ %s' end,
                 coalesce(v->>'number', 's/nº'), coalesce(v->>'emitter_name', 'fornecedor'),
                 translate(to_char(coalesce((v->>'total_amount')::numeric, 0), 'FM999,999,999,990.00'), ',.', '.,')),
          '/notas/' || v_id);

  return jsonb_build_object(
    'status', v_status, 'id', v_id, 'access_key', v->>'access_key',
    'number', v->>'number', 'emitter_name', v->>'emitter_name',
    'total_amount', v->>'total_amount', 'pendencias', v_pend,
    'duplicatas', jsonb_array_length(v->'duplicates'));
end $fn$;

-- ---------------------------------------------------------------------
-- Importação manual: mesmas checagens de antes, gravação compartilhada
-- ---------------------------------------------------------------------
create or replace function app.register_invoice_xml(_company_id uuid, _raw text, _filename text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v jsonb;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  if not app.has_permission(_company_id, 'xml_import', 'import') then
    raise exception 'Sem permissão para importar notas nesta empresa.' using errcode = '42501';
  end if;

  v := app.parse_nfe(_raw);
  if not (v->>'ok')::boolean then
    return jsonb_build_object('status', 'erro', 'errors', v->'errors');
  end if;
  if v->>'kind' = 'resumo' then
    return jsonb_build_object('status', 'erro',
      'errors', jsonb_build_array('Este arquivo é só o resumo da nota. Peça o XML completo ao fornecedor.'));
  end if;

  return app.save_invoice(_company_id, v, _filename, auth.uid(), 'xml', null);
end $fn$;

-- ---------------------------------------------------------------------
-- Prévia da importação: avisa também quando o destinatário é um CPF
-- ---------------------------------------------------------------------
create or replace function app.preview_invoice_xml(_company_id uuid, _raw text)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  v      jsonb;
  v_cnpj text;
  forn   record;
  ja     record;
  itens  jsonb := '[]'::jsonb;
  it     jsonb;
  v_pid  uuid;
  v_pdesc text;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  if not app.has_permission(_company_id, 'xml_import', 'import') then
    raise exception 'Sem permissão para importar notas nesta empresa.' using errcode = '42501';
  end if;

  v := app.parse_nfe(_raw);
  if not (v->>'ok')::boolean then
    return v - 'clean_xml';
  end if;

  select regexp_replace(cnpj, '\D', '', 'g') into v_cnpj from public.companies where id = _company_id;

  -- destinatário sem CNPJ: nota para pessoa física (CPF), não para a empresa
  if v->>'kind' = 'completo' and v->>'dest_cnpj' is null then
    v := jsonb_set(v, '{warnings}', (v->'warnings') ||
      '"A nota não foi emitida para uma empresa (o destinatário não tem CNPJ — provavelmente é uma pessoa física). Confira antes de registrar."'::jsonb);
  end if;
  if v->>'dest_cnpj' is not null and v_cnpj is not null and v->>'dest_cnpj' <> v_cnpj then
    v := jsonb_set(v, '{warnings}', (v->'warnings') ||
      to_jsonb(format('A nota foi emitida para o CNPJ %s, que não é o da empresa ativa.', v->>'dest_cnpj')));
  end if;
  if v->>'emitter_cnpj' = v_cnpj then
    v := jsonb_set(v, '{warnings}', (v->'warnings') ||
      '"Esta nota foi emitida pela própria empresa — confira se é mesmo uma compra."'::jsonb);
  end if;
  if v->>'fiscal_status' = 'cancelada' then
    v := jsonb_set(v, '{warnings}', (v->'warnings') || '"A nota consta como cancelada."'::jsonb);
  end if;

  select s.id, s.legal_name, s.trade_name into forn
    from public.suppliers s
   where s.company_id = _company_id
     and s.deleted_at is null
     and regexp_replace(s.doc_number, '\D', '', 'g') = v->>'emitter_cnpj'
   limit 1;

  select ri.id, ri.doc_kind::text as doc_kind, ri.created_at, ri.source into ja
    from public.received_invoices ri
   where ri.company_id = _company_id and ri.access_key = v->>'access_key'
   limit 1;

  -- casa cada item com o cadastro: código do fornecedor primeiro, EAN depois
  for it in select * from jsonb_array_elements(coalesce(v->'items', '[]'::jsonb)) loop
    v_pid := null;
    if forn.id is not null and it->>'code' is not null then
      select sp.product_id into v_pid
        from public.supplier_products sp
       where sp.company_id = _company_id and sp.supplier_id = forn.id
         and sp.supplier_code = it->>'code' and sp.product_id is not null
       limit 1;
    end if;
    if v_pid is null and nullif(it->>'ean', '') is not null then
      select p.id into v_pid from public.products p
       where p.company_id = _company_id and p.deleted_at is null and p.ean = it->>'ean'
       limit 1;
    end if;
    v_pdesc := null;
    if v_pid is not null then
      select description into v_pdesc from public.products where id = v_pid;
    end if;
    itens := itens || (it || jsonb_build_object('product_id', v_pid, 'product_description', v_pdesc));
  end loop;

  return (v - 'clean_xml')
    || jsonb_build_object(
         'items', itens,
         'supplier', case when forn.id is null then null else
            jsonb_build_object('id', forn.id, 'name', coalesce(forn.trade_name, forn.legal_name)) end,
         'existing', case when ja.id is null then null else
            jsonb_build_object('id', ja.id, 'kind', ja.doc_kind, 'source', ja.source, 'created_at', ja.created_at) end,
         'unmatched_items', (select count(*) from jsonb_array_elements(itens) x where x->>'product_id' is null));
end $fn$;

-- ---------------------------------------------------------------------
-- XML de terceiro → xml limpo (sem namespace), ou null se não for XML
-- ---------------------------------------------------------------------
create or replace function app.dfe_xml(_raw text)
returns xml
language plpgsql immutable set search_path = pg_catalog, pg_temp as $fn$
declare
  t text;
begin
  if _raw is null or length(_raw) > 2000000 or _raw ~* '<!DOCTYPE|<!ENTITY' then
    return null;
  end if;
  t := regexp_replace(_raw, '<\?xml[^>]*\?>', '', 'g');
  t := regexp_replace(t, 'xmlns(:[A-Za-z0-9_.-]+)?="[^"]*"', '', 'g');
  t := regexp_replace(t, '<(/?)[A-Za-z0-9_.-]+:', '<\1', 'g');
  return t::xml;
exception when others then
  return null;
end $fn$;

-- ---------------------------------------------------------------------
-- Um documento devolvido pela distribuição DF-e
--   resNFe          → resumo (só cabeçalho; itens chegam depois)
--   procNFe / NFe   → nota completa, pela mesma gravação da importação
--   resEvento /
--   procEventoNFe   → evento: cancelamento marca a nota; manifestação
--                     feita pela contabilidade fica registrada
-- Devolve {resultado: nova|enriquecida|resumo|evento|ignorada|erro}
-- ---------------------------------------------------------------------
create or replace function app.ingest_dfe_doc(
  _company_id uuid, _env text, _nsu bigint, _schema text, _raw text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  x        xml;
  v        jsonb;
  r        jsonb;
  v_cnpj   text;
  v_key    text;
  v_tipo   text;
  v_seq    smallint;
  v_quando timestamptz;
  v_desc   text;
  v_sit    text;
  ja       record;
  forn     uuid;
  esquema  text := lower(coalesce(_schema, ''));
begin
  select regexp_replace(cnpj, '\D', '', 'g') into v_cnpj from public.companies where id = _company_id;
  if v_cnpj is null then
    return jsonb_build_object('resultado', 'erro', 'motivo', 'empresa não encontrada');
  end if;

  -- ------------------------------------------------------------ eventos
  if esquema like '%evento%' then
    x := app.dfe_xml(_raw);
    if x is null then
      return jsonb_build_object('resultado', 'erro', 'motivo', 'evento ilegível');
    end if;
    v_key  := regexp_replace(coalesce(app.nfe_txt(x, '//chNFe/text()'), ''), '\D', '', 'g');
    v_tipo := app.nfe_txt(x, '//tpEvento/text()');
    v_seq  := coalesce(nullif(app.nfe_txt(x, '//nSeqEvento/text()'), '')::smallint, 1);
    v_quando := coalesce(app.nfe_txt(x, '//dhEvento/text()'), app.nfe_txt(x, '//dhRecbto/text()'),
                         app.nfe_txt(x, '//dhRegEvento/text()'))::timestamptz;
    v_desc := coalesce(app.nfe_txt(x, '//xEvento/text()'), app.nfe_txt(x, '//descEvento/text()'));
    if length(v_key) <> 44 or v_tipo is null then
      return jsonb_build_object('resultado', 'ignorada', 'motivo', 'evento sem chave');
    end if;

    insert into public.fiscal_events (company_id, environment, access_key, event_type, sequence,
                                      occurred_at, nsu, description)
    values (_company_id, _env::dfe_environment, v_key, v_tipo, v_seq, v_quando, _nsu, left(v_desc, 300))
    on conflict (company_id, environment, access_key, event_type, sequence) do nothing;

    -- cancelamento: a nota nunca volta a "autorizada" por evento atrasado
    if v_tipo = '110111' then
      update public.received_invoices
         set fiscal_status = 'cancelada', cancelled_at = coalesce(cancelled_at, v_quando)
       where company_id = _company_id and environment = _env::dfe_environment and access_key = v_key;
    end if;

    -- manifestação do destinatário (feita pela contabilidade): só registra
    update public.received_invoices
       set manifestation = case v_tipo
             when '210210' then 'ciencia'::dfe_manifestation
             when '210200' then 'confirmada'::dfe_manifestation
             when '210220' then 'desconhecida'::dfe_manifestation
             when '210240' then 'nao_realizada'::dfe_manifestation end
     where company_id = _company_id and environment = _env::dfe_environment and access_key = v_key
       and v_tipo in ('210210', '210200', '210220', '210240')
       -- ciência não sobrescreve manifestação conclusiva
       and not (v_tipo = '210210' and manifestation in ('confirmada', 'desconhecida', 'nao_realizada'));

    return jsonb_build_object('resultado', 'evento', 'access_key', v_key, 'tipo', v_tipo);
  end if;

  -- ------------------------------------------------------------ resumo
  if esquema like 'resnfe%' then
    x := app.dfe_xml(_raw);
    if x is null then
      return jsonb_build_object('resultado', 'erro', 'motivo', 'resumo ilegível');
    end if;
    v_key := regexp_replace(coalesce(app.nfe_txt(x, '//chNFe/text()'), ''), '\D', '', 'g');
    if length(v_key) <> 44 then
      return jsonb_build_object('resultado', 'ignorada', 'motivo', 'resumo sem chave');
    end if;

    select id, doc_kind::text as doc_kind into ja from public.received_invoices
     where company_id = _company_id and environment = _env::dfe_environment and access_key = v_key;

    -- cSitNFe: 1 autorizada, 2 denegada, 3 cancelada
    v_sit := case app.nfe_txt(x, '//cSitNFe/text()')
               when '3' then 'cancelada' when '2' then 'denegada' else 'autorizada' end;

    if ja.id is not null then
      if v_sit = 'cancelada' then
        update public.received_invoices set fiscal_status = 'cancelada' where id = ja.id;
      end if;
      return jsonb_build_object('resultado', 'ignorada', 'access_key', v_key, 'motivo', 'já existe');
    end if;

    select s.id into forn from public.suppliers s
     where s.company_id = _company_id and s.deleted_at is null
       and regexp_replace(s.doc_number, '\D', '', 'g') =
           regexp_replace(coalesce(app.nfe_txt(x, '//CNPJ/text()'), ''), '\D', '', 'g')
     limit 1;

    insert into public.received_invoices (
      company_id, environment, access_key, nsu, doc_kind, emitter_cnpj, emitter_name, emitter_ie,
      supplier_id, number, series, issued_at, total_amount, protocol, fiscal_status, source, dest_cnpj)
    values (
      _company_id, _env::dfe_environment, v_key, _nsu, 'resumo',
      regexp_replace(coalesce(app.nfe_txt(x, '//CNPJ/text()'), app.nfe_txt(x, '//CPF/text()'), ''), '\D', '', 'g'),
      app.nfe_txt(x, '//xNome/text()'), app.nfe_txt(x, '//IE/text()'), forn,
      -- número e série estão dentro da chave: posições 26-34 e 23-25
      ltrim(substr(v_key, 26, 9), '0'), ltrim(substr(v_key, 23, 3), '0'),
      app.nfe_txt(x, '//dhEmi/text()')::timestamptz,
      app.nfe_num(app.nfe_txt(x, '//vNF/text()')),
      app.nfe_txt(x, '//nProt/text()'),
      v_sit::dfe_fiscal_status, 'dfe', v_cnpj);

    return jsonb_build_object('resultado', 'resumo', 'access_key', v_key);
  end if;

  -- ------------------------------------------------------------ nota completa
  if esquema like 'procnfe%' or esquema like 'nfe_v%' then
    v := app.parse_nfe(_raw);
    if not (v->>'ok')::boolean then
      return jsonb_build_object('resultado', 'erro', 'motivo', v->'errors'->>0);
    end if;
    -- só compra: nota em que a empresa é destinatária (a distribuição
    -- também entrega notas em que ela é só transportadora ou autorizada)
    if coalesce(v->>'dest_cnpj', '') <> v_cnpj then
      return jsonb_build_object('resultado', 'ignorada', 'access_key', v->>'access_key',
                                'motivo', 'empresa não é a destinatária');
    end if;

    select id, doc_kind::text as doc_kind into ja from public.received_invoices
     where company_id = _company_id and environment = _env::dfe_environment and access_key = v->>'access_key';

    r := app.save_invoice(_company_id, v, null, null, 'dfe', _nsu);
    return jsonb_build_object(
      'resultado', case r->>'status'
                     when 'registrado' then 'nova'
                     when 'completado' then 'enriquecida'
                     else 'ignorada' end,
      'access_key', v->>'access_key', 'id', r->>'id');
  end if;

  return jsonb_build_object('resultado', 'ignorada', 'motivo', 'esquema desconhecido: ' || left(_schema, 60));
end $fn$;

-- ---------------------------------------------------------------------
-- Balde SÓ do certificado. Sem nenhuma policy: nenhum usuário lê, lista
-- ou grava aqui — só a chave de serviço, no servidor. (O balde "fiscal"
-- tem leitura para quem vê a consulta; o .pfx não pode morar lá.)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('fiscal-certs', 'fiscal-certs', false, 102400)
on conflict (id) do update set public = false;

-- ---------------------------------------------------------------------
-- Estado da consulta para a tela (sem nenhum segredo)
-- ---------------------------------------------------------------------
create or replace function public.dfe_status(_company_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  c   record;
  st  record;
  pode_config boolean := app.has_permission(_company_id, 'settings', 'edit');
begin
  if not app.has_permission(_company_id, 'dfe', 'view') then
    raise exception 'Sem permissão para ver a consulta da SEFAZ.' using errcode = '42501';
  end if;

  select environment::text as environment, cert_subject, cert_valid_from, cert_valid_to,
         is_active, updated_at, (cert_storage_path is not null and cert_secret_name is not null) as tem_cert
    into c
    from public.fiscal_connections where company_id = _company_id
   order by (environment = 'producao') desc limit 1;

  select ult_nsu, max_nsu, last_run_at, last_cstat, last_message, blocked_until,
         (locked_at is not null and locked_at > now() - interval '15 minutes') as rodando
    into st
    from public.dfe_sync_state where company_id = _company_id
   order by (environment = 'producao') desc limit 1;

  return jsonb_build_object(
    'pode_configurar', pode_config,
    'pode_consultar', app.has_permission(_company_id, 'dfe', 'import'),
    'conexao', case when c.environment is null then null else jsonb_build_object(
        'ambiente', c.environment, 'titular', c.cert_subject,
        'valido_de', c.cert_valid_from, 'valido_ate', c.cert_valid_to,
        'ativa', c.is_active, 'tem_certificado', c.tem_cert, 'atualizada_em', c.updated_at) end,
    'estado', case when st.last_run_at is null and st.ult_nsu is null then null else jsonb_build_object(
        'ult_nsu', st.ult_nsu, 'max_nsu', st.max_nsu, 'ultima', st.last_run_at,
        'cstat', st.last_cstat, 'mensagem', st.last_message,
        'bloqueado_ate', st.blocked_until, 'rodando', coalesce(st.rodando, false)) end,
    'execucoes', coalesce((
        select jsonb_agg(to_jsonb(x) order by x.started_at desc) from (
          select id, trigger, started_at, finished_at, status::text as status, cstat, message,
                 docs_returned, new_invoices, enriched, from_nsu, to_nsu
            from public.dfe_sync_runs where company_id = _company_id
           order by started_at desc limit 15) x), '[]'::jsonb),
    'resumos', (select count(*) from public.received_invoices
                 where company_id = _company_id and doc_kind = 'resumo' and fiscal_status <> 'cancelada'));
end $fn$;

revoke all on function public.dfe_status(uuid) from public, anon;
grant execute on function public.dfe_status(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Quem pode configurar / consultar — conferido com o JWT do usuário
-- antes de o servidor usar a chave de serviço
-- ---------------------------------------------------------------------
create or replace function public.dfe_can(_company_id uuid, _acao text)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select case _acao
    when 'configurar' then app.has_permission(_company_id, 'settings', 'edit')
    when 'consultar'  then app.has_permission(_company_id, 'dfe', 'import')
    else false end;
$fn$;
revoke all on function public.dfe_can(uuid, text) from public, anon;
grant execute on function public.dfe_can(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Funções do coletor: só a chave de serviço (servidor) executa
-- ---------------------------------------------------------------------
create or replace function public.dfe_ingest(
  _company_id uuid, _env text, _nsu bigint, _schema text, _xml text)
returns jsonb language sql security definer set search_path = public, pg_temp as $fn$
  select app.ingest_dfe_doc(_company_id, _env, _nsu, _schema, _xml);
$fn$;

create or replace function public.dfe_acquire_lock(_company_id uuid, _env text, _owner text)
returns boolean language sql security definer set search_path = public, pg_temp as $fn$
  select app.dfe_acquire_lock(_company_id, _env::dfe_environment, _owner, 15);
$fn$;

create or replace function public.dfe_release_lock(_company_id uuid, _env text)
returns void language sql security definer set search_path = public, pg_temp as $fn$
  select app.dfe_release_lock(_company_id, _env::dfe_environment);
$fn$;

-- grava/atualiza a conexão depois que o servidor validou o certificado
create or replace function public.dfe_save_connection(
  _company_id uuid, _env text, _path text, _secret text, _subject text,
  _valid_from date, _valid_to date)
returns void language sql security definer set search_path = public, pg_temp as $fn$
  insert into public.fiscal_connections (company_id, environment, cert_storage_path, cert_secret_name,
                                         cert_subject, cert_valid_from, cert_valid_to, is_active)
  values (_company_id, _env::dfe_environment, _path, _secret, _subject, _valid_from, _valid_to, true)
  on conflict (company_id, environment) do update
     set cert_storage_path = excluded.cert_storage_path, cert_secret_name = excluded.cert_secret_name,
         cert_subject = excluded.cert_subject, cert_valid_from = excluded.cert_valid_from,
         cert_valid_to = excluded.cert_valid_to, is_active = true;
$fn$;

create or replace function public.dfe_remove_connection(_company_id uuid)
returns text language plpgsql security definer set search_path = public, vault, pg_temp as $fn$
declare nome text; caminho text;
begin
  select cert_secret_name, cert_storage_path into nome, caminho
    from public.fiscal_connections where company_id = _company_id limit 1;
  if nome is not null then
    delete from vault.secrets where name = nome;
  end if;
  update public.fiscal_connections
     set is_active = false, cert_secret_name = null, cert_storage_path = null,
         cert_subject = null, cert_valid_from = null, cert_valid_to = null
   where company_id = _company_id;
  return caminho;
end $fn$;

revoke all on function
  app.save_invoice(uuid, jsonb, text, uuid, text, bigint),
  app.ingest_dfe_doc(uuid, text, bigint, text, text),
  app.dfe_xml(text),
  public.dfe_ingest(uuid, text, bigint, text, text),
  public.dfe_acquire_lock(uuid, text, text),
  public.dfe_release_lock(uuid, text),
  public.dfe_save_connection(uuid, text, text, text, text, date, date),
  public.dfe_remove_connection(uuid)
from public, anon, authenticated;

grant execute on function
  public.dfe_ingest(uuid, text, bigint, text, text),
  public.dfe_acquire_lock(uuid, text, text),
  public.dfe_release_lock(uuid, text),
  public.dfe_save_connection(uuid, text, text, text, text, date, date),
  public.dfe_remove_connection(uuid),
  public.read_fiscal_secret(text),
  public.store_fiscal_secret(text, text)
to service_role;

-- save_invoice e ingest_dfe_doc não têm grant para ninguém: só são
-- alcançadas por register_invoice_xml (confere permissão do usuário) e
-- por dfe_ingest (só chave de serviço), que rodam como dono da função.
