-- BDIH Project Tracking Tool: access helpers, business-day calendar, scheduling engine,
-- health rules, triggers and audit (SRS sections 3, 4.3, 4.14, 5.2 and Appendix B)

-- Access helpers (security definer so policies can call them without recursion) ---------------

create or replace function public.my_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active
$$;

-- All roles a user holds: the primary role plus any extra roles
create or replace function public.roles_of(uid uuid) returns app_role[]
language sql stable security definer set search_path = public as $$
  select coalesce((select array_agg(distinct r) from (
    select role r from profiles where id = uid and active
    union select ur.role from user_roles ur join profiles p on p.id = ur.user_id where ur.user_id = uid and p.active) x), '{}')
$$;

create or replace function public.has_role(variadic roles app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select roles_of(auth.uid()) && roles
$$;

-- Role-based permission check (Administration, Roles and permissions). A delegated developer
-- team member inherits the Developer Lead's submit, weekly report and invoice permissions.
create or replace function public.has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select exists (select 1 from role_permissions rp where rp.permission = p and rp.role = any (roles_of(pr.id)))
        or (p = 'users.manage' and 'ADMIN' = any (roles_of(pr.id)))
        or ('DEV_MEMBER' = any (roles_of(pr.id)) and pr.delegated and p in ('submit.deliverable', 'weekly.file', 'invoice.submit')
            and exists (select 1 from role_permissions rp where rp.permission = p and rp.role = 'DEV_LEAD'))
    from profiles pr where pr.id = auth.uid() and pr.active), false)
$$;

create or replace function public.in_lookup(p_list text, p_value text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from lookups where list_name = p_list and value = p_value)
$$;

