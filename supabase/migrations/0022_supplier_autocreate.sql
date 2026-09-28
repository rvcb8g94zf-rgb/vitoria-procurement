-- =====================================================================
-- Vitória Procurement — Fornecedor automático / Migração 0022
--
-- Pedido de 25/09/2026: emitente de nota que não está no cadastro vira
-- fornecedor com status "pendente" (aguardando aprovação), já ligado à
-- nota. Vale para XML importado e para o que chega da SEFAZ.
--
--  • Os dados vêm do XML: razão social, fantasia, IE, endereço, telefone.
--  • Nada é aprovado sozinho: ativar ou rejeitar é decisão de quem tem
--    suppliers.edit, na tela de fornecedores.
--  • Rejeitar não apaga: o fornecedor fica "bloqueado" com o motivo, e as
--    próximas notas do mesmo CNPJ continuam ligadas a ele (histórico).
--  • CNPJ/CPF inválido ou da própria empresa não vira fornecedor: segue
--    como pendência para alguém olhar.
-- =====================================================================

-- Emitente completo a partir do XML da nota (endereço, fantasia, fone)
create or replace function app.nfe_emitente(_xml text)
returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $fn$
declare
  x xml;
begin
  if _xml is null or _xml = '' then return '{}'::jsonb; end if;
  x := _xml::xml;
  return jsonb_strip_nulls(jsonb_build_object(
    'fantasia',    app.nfe_txt(x, '//emit/xFant/text()'),
    'logradouro',  app.nfe_txt(x, '//emit/enderEmit/xLgr/text()'),
    'numero',      app.nfe_txt(x, '//emit/enderEmit/nro/text()'),
    'complemento', app.nfe_txt(x, '//emit/enderEmit/xCpl/text()'),
    'bairro',      app.nfe_txt(x, '//emit/enderEmit/xBairro/text()'),
    'cidade',      app.nfe_txt(x, '//emit/enderEmit/xMun/text()'),
    'uf',          app.nfe_txt(x, '//emit/enderEmit/UF/text()'),
    'cep',         app.nfe_txt(x, '//emit/enderEmit/CEP/text()'),
    'fone',        app.nfe_txt(x, '//emit/enderEmit/fone/text()')));
exception when others then
  return '{}'::jsonb;
end $fn$;

