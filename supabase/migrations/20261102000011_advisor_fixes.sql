-- BDIH Project Tracking Tool: fixes for the Supabase security advisor, and columns the live app needs.
-- Supabase grants EXECUTE on every new function to anon and authenticated by default, which
-- undid part of migration 0009. This closes that gap for good.

-- 1. Stop the platform default that makes new functions public
alter default privileges for role postgres in schema public revoke execute on functions from anon, public;

-- 2. Anonymous visitors may call only the two pre-sign-in functions
revoke execute on all functions in schema public from anon, public;
grant execute on function request_password_reset(text) to anon;
grant execute on function public_config() to anon;

-- 3. Internal helpers that signed-in users must not call directly (rate-limit counters, trigger
--    functions, user lookups). Policies keep the helpers they evaluate (has_perm, can_see_*, ...).
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'trg\_%' or p.proname in
      ('rate_limit', 'login_rate_limit', 'notify_users', 'recalc_schedule', 'users_with_role', 'dev_leads',
       'resource_user', 'org_type_of', 'auth_lookup', 'record_login', 'run_reminders'))
  loop
    execute format('revoke execute on function %s from authenticated, anon, public', f.sig);
  end loop;
end $$;
grant execute on function auth_lookup(text), record_login(uuid, boolean, text), run_reminders(), login_rate_limit(text) to service_role;

-- 4. Fixed search_path on the remaining functions
alter function public.trg_touch() set search_path = public;
alter function public.request_ip() set search_path = public;
alter function public.trg_audit_immutable() set search_path = public;
alter function public.is_download_action(text) set search_path = public;
alter function public.path_workstream(text) set search_path = public;
alter function public.activities_at(date) set search_path = public;
alter function public.workstream_progress(date) set search_path = public;

-- 5. Columns for the live app
alter table activities add column if not exists key text;          -- stable plan keys such as A-COMM, used by dashboards
create index if not exists activities_key on activities (key) where key is not null;
-- Addresses allowed to call the Edge Functions (CORS); the administrator edits these in Settings
alter table settings add column if not exists app_origins text[] not null
  default array['http://localhost:8765', 'https://bocratracker.pages.dev'];

-- Signed-in users read all settings through app_settings(); rebuild it for the new columns
create or replace function public.app_settings() returns settings
language sql stable security definer set search_path = public as $$
  select * from settings where id and auth.uid() is not null
$$;
grant execute on function app_settings() to authenticated;

-- Edge Functions read the allowed origins with the service role
create or replace function public.allowed_origins() returns text[]
language sql stable security definer set search_path = public as $$
  select app_origins from settings where id
$$;
revoke execute on function allowed_origins() from public, anon, authenticated;
grant execute on function allowed_origins() to service_role;
