-- =====================================================================
-- 0016_user_admin.sql — gestão de usuários dentro do sistema
--
-- Criar pessoa com senha provisória, dar e retirar acesso a uma empresa,
-- trocar o perfil e redefinir senha — tudo pela tela de Usuários.
--
-- Por que no banco e não pela Admin API do Supabase: a Admin API exige a
-- chave de serviço, que não pode passar pelo navegador. Aqui a função roda
-- com security definer, confere a permissão de quem pediu e grava apenas o
-- hash bcrypt da senha. A senha em texto não fica guardada em lugar nenhum.
--
-- Quem cria a senha é o administrador; a pessoa é obrigada a trocá-la no
-- primeiro acesso (must_change_password). Quando houver e-mail configurado
-- (SMTP), dá para trocar isso por convite e "esqueci minha senha".
-- =====================================================================

alter table public.users
  add column if not exists must_change_password boolean not null default false;

comment on column public.users.must_change_password is
  'Senha definida por um administrador: a pessoa é obrigada a trocar no primeiro acesso.';

-- ---------------------------------------------------------------------
-- Validações
-- ---------------------------------------------------------------------
create or replace function app.valid_email(_email text)
returns boolean language sql immutable as $$
  select coalesce(_email, '') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$';
$$;

create or replace function app.check_password(_password text)
returns void language plpgsql immutable as $$
begin
  if length(coalesce(_password, '')) < 10 then
    raise exception 'A senha precisa ter pelo menos 10 caracteres.' using errcode = '22023';
  end if;
  if _password !~ '[A-Za-z]' or _password !~ '[0-9]' then
    raise exception 'A senha precisa misturar letras e números.' using errcode = '22023';
  end if;
end $$;

-- pgcrypto mora em "extensions" no Supabase e em "public" num Postgres
-- comum: descobre o schema em vez de fixar um, mantendo o search_path preso.
create or replace function app.hash_password(_password text)
returns text language plpgsql volatile security definer set search_path = pg_catalog, pg_temp as $$
declare v_schema text; v_hash text;
begin
  select n.nspname into v_schema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pgcrypto';
  if v_schema is null then
    raise exception 'A extensão pgcrypto não está instalada neste banco.' using errcode = '55000';
  end if;
  execute format('select %I.crypt($1, %I.gen_salt(''bf''))', v_schema, v_schema)
     into v_hash using _password;
  return v_hash;
end $$;

-- Perfil válido: global (company_id nulo) ou da própria empresa.
create or replace function app.role_allowed(_role_id uuid, _companies uuid[])
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.roles r
     where r.id = _role_id
       and (r.company_id is null or r.company_id = any(_companies))
  );
$$;

-- ---------------------------------------------------------------------
-- CRIAR / VINCULAR
-- Se o e-mail já existe, não mexe na senha: só dá acesso à empresa.
-- ---------------------------------------------------------------------
create or replace function app.create_company_user(
  _company_id uuid,
  _email      text,
  _full_name  text,
  _role_id    uuid,
  _password   text,
  _job_title  text default null,
  _phone      text default null,
  _companies  uuid[] default null      -- empresas extras, além da atual
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email   text := lower(btrim(coalesce(_email, '')));
  v_name    text := btrim(coalesce(_full_name, ''));
  v_id      uuid;
  v_status  text;
  v_role    text;
  v_alvos   uuid[];
  c         uuid;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;

  select array(select distinct x from unnest(array[_company_id] || coalesce(_companies, '{}'::uuid[])) as x
                where x is not null)
    into v_alvos;
  if array_length(v_alvos, 1) is null then
    raise exception 'Informe a empresa do novo usuário.' using errcode = '22023';
  end if;

  foreach c in array v_alvos loop
    if not app.has_permission(c, 'users', 'create') then
      raise exception 'Sem permissão para criar usuários nesta empresa.' using errcode = '42501';
    end if;
  end loop;

  if not app.valid_email(v_email) then
    raise exception 'E-mail inválido.' using errcode = '22023';
  end if;
  if length(v_name) < 3 then
    raise exception 'Informe o nome completo.' using errcode = '22023';
  end if;
  if not app.role_allowed(_role_id, v_alvos) then
    raise exception 'Perfil de acesso inválido.' using errcode = '22023';
  end if;

  select name into v_role from public.roles where id = _role_id;
  select u.id into v_id from auth.users u where lower(u.email) = v_email;

  if v_id is null then
    perform app.check_password(_password);
    v_id := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
      v_email, app.hash_password(_password), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', v_name),
      now(), now(), '', '', '', '', '', '', '', ''
    );

    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (v_id::text, v_id,
            jsonb_build_object('sub', v_id::text, 'email', v_email,
                               'email_verified', true, 'phone_verified', false),
            'email', now(), now());

    -- o gatilho app.handle_new_auth_user já criou o perfil; completa o cadastro
    update public.users
       set full_name = v_name,
           job_title = nullif(btrim(coalesce(_job_title, '')), ''),
           phone     = nullif(btrim(coalesce(_phone, '')), ''),
           must_change_password = true
     where id = v_id;

    v_status := 'criado';
  else
    if exists (select 1 from public.user_companies uc
                where uc.user_id = v_id and uc.company_id = any(v_alvos) and uc.is_active) then
      v_status := 'ja_tinha_acesso';
    else
      v_status := 'vinculado';
    end if;
    select full_name into v_name from public.users where id = v_id;
  end if;

  foreach c in array v_alvos loop
    insert into public.user_companies (user_id, company_id, role_id, is_default, is_active)
    values (v_id, c, _role_id,
            not exists (select 1 from public.user_companies x where x.user_id = v_id),
            true)
    on conflict (user_id, company_id) do update
       set role_id = excluded.role_id, is_active = true, updated_at = now();

    insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
    values (c, auth.uid(),
            case when v_status = 'criado' then 'created' else 'updated' end, 'user', v_id,
            case when v_status = 'criado'
                 then format('Usuário criado: %s (%s) com o perfil %s', v_name, v_email, v_role)
                 else format('Acesso concedido a %s (%s) com o perfil %s', v_name, v_email, v_role)
            end,
            '/admin/usuarios');
  end loop;

  return jsonb_build_object('status', v_status, 'user_id', v_id, 'email', v_email, 'full_name', v_name);