-- Is a list value still used by a record? Used values cannot be deleted.
create or replace function public.lookup_in_use(p_list text, p_value text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare used boolean := false;
begin
  if p_list = 'phase' then select exists (select 1 from activities where phase = p_value and deleted_at is null) into used;
  elsif p_list = 'document_category' then select exists (select 1 from documents where category = p_value and entity_type <> 'bank') into used;
  elsif p_list = 'bank_category' then select exists (select 1 from documents where category = p_value and entity_type = 'bank') into used;
  elsif p_list in ('ticket_type', 'ticket_priority', 'ticket_status') and to_regclass('public.tickets') is not null then
    execute format('select exists (select 1 from tickets where %I = $1)', case p_list when 'ticket_type' then 'type' when 'ticket_priority' then 'priority' else 'status' end)
      into used using p_value;
  end if;
  return used;
end $$;

create or replace function public.my_org() returns uuid
language sql stable security definer set search_path = public as $$
  select organisation_id from profiles where id = auth.uid() and active
$$;

create or replace function public.org_type_of(uid uuid) returns org_type
language sql stable security definer set search_path = public as $$
  select o.type from profiles p join organisations o on o.id = p.organisation_id where p.id = uid and p.active
$$;

-- True for any active BDIH or BOCRA user
create or replace function public.is_oversight() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(org_type_of(auth.uid()) in ('Client', 'Project Manager'), false)
$$;

create or replace function public.is_bdih() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(org_type_of(auth.uid()) = 'Project Manager', false)
$$;

create or replace function public.can_see_workstream(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_oversight()
      or exists (select 1 from user_workstreams uw join profiles p on p.id = uw.user_id
                 where uw.user_id = auth.uid() and uw.workstream_id = ws and p.active)
$$;

-- Visibility for an arbitrary user; used for notifications and mentions (FR-NTF-02, FR-PRG-05)
create or replace function public.user_can_see(uid uuid, ws uuid, visible boolean default false) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(org_type_of(uid) in ('Client', 'Project Manager'), false)
      or exists (select 1 from user_workstreams uw join profiles p on p.id = uw.user_id
                 where uw.user_id = uid and uw.workstream_id = ws and p.active)
      or (coalesce(visible, false)
          and org_type_of(uid) is not null
          and exists (select 1 from workstreams w where w.id = ws and w.is_shared))
$$;

create or replace function public.can_see_item(ws uuid, visible boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select user_can_see(auth.uid(), ws, visible)
$$;

create or replace function public.can_see_activity(act uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from activities a where a.id = act and a.deleted_at is null
                 and can_see_item(a.workstream_id, a.visible_to_developers))
$$;

create or replace function public.shared_workstream() returns uuid
language sql stable security definer set search_path = public as $$
  select id from workstreams where is_shared
$$;

create or replace function public.request_ip() returns text
language sql stable as $$
  select split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1)
$$;

-- Business-day calendar (Appendix B.1) --------------------------------------------------------

create or replace function public.is_business_day(d date) returns boolean
language sql stable security definer set search_path = public as $$
  select extract(isodow from d) < 6 and not exists (select 1 from closure_days c where c.date = d)
$$;

-- First business day on or after d
create or replace function public.bd_ceil(d date) returns date
language plpgsql stable security definer set search_path = public as $$
begin
  for i in 0..60 loop
    if is_business_day(d + i) then return d + i; end if;
  end loop;
  return d;
end $$;

-- Last business day on or before d
create or replace function public.bd_floor(d date) returns date
language plpgsql stable security definer set search_path = public as $$
begin
  for i in 0..60 loop
    if is_business_day(d - i) then return d - i; end if;
  end loop;
  return d;
end $$;

-- d plus n business days (n may be negative); d is first rolled forward to a business day
create or replace function public.add_business_days(d date, n int) returns date
language plpgsql stable security definer set search_path = public as $$
declare x date := bd_ceil(d); k int := 0; step int := sign(n)::int;
begin
  while k < abs(n) loop
    x := x + step;
    if is_business_day(x) then k := k + 1; end if;
  end loop;
  return x;
end $$;

-- Business days from a to b inclusive
create or replace function public.bd_count(a date, b date) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from generate_series(a, b, interval '1 day') g where is_business_day(g::date)
$$;

-- Closure calendar readable by every signed-in user for Gantt shading
create or replace function public.closure_calendar() returns table (date date, reason text)
language sql stable security definer set search_path = public as $$
  select c.date, c.reason from closure_days c where auth.uid() is not null order by c.date
$$;

-- Durations, planned %, health (FR-SCH-07, FR-SCH-10, Appendix B.2) --------------------------

create or replace function public.activity_duration(a activities) returns int
language sql stable security definer set search_path = public as $$
  select case
    when a.type = 'Milestone' then 0
    when a.type = 'Review' and a.review_stage = 'BDIH' then (select bdih_review_days from settings)
    when a.type = 'Review' then (select bocra_review_days from settings)
    else greatest(a.duration, 1) end
$$;

create or replace function public.planned_pct(a activities, status_date date) returns int
language plpgsql stable security definer set search_path = public as $$
declare sd date := bd_floor(status_date);
begin
  if a.start_date is null then return 0; end if;
  if a.type = 'Milestone' then return case when sd >= a.finish_date then 100 else 0 end; end if;
  if sd < a.start_date then return 0; end if;
  return least(100, round(100.0 * bd_count(a.start_date, sd) / greatest(activity_duration(a), 1)))::int;
end $$;

create or replace function public.activity_health(a activities, status_date date) returns text
language plpgsql stable security definer set search_path = public as $$
declare sd date := bd_floor(status_date);
begin
  if a.status in ('Complete', 'Approved') then return 'Complete'; end if;
  if a.status = 'Cancelled' then return 'Cancelled'; end if;
  if a.type = 'Meeting' and activity_duration(a) > 1 and sd between a.start_date and a.finish_date then return 'Ongoing'; end if;
  if a.finish_date < sd and a.pct_done < 100 then return 'Late'; end if;
  if a.pct_done < 100 and planned_pct(a, status_date) - a.pct_done > 10 then return 'Behind'; end if;
  if a.start_date > sd then return 'Not due'; end if;
  return 'On track';
end $$;

-- Scheduling engine (FR-SCH-04, FR-SCH-05) ----------------------------------------------------
-- Works in business-day index space: dates become positions in the list of business days, so
-- "next business day plus lag" is simple arithmetic. Recalculates every activity, then a
-- backward pass per workstream gives total float and the critical path (FR-SCH-13).

create or replace function public.recalc_schedule() returns void
language plpgsql security definer set search_path = public as $$
declare
  s settings%rowtype;
  r record;
  ps int; es int; ef int; lf int; n int;
  v_af date;
begin
  perform set_config('app.in_recalc', 'on', true);
  select * into s from settings where id;
  if not found then return; end if;

  create temp table if not exists _bd (idx int primary key, d date unique) on commit drop;
  truncate _bd;
  insert into _bd (idx, d)
  select row_number() over (order by g)::int, g::date
  from generate_series(s.project_start - 400, s.project_start + 1500, interval '1 day') g
  where extract(isodow from g) < 6 and not exists (select 1 from closure_days c where c.date = g::date);

  create temp table if not exists _s (id uuid primary key, ws uuid, ms boolean, dur int, si int, fi int, ls int,
    done boolean not null default false, bdone boolean not null default false) on commit drop;
  truncate _s;
  insert into _s (id, ws, ms, dur)
  select a.id, a.workstream_id, a.type = 'Milestone', activity_duration(a)
  from activities a where a.deleted_at is null;

  select min(idx) into ps from _bd where d >= s.project_start;

  -- Forward pass in topological order
  loop
    n := 0;
    for r in
      select a.*, x.dur, x.ms
      from activities a join _s x on x.id = a.id
      where not x.done
        and not exists (select 1 from activity_links l join _s p on p.id = l.predecessor_id
                        where l.successor_id = a.id and not p.done)
      order by a.display_order
    loop
      v_af := r.actual_finish;
      -- Milestones complete themselves when all predecessors are complete
      if r.ms and exists (select 1 from activity_links l join _s p on p.id = l.predecessor_id where l.successor_id = r.id) then
        if not exists (select 1 from activity_links l join activities p on p.id = l.predecessor_id and p.deleted_at is null
                       where l.successor_id = r.id and p.status not in ('Complete', 'Approved')) then
          if r.status not in ('Complete', 'Approved') then
            select max(b.d) into v_af from activity_links l join _s p on p.id = l.predecessor_id join _bd b on b.idx = p.fi
            where l.successor_id = r.id;
            update activities set status = 'Complete', pct_done = 100, auto_done = true, actual_finish = v_af where id = r.id;
          end if;
        elsif r.auto_done then
          update activities set status = 'Not started', pct_done = 0, auto_done = false, actual_finish = null where id = r.id;
          v_af := null;
        end if;
      end if;

      if r.actual_start is not null and not r.ms then
        select min(idx) into es from _bd where d >= r.actual_start;
      elsif r.fixed_start is not null then
        select min(idx) into es from _bd where d >= r.fixed_start;
      elsif exists (select 1 from activity_links l join _s p on p.id = l.predecessor_id where l.successor_id = r.id) then
        select max(case l.link_type
                     when 'SS' then p.si + l.lag
                     when 'FF' then p.fi + l.lag - r.dur + 1
                     else case when r.ms then p.fi + l.lag else p.fi + 1 + l.lag end end)
        into es
        from activity_links l join _s p on p.id = l.predecessor_id where l.successor_id = r.id;
      else
        es := ps;
      end if;
      ef := case when r.ms then es else es + r.dur - 1 end;
      if v_af is not null then
        select max(idx) into ef from _bd where d <= v_af;
        if r.ms then es := ef; elsif ef < es then es := ef; end if;
      end if;
      update _s set si = es, fi = ef, done = true where id = r.id;
      n := n + 1;
    end loop;
    exit when n = 0;
  end loop;

  if exists (select 1 from _s where not done) then
    raise exception 'Circular dependency involving: %',
      (select string_agg(a.name, ', ') from activities a join _s x on x.id = a.id where not x.done)
      using errcode = 'P0001';
  end if;

  -- Backward pass per workstream
  loop
    n := 0;
    for r in
      select x.* from _s x
      where not x.bdone
        and not exists (select 1 from activity_links l join _s c on c.id = l.successor_id
                        where l.predecessor_id = x.id and c.ws = x.ws and not c.bdone)
    loop
      if exists (select 1 from activity_links l join _s c on c.id = l.successor_id where l.predecessor_id = r.id and c.ws = r.ws) then
        select min(case when c.ms then c.ls - l.lag else c.ls - 1 - l.lag end) into lf
        from activity_links l join _s c on c.id = l.successor_id where l.predecessor_id = r.id and c.ws = r.ws;
      else
        select max(fi) into lf from _s where ws = r.ws;
      end if;
      update _s set ls = case when r.ms then lf else lf - r.dur + 1 end, bdone = true where id = r.id;
      n := n + 1;
    end loop;
    exit when n = 0;
  end loop;

  update activities a
  set start_date = bs.d, finish_date = bf.d, total_float = x.ls - x.si,
      is_critical = (x.ls - x.si) <= 0 and a.type <> 'Meeting' and a.status not in ('Complete', 'Approved', 'Cancelled')
  from _s x
  join _bd bs on bs.idx = x.si
  join _bd bf on bf.idx = x.fi
  where a.id = x.id
    and (a.start_date is distinct from bs.d or a.finish_date is distinct from bf.d
         or a.total_float is distinct from x.ls - x.si
         or a.is_critical is distinct from ((x.ls - x.si) <= 0 and a.type <> 'Meeting' and a.status not in ('Complete', 'Approved', 'Cancelled')));

  perform set_config('app.in_recalc', 'off', true);
end $$;

-- Reschedule after any change to activities, links, closure days or settings
create or replace function public.trg_reschedule() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.in_recalc', true), 'off') = 'on' then return null; end if;
  perform recalc_schedule();
  return null;
end $$;

create trigger activities_reschedule after insert or update or delete on activities
  for each statement execute function trg_reschedule();
create trigger links_reschedule after insert or update or delete on activity_links
  for each statement execute function trg_reschedule();
create trigger closure_reschedule after insert or update or delete on closure_days
  for each statement execute function trg_reschedule();
create trigger settings_reschedule after update on settings
  for each statement execute function trg_reschedule();

-- Festive closure dates generate their closure days (FR-ADM-06)
create or replace function public.trg_festive() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.festive_start is distinct from old.festive_start or new.festive_end is distinct from old.festive_end or tg_op = 'INSERT' then
    perform set_config('app.in_recalc', 'on', true);
    delete from closure_days where source = 'festive closure';
    if new.festive_start is not null and new.festive_end is not null then
      insert into closure_days (date, reason, source)
      select g::date, 'Festive closure', 'festive closure'
      from generate_series(new.festive_start, new.festive_end, interval '1 day') g
      on conflict (date) do nothing;
    end if;
    perform set_config('app.in_recalc', 'off', true);
  end if;
  return new;
end $$;
create trigger settings_festive after insert or update on settings for each row execute function trg_festive();

-- Links: no cycles, at most five predecessors, clear message naming the activities (FR-SCH-06)
create or replace function public.trg_link_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare path text;
begin
  if (select count(*) from activity_links where successor_id = new.successor_id and id <> new.id) >= 5 then
    raise exception 'An activity can have at most five predecessors (%).', (select name from activities where id = new.successor_id);
  end if;
  with recursive walk (id, names) as (
    select new.successor_id, array[(select name from activities where id = new.successor_id)]
    union all
    select l.successor_id, w.names || a.name
    from walk w join activity_links l on l.predecessor_id = w.id join activities a on a.id = l.successor_id
    where l.id <> new.id and array_length(w.names, 1) < 600
  )
  select array_to_string(names, ' then ') into path from walk where id = new.predecessor_id limit 1;
  if path is not null then
    raise exception 'Rejected: linking % to % creates a circular dependency through %.',
      (select name from activities where id = new.predecessor_id), (select name from activities where id = new.successor_id), path;
  end if;
  return new;
end $$;
create trigger activity_links_check before insert or update on activity_links for each row execute function trg_link_check();

-- Developer users are bound to their organisation's workstream automatically (FR-ADM-02)
create or replace function public.trg_profile_workstreams() returns trigger
language plpgsql security definer set search_path = public as $$
declare t org_type;
begin
  select type into t from organisations where id = new.organisation_id;
  if new.role in ('DEV_LEAD', 'DEV_MEMBER') and t <> 'Developer' then
    raise exception 'Developer roles belong to developer organisations.';
  end if;
  if new.role in ('ADMIN', 'BDIH_DIRECTOR', 'BDIH_LEAD', 'BDIH_PO', 'BDIH_BA', 'BDIH_TEAM') and t <> 'Project Manager' then
    raise exception 'BDIH roles belong to BDIH.';
  end if;
  if new.role in ('BOCRA_REP', 'BOCRA_TEAM') and t <> 'Client' then
    raise exception 'BOCRA roles belong to BOCRA.';
  end if;
  if tg_op = 'UPDATE' and new.organisation_id is distinct from old.organisation_id then
    delete from user_workstreams where user_id = new.id;
  end if;
  if t = 'Developer' then
    insert into user_workstreams (user_id, workstream_id, access)
    select new.id, w.id, 'edit' from workstreams w where w.owner_organisation_id = new.organisation_id
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger profiles_workstreams after insert or update of organisation_id, role on profiles
  for each row execute function trg_profile_workstreams();

-- Extra roles must belong to the same organisation as the user
create or replace function public.trg_user_role_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare t org_type;
begin
  select o.type into t from profiles p join organisations o on o.id = p.organisation_id where p.id = new.user_id;
  if (new.role in ('DEV_LEAD', 'DEV_MEMBER') and t <> 'Developer')
     or (new.role in ('ADMIN', 'BDIH_DIRECTOR', 'BDIH_LEAD', 'BDIH_PO', 'BDIH_BA', 'BDIH_TEAM') and t <> 'Project Manager')
     or (new.role in ('BOCRA_REP', 'BOCRA_TEAM') and t <> 'Client') then
    raise exception 'Role % does not belong to this user''s organisation.', new.role;
  end if;
  return new;
end $$;
create trigger user_roles_check before insert or update on user_roles for each row execute function trg_user_role_check();

create or replace function public.trg_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger activities_touch before update on activities for each row execute function trg_touch();
create trigger profiles_touch before update on profiles for each row execute function trg_touch();
create trigger risks_touch before update on risks for each row execute function trg_touch();
create trigger issues_touch before update on issues for each row execute function trg_touch();
create trigger crs_touch before update on change_requests for each row execute function trg_touch();

-- Change requests: BDIH fields only by BDIH, BOCRA decision only by BOCRA (FR-RSK-04)
create or replace function public.trg_cr_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.impact_scope, new.impact_time, new.impact_cost, new.bdih_recommendation, new.plan_changes)
     is distinct from (old.impact_scope, old.impact_time, old.impact_cost, old.bdih_recommendation, old.plan_changes)
     and not has_perm('cr.recommend') then
    raise exception 'Only the BDIH Project Leader records the impact assessment and recommendation.';
  end if;
  if (new.bocra_decision, new.bocra_decision_text) is distinct from (old.bocra_decision, old.bocra_decision_text) then
    if not has_perm('cr.decide') then raise exception 'Only the BOCRA Project Lead decides change requests.'; end if;
    if new.bocra_decision <> 'Pending' and coalesce(trim(new.bocra_decision_text), '') = '' then
      raise exception 'Record the BOCRA decision in writing.';
    end if;
    new.decided_by := auth.uid(); new.decided_at := now();
  end if;
  if new.bdih_recommendation is distinct from old.bdih_recommendation then new.recommended_by := auth.uid(); end if;
  new.status := case when new.bocra_decision <> 'Pending' then new.bocra_decision
                     when coalesce(new.bdih_recommendation, '') <> '' then 'Recommended' else 'Under assessment' end;
  return new;
end $$;
create trigger change_requests_guard before update on change_requests for each row execute function trg_cr_guard();

-- Audit trail (FR-AUD-01, FR-AUD-02) -----------------------------------------------------------

create or replace function public.trg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.in_recalc', true), 'off') = 'on' then return null; end if;
  insert into audit_log (user_id, ip, action, entity_type, entity_id, before, after)
  values (auth.uid(), request_ip(), lower(tg_table_name) || '.' || lower(tg_op), tg_table_name,
          coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'id',
                   (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'date'),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'user_workstreams', 'resources', 'settings', 'closure_days', 'lookups', 'organisations',
    'workstreams', 'activities', 'activity_links', 'baselines', 'submissions', 'reviews', 'documents', 'document_versions',
    'weekly_reports', 'progress_reports', 'deliverables', 'risks', 'issues', 'decisions', 'change_requests', 'meetings',
    'action_items', 'comments', 'account_requests', 'role_permissions', 'password_reset_requests', 'report_definitions', 'user_roles', 'role_labels']
  loop
    execute format('create trigger %I after insert or update or delete on %I for each row execute function trg_audit()', t || '_audit', t);
  end loop;
end $$;

create or replace function public.trg_audit_immutable() returns trigger language plpgsql as $$
begin raise exception 'The audit log is append-only.'; end $$;
create trigger audit_log_immutable before update or delete on audit_log for each row execute function trg_audit_immutable();
create trigger audit_log_no_truncate before truncate on audit_log for each statement execute function trg_audit_immutable();

-- Explicit audit entries for events with no row change (downloads, exports, report generation, logins)
create or replace function public.log_event(p_action text, p_entity_type text default null, p_entity_id text default null, p_details jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into audit_log (user_id, ip, action, entity_type, entity_id, after)
  select auth.uid(), request_ip(), p_action, p_entity_type, p_entity_id, p_details where auth.uid() is not null
$$;

-- Notifications only reach users who can see the item (FR-NTF-02) -------------------------------

create or replace function public.notify_users(p_users uuid[], p_type text, p_title text, p_ws uuid, p_visible boolean,
  p_entity_type text default null, p_entity_id uuid default null, p_link text default null, p_category text default 'General')
returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, type, category, title, entity_type, entity_id, link)
  select distinct u, p_type, p_category, p_title, p_entity_type, p_entity_id, p_link
  from unnest(p_users) u
  where u is not null and (p_ws is null or user_can_see(u, p_ws, p_visible))
$$;

create or replace function public.users_with_role(variadic roles app_role[]) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), '{}') from profiles where active and roles_of(id) && roles
$$;

create or replace function public.dev_leads(ws uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p.id), '{}') from profiles p join user_workstreams uw on uw.user_id = p.id
  where p.active and 'DEV_LEAD' = any (roles_of(p.id)) and uw.workstream_id = ws
$$;

create or replace function public.resource_user(res uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select linked_user_id from resources where id = res
$$;
