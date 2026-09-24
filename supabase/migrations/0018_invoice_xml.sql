-- =====================================================================
-- 0018_invoice_xml.sql — importação de NF-e por XML
--
-- O banco lê o XML (xpath nativo do Postgres), confere, guarda a nota com
-- as linhas e as duplicatas, liga fornecedor e produto ao cadastro e
-- registra o que não reconheceu como pendência para alguém validar.
--
-- Mesmo princípio do fechamento de caixa: a tela manda o texto, o banco
-- decide. Nenhum número chega calculado do navegador.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Cabeçalho ganha o que só o XML completo traz
-- ---------------------------------------------------------------------
alter table public.received_invoices
  add column if not exists source           text not null default 'dfe',
  add column if not exists imported_by      uuid references public.users(id) on delete set null,
  add column if not exists source_filename  text,
  add column if not exists dest_cnpj        text,
  add column if not exists emitter_uf       char(2),
  add column if not exists operation        text,          -- natureza da operação
  add column if not exists products_total   numeric(14,2),
  add column if not exists discount_total   numeric(14,2),
  add column if not exists freight_total    numeric(14,2),
  add column if not exists insurance_total  numeric(14,2),
  add column if not exists other_total      numeric(14,2),
  add column if not exists icms_st_total    numeric(14,2),
  add column if not exists ipi_total        numeric(14,2),
  add column if not exists xml_content      text;

comment on column public.received_invoices.source is 'dfe = coletor automático; xml = arquivo importado na tela.';
comment on column public.received_invoices.xml_content is 'XML como veio, para reler no futuro sem depender do arquivo.';

-- ---------------------------------------------------------------------
-- Linhas da nota
-- ---------------------------------------------------------------------
create table if not exists public.received_invoice_items (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  invoice_id      uuid not null references public.received_invoices(id) on delete cascade,
  seq             smallint not null,
  product_id      uuid references public.products(id) on delete set null,
  supplier_code   text,
  ean             text,
  description     text not null,
  ncm             text,
  cfop            text,
  unit_raw        text,
  quantity        numeric(16,4) not null default 0,
  unit_price      numeric(16,6) not null default 0,
  line_total      numeric(14,2) not null default 0,
  discount        numeric(14,2) not null default 0,
  freight         numeric(14,2) not null default 0,
  insurance       numeric(14,2) not null default 0,
  other           numeric(14,2) not null default 0,
  icms_st         numeric(14,2) not null default 0,
  ipi             numeric(14,2) not null default 0,
  -- custo cheio: o que de fato saiu do caixa por unidade
  landed_total    numeric(14,2) not null default 0,
  landed_price    numeric(16,6) not null default 0,
  created_at      timestamptz not null default now(),
  unique (invoice_id, seq)
);
create index if not exists rii_invoice_ix on public.received_invoice_items (invoice_id);
create index if not exists rii_product_ix on public.received_invoice_items (company_id, product_id);

-- ---------------------------------------------------------------------
-- Leitura do XML
-- ---------------------------------------------------------------------
create or replace function app.nfe_txt(_x xml, _path text)
returns text language sql immutable as $$
  select nullif(btrim((xpath(_path, _x))[1]::text), '');
$$;

create or replace function app.nfe_num(_v text)
returns numeric language sql immutable as $$
  select case when _v is null or btrim(_v) = '' then null else btrim(_v)::numeric end;
$$;

/**
 * Lê uma NF-e (procNFe, nfeProc, NFe ou resNFe) e devolve tudo em jsonb.
 * Namespaces são retirados antes da leitura: o mesmo caminho serve para
 * XML com ou sem prefixo, que é como os fornecedores mandam na prática.
 */