-- Acha ou cria o fornecedor do documento. Devolve null quando o documento
-- não serve (inválido, vazio ou da própria empresa).
create or replace function app.ensure_supplier(
  _company_id uuid, _doc text, _nome text, _ie text, _uf text, _end jsonb, _origem text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  d      text := regexp_replace(coalesce(_doc, ''), '\D', '', 'g');
  tipo   public.party_doc_type;
  proprio text;
  v_id   uuid;
  e      jsonb := coalesce(_end, '{}'::jsonb);
begin
  if length(d) = 14 and app.is_valid_cnpj(d) then tipo := 'cnpj';
  elsif length(d) = 11 and app.is_valid_cpf(d) then tipo := 'cpf';
  else return null;
  end if;

  select regexp_replace(cnpj, '\D', '', 'g') into proprio from public.companies where id = _company_id;
  if d = proprio then return null; end if;

  select id into v_id from public.suppliers
   where company_id = _company_id and deleted_at is null and doc_number = d;
  if v_id is not null then return v_id; end if;

  begin
    insert into public.suppliers (
      company_id, doc_type, doc_number, legal_name, trade_name, state_reg, state_reg_exempt,
      zip_code, street, street_number, complement, district, city, state_uf, phone,
      notes, status)
    values (
      _company_id, tipo, d,
      left(coalesce(nullif(btrim(_nome), ''), 'Emitente ' || d), 160),
      left(nullif(btrim(e->>'fantasia'), ''), 120),
      case when upper(coalesce(_ie, '')) in ('', 'ISENTO') then null else left(_ie, 30) end,
      upper(coalesce(_ie, '')) = 'ISENTO',
      nullif(regexp_replace(coalesce(e->>'cep', ''), '\D', '', 'g'), ''),
      left(e->>'logradouro', 160), left(e->>'numero', 20), left(e->>'complemento', 80),
      left(e->>'bairro', 80), left(e->>'cidade', 80),
      nullif(upper(left(coalesce(e->>'uf', _uf, ''), 2)), ''),
      nullif(regexp_replace(coalesce(e->>'fone', ''), '\D', '', 'g'), ''),
      format('Cadastrado automaticamente a partir de %s em %s. Confira os dados e aprove.',
             coalesce(_origem, 'nota fiscal'),
             to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')),
      'pendente')
    returning id into v_id;
  exception when unique_violation then
    -- outra gravação criou o mesmo fornecedor no mesmo instante
    select id into v_id from public.suppliers
     where company_id = _company_id and deleted_at is null and doc_number = d;
    return v_id;
  end;

  -- a pendência antiga deste emitente (se houver) está resolvida
  update public.pending_registrations
     set status = 'duplicado', resolved_entity_id = v_id, reviewed_at = now(),
         review_notes = 'Virou fornecedor aguardando aprovação.'
   where company_id = _company_id and kind = 'supplier' and status = 'pendente'
     and dedup_key = 'fornecedor:' || d;

  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, auth.uid(), 'created', 'supplier', v_id,
          format('Fornecedor %s cadastrado a partir de %s — aguardando aprovação',
                 coalesce(nullif(btrim(_nome), ''), d), coalesce(_origem, 'nota fiscal')),
          '/cadastros/fornecedores/' || v_id);

  return v_id;
end $fn$;

-- Aprovar ou rejeitar um fornecedor que chegou pela nota
create or replace function app.review_supplier(
  _company_id uuid, _supplier_id uuid, _decisao text, _motivo text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  f     record;
  quem  text;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  if not app.has_permission(_company_id, 'suppliers', 'edit') then
    raise exception 'Sem permissão para aprovar fornecedores nesta empresa.' using errcode = '42501';
  end if;
  select * into f from public.suppliers
   where id = _supplier_id and company_id = _company_id and deleted_at is null for update;
  if f.id is null then
    raise exception 'Fornecedor não encontrado.' using errcode = 'P0002';
  end if;
  if f.status <> 'pendente' then
    raise exception 'Este fornecedor não está aguardando aprovação.' using errcode = '22023';
  end if;
  if _decisao not in ('aprovar', 'rejeitar') then
    raise exception 'Decisão inválida.' using errcode = '22023';
  end if;
  if _decisao = 'rejeitar' and length(btrim(coalesce(_motivo, ''))) < 5 then
    raise exception 'Escreva o motivo da rejeição (pelo menos 5 letras).' using errcode = '22023';
  end if;

  select full_name into quem from public.users where id = auth.uid();

  update public.suppliers
     set status = case _decisao when 'aprovar' then 'ativo'::supplier_status else 'bloqueado'::supplier_status end,
         notes = concat_ws(E'\n', notes, format('%s em %s por %s%s',
                   case _decisao when 'aprovar' then 'Aprovado' else 'Rejeitado' end,
                   to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
                   coalesce(quem, 'usuário'),
                   case when _decisao = 'rejeitar' then ': ' || btrim(_motivo) else '' end))
   where id = _supplier_id;

  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, auth.uid(), 'updated', 'supplier', _supplier_id,
          format('Fornecedor %s %s', coalesce(f.trade_name, f.legal_name),
                 case _decisao when 'aprovar' then 'aprovado' else 'rejeitado' end),
          '/cadastros/fornecedores/' || _supplier_id);

  return jsonb_build_object('id', _supplier_id,
                            'status', case _decisao when 'aprovar' then 'ativo' else 'bloqueado' end);
end $fn$;

create or replace function public.review_supplier(
  _company_id uuid, _supplier_id uuid, _decisao text, _motivo text default null)
returns jsonb language sql security invoker set search_path = public, pg_temp as $fn$
  select app.review_supplier(_company_id, _supplier_id, _decisao, _motivo);
$fn$;

-- ---------------------------------------------------------------------
-- Gravação da nota: emitente desconhecido vira fornecedor pendente
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
    'duplicatas', jsonb_array_length(v->'duplicates'),
    'fornecedor_novo', v_fornecedor_novo, 'supplier_id', forn.id);
