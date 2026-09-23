-- =====================================================================
-- 0017_last_seen.sql — marca o último acesso de quem entra
--
-- A tela de Usuários mostra "último acesso"; sem isso a coluna ficaria
-- vazia para sempre. A escrita acontece uma vez por login, no próprio
-- navegador da pessoa, e nunca em outra linha que não a dela.
-- =====================================================================

create or replace function app.touch_last_seen()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    return;
  end if;
  update public.users
     set last_seen_at = now()
   where id = auth.uid()
     and (last_seen_at is null or last_seen_at < now() - interval '1 minute');
end $$;

create or replace function public.touch_last_seen()
returns void language sql security invoker set search_path = public, pg_temp as $$
  select app.touch_last_seen();
$$;

revoke execute on function app.touch_last_seen(), public.touch_last_seen() from public, anon;
grant execute on function app.touch_last_seen(), public.touch_last_seen() to authenticated;
