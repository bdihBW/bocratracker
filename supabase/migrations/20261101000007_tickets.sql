-- BDIH Project Tracking Tool: developer tickets (Jira-style boards)
-- One board per developer workstream. Developers see only their own board; BDIH and BOCRA see both.

-- Ticket types, priorities and board columns are lists the administrator edits (lookups:
-- ticket_type, ticket_priority, ticket_status). "Done" is protected.
insert into lookups (list_name, value, sort_order, protected) values
  ('ticket_status', 'To do', 1, false), ('ticket_status', 'In progress', 2, false), ('ticket_status', 'In review', 3, false),
  ('ticket_status', 'Blocked', 4, false), ('ticket_status', 'Done', 5, true),
  ('ticket_type', 'Story', 1, false), ('ticket_type', 'Task', 2, false), ('ticket_type', 'Bug', 3, false),
  ('ticket_type', 'UAT defect', 4, false), ('ticket_type', 'Support request', 5, false),
  ('ticket_priority', 'Highest', 1, false), ('ticket_priority', 'High', 2, false), ('ticket_priority', 'Medium', 3, false), ('ticket_priority', 'Low', 4, false)
on conflict do nothing;

alter table workstreams add column ticket_prefix text unique;
update workstreams set ticket_prefix = case code when 'A' then 'BOC' when 'B' then 'UAS' end where not is_shared;

