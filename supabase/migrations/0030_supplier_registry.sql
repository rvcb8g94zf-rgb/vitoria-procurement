-- 0030_supplier_registry.sql
-- Fornecedor completo pela Receita Federal (CNPJ).
--
-- O resumo da NF-e que a SEFAZ entrega (resNFe) só traz CNPJ, razão social e
-- IE — não tem endereço, telefone nem e-mail. O XML completo só é liberado
-- depois da Ciência da Operação (feita pela contabilidade). Para não esperar,
-- o sistema consulta o CNPJ na base pública da Receita (BrasilAPI, com a
-- CNPJ.ws de reserva) e preenche o que estiver vazio. Nada que alguém já
-- digitou é sobrescrito; os dados da Receita (situação, CNAE, porte,
-- Simples) ficam em colunas próprias.
--
-- A consulta HTTP é feita pelo servidor da aplicação (o banco não sai para a
-- internet); aqui ficam só as regras de gravação.

alter table public.suppliers
  add column if not exists registry_status      text,        -- ATIVA, BAIXADA, INAPTA, SUSPENSA, NULA
  add column if not exists registry_status_date date,
  add column if not exists cnae_code            text,
  add column if not exists cnae_desc            text,
  add column if not exists company_size         text,        -- porte
  add column if not exists simples_opt          boolean,
  add column if not exists mei_opt              boolean,
  add column if not exists registry_checked_at  timestamptz,
  add column if not exists registry_source      text,
  add column if not exists registry_error       text;