end $fn$;

-- ---------------------------------------------------------------------
-- SEFAZ: o resumo da nota também já cria o fornecedor pendente
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
           regexp_replace(coalesce(app.nfe_txt(x, '//CNPJ/text()'), app.nfe_txt(x, '//CPF/text()'), ''), '\D', '', 'g')
     limit 1;
    if forn is null then
      forn := app.ensure_supplier(
        _company_id,
        coalesce(app.nfe_txt(x, '//CNPJ/text()'), app.nfe_txt(x, '//CPF/text()')),
        app.nfe_txt(x, '//xNome/text()'), app.nfe_txt(x, '//IE/text()'), null, '{}'::jsonb,
        format('resumo da NF-e (chave %s) recebido da SEFAZ', v_key));
    end if;

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
-- Lista de notas: agora devolve também a situação do fornecedor
-- ---------------------------------------------------------------------
drop function if exists public.search_received_invoices(uuid, date, date, uuid, text, text, int);
create or replace function public.search_received_invoices(
  _company_id uuid,
  _from       date default null,
  _to         date default null,
  _supplier   uuid default null,
  _status     text default null,
  _search     text default null,
  _limit      int default 500
)
returns table (
  id uuid, access_key text, number text, series text, issued_at timestamptz,
  emitter_name text, emitter_cnpj text, supplier_id uuid, supplier_name text,
  total_amount numeric, item_count smallint, doc_kind text, fiscal_status text,
  source text, duplicates_count int, next_due date, created_at timestamptz,
  supplier_status text
)
language sql stable security invoker set search_path = public, pg_temp as $fn$
  with q as (
    select btrim(coalesce(_search, ''))                                as texto,
           nullif(regexp_replace(coalesce(_search, ''), '\D', '', 'g'), '') as digitos
  )
  select ri.id, ri.access_key, ri.number, ri.series, ri.issued_at,
         ri.emitter_name, ri.emitter_cnpj, ri.supplier_id,
         coalesce(s.trade_name, s.legal_name) as supplier_name,
         ri.total_amount, ri.item_count, ri.doc_kind::text, ri.fiscal_status::text,
         ri.source,
         (select count(*)::int from public.received_invoice_duplicates d where d.invoice_id = ri.id) as duplicates_count,
         (select min(d.due_date) from public.received_invoice_duplicates d
           where d.invoice_id = ri.id and d.due_date >= current_date) as next_due,
         ri.created_at,
         s.status::text as supplier_status
    from public.received_invoices ri
    left join public.suppliers s on s.id = ri.supplier_id
   cross join q
   where ri.company_id = _company_id
     and (_from is null or ri.issued_at >= _from::timestamptz)
     and (_to is null or ri.issued_at < (_to + 1)::timestamptz)
     and (_supplier is null or ri.supplier_id = _supplier)
     and (coalesce(_status, '') = ''
          or (_status = 'sem_fornecedor' and (ri.supplier_id is null or s.status = 'pendente'))
          or (_status = 'resumo' and ri.doc_kind = 'resumo')
          or (_status in ('autorizada','cancelada','denegada','desconhecida')
              and ri.fiscal_status::text = _status))
     and (q.texto = ''
          or (q.digitos is not null and ri.access_key like '%' || q.digitos || '%')
          or ri.number ilike '%' || q.texto || '%'
          or ri.emitter_name ilike '%' || q.texto || '%'
          or coalesce(s.trade_name, s.legal_name) ilike '%' || q.texto || '%')
   order by ri.issued_at desc nulls last, ri.created_at desc
   limit greatest(1, least(coalesce(_limit, 500), 2000));
$fn$;