create or replace function app.parse_nfe(_raw text)
returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_txt   text;
  v_x     xml;
  v_err   text[] := '{}';
  v_warn  text[] := '{}';
  v_key   text;
  v_kind  text;
  v_det   xml;
  v_itens jsonb := '[]'::jsonb;
  v_dups  jsonb := '[]'::jsonb;
  v_dup   xml;
  v_seq   int := 0;
  v_qtd   numeric;
  v_vun   numeric;
  v_tot   numeric;
  v_desc  numeric;
  v_fre   numeric;
  v_seg   numeric;
  v_out   numeric;
  v_st    numeric;
  v_ipi   numeric;
  v_land  numeric;
  v_cstat text;
  v_emi   text;
  v_prod  numeric;
begin
  if _raw is null or btrim(_raw) = '' then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('Arquivo vazio.'), 'warnings', '[]'::jsonb);
  end if;
  if length(_raw) > 2000000 then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('XML maior que 2 MB.'), 'warnings', '[]'::jsonb);
  end if;
  -- DOCTYPE/ENTITY nunca aparece em NF-e legítima e é vetor de ataque
  if _raw ~* '<!DOCTYPE|<!ENTITY' then
    return jsonb_build_object('ok', false, 'warnings', '[]'::jsonb,
      'errors', jsonb_build_array('XML com DOCTYPE não é aceito.'));
  end if;

  v_txt := regexp_replace(_raw, '<\?xml[^>]*\?>', '', 'g');
  v_txt := regexp_replace(v_txt, 'xmlns(:[A-Za-z0-9_.-]+)?="[^"]*"', '', 'g');
  v_txt := regexp_replace(v_txt, '<(/?)[A-Za-z0-9_.-]+:', '<\1', 'g');

  begin
    v_x := v_txt::xml;
  exception when others then
    return jsonb_build_object('ok', false, 'warnings', '[]'::jsonb,
      'errors', jsonb_build_array('Não consegui ler o XML: arquivo corrompido ou não é uma NF-e.'));
  end;

  -- chave de acesso
  v_key := regexp_replace(coalesce(app.nfe_txt(v_x, '//infNFe/@Id'), ''), '\D', '', 'g');
  if length(v_key) <> 44 then
    v_key := regexp_replace(coalesce(app.nfe_txt(v_x, '//chNFe/text()'), ''), '\D', '', 'g');
    v_kind := 'resumo';
  else
    v_kind := 'completo';
  end if;
  if length(v_key) <> 44 then
    return jsonb_build_object('ok', false, 'warnings', '[]'::jsonb,
      'errors', jsonb_build_array('Não encontrei a chave de acesso da NF-e neste arquivo.'));
  end if;

  if v_kind = 'resumo' then
    v_warn := v_warn || 'Este arquivo é o resumo da nota (resNFe), sem itens nem duplicatas.'::text;
  end if;

  -- itens
  if v_kind = 'completo' then
    foreach v_det in array xpath('//det', v_x) loop
      v_seq  := v_seq + 1;
      v_qtd  := coalesce(app.nfe_num(app.nfe_txt(v_det, './/prod/qCom/text()')), 0);
      v_vun  := coalesce(app.nfe_num(app.nfe_txt(v_det, './/prod/vUnCom/text()')), 0);
      v_tot  := coalesce(app.nfe_num(app.nfe_txt(v_det, './/prod/vProd/text()')), 0);
      v_desc := coalesce(app.nfe_num(app.nfe_txt(v_det, './/prod/vDesc/text()')), 0);
      v_fre  := coalesce(app.nfe_num(app.nfe_txt(v_det, './/prod/vFrete/text()')), 0);
      v_seg  := coalesce(app.nfe_num(app.nfe_txt(v_det, './/prod/vSeg/text()')), 0);
      v_out  := coalesce(app.nfe_num(app.nfe_txt(v_det, './/prod/vOutro/text()')), 0);
      v_st   := coalesce(app.nfe_num(app.nfe_txt(v_det, './/imposto//vICMSST/text()')), 0);
      v_ipi  := coalesce(app.nfe_num(app.nfe_txt(v_det, './/imposto//IPI//vIPI/text()')), 0);
      v_land := round(v_tot - v_desc + v_fre + v_seg + v_out + v_st + v_ipi, 2);

      v_itens := v_itens || jsonb_build_object(
        'seq', coalesce(app.nfe_num(app.nfe_txt(v_det, './@nItem')), v_seq)::int,
        'code', app.nfe_txt(v_det, './/prod/cProd/text()'),
        'ean', nullif(regexp_replace(coalesce(app.nfe_txt(v_det, './/prod/cEAN/text()'), ''), '\D', '', 'g'), ''),
        'description', coalesce(app.nfe_txt(v_det, './/prod/xProd/text()'), '(sem descrição)'),
        'ncm', app.nfe_txt(v_det, './/prod/NCM/text()'),
        'cfop', app.nfe_txt(v_det, './/prod/CFOP/text()'),
        'unit', app.nfe_txt(v_det, './/prod/uCom/text()'),
        'quantity', v_qtd, 'unit_price', v_vun, 'line_total', v_tot,
        'discount', v_desc, 'freight', v_fre, 'insurance', v_seg, 'other', v_out,
        'icms_st', v_st, 'ipi', v_ipi,
        'landed_total', v_land,
        'landed_price', case when v_qtd > 0 then round(v_land / v_qtd, 6) else 0 end);
    end loop;

    if jsonb_array_length(v_itens) = 0 then
      v_warn := v_warn || 'A nota não trouxe nenhum item.'::text;
    end if;

    -- duplicatas (cobrança)
    foreach v_dup in array xpath('//cobr/dup', v_x) loop
      v_dups := v_dups || jsonb_build_object(
        'seq', jsonb_array_length(v_dups) + 1,
        'number', app.nfe_txt(v_dup, './nDup/text()'),
        'due_date', app.nfe_txt(v_dup, './dVenc/text()'),
        'amount', coalesce(app.nfe_num(app.nfe_txt(v_dup, './vDup/text()')), 0));
    end loop;
  end if;

  v_cstat := app.nfe_txt(v_x, '//infProt/cStat/text()');
  v_emi   := coalesce(app.nfe_txt(v_x, '//ide/dhEmi/text()'), app.nfe_txt(v_x, '//ide/dEmi/text()'),
                      app.nfe_txt(v_x, '//dhEmi/text()'));
  v_prod  := app.nfe_num(app.nfe_txt(v_x, '//ICMSTot/vProd/text()'));

  return jsonb_build_object(
    'ok', true,
    'errors', '[]'::jsonb,
    'warnings', to_jsonb(v_warn),
    'access_key', v_key,
    'kind', v_kind,
    'emitter_cnpj', nullif(regexp_replace(coalesce(app.nfe_txt(v_x, '//emit/CNPJ/text()'), ''), '\D', '', 'g'), ''),
    'emitter_name', coalesce(app.nfe_txt(v_x, '//emit/xNome/text()'), app.nfe_txt(v_x, '//xNome/text()')),
    'emitter_ie', app.nfe_txt(v_x, '//emit/IE/text()'),
    'emitter_uf', app.nfe_txt(v_x, '//emit/enderEmit/UF/text()'),
    'dest_cnpj', nullif(regexp_replace(coalesce(app.nfe_txt(v_x, '//dest/CNPJ/text()'), ''), '\D', '', 'g'), ''),
    'dest_name', app.nfe_txt(v_x, '//dest/xNome/text()'),
    'number', coalesce(app.nfe_txt(v_x, '//ide/nNF/text()'), app.nfe_txt(v_x, '//nNF/text()')),
    'series', app.nfe_txt(v_x, '//ide/serie/text()'),
    'operation', app.nfe_txt(v_x, '//ide/natOp/text()'),
    'issued_at', v_emi,
    'protocol', coalesce(app.nfe_txt(v_x, '//infProt/nProt/text()'), app.nfe_txt(v_x, '//nProt/text()')),
    'fiscal_status', case
        when v_cstat in ('100', '150') then 'autorizada'
        when v_cstat in ('101', '135', '151', '155') then 'cancelada'
        when v_cstat in ('110', '301', '302', '303') then 'denegada'
        else 'desconhecida' end,
    'products_total', v_prod,
    'discount_total', app.nfe_num(app.nfe_txt(v_x, '//ICMSTot/vDesc/text()')),
    'freight_total', app.nfe_num(app.nfe_txt(v_x, '//ICMSTot/vFrete/text()')),
    'insurance_total', app.nfe_num(app.nfe_txt(v_x, '//ICMSTot/vSeg/text()')),
    'other_total', app.nfe_num(app.nfe_txt(v_x, '//ICMSTot/vOutro/text()')),
    'icms_st_total', app.nfe_num(app.nfe_txt(v_x, '//ICMSTot/vST/text()')),
    'ipi_total', app.nfe_num(app.nfe_txt(v_x, '//ICMSTot/vIPI/text()')),
    'total_amount', coalesce(app.nfe_num(app.nfe_txt(v_x, '//ICMSTot/vNF/text()')),
                             app.nfe_num(app.nfe_txt(v_x, '//vNF/text()'))),
    'items', v_itens,
    'duplicates', v_dups,
    'clean_xml', v_txt
  );
