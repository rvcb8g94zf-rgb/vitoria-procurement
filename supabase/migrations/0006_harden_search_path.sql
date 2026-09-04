-- =====================================================================
-- Vitória Procurement — Fase 1 / Migração 0006
-- Fecha os avisos do linter de segurança do Supabase.
-- =====================================================================

-- 1. search_path fixo nas funções que ficaram sem: sem isso um schema
--    malicioso no caminho do chamador poderia sequestrar as chamadas.
alter function app.touch_updated_at()        set search_path = '';
alter function app.request_ip()              set search_path = '';
alter function app.request_user_agent()      set search_path = '';
alter function app.folder_company(text)      set search_path = public, storage, pg_temp;

-- 2. extensão fora do schema public
alter extension unaccent set schema extensions;