-- ---------------------------------------------------------------------
-- Notas que já estão no sistema sem fornecedor: mesmo tratamento
-- ---------------------------------------------------------------------
do $do$
declare
  r   record;
  sid uuid;
begin
  for r in
    select ri.id, ri.company_id, ri.emitter_cnpj, ri.emitter_name, ri.emitter_ie, ri.emitter_uf,
           ri.number, ri.access_key, ri.xml_content
      from public.received_invoices ri
     where ri.supplier_id is null
     order by ri.issued_at
  loop
    sid := app.ensure_supplier(r.company_id, r.emitter_cnpj, r.emitter_name, r.emitter_ie, r.emitter_uf,
                               app.nfe_emitente(r.xml_content),
                               format('NF-e %s (chave %s)', coalesce(r.number, 's/nº'), r.access_key));
    if sid is not null then
      update public.received_invoices set supplier_id = sid where id = r.id;
      update public.payables set supplier_id = sid where invoice_id = r.id and supplier_id is null;
    end if;
  end loop;
end $do$;

revoke all on function
  app.nfe_emitente(text),
  app.ensure_supplier(uuid, text, text, text, text, jsonb, text),
  app.review_supplier(uuid, uuid, text, text),
  public.review_supplier(uuid, uuid, text, text),
  public.search_received_invoices(uuid, date, date, uuid, text, text, int)
from public, anon;

grant execute on function
  app.review_supplier(uuid, uuid, text, text),
  public.review_supplier(uuid, uuid, text, text),
  public.search_received_invoices(uuid, date, date, uuid, text, text, int)
to authenticated;

revoke all on function app.ensure_supplier(uuid, text, text, text, text, jsonb, text) from authenticated;

-- ---------------------------------------------------------------------
-- Resumo primeiro, XML completo depois (o caminho normal da SEFAZ): o
-- fornecedor pendente nasce só com CNPJ e nome. Quando o XML completo da
-- nota chega, os campos AINDA VAZIOS são preenchidos com o endereço do
-- emitente. Nada que alguém já digitou é sobrescrito, e só vale enquanto
-- o fornecedor está aguardando aprovação.
-- ---------------------------------------------------------------------
create or replace function app.trg_fill_pending_supplier()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  e jsonb;
begin
  if new.supplier_id is null or new.xml_content is null or new.doc_kind <> 'completo' then
    return new;
  end if;
  if not exists (select 1 from public.suppliers where id = new.supplier_id and status = 'pendente') then
    return new;
  end if;

  e := app.nfe_emitente(new.xml_content);
  update public.suppliers s set
    trade_name    = coalesce(s.trade_name, left(nullif(btrim(e->>'fantasia'), ''), 120)),
    state_reg     = coalesce(s.state_reg, case when upper(coalesce(new.emitter_ie, '')) in ('', 'ISENTO') then null else left(new.emitter_ie, 30) end),
    zip_code      = coalesce(s.zip_code, nullif(regexp_replace(coalesce(e->>'cep', ''), '\D', '', 'g'), '')),
    street        = coalesce(s.street, left(e->>'logradouro', 160)),
    street_number = coalesce(s.street_number, left(e->>'numero', 20)),
    complement    = coalesce(s.complement, left(e->>'complemento', 80)),
    district      = coalesce(s.district, left(e->>'bairro', 80)),
    city          = coalesce(s.city, left(e->>'cidade', 80)),
    state_uf      = coalesce(s.state_uf, nullif(upper(left(coalesce(e->>'uf', new.emitter_uf, ''), 2)), '')),
    phone         = coalesce(s.phone, nullif(regexp_replace(coalesce(e->>'fone', ''), '\D', '', 'g'), ''))
  where s.id = new.supplier_id and s.status = 'pendente';

  return new;
end $fn$;

drop trigger if exists trg_received_fill_supplier on public.received_invoices;
create trigger trg_received_fill_supplier
after insert or update of xml_content, doc_kind, supplier_id on public.received_invoices
for each row execute function app.trg_fill_pending_supplier();

revoke all on function app.trg_fill_pending_supplier() from public, anon, authenticated;