end $$;

-- ---------------------------------------------------------------------
-- TROCAR PERFIL
-- ---------------------------------------------------------------------
create or replace function app.set_user_role(_user_id uuid, _company_id uuid, _role_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_role text; v_nome text;
begin
  if not app.has_permission(_company_id, 'users', 'edit') then
    raise exception 'Sem permissão para alterar usuários nesta empresa.' using errcode = '42501';
  end if;
  if _user_id = auth.uid() then
    raise exception 'Você não pode alterar o próprio perfil de acesso.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.user_companies where user_id = _user_id and company_id = _company_id) then
    raise exception 'Este usuário não tem acesso a esta empresa.' using errcode = '22023';
  end if;
  if not app.role_allowed(_role_id, array[_company_id]) then
    raise exception 'Perfil de acesso inválido.' using errcode = '22023';
  end if;
  if exists (select 1 from public.users u where u.id = _user_id and u.is_superadmin) and not app.is_superadmin() then
    raise exception 'Só um superadministrador altera outro superadministrador.' using errcode = '42501';
  end if;

  update public.user_companies
     set role_id = _role_id, updated_at = now()
   where user_id = _user_id and company_id = _company_id;

  select r.name, u.full_name into v_role, v_nome
    from public.roles r, public.users u where r.id = _role_id and u.id = _user_id;

  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, auth.uid(), 'updated', 'user', _user_id,
          format('Perfil de %s alterado para %s', v_nome, v_role), '/admin/usuarios');
end $$;

-- ---------------------------------------------------------------------
-- ATIVAR / DESATIVAR O ACESSO A UMA EMPRESA
-- ---------------------------------------------------------------------
create or replace function app.set_company_access(_user_id uuid, _company_id uuid, _active boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_nome text;
begin
  if not app.has_permission(_company_id, 'users', 'edit') then
    raise exception 'Sem permissão para alterar usuários nesta empresa.' using errcode = '42501';
  end if;
  if _user_id = auth.uid() then
    raise exception 'Você não pode desativar o próprio acesso.' using errcode = '22023';
  end if;
  if exists (select 1 from public.users u where u.id = _user_id and u.is_superadmin) and not app.is_superadmin() then
    raise exception 'Só um superadministrador altera outro superadministrador.' using errcode = '42501';
  end if;

  update public.user_companies
     set is_active = _active, updated_at = now()
   where user_id = _user_id and company_id = _company_id;
  if not found then
    raise exception 'Este usuário não tem acesso a esta empresa.' using errcode = '22023';
  end if;

  select full_name into v_nome from public.users where id = _user_id;

  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, auth.uid(), case when _active then 'updated' else 'cancelled' end, 'user', _user_id,
          format('Acesso de %s %s', v_nome, case when _active then 'reativado' else 'desativado' end),
          '/admin/usuarios');
end $$;

