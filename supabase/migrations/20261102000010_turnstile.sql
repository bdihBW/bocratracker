-- BDIH Project Tracking Tool: Cloudflare Turnstile on sign-in.
-- Run this after migrations 0001 to 0009. The site key is public; the secret key is set only as the
-- Edge Function secret TURNSTILE_SECRET and never stored here.

alter table settings add column if not exists turnstile_site_key text not null default '0x4AAAAAAFvlUC69yGzxrwc-'
  check (turnstile_site_key ~ '^0x[A-Za-z0-9_-]{10,80}$');
alter table settings add column if not exists turnstile_enabled boolean not null default true;

-- What the sign-in page needs before anyone is signed in: names and the Turnstile site key only
create or replace function public.public_config()
returns table (app_name text, app_subtitle text, turnstile_site_key text, turnstile_enabled boolean)
language sql stable security definer set search_path = public as $$
  select app_name, app_subtitle, turnstile_site_key, turnstile_enabled from settings where id
$$;
revoke execute on function public_config() from public;
grant execute on function public_config() to anon, authenticated;