create table tickets (
  id uuid primary key default gen_random_uuid(),
  key text unique,                                   -- BOC-12, set by trigger
  seq int,
  workstream_id uuid not null references workstreams,
  type text not null default 'Task',
  title text not null check (length(title) between 1 and 200),
  description text,
  priority text not null default 'Medium',
  status text not null default 'To do',
  assignee_id uuid references profiles,
  reporter_id uuid not null references profiles default auth.uid(),
  activity_id uuid references activities,
  labels text[] not null default '{}',
  due_date date,
  estimate numeric(5, 1) check (estimate >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tickets_board on tickets (workstream_id, status);

create table ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets on delete cascade,
  author_id uuid not null references profiles default auth.uid(),
  body text not null check (length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);

create table ticket_history (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references tickets on delete cascade,
  changed_by uuid references profiles default auth.uid(),
  changed_at timestamptz not null default now(),
  field text not null,
  old_value text,
  new_value text
);

alter table documents drop constraint if exists documents_entity_type_check;
alter table documents add constraint documents_entity_type_check check (entity_type in ('library', 'bank', 'activity', 'submission',
  'meeting', 'risk', 'issue', 'change_request', 'weekly_report', 'progress_report', 'invoice', 'ticket'));

-- Keys, validation and history -----------------------------------------------------------------
create or replace function public.trg_ticket_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare pfx text;
begin
  if tg_op = 'INSERT' then
    select coalesce(ticket_prefix, case when not is_shared then upper(code) end) into pfx from workstreams where id = new.workstream_id;
    if pfx is null then raise exception 'Tickets belong on a developer board, not the Shared workstream.'; end if;
    perform pg_advisory_xact_lock(hashtext('tickets:' || new.workstream_id));
    select coalesce(max(seq), 0) + 1 into new.seq from tickets where workstream_id = new.workstream_id;
    new.key := pfx || '-' || new.seq;
  elsif new.workstream_id is distinct from old.workstream_id then
    raise exception 'A ticket cannot move between boards.';
  end if;
  if not in_lookup('ticket_type', new.type) or not in_lookup('ticket_priority', new.priority) or not in_lookup('ticket_status', new.status) then
    raise exception 'Unknown ticket type, priority or status. The administrator manages these lists.';
  end if;
  if new.assignee_id is not null and not user_can_see(new.assignee_id, new.workstream_id, false) then
    raise exception 'The assignee cannot see this board.';
  end if;
  if new.activity_id is not null and not exists (select 1 from activities where id = new.activity_id and workstream_id = new.workstream_id) then
    raise exception 'Link the ticket to an activity on the same workstream.';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger tickets_before before insert or update on tickets for each row execute function trg_ticket_before();

create or replace function public.trg_ticket_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare f text; o jsonb := to_jsonb(old); n jsonb := to_jsonb(new);
begin
  if tg_op = 'INSERT' then
    insert into ticket_history (ticket_id, field, new_value) values (new.id, 'created', new.status::text);
    perform notify_users(array[new.assignee_id], 'Ticket', new.key || ' assigned to you: ' || new.title, new.workstream_id, false, 'ticket', new.id, '/tickets', 'Tickets');
    return null;
  end if;
  foreach f in array array['status', 'assignee_id', 'priority', 'type', 'due_date', 'activity_id', 'title', 'labels', 'estimate'] loop
    if o -> f is distinct from n -> f then
      insert into ticket_history (ticket_id, field, old_value, new_value) values (new.id, f, o ->> f, n ->> f);
    end if;
  end loop;
  if old.status is distinct from new.status or old.assignee_id is distinct from new.assignee_id then
    perform notify_users(array_remove(array[new.assignee_id, new.reporter_id], auth.uid()), 'Ticket',
      new.key || ': ' || case when old.status is distinct from new.status then 'moved to ' || new.status else 'reassigned' end,
      new.workstream_id, false, 'ticket', new.id, '/tickets', 'Tickets');
  end if;
  return null;
end $$;
create trigger tickets_after after insert or update on tickets for each row execute function trg_ticket_after();
create trigger tickets_audit after insert or update or delete on tickets for each row execute function trg_audit();
create trigger ticket_comments_audit after insert on ticket_comments for each row execute function trg_audit();

-- Access ---------------------------------------------------------------------------------------
alter table tickets enable row level security; alter table tickets force row level security;
alter table ticket_comments enable row level security; alter table ticket_comments force row level security;
alter table ticket_history enable row level security; alter table ticket_history force row level security;

create policy tk_read on tickets for select to authenticated using (can_see_workstream(workstream_id));
create policy tk_insert on tickets for insert to authenticated with check (
  has_perm('ticket.create') and can_see_workstream(workstream_id) and reporter_id = auth.uid());
create policy tk_update on tickets for update to authenticated
  using (has_perm('ticket.manage') and can_see_workstream(workstream_id))
  with check (has_perm('ticket.manage') and can_see_workstream(workstream_id));
create policy tk_delete on tickets for delete to authenticated using (has_role('ADMIN'));

create policy tkc_read on ticket_comments for select to authenticated using (
  exists (select 1 from tickets t where t.id = ticket_id and can_see_workstream(t.workstream_id)));
create policy tkc_insert on ticket_comments for insert to authenticated with check (
  -- Anyone who can see the board comments, except a read-only Director
  author_id = auth.uid() and not (roles_of(auth.uid()) <@ array['BDIH_DIRECTOR']::app_role[])
  and exists (select 1 from tickets t where t.id = ticket_id and can_see_workstream(t.workstream_id)));
create policy tkh_read on ticket_history for select to authenticated using (
  exists (select 1 from tickets t where t.id = ticket_id and can_see_workstream(t.workstream_id)));

grant select, insert, update on tickets to authenticated;
grant select, insert on ticket_comments to authenticated;
grant select on ticket_history to authenticated;

insert into permission_catalogue (permission, description, sort_order) values
  ('ticket.create', 'Raise tickets for the developers', 23),
  ('ticket.manage', 'Move, assign and edit tickets', 24)
on conflict (permission) do nothing;
insert into role_permissions (permission, role)
select p, r::app_role from (values
  ('ticket.create', '{ADMIN,BDIH_LEAD,BDIH_PO,BDIH_BA,BDIH_TEAM,BOCRA_REP,BOCRA_TEAM,DEV_LEAD,DEV_MEMBER}'),
  ('ticket.manage', '{ADMIN,BDIH_LEAD,BDIH_PO,BDIH_BA,BDIH_TEAM,DEV_LEAD,DEV_MEMBER}')) v(p, roles)
cross join unnest(roles::text[]) r
on conflict do nothing;

-- Board view with names, for the app and the report builder
create or replace view public.v_tickets with (security_invoker = true) as
select t.*, w.name as workstream, a.full_name as assignee, r.full_name as reporter, ac.name as activity,
       (select count(*) from ticket_comments c where c.ticket_id = t.id) as comment_count
from tickets t join workstreams w on w.id = t.workstream_id
left join profiles a on a.id = t.assignee_id left join profiles r on r.id = t.reporter_id
left join activities ac on ac.id = t.activity_id;
grant select on v_tickets to authenticated;

alter publication supabase_realtime add table tickets;
