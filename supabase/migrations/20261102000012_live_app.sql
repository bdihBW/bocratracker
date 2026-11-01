-- BDIH Project Tracking Tool: small functions the live app calls.

-- After a user sets their own password (Supabase Auth updateUser), clear the first-sign-in flag
create or replace function public.password_changed() returns void
language sql security definer set search_path = public as $$
  update profiles set must_change_password = false where id = auth.uid();
  insert into audit_log (user_id, ip, action, entity_type, entity_id) values (auth.uid(), request_ip(), 'password.change', 'user', auth.uid()::text);
$$;
revoke execute on function password_changed() from public, anon;
grant execute on function password_changed() to authenticated;
