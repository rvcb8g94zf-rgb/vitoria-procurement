-- =====================================================================
-- Vitória Procurement — Fase 1 / Migração 0008
-- Permissões efetivas do usuário na empresa ativa, em uma chamada.
--
-- Reaproveita app.has_permission() de propósito: a sidebar passa a
-- esconder exatamente o que o RLS bloquearia. Se a regra mudar, muda
-- nos dois lugares ao mesmo tempo, porque só existe um lugar.
-- =====================================================================

create or replace function app.my_permissions(_company_id uuid)
returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
           array_agg(distinct p.module || '.' || p.action order by p.module || '.' || p.action),
           '{}'::text[]
         )
    from public.permissions p
   where app.has_permission(_company_id, p.module, p.action);
$$;

grant execute on function app.my_permissions(uuid) to authenticated;