end $$;

-- ---------------------------------------------------------------------
-- Prévia: o que a tela mostra antes de gravar
-- ---------------------------------------------------------------------
create or replace function app.preview_invoice_xml(_company_id uuid, _raw text)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
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
end $$;

-- ---------------------------------------------------------------------
-- Registro: relê o XML (a prévia nunca é confiada) e grava tudo
-- ---------------------------------------------------------------------
create or replace function app.register_invoice_xml(_company_id uuid, _raw text, _filename text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v        jsonb;
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
      imported_by, source_filename, completed_at)
    values (
      _company_id, v->>'access_key', 'completo', v->>'emitter_cnpj', v->>'emitter_name',
      v->>'emitter_ie', nullif(left(coalesce(v->>'emitter_uf', ''), 2), ''), forn.id, v->>'number', v->>'series',
      v_emi, (v->>'total_amount')::numeric, v->>'protocol',
      jsonb_array_length(v->'items'), (v->>'fiscal_status')::dfe_fiscal_status,
      v->>'dest_cnpj', v->>'operation',
      (v->>'products_total')::numeric, (v->>'discount_total')::numeric, (v->>'freight_total')::numeric,
      (v->>'insurance_total')::numeric, (v->>'other_total')::numeric, (v->>'icms_st_total')::numeric,
      (v->>'ipi_total')::numeric, v->>'clean_xml', 'xml', auth.uid(),
      left(nullif(btrim(coalesce(_filename, '')), ''), 200), now())
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
      imported_by = auth.uid(), completed_at = now()
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
  values (_company_id, auth.uid(), case when v_status = 'registrado' then 'created' else 'updated' end,
          'received_invoice', v_id,
          format('NF-e %s de %s importada — R$ %s',
                 coalesce(v->>'number', 's/nº'), coalesce(v->>'emitter_name', 'fornecedor'),
                 translate(to_char(coalesce((v->>'total_amount')::numeric, 0), 'FM999,999,999,990.00'), ',.', '.,')),
          '/notas/' || v_id);

  return jsonb_build_object(
    'status', v_status, 'id', v_id, 'access_key', v->>'access_key',
    'number', v->>'number', 'emitter_name', v->>'emitter_name',
    'total_amount', v->>'total_amount', 'pendencias', v_pend,
    'duplicatas', jsonb_array_length(v->'duplicates'));
