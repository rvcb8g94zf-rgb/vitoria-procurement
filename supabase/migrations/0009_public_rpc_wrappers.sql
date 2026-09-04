-- =====================================================================
-- Vitória Procurement — Fase 1 / Migração 0009
-- Invólucros em public para as funções que a aplicação chama via RPC.
--
-- O PostgREST só expõe os schemas configurados na API (public por
-- padrão). Manter a lógica em `app` e publicar só a superfície
-- necessária mantém os helpers internos fora do alcance da API.
-- =====================================================================

create or replace function public.my_permissions(_company_id uuid)
returns text[] language sql stable security invoker set search_path = public, pg_temp as $$
  select app.my_permissions(_company_id);
$$;

create or replace function public.create_company(
  _legal_name text, _cnpj text, _trade_name text default null
)
returns uuid language sql security invoker set search_path = public, pg_temp as $$
  select app.create_company(_legal_name, _cnpj, _trade_name);
$$;

create or replace function public.next_document_number(_company_id uuid, _doc_type text)
returns text language sql security invoker set search_path = public, pg_temp as $$
  select app.next_document_number(_company_id, _doc_type);
$$;

create or replace function public.tolerance_report(
  _company_id uuid, _expected numeric, _actual numeric, _kind text default 'price'
)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select app.tolerance_report(_company_id, _expected, _actual, _kind);
$$;

create or replace function public.is_valid_cnpj(_cnpj text)
returns boolean language sql immutable security invoker set search_path = public, pg_temp as $$
  select app.is_valid_cnpj(_cnpj);
$$;

-- anon não chama nada: toda a superfície exige sessão autenticada
revoke execute on function
  public.my_permissions(uuid),
  public.create_company(text, text, text),
  public.next_document_number(uuid, text),
  public.tolerance_report(uuid, numeric, numeric, text),
  public.is_valid_cnpj(text)
from public, anon;

grant execute on function
  public.my_permissions(uuid),
  public.create_company(text, text, text),
  public.next_document_number(uuid, text),
  public.tolerance_report(uuid, numeric, numeric, text),
  public.is_valid_cnpj(text)
to authenticated;