-- quem pode gravar: o servidor (chave de serviço) ou quem edita fornecedores
create or replace function app.can_write_registry(_company_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') = 'service_role'
      or app.has_permission(_company_id, 'suppliers', 'edit');
$$;

-- _d: {razao_social, nome_fantasia, cep, logradouro, numero, complemento, bairro,
--      municipio, uf, telefone, email, situacao, data_situacao, cnae, cnae_descricao,
--      porte, simples, mei}   (campos já normalizados pela aplicação)
-- _erro: preenchido quando a consulta falhou (a tentativa fica registrada)
create or replace function app.apply_supplier_registry(
  _company_id uuid, _supplier_id uuid, _d jsonb, _fonte text, _erro text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  s        record;
  v_campos text[] := '{}';
  v_uf     text;
  v_cep    text;
  v_tel    text;
begin
  if not app.can_write_registry(_company_id) then
    raise exception 'Sem permissão para atualizar fornecedores.' using errcode = '42501';
  end if;
  select * into s from public.suppliers where id = _supplier_id and company_id = _company_id and deleted_at is null for update;
  if s.id is null then raise exception 'Fornecedor não encontrado.' using errcode = 'P0002'; end if;

  if _erro is not null then
    update public.suppliers set registry_checked_at = now(), registry_error = left(_erro, 300), registry_source = _fonte
     where id = _supplier_id;
    return jsonb_build_object('ok', false, 'erro', _erro);
  end if;

  v_uf  := nullif(upper(left(btrim(coalesce(_d->>'uf', '')), 2)), '');
  v_cep := nullif(regexp_replace(coalesce(_d->>'cep', ''), '\D', '', 'g'), '');
  v_tel := nullif(regexp_replace(coalesce(_d->>'telefone', ''), '\D', '', 'g'), '');
  if v_cep is not null and length(v_cep) <> 8 then v_cep := null; end if;
  if v_tel is not null and length(v_tel) not between 10 and 11 then v_tel := null; end if;

  if s.trade_name is null and nullif(btrim(coalesce(_d->>'nome_fantasia', '')), '') is not null then v_campos := v_campos || 'nome fantasia'::text; end if;
  if s.zip_code is null and v_cep is not null then v_campos := v_campos || 'CEP'::text; end if;
  if s.street is null and nullif(btrim(coalesce(_d->>'logradouro', '')), '') is not null then v_campos := v_campos || 'endereço'::text; end if;
  if s.city is null and nullif(btrim(coalesce(_d->>'municipio', '')), '') is not null then v_campos := v_campos || 'cidade'::text; end if;
  if s.phone is null and v_tel is not null then v_campos := v_campos || 'telefone'::text; end if;
  if s.email is null and coalesce(_d->>'email', '') ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_campos := v_campos || 'e-mail'::text; end if;

  update public.suppliers set
    trade_name    = coalesce(trade_name, nullif(left(btrim(coalesce(_d->>'nome_fantasia', '')), 120), '')),
    zip_code      = coalesce(zip_code, v_cep),
    street        = coalesce(street, nullif(left(btrim(coalesce(_d->>'logradouro', '')), 160), '')),
    street_number = case when street is null then coalesce(street_number, nullif(left(btrim(coalesce(_d->>'numero', '')), 20), '')) else street_number end,
    complement    = case when street is null then coalesce(complement, nullif(left(btrim(coalesce(_d->>'complemento', '')), 80), '')) else complement end,
    district      = coalesce(district, nullif(left(btrim(coalesce(_d->>'bairro', '')), 80), '')),
    city          = coalesce(city, nullif(left(btrim(coalesce(_d->>'municipio', '')), 80), '')),
    state_uf      = coalesce(state_uf, v_uf),
    phone         = coalesce(phone, v_tel),
    email         = coalesce(email, case when coalesce(_d->>'email', '') ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then lower(left(btrim(_d->>'email'), 160)) end),
    registry_status      = nullif(upper(btrim(coalesce(_d->>'situacao', ''))), ''),
    registry_status_date = nullif(_d->>'data_situacao', '')::date,
    cnae_code            = nullif(regexp_replace(coalesce(_d->>'cnae', ''), '\D', '', 'g'), ''),
    cnae_desc            = nullif(left(btrim(coalesce(_d->>'cnae_descricao', '')), 200), ''),
    company_size         = nullif(left(btrim(coalesce(_d->>'porte', '')), 60), ''),
    simples_opt          = (_d->>'simples')::boolean,
    mei_opt              = (_d->>'mei')::boolean,
    registry_checked_at  = now(),
    registry_source      = _fonte,
    registry_error       = null
  where id = _supplier_id;

  if array_length(v_campos, 1) > 0 then
    insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
    values (_company_id, auth.uid(), 'updated', 'supplier', _supplier_id,
            format('Fornecedor %s completado pela Receita: %s', coalesce(s.trade_name, s.legal_name), array_to_string(v_campos, ', ')),
            '/interno/cadastros/fornecedores/' || _supplier_id);
  end if;
  return jsonb_build_object('ok', true, 'campos', to_jsonb(v_campos),
                            'situacao', nullif(upper(btrim(coalesce(_d->>'situacao', ''))), ''));
end $fn$;

-- fila: CNPJ nunca consultado (ou há mais de 90 dias, ou que falhou há mais de 1 dia)
create or replace function app.suppliers_to_enrich(_company_id uuid, _limit int default 10)
returns table (id uuid, doc_number text)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id, regexp_replace(s.doc_number, '\D', '', 'g')
    from public.suppliers s
   where s.company_id = _company_id and s.deleted_at is null and s.doc_type = 'cnpj'
     and length(regexp_replace(s.doc_number, '\D', '', 'g')) = 14
     and s.status in ('ativo', 'pendente')
     and app.can_write_registry(_company_id)
     and (s.registry_checked_at is null
          or (s.registry_error is null and s.registry_checked_at < now() - interval '90 days')
          or (s.registry_error is not null and s.registry_checked_at < now() - interval '1 day'))
   order by (s.registry_checked_at is null) desc, s.status = 'pendente' desc, s.created_at desc
   limit greatest(1, least(coalesce(_limit, 10), 50));
$$;

-- o servidor chama estas funções com a chave de serviço
grant usage on schema app to service_role;

revoke all on function app.can_write_registry(uuid), app.apply_supplier_registry(uuid, uuid, jsonb, text, text),
  app.suppliers_to_enrich(uuid, int) from public, anon;
grant execute on function app.can_write_registry(uuid), app.apply_supplier_registry(uuid, uuid, jsonb, text, text),
  app.suppliers_to_enrich(uuid, int) to authenticated, service_role;

create or replace function public.apply_supplier_registry(_company_id uuid, _supplier_id uuid, _d jsonb, _fonte text, _erro text default null)
returns jsonb language sql security invoker set search_path = public, pg_temp as $$
  select app.apply_supplier_registry(_company_id, _supplier_id, _d, _fonte, _erro); $$;
create or replace function public.suppliers_to_enrich(_company_id uuid, _limit int default 10)
returns table (id uuid, doc_number text) language sql stable security invoker set search_path = public, pg_temp as $$
  select * from app.suppliers_to_enrich(_company_id, _limit); $$;

revoke all on function public.apply_supplier_registry(uuid, uuid, jsonb, text, text), public.suppliers_to_enrich(uuid, int) from public, anon;
grant execute on function public.apply_supplier_registry(uuid, uuid, jsonb, text, text), public.suppliers_to_enrich(uuid, int) to authenticated, service_role;