end $$;

-- ---------------------------------------------------------------------
-- Busca da lista de notas
-- ---------------------------------------------------------------------
create or replace function public.search_received_invoices(
  _company_id uuid,
  _from       date default null,
  _to         date default null,
  _supplier   uuid default null,
  _status     text default null,     -- '' | autorizada | cancelada | sem_fornecedor | resumo
  _search     text default null,
  _limit      int default 500
)
returns table (
  id uuid, access_key text, number text, series text, issued_at timestamptz,
  emitter_name text, emitter_cnpj text, supplier_id uuid, supplier_name text,
  total_amount numeric, item_count smallint, doc_kind text, fiscal_status text,
  source text, duplicates_count int, next_due date, created_at timestamptz
)
language sql stable security invoker set search_path = public, pg_temp as $$
  select ri.id, ri.access_key, ri.number, ri.series, ri.issued_at,
         ri.emitter_name, ri.emitter_cnpj, ri.supplier_id,
         coalesce(s.trade_name, s.legal_name) as supplier_name,
         ri.total_amount, ri.item_count, ri.doc_kind::text, ri.fiscal_status::text,
         ri.source,
         (select count(*)::int from public.received_invoice_duplicates d where d.invoice_id = ri.id) as duplicates_count,
         (select min(d.due_date) from public.received_invoice_duplicates d
           where d.invoice_id = ri.id and d.due_date >= current_date) as next_due,
         ri.created_at
    from public.received_invoices ri
    left join public.suppliers s on s.id = ri.supplier_id
   where ri.company_id = _company_id
     and (_from is null or ri.issued_at >= _from::timestamptz)
     and (_to is null or ri.issued_at < (_to + 1)::timestamptz)
     and (_supplier is null or ri.supplier_id = _supplier)
     and (coalesce(_status, '') = ''
          or (_status = 'sem_fornecedor' and ri.supplier_id is null)
          or (_status = 'resumo' and ri.doc_kind = 'resumo')
          or (_status in ('autorizada','cancelada','denegada','desconhecida')
              and ri.fiscal_status::text = _status))
     and (coalesce(_search, '') = ''
          or ri.access_key like '%' || regexp_replace(_search, '\D', '', 'g') || '%'
          or ri.number = btrim(_search)
          or ri.emitter_name ilike '%' || btrim(_search) || '%')
   order by ri.issued_at desc nulls last, ri.created_at desc
   limit greatest(1, least(coalesce(_limit, 500), 2000));
