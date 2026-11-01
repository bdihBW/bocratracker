-- BDIH Project Tracking Tool: daily download limit, download log, adding deliverables from the plan,
-- and several leads per developer team.

-- Daily download limit (0 = no limit) ----------------------------------------------------------
alter table settings add column daily_download_limit int not null default 30 check (daily_download_limit between 0 and 1000);

create or replace function public.is_download_action(a text) returns boolean
language sql immutable as $$
  select a = 'document.download' or a like 'report.generate%' or a = 'report.download' or a like 'export.%'
$$;

create or replace function public.downloads_today(p_user uuid default auth.uid()) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from audit_log
  where user_id = p_user and is_download_action(action)
    and (occurred_at at time zone 'Africa/Gaborone')::date = (now() at time zone 'Africa/Gaborone')::date
$$;

-- Records a download if the caller is under today's limit; raises otherwise.
-- The signed-url Edge Function and every report or export call this before handing over a file.
create or replace function public.record_download(p_action text, p_entity_type text, p_entity_id text, p_details jsonb default null)
returns int language plpgsql security definer set search_path = public as $$
declare lim int; n int;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if not is_download_action(p_action) then raise exception 'Unknown download type.'; end if;
  select daily_download_limit into lim from settings;
  perform pg_advisory_xact_lock(hashtext('dl:' || auth.uid()));
  n := downloads_today();
  if lim > 0 and n >= lim then
    raise exception 'You have reached today''s limit of % downloads. It resets at midnight.', lim using errcode = 'P0429';
  end if;
  insert into audit_log (user_id, ip, action, entity_type, entity_id, after)
  values (auth.uid(), request_ip(), p_action, p_entity_type, p_entity_id, p_details);
  return case when lim > 0 then lim - n - 1 else null end;   -- downloads left today
end $$;

-- Who downloaded what: BDIH and BOCRA only
create or replace function public.download_log(p_from date default current_date - 30, p_to date default current_date)
returns table (occurred_at timestamptz, user_name text, organisation text, action text, entity_type text, entity_id text, title text, details jsonb)
language sql stable security definer set search_path = public as $$
  select l.occurred_at, p.full_name, o.short_name, l.action, l.entity_type, l.entity_id,
         case when l.action = 'document.download' then (select d.title from documents d where d.id::text = l.entity_id) end,
         l.after
  from audit_log l
  left join profiles p on p.id = l.user_id
  left join organisations o on o.id = p.organisation_id
  where is_download_action(l.action) and is_oversight()
    and (l.occurred_at at time zone 'Africa/Gaborone')::date between p_from and p_to
  order by l.occurred_at desc
$$;

-- Add a deliverable with its review steps and register entry (Project plan, Add deliverable) ----
create or replace function public.add_deliverable(p_name text, p_ref text, p_workstream uuid, p_phase text, p_duration int,
  p_lead uuid default null, p_predecessor uuid default null, p_bdih_review boolean default true, p_doc_category text default 'Report')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  d uuid; b uuid; o uuid; ord int; owner uuid;
begin
  if not has_perm('plan.edit') then raise exception 'Only the plan editors add deliverables.'; end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_ref), '') = '' then raise exception 'Give the deliverable a name and reference.'; end if;
  select coalesce((select display_order from activities where id = p_predecessor),
                  (select max(display_order) from activities where workstream_id = p_workstream and deleted_at is null), 0) into ord;
  -- Make room for three rows after the chosen position
  perform set_config('app.in_recalc', 'on', true);
  update activities set display_order = display_order + 3 where display_order > ord;
  perform set_config('app.in_recalc', 'off', true);
  insert into activities (display_order, workstream_id, phase, name, type, duration, lead_resource_id, deliverable_ref, submittable, doc_category)
  values (ord + 1, p_workstream, p_phase, p_name, 'Task', greatest(1, p_duration), p_lead, p_ref, true, p_doc_category) returning id into d;
  if p_predecessor is not null then insert into activity_links (predecessor_id, successor_id) values (p_predecessor, d); end if;
  if p_bdih_review then
    insert into activities (display_order, workstream_id, phase, name, type, review_stage, indent, for_activity_id, lead_resource_id)
    values (ord + 2, p_workstream, p_phase, 'BDIH review: ' || p_name, 'Review', 'BDIH', 1, d,
            (select id from resources where name = 'BDIH Developer')) returning id into b;
    insert into activity_links (predecessor_id, successor_id) values (d, b);
  end if;
  insert into activities (display_order, workstream_id, phase, name, type, review_stage, indent, for_activity_id, lead_resource_id)
  values (ord + 3, p_workstream, p_phase, 'BOCRA review: ' || p_name, 'Review', 'BOCRA', 1, d,
          (select id from resources where name = 'BOCRA Project Lead')) returning id into o;
  insert into activity_links (predecessor_id, successor_id) values (coalesce(b, d), o);
  update activities set bdih_review_activity_id = b, bocra_review_activity_id = o where id = d;
  select owner_organisation_id into owner from workstreams where id = p_workstream;
  insert into deliverables (ref, name, phase, owner_organisation_id, workstream_id, activity_id) values (p_ref, p_name, p_phase, owner, p_workstream, d);
  return d;
end $$;

-- Several leads per developer team ---------------------------------------------------------------
-- A developer team may hold any number of Developer Leads (primary role or an extra role in
-- user_roles). Every grant and removal is recorded by the user_roles audit trigger. This keeps at
-- least one active lead per team.
create or replace function public.trg_keep_one_lead() returns trigger
language plpgsql security definer set search_path = public as $$
declare org uuid;
begin
  if tg_table_name = 'user_roles' then
    select organisation_id into org from profiles where id = old.user_id;
  else
    org := old.organisation_id;
  end if;
  if (select type from organisations where id = org) = 'Developer'
     and exists (select 1 from profiles where organisation_id = org and active)
     and not exists (select 1 from profiles p where p.organisation_id = org and p.active and 'DEV_LEAD' = any (roles_of(p.id))) then
    raise exception 'A developer team needs at least one Developer Lead.';
  end if;
  return null;
end $$;
create trigger user_roles_keep_lead after delete on user_roles for each row
  when (old.role = 'DEV_LEAD') execute function trg_keep_one_lead();
create trigger profiles_keep_lead after update of role, active on profiles for each row
  when (old.role = 'DEV_LEAD') execute function trg_keep_one_lead();

create or replace view public.v_developer_leads with (security_invoker = true) as
select o.short_name as organisation, p.id as user_id, p.full_name, p.role = 'DEV_LEAD' as primary_lead
from profiles p join organisations o on o.id = p.organisation_id
where o.type = 'Developer' and p.active and 'DEV_LEAD' = any (roles_of(p.id));

grant execute on function downloads_today(uuid), record_download(text, text, text, jsonb), download_log(date, date),
  add_deliverable(text, text, uuid, text, int, uuid, uuid, boolean, text) to authenticated;
grant select on v_developer_leads to authenticated;
