-- =====================================================================
-- Vitória Procurement — Módulo DF-e / Migração 0014
-- Leitura da senha do certificado a partir do Vault.
--
-- A senha nunca fica em tabela comum nem em variável do frontend. Esta
-- função é SECURITY DEFINER e só pode ser chamada com service_role —
-- revogada de authenticated e anon de propósito.
-- =====================================================================

create extension if not exists supabase_vault with schema vault;

create or replace function public.read_fiscal_secret(_name text)
returns text
language plpgsql security definer set search_path = public, vault, pg_temp as $$
declare v text;
begin
  select decrypted_secret into v
    from vault.decrypted_secrets
   where name = _name
   limit 1;

  if v is null then
    raise exception 'Segredo % não encontrado.', _name using errcode = 'no_data_found';
  end if;
  return v;
end $$;

revoke execute on function public.read_fiscal_secret(text) from public, anon, authenticated;

-- Guarda ou substitui a senha do certificado de uma empresa.
create or replace function public.store_fiscal_secret(_name text, _value text)
returns void
language plpgsql security definer set search_path = public, vault, pg_temp as $$
declare existing uuid;
begin
  select id into existing from vault.secrets where name = _name limit 1;
  if existing is null then
    perform vault.create_secret(_value, _name, 'Senha do certificado A1 — Vitória Procurement');
  else
    perform vault.update_secret(existing, _value);
  end if;
end $$;

revoke execute on function public.store_fiscal_secret(text, text) from public, anon, authenticated;