$$;

-- ---------------------------------------------------------------------
-- RLS das linhas: leitura para quem vê notas; escrita só pelas funções
-- ---------------------------------------------------------------------
alter table public.received_invoice_items enable row level security;

drop policy if exists rii_select on public.received_invoice_items;
create policy rii_select on public.received_invoice_items for select to authenticated
using (app.has_permission(company_id, 'invoices', 'view'));

drop trigger if exists trg_audit_received_invoice_items on public.received_invoice_items;
create trigger trg_audit_received_invoice_items
after insert or update or delete on public.received_invoice_items
for each row execute function app.audit();

-- ---------------------------------------------------------------------
-- Superfície pública
-- ---------------------------------------------------------------------
create or replace function public.preview_invoice_xml(_company_id uuid, _raw text)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select app.preview_invoice_xml(_company_id, _raw);
$$;

create or replace function public.register_invoice_xml(_company_id uuid, _raw text, _filename text default null)
returns jsonb language sql security invoker set search_path = public, pg_temp as $$
  select app.register_invoice_xml(_company_id, _raw, _filename);
$$;

revoke execute on function
  app.parse_nfe(text), app.preview_invoice_xml(uuid, text), app.register_invoice_xml(uuid, text, text),
  app.nfe_txt(xml, text), app.nfe_num(text)
from public, anon;

grant execute on function
  app.parse_nfe(text), app.preview_invoice_xml(uuid, text), app.register_invoice_xml(uuid, text, text),
  app.nfe_txt(xml, text), app.nfe_num(text)
to authenticated;

revoke execute on function
  public.preview_invoice_xml(uuid, text),
  public.register_invoice_xml(uuid, text, text),
  public.search_received_invoices(uuid, date, date, uuid, text, text, int)
from public, anon;

grant execute on function
  public.preview_invoice_xml(uuid, text),
  public.register_invoice_xml(uuid, text, text),
  public.search_received_invoices(uuid, date, date, uuid, text, text, int)
to authenticated;
