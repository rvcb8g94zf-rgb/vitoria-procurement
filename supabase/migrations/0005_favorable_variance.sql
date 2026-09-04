-- =====================================================================
-- Vitória Procurement — Fase 1 / Migração 0005
-- Decisão: NF-e com preço ABAIXO do pedido é desconto aceito, não
-- divergência. A tolerância deixa de ser simétrica.
--
-- Escopo da regra:
--   preço e total  → variação favorável (menor) é aceita
--   quantidade     → continua simétrica; receber menos é falta de
--                    entrega, tratada pelo recebimento parcial
-- =====================================================================

alter table public.company_settings
  add column if not exists accept_favorable_variance boolean not null default true,
  add column if not exists favorable_review_pct numeric(6,3) not null default 20.000
    check (favorable_review_pct >= 0);

comment on column public.company_settings.accept_favorable_variance is
  'true = NF-e mais barata que o pedido não gera divergência.';
comment on column public.company_settings.favorable_review_pct is
  'Desconto acima deste percentual é sinalizado para conferência: costuma indicar unidade ou produto trocado, não negociação.';

-- ---------------------------------------------------------------------
-- Motor de tolerância — agora direcional
-- ---------------------------------------------------------------------
create or replace function app.within_tolerance(
  _company_id uuid,
  _expected   numeric,
  _actual     numeric,
  _kind       text default 'price'   -- 'price' | 'total' | 'quantity'
)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  s      public.company_settings%rowtype;
  v_pct  numeric;
  v_abs  numeric;
  v_diff numeric;
  ok_pct boolean;
  ok_abs boolean;
begin
  if _expected is null or _actual is null then
    return false;
  end if;

  select * into s from public.company_settings where company_id = _company_id;
  if not found then
    return _expected = _actual;
  end if;

  -- variação favorável: pagamos menos do que o pedido previa
  if s.accept_favorable_variance
     and _kind in ('price','total')
     and _actual < _expected then
    return true;
  end if;

  v_pct := case _kind when 'price' then s.price_tol_pct
                      when 'total' then s.total_tol_pct
                      else s.quantity_tol_pct end;
  v_abs := case _kind when 'price' then s.price_tol_abs
                      when 'total' then s.total_tol_abs
                      else s.quantity_tol_abs end;

  v_diff := abs(_actual - _expected);
  ok_abs := v_diff <= v_abs;
  ok_pct := case when _expected = 0 then v_diff = 0
                 else v_diff <= abs(_expected) * v_pct / 100 end;

  return case s.tolerance_rule
           when 'either' then ok_pct or ok_abs
           else               ok_pct and ok_abs
         end;
end $$;

-- ---------------------------------------------------------------------
-- Relatório classificado — alimenta o módulo de divergências
--   ok                → dentro da faixa de tolerância
--   desconto          → mais barato, aceito sem ressalva
--   desconto_atipico  → mais barato além do limite de revisão: aceito,
--                       mas sinalizado (unidade ou produto trocado?)
--   divergencia       → fora da tolerância
-- ---------------------------------------------------------------------
create or replace function app.tolerance_report(
  _company_id uuid, _expected numeric, _actual numeric, _kind text default 'price'
)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  s        public.company_settings%rowtype;
  v_diff   numeric;
  v_pct    numeric;
  v_dir    text;
  v_ok     boolean;
  v_class  text;
begin
  select * into s from public.company_settings where company_id = _company_id;

  v_diff := round(coalesce(_actual,0) - coalesce(_expected,0), 4);
  v_pct  := case when coalesce(_expected,0) = 0 then null
                 else round(v_diff / _expected * 100, 4) end;
  v_dir  := case when v_diff = 0 then 'exata'
                 when v_diff < 0 then 'favoravel'
                 else 'desfavoravel' end;

  v_ok := app.within_tolerance(_company_id, _expected, _actual, _kind);

  if v_dir = 'favoravel'
     and _kind in ('price','total')
     and coalesce(s.accept_favorable_variance, false) then
    v_class := case
      when v_pct is not null and abs(v_pct) > coalesce(s.favorable_review_pct, 20)
        then 'desconto_atipico'
      else 'desconto'
    end;
  elsif v_ok then
    v_class := 'ok';
  else
    v_class := 'divergencia';
  end if;

  return jsonb_build_object(
    'kind',       _kind,
    'expected',   _expected,
    'actual',     _actual,
    'diff',       v_diff,
    'diff_pct',   v_pct,
    'direction',  v_dir,
    'tolerated',  v_ok,
    'blocking',   v_class = 'divergencia',
    'class',      v_class
  );
end $$;

grant execute on function
  app.within_tolerance(uuid, numeric, numeric, text),
  app.tolerance_report(uuid, numeric, numeric, text)
to authenticated;