-- ---------------------------------------------------------------------
-- REDEFINIR SENHA (o administrador entrega uma senha provisória)
-- ---------------------------------------------------------------------
create or replace function app.reset_user_password(_user_id uuid, _company_id uuid, _password text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_nome text;
begin
  if not app.has_permission(_company_id, 'users', 'edit') then
    raise exception 'Sem permissão para alterar usuários nesta empresa.' using errcode = '42501';
  end if;
  if _user_id = auth.uid() then
    raise exception 'Para trocar a sua própria senha, use "Trocar senha".' using errcode = '22023';
  end if;
  if not exists (select 1 from public.user_companies where user_id = _user_id and company_id = _company_id) then
    raise exception 'Este usuário não tem acesso a esta empresa.' using errcode = '22023';
  end if;
  if exists (select 1 from public.users u where u.id = _user_id and u.is_superadmin) and not app.is_superadmin() then
    raise exception 'Só um superadministrador redefine a senha de outro superadministrador.' using errcode = '42501';
  end if;
  perform app.check_password(_password);

  update auth.users
     set encrypted_password = app.hash_password(_password),
         updated_at = now()
   where id = _user_id;

  update public.users set must_change_password = true where id = _user_id;

  select full_name into v_nome from public.users where id = _user_id;

  insert into public.activity_logs (company_id, user_id, verb, entity_type, entity_id, summary, link)
  values (_company_id, auth.uid(), 'updated', 'user', _user_id,
          format('Senha provisória definida para %s', v_nome), '/admin/usuarios');
end $$;

-- ---------------------------------------------------------------------
-- A própria pessoa avisa que trocou a senha (a troca em si é feita pelo
-- Supabase Auth, no navegador, com a sessão dela).
-- ---------------------------------------------------------------------
create or replace function app.mark_password_changed()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  update public.users set must_change_password = false where id = auth.uid();
end $$;

-- ---------------------------------------------------------------------
-- Superfície pública (PostgREST só enxerga o schema public)
-- ---------------------------------------------------------------------
create or replace function public.create_company_user(
  _company_id uuid, _email text, _full_name text, _role_id uuid, _password text,
  _job_title text default null, _phone text default null, _companies uuid[] default null
) returns jsonb language sql security invoker set search_path = public, pg_temp as $$
  select app.create_company_user(_company_id, _email, _full_name, _role_id, _password,
                                 _job_title, _phone, _companies);
$$;

create or replace function public.set_user_role(_user_id uuid, _company_id uuid, _role_id uuid)
returns void language sql security invoker set search_path = public, pg_temp as $$
  select app.set_user_role(_user_id, _company_id, _role_id);
$$;

create or replace function public.set_company_access(_user_id uuid, _company_id uuid, _active boolean)
returns void language sql security invoker set search_path = public, pg_temp as $$
  select app.set_company_access(_user_id, _company_id, _active);
$$;

create or replace function public.reset_user_password(_user_id uuid, _company_id uuid, _password text)
returns void language sql security invoker set search_path = public, pg_temp as $$
  select app.reset_user_password(_user_id, _company_id, _password);
$$;

create or replace function public.mark_password_changed()
returns void language sql security invoker set search_path = public, pg_temp as $$
  select app.mark_password_changed();
$$;

-- anon não executa nada; quem chama é sempre um usuário autenticado, e a
-- própria função confere a permissão de quem pediu.
revoke execute on function
  app.create_company_user(uuid, text, text, uuid, text, text, text, uuid[]),
  app.set_user_role(uuid, uuid, uuid),
  app.set_company_access(uuid, uuid, boolean),
  app.reset_user_password(uuid, uuid, text),
  app.mark_password_changed(),
  app.check_password(text),
  app.role_allowed(uuid, uuid[]),
  app.valid_email(text),
  app.hash_password(text)
from public, anon;

grant execute on function
  app.create_company_user(uuid, text, text, uuid, text, text, text, uuid[]),
  app.set_user_role(uuid, uuid, uuid),
  app.set_company_access(uuid, uuid, boolean),
  app.reset_user_password(uuid, uuid, text),
  app.mark_password_changed(),
  app.check_password(text),
  app.role_allowed(uuid, uuid[]),
  app.valid_email(text)
to authenticated;

-- hash_password nunca é chamada direto pelo cliente: só pelas funções acima
revoke execute on function app.hash_password(text) from public, anon, authenticated;

revoke execute on function
  public.create_company_user(uuid, text, text, uuid, text, text, text, uuid[]),
  public.set_user_role(uuid, uuid, uuid),
  public.set_company_access(uuid, uuid, boolean),
  public.reset_user_password(uuid, uuid, text),
  public.mark_password_changed()
from public, anon;

grant execute on function
  public.create_company_user(uuid, text, text, uuid, text, text, text, uuid[]),
  public.set_user_role(uuid, uuid, uuid),
  public.set_company_access(uuid, uuid, boolean),
  public.reset_user_password(uuid, uuid, text),
  public.mark_password_changed()
to authenticated;
