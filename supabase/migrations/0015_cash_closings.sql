-- =====================================================================
-- Vitória Procurement — Módulo Caixa / Migração 0015
-- Fechamento de caixa da loja: importação diária do relatório do PDV.
--
-- Decisões de desenho:
--  • O banco lê o relatório. A aplicação envia só o TEXTO do arquivo; os
--    números saem daqui. Não existe caminho para gravar um fechamento
--    cujos valores não venham do próprio relatório.
--  • O texto (limpo de códigos de impressora) fica guardado junto do
--    registro: qualquer fechamento pode ser relido e auditado depois.
--  • Um fechamento é identificado pela sessão do caixa — abertura e
--    fechamento, ao segundo. O mesmo relatório não entra duas vezes.
--  • Conferência aritmética na importação: as somas do relatório precisam
--    fechar entre si. Divergência não bloqueia, mas fica marcada.
--  • Nada é apagado: correção é cancelamento com motivo + nova importação.
--
-- Formato de referência (PDV da loja, relatório de 18/09/2026):
--   cada linha começa com 0x0F (modo condensado da impressora) e termina
--   em CRLF; seções separadas por linhas de hífens; valores "1.892,10+".
-- =====================================================================

-- ---------------------------------------------------------------------
-- Normalização de texto: maiúsculas, sem acento, espaços colapsados
-- ---------------------------------------------------------------------
create or replace function app.cash_norm(_s text)
returns text language sql immutable set search_path = pg_catalog, pg_temp as $$
  select btrim(regexp_replace(upper(translate(coalesce(_s, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '\s+', ' ', 'g'));
$$;

-- ---------------------------------------------------------------------
-- Classificação de uma forma de pagamento a partir do rótulo impresso.
-- "CREDITO REDE" → tipo crédito, adquirente Rede, rótulo "Crédito Rede".
-- Serve de palpite inicial: o cadastro pode ser corrigido depois.
-- ---------------------------------------------------------------------
create or replace function app.cash_method_info(_code text)
returns jsonb language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare
  c     text := app.cash_norm(_code);
  k     text;
  acq   text;
  w     text;
  words text[] := '{}';
  lbl   text;
begin
  k := case
    when c ~ '\y(DINHEIRO|ESPECIE|MOEDA)\y'              then 'dinheiro'
    when c ~ '\yPIX\y'                                   then 'pix'
    when c ~ 'CREDIARIO|CONVENIO|FIADO|\yA PRAZO\y|CARNE' then 'crediario'
    when c ~ '\y(CREDITO|CRED)\y'                        then 'credito'
    when c ~ '\y(DEBITO|DEB)\y'                          then 'debito'
    when c ~ 'BOLETO'                                    then 'boleto'
    when c ~ 'CHEQUE'                                    then 'cheque'
    when c ~ 'VALE|VOUCHER|TICKET|ALIMENTACAO|REFEICAO'  then 'voucher'
    when c ~ 'TRANSF|\yTED\y|\yDOC\y|DEPOSITO'           then 'transferencia'
    else 'outros'
  end;

  if k <> 'dinheiro' then
    acq := case
      when c ~ '\yREDE\y'          then 'Rede'
      when c ~ '\yCAIXA\y'         then 'Caixa'
      when c ~ '\yCIELO\y'         then 'Cielo'
      when c ~ '\ySTONE\y'         then 'Stone'
      when c ~ '\yGETNET\y'        then 'Getnet'
      when c ~ 'PAGSEGURO|PAGBANK' then 'PagBank'
      when c ~ 'MERCADO ?PAGO'     then 'Mercado Pago'
      when c ~ '\ySAFRA'           then 'SafraPay'
      when c ~ '\ySUMUP\y'         then 'SumUp'
      when c ~ '\ySIPAG\y'         then 'Sipag'
      when c ~ '\yVERO\y'          then 'Vero'
      when c ~ '\yTON\y'           then 'Ton'
      when c ~ 'INFINITE'          then 'InfinitePay'
      else null
    end;
  end if;

  foreach w in array regexp_split_to_array(c, ' ') loop
    words := words || case w
      when 'CREDITO' then 'Crédito'        when 'DEBITO' then 'Débito'
      when 'CARTAO' then 'Cartão'          when 'PIX' then 'PIX'
      when 'TED' then 'TED'                when 'DOC' then 'DOC'
      when 'CREDIARIO' then 'Crediário'    when 'TRANSFERENCIA' then 'Transferência'
      when 'DEPOSITO' then 'Depósito'      when 'CONVENIO' then 'Convênio'
      when 'ALIMENTACAO' then 'Alimentação' when 'REFEICAO' then 'Refeição'
      when 'ESPECIE' then 'Espécie'
      when 'DE' then 'de' when 'DO' then 'do' when 'DA' then 'da'
      when 'E' then 'e'   when 'A' then 'a'
      else initcap(w)
    end;
  end loop;
  lbl := array_to_string(words, ' ');
  lbl := upper(left(lbl, 1)) || substr(lbl, 2);

  return jsonb_build_object(
    'code', c,
    'label', lbl,
    'kind', k,
    'acquirer', acq,
    'sort', case k
      when 'dinheiro' then 10 when 'pix' then 20 when 'debito' then 30
      when 'credito' then 40 when 'voucher' then 50 when 'boleto' then 60
      when 'transferencia' then 70 when 'cheque' then 80 when 'crediario' then 85
      else 90 end
  );
end $$;

-- ---------------------------------------------------------------------
-- LEITOR DO RELATÓRIO
-- Função pura: recebe o texto, devolve tudo o que foi lido, os alertas,
-- os erros que impedem o registro e a conferência aritmética.
--
-- Estrutura esperada, ancorada nas linhas de total (não em posições):
--   datas → entradas → formas de pagamento → TOTAL EM TITULOS
--   → saídas → TOTAL DAS SAIDAS → TROCO NA GAVETA → TOTAL DE OPERACOES
-- Forma de pagamento nova (ex.: "CREDITO CIELO") entra sozinha: é a seção
-- imediatamente anterior a TOTAL EM TITULOS, qualquer que seja o rótulo.
-- ---------------------------------------------------------------------
create or replace function app.parse_cash_report(_raw text, _tz text default 'America/Sao_Paulo')
returns jsonb
language plpgsql stable
set search_path = pg_catalog, pg_temp
as $$
declare
  v_text   text;
  v_line   text;
  v_norm   text;
  v_m      text[];
  v_sec    int := 0;
  v_idx    int := 0;
  v_lines  jsonb := '[]'::jsonb;
  v_warn   text[] := '{}';
  v_err    text[] := '{}';
  v_unk    int := 0;
  v_title  boolean := false;
  v_open   timestamptz;
  v_close  timestamptz;
  v_ops    int;
  v_amt    numeric;
  v_neg    boolean;
  v_year   int;

  v_sec_tit int; v_sec_ped int; v_sec_pag int; v_sec_sai int; v_idx_tit int;
  v_rep_tit numeric; v_rep_sai numeric; v_rep_gav numeric;

  v_pay      jsonb;
  v_entries  jsonb;
  v_outs     jsonb;
  v_others   jsonb;

  v_change_in numeric; v_receipts numeric; v_tenders numeric; v_cash numeric;
  v_change_out numeric; v_discount numeric; v_out_calc numeric; v_out_total numeric;
  v_drawer numeric; v_non_cash numeric;
  v_checks jsonb := '[]'::jsonb;
  v_ok boolean := true;
  v_tol constant numeric := 0.01;
begin
  -- 1. Limpeza: sequências ESC/POS, controles de impressora, fim de linha.
  v_text := coalesce(_raw, '');
  v_text := regexp_replace(v_text, chr(27) || '[@-~][' || chr(1) || '-' || chr(15) || ']?', '', 'g');
  v_text := regexp_replace(v_text, chr(29) || '[!-~][' || chr(1) || '-' || chr(15) || ']?', '', 'g');
  v_text := replace(replace(v_text, chr(13) || chr(10), chr(10)), chr(13), chr(10));
  v_text := replace(v_text, chr(9), ' ');
  v_text := regexp_replace(v_text, '[' || chr(1) || '-' || chr(9) || chr(11) || '-' || chr(31) || chr(127) || ']', '', 'g');
  -- linhas em branco no fim são avanço de papel
  v_text := regexp_replace(v_text, '[ ' || chr(10) || ']+$', '');

  -- 2. Leitura linha a linha.
  foreach v_line in array string_to_array(v_text, chr(10)) loop
    v_line := btrim(v_line);
    continue when v_line = '';

    if v_line ~ '^[-=_*]{5,}$' then
      v_sec := v_sec + 1;
      continue;
    end if;

    v_norm := app.cash_norm(v_line);

    if v_norm ~ '^RELATORIO DE CAIXA' then
      v_title := true;
      continue;
    end if;

    v_m := regexp_match(v_norm,
      '^DATA DE (ABERTURA|FECHAMENTO) ?: ?([0-9]{2})/([0-9]{2})/([0-9]{2,4}) +([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?');
    if v_m is not null then
      v_year := v_m[4]::int;
      if v_year < 100 then v_year := 2000 + v_year; end if;
      begin
        if v_m[1] = 'ABERTURA' then
          v_open := make_timestamp(v_year, v_m[3]::int, v_m[2]::int, v_m[5]::int, v_m[6]::int,
                                   coalesce(v_m[7], '0')::double precision) at time zone _tz;
        else
          v_close := make_timestamp(v_year, v_m[3]::int, v_m[2]::int, v_m[5]::int, v_m[6]::int,
                                    coalesce(v_m[7], '0')::double precision) at time zone _tz;
        end if;
      exception when others then
        v_err := v_err || format('Data inválida na linha "%s".', v_line);
      end;
      continue;
    end if;

    v_m := regexp_match(v_norm, 'TOTAL DE OPERACOES(?: DE CAIXA)? ?: ?([0-9]+)');
    if v_m is not null then
      v_ops := v_m[1]::int;
      continue;
    end if;

    -- "RÓTULO   1.234,56+"  |  "RÓTULO   160,81-"  |  "RÓTULO   -12,00"
    v_m := regexp_match(v_norm,
      '^(.*[^ ]) +(-?)((?:[0-9]{1,3}(?:\.[0-9]{3})+)|[0-9]+),([0-9]{2}) ?([+-]?)$');
    if v_m is not null then
      v_idx := v_idx + 1;
      v_amt := (replace(v_m[3], '.', '') || '.' || v_m[4])::numeric;
      v_neg := v_m[2] = '-' or v_m[5] = '-';
      v_lines := v_lines || jsonb_build_object(
        'i', v_idx, 'sec', v_sec, 'label', v_m[1],
        'amount', v_amt, 'sign', case when v_neg then '-' else '+' end);
      continue;
    end if;

    v_unk := v_unk + 1;
    if v_unk <= 5 then
      v_warn := v_warn || format('Linha não reconhecida, ignorada: "%s".', left(v_line, 80));
    end if;
  end loop;

  if v_unk > 5 then
    v_warn := v_warn || format('Mais %s linhas não reconhecidas foram ignoradas.', v_unk - 5);
  end if;

  -- 3. Validações que impedem o registro.
  if v_open is null then v_err := v_err || 'Não encontrei a DATA DE ABERTURA do caixa.'::text; end if;
  if v_close is null then v_err := v_err || 'Não encontrei a DATA DE FECHAMENTO do caixa.'::text; end if;
  if v_open is not null and v_close is not null and v_close < v_open then
    v_err := v_err || 'O fechamento está antes da abertura.'::text;
  end if;
  if jsonb_array_length(v_lines) = 0 then
    v_err := v_err || 'Não encontrei nenhum valor no arquivo. Ele é mesmo um relatório de caixa?'::text;
  end if;

  -- 4. Âncoras.
  select (l->>'sec')::int, (l->>'i')::int, (l->>'amount')::numeric
    into v_sec_tit, v_idx_tit, v_rep_tit
    from jsonb_array_elements(v_lines) l where l->>'label' = 'TOTAL EM TITULOS'
    order by (l->>'i')::int limit 1;

  select (l->>'sec')::int into v_sec_ped
    from jsonb_array_elements(v_lines) l where l->>'label' like 'PAGTO DE PEDIDOS%'
    order by (l->>'i')::int limit 1;

  select (l->>'sec')::int, (l->>'amount')::numeric into v_sec_sai, v_rep_sai
    from jsonb_array_elements(v_lines) l where l->>'label' = 'TOTAL DAS SAIDAS'
    order by (l->>'i')::int limit 1;

  select (l->>'amount')::numeric into v_rep_gav
    from jsonb_array_elements(v_lines) l where l->>'label' = 'TROCO NA GAVETA'
    order by (l->>'i')::int limit 1;

  v_sec_pag := coalesce(v_sec_tit - 1, v_sec_ped + 1);

  if v_sec_pag is null and jsonb_array_length(v_lines) > 0 then
    v_err := v_err || 'Formato não reconhecido: faltam as linhas TOTAL EM TITULOS e PAGTO DE PEDIDOS.'::text;
  end if;

  if cardinality(v_err) > 0 then
    return jsonb_build_object('ok', false, 'errors', to_jsonb(v_err), 'warnings', to_jsonb(v_warn),
                              'clean_text', v_text);
  end if;

  -- 5. Seções.
  -- Formas de pagamento: a seção antes do TOTAL EM TITULOS. Se o PDV
  -- imprimir o total na mesma seção, vale o que vem antes dele.
  select coalesce(jsonb_agg(jsonb_build_object('code', label, 'amount', total, 'position', pos) order by pos), '[]')
    into v_pay
    from (
      select l->>'label' as label,
             sum(case when l->>'sign' = '-' then -(l->>'amount')::numeric else (l->>'amount')::numeric end) as total,
             min((l->>'i')::int) as pos
        from jsonb_array_elements(v_lines) l
       where l->>'label' not in ('TOTAL EM TITULOS', 'TOTAL DAS SAIDAS', 'TROCO NA GAVETA')
         and ((l->>'sec')::int = v_sec_pag
              or (v_sec_tit is not null and (l->>'sec')::int = v_sec_tit and (l->>'i')::int < v_idx_tit
                  and not exists (select 1 from jsonb_array_elements(v_lines) x where (x->>'sec')::int = v_sec_pag)))
       group by l->>'label'
    ) s;

  if jsonb_array_length(v_pay) = 0 then
    v_warn := v_warn || 'Nenhuma forma de pagamento encontrada no relatório.'::text;
  end if;

  select coalesce(jsonb_agg(l order by (l->>'i')::int), '[]') into v_entries
    from jsonb_array_elements(v_lines) l
   where (l->>'sec')::int < v_sec_pag
     and l->>'label' not in ('TOTAL EM TITULOS', 'TOTAL DAS SAIDAS', 'TROCO NA GAVETA');

  select coalesce(jsonb_agg(l order by (l->>'i')::int), '[]') into v_outs
    from jsonb_array_elements(v_lines) l
   where (l->>'sec')::int > coalesce(v_sec_tit, v_sec_pag)
     and (v_sec_sai is null or (l->>'sec')::int < v_sec_sai)
     and l->>'label' not in ('TOTAL EM TITULOS', 'TOTAL DAS SAIDAS', 'TROCO NA GAVETA');

  select coalesce(jsonb_agg(l order by (l->>'i')::int), '[]') into v_others
    from jsonb_array_elements(v_lines) l
   where v_sec_sai is not null and (l->>'sec')::int > v_sec_sai
     and l->>'label' not in ('TOTAL EM TITULOS', 'TOTAL DAS SAIDAS', 'TROCO NA GAVETA');

  if jsonb_array_length(v_others) > 0 then
    v_warn := v_warn || format('%s linha(s) com valor fora das seções conhecidas foram guardadas sem classificação.',
                               jsonb_array_length(v_others));
  end if;

  -- 6. Campos.
  select coalesce(sum(case when e->>'sign' = '-' then -(e->>'amount')::numeric else (e->>'amount')::numeric end)
                  filter (where e->>'label' ~ '^(ENTRADA DE TROCO|SUPRIMENTO|FUNDO DE TROCO|TROCO INICIAL)'), 0),
         coalesce(sum(case when e->>'sign' = '-' then -(e->>'amount')::numeric else (e->>'amount')::numeric end)
                  filter (where e->>'label' !~ '^(ENTRADA DE TROCO|SUPRIMENTO|FUNDO DE TROCO|TROCO INICIAL)'), 0)
    into v_change_in, v_receipts
    from jsonb_array_elements(v_entries) e;

  select coalesce(sum((p->>'amount')::numeric), 0),
         coalesce(sum((p->>'amount')::numeric)
                  filter (where (app.cash_method_info(p->>'code'))->>'kind' = 'dinheiro'), 0)
    into v_tenders, v_cash
    from jsonb_array_elements(v_pay) p;

  -- Saídas: o sinal impresso é sempre "-"; guardamos o valor positivo.
  select coalesce(sum((o->>'amount')::numeric) filter (where o->>'label' ~ '^(SAIDA DE TROCO|TROCO DEVOLVIDO)'), 0),
         coalesce(sum((o->>'amount')::numeric) filter (where o->>'label' ~ '^DESCONTO'), 0),
         coalesce(sum((o->>'amount')::numeric) filter (where o->>'label' !~ '^DESCONTO'), 0)
    into v_change_out, v_discount, v_out_calc
    from jsonb_array_elements(v_outs) o;

  v_non_cash  := coalesce(v_rep_tit, v_tenders - v_cash);
  v_out_total := coalesce(v_rep_sai, v_out_calc);
  v_drawer    := coalesce(v_rep_gav, v_change_in + v_cash - v_out_total);

  -- 7. Conferência aritmética. Desconto não sai da gaveta: é informativo.
  v_checks := v_checks || jsonb_build_object(
    'key', 'formas_x_pedidos',
    'label', 'Formas de pagamento = pedidos pagos + troco devolvido',
    'expected', v_receipts + v_change_out, 'found', v_tenders,
    'ok', abs(v_tenders - (v_receipts + v_change_out)) <= v_tol);

  if v_rep_tit is not null then
    v_checks := v_checks || jsonb_build_object(
      'key', 'total_titulos',
      'label', 'Total em títulos = formas de pagamento − dinheiro',
      'expected', v_tenders - v_cash, 'found', v_rep_tit,
      'ok', abs(v_rep_tit - (v_tenders - v_cash)) <= v_tol);
  end if;

  if v_rep_sai is not null then
    v_checks := v_checks || jsonb_build_object(
      'key', 'total_saidas',
      'label', 'Total das saídas = saídas, exceto desconto',
      'expected', v_out_calc, 'found', v_rep_sai,
      'ok', abs(v_rep_sai - v_out_calc) <= v_tol);
  end if;

  if v_rep_gav is not null then
    v_checks := v_checks || jsonb_build_object(
      'key', 'troco_gaveta',
      'label', 'Troco na gaveta = entrada de troco + dinheiro − saídas',
      'expected', v_change_in + v_cash - v_out_total, 'found', v_rep_gav,
      'ok', abs(v_rep_gav - (v_change_in + v_cash - v_out_total)) <= v_tol);
  end if;

  select bool_and((c->>'ok')::boolean) into v_ok from jsonb_array_elements(v_checks) c;

  if not v_title then
    v_warn := v_warn || 'O cabeçalho "RELATORIO DE CAIXA" não apareceu — confira se o arquivo é o relatório certo.'::text;
  end if;
  if v_ops is null then
    v_warn := v_warn || 'O total de operações de caixa não apareceu no relatório.'::text;
  end if;
  if v_close - v_open > interval '24 hours' then
    v_warn := v_warn || 'O caixa ficou aberto por mais de 24 horas.'::text;
  end if;

  return jsonb_build_object(
    'ok', true,
    'errors', '[]'::jsonb,
    'warnings', to_jsonb(v_warn),
    'business_date', ((v_open at time zone _tz)::date),
    'opened_at', v_open,
    'closed_at', v_close,
    'change_in', v_change_in,
    'receipts_total', v_receipts,
    'tenders_total', v_tenders,
    'cash_total', v_cash,
    'non_cash_total', v_non_cash,
    'change_out', v_change_out,
    'discount_total', v_discount,
    'outflows_total', v_out_total,
    'drawer_balance', v_drawer,
    'operations_count', v_ops,
    'payments', v_pay,
    'entries', v_entries,
    'outflows', v_outs,
    'others', v_others,
    'checks', v_checks,
    'check_ok', coalesce(v_ok, true),
    'clean_text', v_text,
    'content_hash', encode(sha256(convert_to(v_text, 'UTF8')), 'hex')
  );
end $$;

-- ---------------------------------------------------------------------
-- TABELAS
-- ---------------------------------------------------------------------
create table if not exists public.cash_payment_methods (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  code        text not null,                 -- rótulo impresso, normalizado
  label       text not null,                 -- como aparece na tela
  kind        text not null check (kind in ('dinheiro','pix','debito','credito','voucher',
                                             'boleto','transferencia','cheque','crediario','outros')),
  acquirer    text,                          -- maquininha / adquirente
  sort_order  smallint not null default 90,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, code)
);

create table if not exists public.cash_closings (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  business_date    date not null,                              -- dia da abertura, no fuso da empresa
  opened_at        timestamptz not null,
  closed_at        timestamptz not null,
  change_in        numeric(14,2) not null default 0,           -- ENTRADA DE TROCO
  receipts_total   numeric(14,2) not null default 0,           -- PAGTO DE PEDIDOS
  tenders_total    numeric(14,2) not null default 0,           -- soma das formas de pagamento
  cash_total       numeric(14,2) not null default 0,           -- DINHEIRO
  non_cash_total   numeric(14,2) not null default 0,           -- TOTAL EM TITULOS
  change_out       numeric(14,2) not null default 0,           -- SAIDA DE TROCO
  discount_total   numeric(14,2) not null default 0,           -- DESCONTO DO CAIXA
  outflows_total   numeric(14,2) not null default 0,           -- TOTAL DAS SAIDAS
  drawer_balance   numeric(14,2) not null default 0,           -- TROCO NA GAVETA
  operations_count integer check (operations_count >= 0),
  check_ok         boolean not null default true,
  checks           jsonb not null default '[]'::jsonb,
  lines            jsonb not null default '{}'::jsonb,         -- entradas, saídas e outras linhas lidas
  warnings         jsonb not null default '[]'::jsonb,
  raw_text         text not null,
  content_hash     text not null,
  source_filename  text,
  uploaded_by      uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  cancelled_at     timestamptz,
  cancelled_by     uuid references public.users(id) on delete set null,
  cancel_reason    text,
  constraint cash_closing_period_ok check (closed_at >= opened_at),
  constraint cash_closing_cancel_ok check (
    (cancelled_at is null and cancel_reason is null)
    or (cancelled_at is not null and length(btrim(cancel_reason)) >= 5))
);

-- a sessão do caixa é a identidade do fechamento
create unique index if not exists cash_closings_session_uk
  on public.cash_closings (company_id, opened_at, closed_at) where cancelled_at is null;
create index if not exists cash_closings_date_ix
  on public.cash_closings (company_id, business_date desc);

create table if not exists public.cash_closing_payments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  closing_id  uuid not null references public.cash_closings(id) on delete cascade,
  method_id   uuid not null references public.cash_payment_methods(id) on delete restrict,
  amount      numeric(14,2) not null,
  position    smallint not null,
  unique (closing_id, method_id)
);
create index if not exists cash_payments_closing_ix on public.cash_closing_payments (closing_id);
create index if not exists cash_payments_method_ix on public.cash_closing_payments (company_id, method_id);

drop trigger if exists trg_cash_methods_touch on public.cash_payment_methods;
create trigger trg_cash_methods_touch before update on public.cash_payment_methods
for each row execute function app.touch_updated_at();

drop trigger if exists trg_cash_closings_touch on public.cash_closings;
create trigger trg_cash_closings_touch before update on public.cash_closings
for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------
-- Permissões do módulo
-- ---------------------------------------------------------------------
insert into public.permissions (module, action, label)
select 'cash', a.action, 'Fechamento de caixa — ' || a.action
from unnest(array['view','create','delete','export']) as a(action)
on conflict (module, action) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.company_id is null and p.module = 'cash'
  and (r.slug = 'administrador'
       or (r.slug = 'financeiro' and p.action in ('view','create','export'))
       or (r.slug = 'diretoria'  and p.action in ('view','export')))
on conflict do nothing;

-- ---------------------------------------------------------------------
-- RLS — só leitura para o cliente. Toda escrita passa pelas funções
-- abaixo, que conferem permissão e leem o relatório no próprio banco.
-- ---------------------------------------------------------------------
alter table public.cash_payment_methods  enable row level security;
alter table public.cash_closings         enable row level security;
alter table public.cash_closing_payments enable row level security;

drop policy if exists cash_methods_select on public.cash_payment_methods;
create policy cash_methods_select on public.cash_payment_methods for select to authenticated
using (app.has_permission(company_id, 'cash', 'view'));

drop policy if exists cash_closings_select on public.cash_closings;
create policy cash_closings_select on public.cash_closings for select to authenticated
using (app.has_permission(company_id, 'cash', 'view'));

drop policy if exists cash_payments_select on public.cash_closing_payments;
create policy cash_payments_select on public.cash_closing_payments for select to authenticated
using (app.has_permission(company_id, 'cash', 'view'));

-- ---------------------------------------------------------------------
-- PRÉVIA — lê o relatório e diz o que aconteceria, sem gravar nada.
-- ---------------------------------------------------------------------
create or replace function app.preview_cash_report(_company_id uuid, _raw text)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v    jsonb;
  v_tz text;
  dup  record;
  pays jsonb;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  if not app.has_permission(_company_id, 'cash', 'create') then
    raise exception 'Sem permissão para importar fechamentos de caixa.' using errcode = '42501';
  end if;
  if length(coalesce(_raw, '')) > 65536 then
    return jsonb_build_object('ok', false, 'warnings', '[]'::jsonb,
      'errors', jsonb_build_array('Arquivo grande demais para um relatório de caixa (limite de 64 KB).'));
  end if;

  select timezone into v_tz from public.companies where id = _company_id;
  v := app.parse_cash_report(_raw, coalesce(v_tz, 'America/Sao_Paulo'));
  if not (v->>'ok')::boolean then
    return v - 'clean_text';
  end if;

  if (v->>'closed_at')::timestamptz > now() + interval '1 day' then
    v := jsonb_set(v, '{warnings}', (v->'warnings') || '"A data do relatório está no futuro — confira o relógio do PDV."'::jsonb);
  end if;

  -- rótulo e tipo de cada forma: o cadastro existente manda; senão, o palpite
  select coalesce(jsonb_agg(p || jsonb_build_object(
           'label', coalesce(m.label, i->>'label'),
           'kind', coalesce(m.kind, i->>'kind'),
           'acquirer', case when m.id is not null then m.acquirer else i->>'acquirer' end)
         order by (p->>'position')::int), '[]')
    into pays
    from jsonb_array_elements(v->'payments') p
    cross join lateral (select app.cash_method_info(p->>'code') as i) x
    left join public.cash_payment_methods m on m.company_id = _company_id and m.code = p->>'code';

  select c.id, c.created_at, u.full_name
    into dup
    from public.cash_closings c
    left join public.users u on u.id = c.uploaded_by
   where c.company_id = _company_id
     and c.opened_at = (v->>'opened_at')::timestamptz
     and c.closed_at = (v->>'closed_at')::timestamptz
     and c.cancelled_at is null
   limit 1;

  v := jsonb_set(v, '{payments}', pays);
  v := v - 'clean_text' - 'entries' - 'outflows' - 'others' - 'content_hash';
  if dup.id is not null then
    v := v || jsonb_build_object('duplicate', jsonb_build_object(
      'id', dup.id, 'created_at', dup.created_at, 'uploaded_by', dup.full_name));
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- REGISTRO — relê o texto (a prévia nunca é confiada) e grava tudo numa
-- transação: fechamento, formas de pagamento e cadastro de formas novas.
-- ---------------------------------------------------------------------
create or replace function app.register_cash_closing(_company_id uuid, _raw text, _filename text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v     jsonb;
  v_tz  text;
  v_id  uuid;
  dup   record;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  if not app.has_permission(_company_id, 'cash', 'create') then
    raise exception 'Sem permissão para importar fechamentos de caixa.' using errcode = '42501';
  end if;
  if length(coalesce(_raw, '')) > 65536 then
    return jsonb_build_object('status', 'erro',
      'errors', jsonb_build_array('Arquivo grande demais para um relatório de caixa (limite de 64 KB).'));
  end if;

  select timezone into v_tz from public.companies where id = _company_id;
  v := app.parse_cash_report(_raw, coalesce(v_tz, 'America/Sao_Paulo'));
  if not (v->>'ok')::boolean then
    return jsonb_build_object('status', 'erro', 'errors', v->'errors');
  end if;

  select c.id, c.created_at, u.full_name into dup
    from public.cash_closings c
    left join public.users u on u.id = c.uploaded_by
   where c.company_id = _company_id
     and c.opened_at = (v->>'opened_at')::timestamptz
     and c.closed_at = (v->>'closed_at')::timestamptz
     and c.cancelled_at is null
   limit 1;
  if dup.id is not null then
    return jsonb_build_object('status', 'duplicado', 'id', dup.id,
                              'created_at', dup.created_at, 'uploaded_by', dup.full_name);
  end if;

  -- formas de pagamento novas entram no cadastro com o palpite de tipo
  insert into public.cash_payment_methods (company_id, code, label, kind, acquirer, sort_order)
  select _company_id, i->>'code', i->>'label', i->>'kind', i->>'acquirer', (i->>'sort')::smallint
    from jsonb_array_elements(v->'payments') p
   cross join lateral (select app.cash_method_info(p->>'code') as i) x
  on conflict (company_id, code) do nothing;

  begin
    insert into public.cash_closings (
      company_id, business_date, opened_at, closed_at,
      change_in, receipts_total, tenders_total, cash_total, non_cash_total,
      change_out, discount_total, outflows_total, drawer_balance, operations_count,
      check_ok, checks, lines, warnings, raw_text, content_hash, source_filename, uploaded_by)
    values (
      _company_id, (v->>'business_date')::date,
      (v->>'opened_at')::timestamptz, (v->>'closed_at')::timestamptz,
      (v->>'change_in')::numeric, (v->>'receipts_total')::numeric, (v->>'tenders_total')::numeric,
      (v->>'cash_total')::numeric, (v->>'non_cash_total')::numeric,
      (v->>'change_out')::numeric, (v->>'discount_total')::numeric, (v->>'outflows_total')::numeric,
      (v->>'drawer_balance')::numeric, (v->>'operations_count')::int,
      (v->>'check_ok')::boolean, v->'checks',
      jsonb_build_object('entries', v->'entries', 'outflows', v->'outflows', 'others', v->'others'),
      v->'warnings', v->>'clean_text', v->>'content_hash',
      left(nullif(btrim(coalesce(_filename, '')), ''), 200), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    -- outro envio do mesmo relatório chegou primeiro
    select c.id, c.created_at, u.full_name into dup
      from public.cash_closings c left join public.users u on u.id = c.uploaded_by
     where c.company_id = _company_id
       and c.opened_at = (v->>'opened_at')::timestamptz
       and c.closed_at = (v->>'closed_at')::timestamptz
       and c.cancelled_at is null
     limit 1;
    return jsonb_build_object('status', 'duplicado', 'id', dup.id,
                              'created_at', dup.created_at, 'uploaded_by', dup.full_name);
  end;

  insert into public.cash_closing_payments (company_id, closing_id, method_id, amount, position)
  select _company_id, v_id, m.id, (p->>'amount')::numeric, (p->>'position')::smallint
    from jsonb_array_elements(v->'payments') p
    join public.cash_payment_methods m on m.company_id = _company_id and m.code = p->>'code';

  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, auth.uid(), 'created', 'cash_closing', v_id,
          format('Fechamento de caixa de %s importado — R$ %s em pedidos%s',
                 to_char((v->>'business_date')::date, 'DD/MM/YYYY'),
                 -- ',' e '.' fixos (não dependem do locale); depois troca para o padrão BR
                 translate(to_char((v->>'receipts_total')::numeric, 'FM999,999,999,990.00'), ',.', '.,'),
                 case when (v->>'check_ok')::boolean then '' else ' (com divergência na conferência)' end),
          '/financeiro/caixa/' || v_id);

  return jsonb_build_object('status', 'registrado', 'id', v_id,
                            'business_date', v->'business_date', 'check_ok', v->'check_ok');
end $$;

-- ---------------------------------------------------------------------
-- CANCELAMENTO — o registro fica, marcado, com motivo. Libera a sessão
-- para uma nova importação corrigida.
-- ---------------------------------------------------------------------
create or replace function app.cancel_cash_closing(_id uuid, _reason text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c record;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  select id, company_id, business_date, cancelled_at into c from public.cash_closings where id = _id;
  if c.id is null or not app.has_permission(c.company_id, 'cash', 'delete') then
    raise exception 'Sem permissão para cancelar este fechamento.' using errcode = '42501';
  end if;
  if c.cancelled_at is not null then
    raise exception 'Este fechamento já está cancelado.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(_reason, ''))) < 5 then
    raise exception 'Informe o motivo do cancelamento.' using errcode = '22023';
  end if;

  update public.cash_closings
     set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = btrim(_reason)
   where id = _id;

  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (c.company_id, auth.uid(), 'cancelled', 'cash_closing', c.id,
          format('Fechamento de caixa de %s cancelado: %s', to_char(c.business_date, 'DD/MM/YYYY'), btrim(_reason)),
          '/financeiro/caixa/' || c.id);
end $$;

-- ---------------------------------------------------------------------
-- BUSCA com filtros — roda com a permissão de quem consulta (RLS vale).
--   _method: null = todas; 'kind:credito' = um tipo; 'CREDITO REDE' = uma forma.
--   _min/_max aplicam-se ao total do dia (pedidos pagos) ou, com uma
--   modalidade escolhida, ao valor daquela modalidade.
-- ---------------------------------------------------------------------
create or replace function public.search_cash_closings(
  _company_id uuid,
  _from date default null,
  _to date default null,
  _method text default null,
  _min numeric default null,
  _max numeric default null,
  _include_cancelled boolean default false,
  _limit int default 1000
)
returns table (
  id uuid, business_date date, opened_at timestamptz, closed_at timestamptz,
  change_in numeric, receipts_total numeric, tenders_total numeric, cash_total numeric,
  non_cash_total numeric, change_out numeric, discount_total numeric, outflows_total numeric,
  drawer_balance numeric, operations_count int, check_ok boolean,
  cancelled_at timestamptz, source_filename text, created_at timestamptz,
  selected_amount numeric, payments jsonb
)
language sql stable security invoker set search_path = public, pg_temp as $$
  with base as (
    select c.*,
      coalesce((
        select jsonb_agg(jsonb_build_object('code', m.code, 'label', m.label, 'kind', m.kind,
                                            'acquirer', m.acquirer, 'amount', p.amount)
                         order by m.sort_order, m.label)
          from public.cash_closing_payments p
          join public.cash_payment_methods m on m.id = p.method_id
         where p.closing_id = c.id), '[]'::jsonb) as pays,
      case when coalesce(_method, '') = '' then c.receipts_total
           else (select coalesce(sum(p.amount), 0)
                   from public.cash_closing_payments p
                   join public.cash_payment_methods m on m.id = p.method_id
                  where p.closing_id = c.id
                    and case when _method like 'kind:%' then m.kind = substr(_method, 6)
                             else m.code = _method end)
      end as sel
    from public.cash_closings c
    where c.company_id = _company_id
      and (_from is null or c.business_date >= _from)
      and (_to is null or c.business_date <= _to)
      and (_include_cancelled or c.cancelled_at is null)
  )
  select b.id, b.business_date, b.opened_at, b.closed_at,
         b.change_in, b.receipts_total, b.tenders_total, b.cash_total,
         b.non_cash_total, b.change_out, b.discount_total, b.outflows_total,
         b.drawer_balance, b.operations_count, b.check_ok,
         b.cancelled_at, b.source_filename, b.created_at,
         b.sel, b.pays
    from base b
   where (coalesce(_method, '') = '' or b.sel <> 0)
     and (_min is null or b.sel >= _min)
     and (_max is null or b.sel <= _max)
   order by b.business_date desc, b.opened_at desc
   limit greatest(1, least(coalesce(_limit, 1000), 5000));
$$;

-- ---------------------------------------------------------------------
-- Superfície pública (PostgREST só expõe public). anon não chama nada.
-- ---------------------------------------------------------------------
create or replace function public.preview_cash_report(_company_id uuid, _raw text)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select app.preview_cash_report(_company_id, _raw);
$$;

create or replace function public.register_cash_closing(_company_id uuid, _raw text, _filename text default null)
returns jsonb language sql security invoker set search_path = public, pg_temp as $$
  select app.register_cash_closing(_company_id, _raw, _filename);
$$;

create or replace function public.cancel_cash_closing(_id uuid, _reason text)
returns void language sql security invoker set search_path = public, pg_temp as $$
  select app.cancel_cash_closing(_id, _reason);
$$;

revoke execute on function
  app.parse_cash_report(text, text),
  app.preview_cash_report(uuid, text),
  app.register_cash_closing(uuid, text, text),
  app.cancel_cash_closing(uuid, text)
from public, anon;

grant execute on function
  app.cash_norm(text), app.cash_method_info(text), app.parse_cash_report(text, text),
  app.preview_cash_report(uuid, text), app.register_cash_closing(uuid, text, text),
  app.cancel_cash_closing(uuid, text)
to authenticated;

revoke execute on function
  public.preview_cash_report(uuid, text),
  public.register_cash_closing(uuid, text, text),
  public.cancel_cash_closing(uuid, text),
  public.search_cash_closings(uuid, date, date, text, numeric, numeric, boolean, int)
from public, anon;

grant execute on function
  public.preview_cash_report(uuid, text),
  public.register_cash_closing(uuid, text, text),
  public.cancel_cash_closing(uuid, text),
  public.search_cash_closings(uuid, date, date, text, numeric, numeric, boolean, int)
to authenticated;

-- ---------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['cash_closings','cash_payment_methods'] loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$I', t);
    execute format(
      'create trigger trg_audit_%1$s after insert or update or delete on public.%1$I
       for each row execute function app.audit()', t);
  end loop;
end $$;
