-- =====================================================================
-- Vitória Procurement — Fase 1 / Migração 0007
-- Cadastro de novas empresas em operação + validação de CNPJ.
--
-- Lacuna fechada: a permissão 'companies.create' existia no catálogo
-- mas nenhuma política a consultava — só superadmin conseguia abrir
-- empresa. Agora o cadastro passa por app.create_company(), que valida
-- a permissão e vincula o autor como administrador na mesma transação.
-- =====================================================================

create or replace function app.cnpj_digits(_cnpj text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(coalesce(_cnpj,''), '\D', '', 'g');
$$;

create or replace function app.is_valid_cnpj(_cnpj text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  d text; s int; i int; w int; dv1 int; dv2 int;
begin
  d := regexp_replace(coalesce(_cnpj,''), '\D', '', 'g');
  if length(d) <> 14 then return false; end if;
  if d ~ '^(\d)\1{13}$' then return false; end if;   -- 00000000000000 e afins

  s := 0; w := 5;
  for i in 1..12 loop
    s := s + substr(d,i,1)::int * w;
    w := case when w = 2 then 9 else w - 1 end;
  end loop;
  dv1 := 11 - (s % 11);
  if dv1 >= 10 then dv1 := 0; end if;

  s := 0; w := 6;
  for i in 1..13 loop
    s := s + substr(d,i,1)::int * w;
    w := case when w = 2 then 9 else w - 1 end;
  end loop;
  dv2 := 11 - (s % 11);
  if dv2 >= 10 then dv2 := 0; end if;

  return dv1 = substr(d,13,1)::int and dv2 = substr(d,14,1)::int;
end $$;

alter table public.companies drop constraint if exists companies_cnpj_valid;
alter table public.companies add constraint companies_cnpj_valid check (app.is_valid_cnpj(cnpj));

create or replace function app.can_create_company()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select app.is_superadmin()
      or exists (
        select 1 from unnest(app.current_company_ids()) c(id)
         where app.has_permission(c.id, 'companies', 'create')
      );
$$;

create or replace function app.provision_company(
  _legal_name text, _cnpj text, _trade_name text, _owner_id uuid
)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid;
  v_role    uuid;
begin
  if not app.is_valid_cnpj(_cnpj) then
    raise exception 'CNPJ inválido: %', _cnpj using errcode = 'check_violation';
  end if;

  insert into public.companies (legal_name, trade_name, cnpj)
  values (_legal_name, coalesce(nullif(_trade_name,''), _legal_name), app.cnpj_digits(_cnpj))
  returning id into v_company;

  select id into v_role from public.roles
   where slug = 'administrador' and company_id is null;

  insert into public.user_companies (user_id, company_id, role_id, is_default)
  values (_owner_id, v_company, v_role,
          not exists (select 1 from public.user_companies where user_id = _owner_id))
  on conflict (user_id, company_id) do update set role_id = excluded.role_id;

  insert into public.departments (company_id, code, name)
  values (v_company, 'ADM', 'Administrativo'), (v_company, 'OPE', 'Operações')
  on conflict do nothing;

  insert into public.cost_centers (company_id, code, name)
  values (v_company, '1000', 'Administrativo'), (v_company, '2000', 'Operacional')
  on conflict do nothing;

  return v_company;
end $$;

revoke execute on function app.provision_company(text, text, text, uuid) from public, authenticated;

-- Chamada da aplicação. Atômico de propósito: empresa criada sem
-- vínculo ficaria invisível para todo mundo, inclusive para o autor.
create or replace function app.create_company(
  _legal_name text, _cnpj text, _trade_name text default null
)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_company uuid;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  if not app.can_create_company() then
    raise exception 'Sem permissão para cadastrar empresas.' using errcode = '42501';
  end if;

  v_company := app.provision_company(_legal_name, _cnpj, _trade_name, auth.uid());

  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary)
  values (v_company, auth.uid(), 'created', 'company', v_company,
          'Empresa ' || _legal_name || ' cadastrada no sistema');

  return v_company;
end $$;

grant execute on function app.create_company(text, text, text) to authenticated;

-- Primeiro acesso: só roda enquanto não existe nenhuma empresa.
create or replace function app.bootstrap_company(
  _legal_name text, _cnpj text, _trade_name text default null, _owner_id uuid default auth.uid()
)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_first boolean;
begin
  select not exists (select 1 from public.companies) into v_first;

  if not (v_first or app.is_superadmin()) then
    raise exception 'Sem permissão para criar empresas.' using errcode = '42501';
  end if;
  if _owner_id is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;

  if v_first then
    update public.users set is_superadmin = true where id = _owner_id;
  end if;

  return app.provision_company(_legal_name, _cnpj, _trade_name, _owner_id);
end $$;

grant execute on function app.bootstrap_company(text, text, text, uuid) to authenticated;
grant execute on function app.can_create_company() to authenticated;
grant execute on function app.is_valid_cnpj(text), app.cnpj_digits(text) to authenticated;
