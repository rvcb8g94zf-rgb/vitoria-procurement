-- 0019_fix_dup_xpath.sql
-- Correção da leitura das duplicatas (cobrança) e do nItem do item.
--
-- Em Postgres, cada nó devolvido por xpath() vira um fragmento próprio: o
-- contexto passa a ser o nó-documento do fragmento, e não o elemento. Por
-- isso './nDup' não achava nada dentro de <dup> — o caminho certo é
-- '/dup/nDup'. Os itens já usavam './/prod/...' e por isso vinham certos;
-- só as duplicatas (número, vencimento, valor) e o atributo nItem estavam
-- voltando vazios. Aqui a função é reescrita com os caminhos corretos.

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
        'seq', coalesce(app.nfe_num(app.nfe_txt(v_det, '/det/@nItem')), v_seq)::int,
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
        'number', app.nfe_txt(v_dup, '/dup/nDup/text()'),
        'due_date', app.nfe_txt(v_dup, '/dup/dVenc/text()'),
        'amount', coalesce(app.nfe_num(app.nfe_txt(v_dup, '/dup/vDup/text()')), 0));
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

revoke all on function app.parse_nfe(text) from public, anon;
grant execute on function app.parse_nfe(text) to authenticated;

-- ---------------------------------------------------------------------
-- Busca: texto que não tem dígito zerava o filtro
-- ---------------------------------------------------------------------
-- regexp_replace('TUPAN', '\D', '', 'g') devolve '' e 'access_key like
-- ''%%''' casa com tudo — buscar pelo nome do emitente trazia a lista
-- inteira. Agora a chave só entra na busca quando há dígitos, o número da
-- nota aceita parte do número e o nome do fornecedor cadastrado também
-- é procurado.
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
         ri.created_at
    from public.received_invoices ri
    left join public.suppliers s on s.id = ri.supplier_id
   cross join q
   where ri.company_id = _company_id
     and (_from is null or ri.issued_at >= _from::timestamptz)
     and (_to is null or ri.issued_at < (_to + 1)::timestamptz)
     and (_supplier is null or ri.supplier_id = _supplier)
     and (coalesce(_status, '') = ''
          or (_status = 'sem_fornecedor' and ri.supplier_id is null)
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
$$;

revoke all on function public.search_received_invoices(uuid, date, date, uuid, text, text, int) from public, anon;
grant execute on function public.search_received_invoices(uuid, date, date, uuid, text, text, int) to authenticated;
