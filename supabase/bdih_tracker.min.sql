-- BDIH Project Tracker database, compressed. Built 2026-11-01 from supabase/migrations and seed.sql.
create extension if not exists pgcrypto;
create extension if not exists citext;
create type org_type as enum ('Client', 'Project Manager', 'Developer');
create type app_role as enum ('ADMIN', 'BDIH_DIRECTOR', 'BDIH_LEAD', 'BDIH_PO', 'BDIH_BA', 'BDIH_TEAM', 'BOCRA_REP', 'BOCRA_TEAM', 'DEV_LEAD', 'DEV_MEMBER');
create type activity_type as enum ('Task', 'Review', 'Milestone', 'Meeting', 'Report');
create type activity_status as enum ('Not started', 'In progress', 'Submitted', 'Under BDIH review', 'Returned to developer',
'Under BOCRA review', 'Approved', 'Complete', 'On hold', 'Cancelled');
create type review_stage as enum ('BDIH', 'BOCRA');
create type link_type as enum ('FS', 'SS', 'FF');
create type submission_state as enum ('Under BDIH review', 'Under BOCRA review', 'Returned', 'Approved');
create table organisations (
id uuid primary key default gen_random_uuid(),
name text not null unique,
short_name text not null unique,
type org_type not null,
contact text,
active boolean not null default true,
created_at timestamptz not null default now()
);
create table workstreams (
id uuid primary key default gen_random_uuid(),
code text not null unique,
name text not null,
owner_organisation_id uuid not null references organisations,
is_shared boolean not null default false,
website text,
created_at timestamptz not null default now()
);
create unique index workstreams_one_shared on workstreams (is_shared) where is_shared;
create table profiles (
id uuid primary key references auth.users on delete cascade,
username citext not null unique check (username ~ '^[a-z0-9._]{3,30}$'),
full_name text not null,
organisation_id uuid not null references organisations,
role app_role not null,
job_title text,
phone text,
email text,
active boolean not null default true,
must_change_password boolean not null default true,
delegated boolean not null default false,
failed_logins timestamptz[] not null default '{}',
locked_until timestamptz,
last_login_at timestamptz,
last_login_ip text,
notification_prefs jsonb not null default '{}',
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
);
create table user_roles (
user_id uuid not null references profiles on delete cascade,
role app_role not null,
granted_by uuid references profiles default auth.uid(),
granted_at timestamptz not null default now(),
primary key (user_id, role)
);
create table user_workstreams (
user_id uuid not null references profiles on delete cascade,
workstream_id uuid not null references workstreams on delete cascade,
access text not null default 'edit' check (access in ('view', 'edit')),
primary key (user_id, workstream_id)
);
create table account_requests (
id uuid primary key default gen_random_uuid(),
requested_by uuid not null references profiles default auth.uid(),
organisation_id uuid not null references organisations,
full_name text not null,
username citext not null check (username ~ '^[a-z0-9._]{3,30}$'),
email text not null,
job_title text,
status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected')),
decided_by uuid references profiles,
decided_at timestamptz,
created_at timestamptz not null default now()
);
create table resources (
id uuid primary key default gen_random_uuid(),
name text not null unique,
organisation_id uuid not null references organisations,
role_description text,
linked_user_id uuid references profiles
);
create table settings (
id boolean primary key default true check (id),
project_start date not null,
contract_months int not null default 3 check (contract_months between 1 and 36),
bdih_review_days int not null default 3 check (bdih_review_days between 1 and 30),
bocra_review_days int not null default 5 check (bocra_review_days between 1 and 30),
weekly_report_day int not null default 5 check (weekly_report_day between 1 and 5),
threshold_on_track numeric(4, 2) not null default 0.95,
threshold_at_risk numeric(4, 2) not null default 0.85,
festive_start date,
festive_end date,
current_baseline_id uuid,
locked_through date,
app_name text not null default 'Project Tracker',
app_subtitle text not null default 'BOCRA and UASF Trust websites',
project_name text not null default 'BOCRA and UASF Trust websites',
vat_rate numeric(4, 1) not null default 14 check (vat_rate between 0 and 50),
escalation_days int not null default 3 check (escalation_days between 1 and 30),
idle_minutes int not null default 30 check (idle_minutes between 5 and 480),
session_hours int not null default 12 check (session_hours between 1 and 24),
lockout_attempts int not null default 5 check (lockout_attempts between 3 and 20),
lockout_minutes int not null default 15 check (lockout_minutes between 1 and 1440),
password_min_length int not null default 12 check (password_min_length between 8 and 64),
updated_at timestamptz not null default now(),
check (threshold_at_risk <= threshold_on_track),
check (festive_end is null or festive_start is null or festive_end >= festive_start)
);
create table closure_days (
date date primary key,
reason text not null,
source text not null check (source in ('festive closure', 'public holiday'))
);
create table lookups (
list_name text not null,
value text not null,
sort_order int not null default 0,
protected boolean not null default false,
label text,
primary key (list_name, value)
);
create table role_labels (
role app_role primary key,
label text not null unique
);
create table activities (
id uuid primary key default gen_random_uuid(),
display_order int not null,
workstream_id uuid not null references workstreams,
phase text not null default 'Phase 1',
name text not null check (length(name) between 1 and 200),
type activity_type not null default 'Task',
review_stage review_stage,
deliverable_ref text,
lead_resource_id uuid references resources,
support_resource_id uuid references resources,
duration int not null default 1 check (duration between 0 and 1000),
fixed_start date,
start_date date,
finish_date date,
total_float int,
is_critical boolean not null default false,
status activity_status not null default 'Not started',
pct_done int not null default 0 check (pct_done between 0 and 100),
actual_start date,
actual_finish date,
notes text,
visible_to_developers boolean not null default false,
submittable boolean not null default false,
doc_category text,
bdih_review_activity_id uuid references activities,
bocra_review_activity_id uuid references activities,
for_activity_id uuid references activities,
parent_id uuid references activities,
indent smallint not null default 0 check (indent between 0 and 6),
auto_done boolean not null default false,
deleted_at timestamptz,
created_by uuid default auth.uid(),
created_at timestamptz not null default now(),
updated_at timestamptz not null default now(),
check (type <> 'Review' or review_stage is not null),
check (actual_finish is null or actual_start is null or actual_finish >= actual_start)
);
create index activities_ws on activities (workstream_id) where deleted_at is null;
create index activities_order on activities (display_order);
create table activity_links (
id uuid primary key default gen_random_uuid(),
predecessor_id uuid not null references activities on delete cascade,
successor_id uuid not null references activities on delete cascade,
link_type link_type not null default 'FS',
lag int not null default 0 check (lag between -100 and 100),
unique (predecessor_id, successor_id),
check (predecessor_id <> successor_id)
);
create index activity_links_succ on activity_links (successor_id);
create table baselines (
id uuid primary key default gen_random_uuid(),
name text not null,
saved_at timestamptz not null default now(),
saved_by uuid references profiles default auth.uid(),
change_request_id uuid
);
alter table settings add constraint settings_baseline_fk foreign key (current_baseline_id) references baselines;
create table baseline_items (
baseline_id uuid not null references baselines on delete cascade,
activity_id uuid not null references activities on delete cascade,
start_date date,
finish_date date,
primary key (baseline_id, activity_id)
);
create table status_history (
id bigint generated always as identity primary key,
activity_id uuid not null references activities on delete cascade,
changed_by uuid references profiles default auth.uid(),
changed_at timestamptz not null default now(),
field text not null,
old_value text,
new_value text,
comment text,
is_correction boolean not null default false
);
create index status_history_act on status_history (activity_id, changed_at desc);
create table submissions (
id uuid primary key default gen_random_uuid(),
activity_id uuid not null references activities,
workstream_id uuid not null references workstreams,
version int not null,
submitted_by uuid not null references profiles default auth.uid(),
submitted_at timestamptz not null default now(),
cover_note text not null,
state submission_state not null,
unique (activity_id, version)
);
create table reviews (
id uuid primary key default gen_random_uuid(),
submission_id uuid not null references submissions on delete cascade,
stage review_stage not null,
reviewer_id uuid references profiles,
due_date date not null,
decided_at timestamptz,
outcome text check (outcome in ('Ready', 'Not ready', 'Approved', 'Returned')),
findings text,
checklist_result jsonb,
overdue_notified boolean not null default false,
due_soon_notified boolean not null default false
);
create index reviews_open on reviews (due_date) where decided_at is null;
create table documents (
id uuid primary key default gen_random_uuid(),
workstream_id uuid not null references workstreams,
entity_type text not null default 'library'
check (entity_type in ('library', 'bank', 'activity', 'submission', 'meeting', 'risk', 'issue', 'change_request', 'weekly_report', 'progress_report')),
entity_id uuid,
category text not null,
title text not null,
visible_to_developers boolean not null default false,
deleted_at timestamptz,
deleted_by uuid references profiles,
created_by uuid references profiles default auth.uid(),
created_at timestamptz not null default now()
);
create index documents_entity on documents (entity_type, entity_id);
create table document_versions (
id uuid primary key default gen_random_uuid(),
document_id uuid not null references documents on delete cascade,
version_no int not null,
file_name text not null,
storage_path text not null unique,
size_bytes bigint not null check (size_bytes between 1 and 104857600),
mime_type text not null,
sha256 text,
scan_status text not null default 'Pending' check (scan_status in ('Pending', 'Clean', 'Infected', 'Error')),
comment text,
uploaded_by uuid not null references profiles default auth.uid(),
uploaded_at timestamptz not null default now(),
unique (document_id, version_no)
);
create table submission_documents (
submission_id uuid not null references submissions on delete cascade,
document_id uuid not null references documents,
version_no int not null,
primary key (submission_id, document_id)
);
create table weekly_reports (
id uuid primary key default gen_random_uuid(),
workstream_id uuid not null references workstreams,
week_ending date not null,
submitted_by uuid not null references profiles default auth.uid(),
submitted_at timestamptz not null default now(),
work_completed text not null,
work_planned text not null,
issues text, risks text, change_requests text, support_needed text,
reviewed_by uuid references profiles,
reviewed_at timestamptz,
bdih_comment text,
unique (workstream_id, week_ending)
);
create table weekly_report_items (
report_id uuid not null references weekly_reports on delete cascade,
activity_id uuid not null references activities,
pct_done int not null check (pct_done between 0 and 100),
primary key (report_id, activity_id)
);
create table progress_reports (
id uuid primary key default gen_random_uuid(),
scope text not null check (scope in ('combined', 'workstream')),
workstream_id uuid references workstreams,
period_start date not null,
period_end date not null,
generated_by uuid references profiles default auth.uid(),
generated_at timestamptz not null default now(),
official_month text,
pdf_path text,
docx_path text,
commentary jsonb,
check (scope = 'combined' or workstream_id is not null),
check (period_end >= period_start)
);
create table deliverables (
id uuid primary key default gen_random_uuid(),
ref text not null,
name text not null,
phase text not null,
owner_organisation_id uuid not null references organisations,
workstream_id uuid not null references workstreams,
activity_id uuid references activities
);
create table risks (
id uuid primary key default gen_random_uuid(),
workstream_id uuid not null references workstreams,
visible_to_developers boolean not null default false,
title text not null,
description text,
likelihood int not null check (likelihood between 1 and 5),
impact int not null check (impact between 1 and 5),
score int generated always as (likelihood * impact) stored,
owner_id uuid references profiles,
mitigation text,
due_date date,
status text not null default 'Open' check (status in ('Open', 'Monitoring', 'Closed')),
escalation_level int not null default 0,
created_by uuid references profiles default auth.uid(),
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
);
create table issues (
id uuid primary key default gen_random_uuid(),
workstream_id uuid not null references workstreams,
visible_to_developers boolean not null default false,
title text not null,
description text,
severity text not null default 'Medium' check (severity in ('Low', 'Medium', 'High', 'Critical')),
owner_id uuid references profiles,
raised_on date not null default current_date,
target_date date,
status text not null default 'Open' check (status in ('Open', 'In progress', 'Resolved', 'Closed')),
resolution text,
escalation_level int not null default 0,
created_by uuid references profiles default auth.uid(),
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
);
create table decisions (
id uuid primary key default gen_random_uuid(),
workstream_id uuid not null references workstreams,
visible_to_developers boolean not null default false,
decision text not null,
decision_date date not null,
made_by text,
forum text,
related_items text,
status text not null default 'Made' check (status in ('Made', 'Required')),
created_by uuid references profiles default auth.uid(),
created_at timestamptz not null default now()
);
create table change_requests (
id uuid primary key default gen_random_uuid(),
workstream_id uuid not null references workstreams,
visible_to_developers boolean not null default false,
title text not null,
description text not null,
requested_by uuid references profiles default auth.uid(),
requested_on date not null default current_date,
impact_scope text check (impact_scope in ('Low', 'Medium', 'High')),
impact_time text,
impact_cost text,
bdih_recommendation text,
recommended_by uuid references profiles,
bocra_decision text not null default 'Pending' check (bocra_decision in ('Pending', 'Approved', 'Rejected')),
bocra_decision_text text,
decided_by uuid references profiles,
decided_at timestamptz,
plan_changes text,
status text not null default 'Under assessment',
created_by uuid references profiles default auth.uid(),
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
);
alter table baselines add constraint baselines_cr_fk foreign key (change_request_id) references change_requests;
create table meetings (
id uuid primary key default gen_random_uuid(),
workstream_id uuid not null references workstreams,
visible_to_developers boolean not null default false,
forum text not null,
title text not null,
meeting_date date not null,
agenda text,
decisions text,
minutes_document_id uuid references documents,
created_by uuid references profiles default auth.uid(),
created_at timestamptz not null default now()
);
create table meeting_attendees (
meeting_id uuid not null references meetings on delete cascade,
user_id uuid not null references profiles,
primary key (meeting_id, user_id)
);
create table action_items (
id uuid primary key default gen_random_uuid(),
meeting_id uuid references meetings on delete cascade,
workstream_id uuid not null references workstreams,
visible_to_developers boolean not null default false,
description text not null,
owner_id uuid not null references profiles,
due_date date not null,
status text not null default 'Open' check (status in ('Open', 'Done', 'Cancelled')),
reminded boolean not null default false,
created_at timestamptz not null default now()
);
create table comments (
id uuid primary key default gen_random_uuid(),
entity_type text not null,
entity_id uuid not null,
workstream_id uuid not null references workstreams,
visible_to_developers boolean not null default false,
author_id uuid not null references profiles default auth.uid(),
body text not null check (length(body) between 1 and 5000),
created_at timestamptz not null default now()
);
create index comments_entity on comments (entity_type, entity_id);
create table notifications (
id uuid primary key default gen_random_uuid(),
user_id uuid not null references profiles on delete cascade,
type text not null,
category text not null default 'General',
entity_type text,
entity_id uuid,
title text not null,
link text,
emailed_at timestamptz,
read_at timestamptz,
created_at timestamptz not null default now()
);
create index notifications_user on notifications (user_id, created_at desc);
create table reminder_flags (key text primary key, created_at timestamptz not null default now());
create table audit_log (
id bigint generated always as identity primary key,
occurred_at timestamptz not null default now(),
user_id uuid,
ip text,
action text not null,
entity_type text,
entity_id text,
before jsonb,
after jsonb
);
create index audit_log_time on audit_log (occurred_at desc);
create index audit_log_user on audit_log (user_id, occurred_at desc);
create index audit_log_entity on audit_log (entity_type, entity_id);
create table role_permissions (
permission text not null,
role app_role not null,
primary key (permission, role)
);
create table permission_catalogue (
permission text primary key,
description text not null,
sort_order int not null default 0
);
create table password_reset_requests (
id uuid primary key default gen_random_uuid(),
user_id uuid not null references profiles on delete cascade,
requested_at timestamptz not null default now(),
ip text,
status text not null default 'Pending' check (status in ('Pending', 'Done', 'Dismissed')),
handled_by uuid references profiles,
handled_at timestamptz
);
create table report_definitions (
id uuid primary key default gen_random_uuid(),
name text not null,
dataset text not null check (dataset in ('activities', 'deliverables', 'submissions', 'invoices', 'risks', 'issues', 'weekly', 'documents')),
definition jsonb not null,
shared boolean not null default false,
created_by uuid not null references profiles default auth.uid(),
created_at timestamptz not null default now()
);
create or replace function public.my_role() returns app_role
language sql stable security definer set search_path = public as $$
select role from profiles where id = auth.uid() and active
$$;
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
create or replace function public.is_business_day(d date) returns boolean
language sql stable security definer set search_path = public as $$
select extract(isodow from d) < 6 and not exists (select 1 from closure_days c where c.date = d)
$$;
create or replace function public.bd_ceil(d date) returns date
language plpgsql stable security definer set search_path = public as $$
begin
for i in 0..60 loop
if is_business_day(d + i) then return d + i; end if;
end loop;
return d;
end $$;
create or replace function public.bd_floor(d date) returns date
language plpgsql stable security definer set search_path = public as $$
begin
for i in 0..60 loop
if is_business_day(d - i) then return d - i; end if;
end loop;
return d;
end $$;
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
create or replace function public.bd_count(a date, b date) returns int
language sql stable security definer set search_path = public as $$
select count(*)::int from generate_series(a, b, interval '1 day') g where is_business_day(g::date)
$$;
create or replace function public.closure_calendar() returns table (date date, reason text)
language sql stable security definer set search_path = public as $$
select c.date, c.reason from closure_days c where auth.uid() is not null order by c.date
$$;
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
create or replace function public.log_event(p_action text, p_entity_type text default null, p_entity_id text default null, p_details jsonb default null)
returns void language sql security definer set search_path = public as $$
insert into audit_log (user_id, ip, action, entity_type, entity_id, after)
select auth.uid(), request_ip(), p_action, p_entity_type, p_entity_id, p_details where auth.uid() is not null
$$;
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
do $$
declare t text;
begin
foreach t in array array['organisations', 'workstreams', 'profiles', 'user_workstreams', 'account_requests', 'resources',
'settings', 'closure_days', 'lookups', 'activities', 'activity_links', 'baselines', 'baseline_items', 'status_history',
'submissions', 'reviews', 'documents', 'document_versions', 'submission_documents', 'weekly_reports', 'weekly_report_items',
'progress_reports', 'deliverables', 'risks', 'issues', 'decisions', 'change_requests', 'meetings', 'meeting_attendees',
'action_items', 'comments', 'notifications', 'reminder_flags', 'audit_log', 'role_permissions', 'permission_catalogue',
'password_reset_requests', 'report_definitions', 'user_roles', 'role_labels']
loop
execute format('alter table %I enable row level security', t);
execute format('alter table %I force row level security', t);
end loop;
end $$;
create policy org_read on organisations for select to authenticated using (true);
create policy org_admin on organisations for all to authenticated using (has_perm('users.manage')) with check (has_perm('users.manage'));
create policy ws_read on workstreams for select to authenticated using (true);
create policy ws_admin on workstreams for all to authenticated using (has_perm('users.manage')) with check (has_perm('users.manage'));
create policy settings_read on settings for select to authenticated using (is_oversight());
create policy settings_write on settings for update to authenticated using (has_perm('settings.edit')) with check (has_perm('settings.edit'));
create policy closure_read on closure_days for select to authenticated using (is_oversight());
create policy closure_write on closure_days for all to authenticated using (has_perm('settings.edit')) with check (has_perm('settings.edit'));
create policy lookups_read on lookups for select to authenticated using (true);
create policy lookups_insert on lookups for insert to authenticated with check (has_perm('users.manage') and not protected);
create policy lookups_update on lookups for update to authenticated using (has_perm('users.manage') and not protected) with check (has_perm('users.manage') and not protected);
create policy lookups_delete on lookups for delete to authenticated using (has_perm('users.manage') and not protected and not lookup_in_use(list_name, value));
create policy resources_read on resources for select to authenticated using (true);
create policy resources_admin on resources for all to authenticated using (has_role('ADMIN')) with check (has_role('ADMIN'));
create policy profiles_read on profiles for select to authenticated using (
is_oversight()
or id = auth.uid()
or organisation_id = my_org()
or (active and role in ('BDIH_LEAD', 'BDIH_PO', 'BDIH_BA', 'BDIH_TEAM', 'BOCRA_REP'))
);
create policy profiles_admin on profiles for all to authenticated using (has_perm('users.manage')) with check (has_perm('users.manage'));
create policy rl_read on role_labels for select to authenticated using (true);
create policy rl_admin on role_labels for all to authenticated using (has_perm('users.manage')) with check (has_perm('users.manage'));
create policy ur_read on user_roles for select to authenticated using (user_id = auth.uid() or is_oversight());
create policy ur_admin on user_roles for all to authenticated using (has_perm('users.manage')) with check (has_perm('users.manage'));
create policy uw_read on user_workstreams for select to authenticated using (user_id = auth.uid() or is_oversight());
create policy uw_admin on user_workstreams for all to authenticated using (has_perm('users.manage')) with check (has_perm('users.manage'));
create policy req_read on account_requests for select to authenticated using (requested_by = auth.uid() or has_perm('users.manage'));
create policy req_insert on account_requests for insert to authenticated with check (
has_role('DEV_LEAD') and requested_by = auth.uid()
and organisation_id = my_org() and status = 'Pending');
create policy req_admin on account_requests for update to authenticated using (has_perm('users.manage')) with check (has_perm('users.manage'));
create policy act_read on activities for select to authenticated using (
(deleted_at is null and can_see_item(workstream_id, visible_to_developers)) or has_role('ADMIN'));
create policy act_insert on activities for insert to authenticated with check (has_perm('plan.edit'));
create policy act_update on activities for update to authenticated using (has_perm('plan.edit')) with check (has_perm('plan.edit'));
create policy act_delete on activities for delete to authenticated using (has_role('ADMIN'));
create policy links_read on activity_links for select to authenticated using (
can_see_activity(predecessor_id) and can_see_activity(successor_id));
create policy links_write on activity_links for all to authenticated using (has_perm('plan.edit')) with check (has_perm('plan.edit'));
create policy bl_read on baselines for select to authenticated using (true);
create policy bl_write on baselines for insert to authenticated with check (has_perm('plan.baseline'));
create policy bli_read on baseline_items for select to authenticated using (can_see_activity(activity_id));
create policy bli_write on baseline_items for insert to authenticated with check (has_perm('plan.baseline'));
create policy hist_read on status_history for select to authenticated using (can_see_activity(activity_id));
create policy sub_read on submissions for select to authenticated using (can_see_activity(activity_id));
create policy rev_read on reviews for select to authenticated using (
exists (select 1 from submissions s where s.id = submission_id and can_see_activity(s.activity_id)));
create policy subdoc_read on submission_documents for select to authenticated using (
exists (select 1 from submissions s where s.id = submission_id and can_see_activity(s.activity_id)));
create policy doc_read on documents for select to authenticated using (
(deleted_at is null and can_see_item(workstream_id, visible_to_developers)) or has_role('ADMIN'));
create policy doc_insert on documents for insert to authenticated with check (
created_by = auth.uid() and can_see_workstream(workstream_id) and deleted_at is null and not has_role('BDIH_DIRECTOR')
and (is_oversight() or not visible_to_developers)
and (entity_type <> 'bank' or (has_perm('bank.upload') and workstream_id = shared_workstream() and visible_to_developers)));
create policy docv_read on document_versions for select to authenticated using (
exists (select 1 from documents d where d.id = document_id
and ((d.deleted_at is null and can_see_item(d.workstream_id, d.visible_to_developers)) or has_role('ADMIN'))));
create policy docv_insert on document_versions for insert to authenticated with check (
uploaded_by = auth.uid()
and exists (select 1 from documents d where d.id = document_id and d.deleted_at is null and can_see_workstream(d.workstream_id)
and (d.entity_type <> 'bank' or has_perm('bank.upload'))
and storage_path like 'workstreams/' || d.workstream_id || '/%'));
create policy wk_read on weekly_reports for select to authenticated using (can_see_workstream(workstream_id));
create policy wk_review on weekly_reports for update to authenticated using (has_perm('weekly.review')) with check (has_perm('weekly.review'));
create policy wki_read on weekly_report_items for select to authenticated using (
exists (select 1 from weekly_reports w where w.id = report_id and can_see_workstream(w.workstream_id)));
create policy pr_read on progress_reports for select to authenticated using (
is_oversight() or (scope = 'workstream' and can_see_workstream(workstream_id)));
create policy pr_insert on progress_reports for insert to authenticated with check (
generated_by = auth.uid() and (is_oversight() or (scope = 'workstream' and can_see_workstream(workstream_id))));
create policy dl_read on deliverables for select to authenticated using (
is_oversight() or (can_see_workstream(workstream_id)) or (activity_id is not null and can_see_activity(activity_id)));
create policy dl_write on deliverables for all to authenticated using (has_perm('plan.edit')) with check (has_perm('plan.edit'));
do $$
declare t text;
begin
foreach t in array array['risks', 'issues', 'decisions', 'change_requests']
loop
execute format($f$create policy %1$s_read on %1$I for select to authenticated using (can_see_item(workstream_id, visible_to_developers))$f$, t);
execute format($f$create policy %1$s_insert on %1$I for insert to authenticated with check (
created_by = auth.uid() and can_see_workstream(workstream_id) and not has_role('BDIH_DIRECTOR') and (is_oversight() or not visible_to_developers))$f$, t);
execute format($f$create policy %1$s_delete on %1$I for delete to authenticated using (has_perm('register.delete'))$f$, t);
end loop;
end $$;
create policy risks_update on risks for update to authenticated using (has_perm('register.edit')) with check (true);
create policy issues_update on issues for update to authenticated using (has_perm('register.edit')) with check (true);
create policy decisions_update on decisions for update to authenticated using (has_perm('register.edit')) with check (true);
create policy change_requests_update on change_requests for update to authenticated
using (has_perm('cr.recommend') or has_perm('cr.decide')) with check (true);
create policy mtg_read on meetings for select to authenticated using (can_see_item(workstream_id, visible_to_developers));
create policy mtg_write on meetings for all to authenticated using (has_perm('meeting.edit')) with check (has_perm('meeting.edit'));
create policy mta_read on meeting_attendees for select to authenticated using (
exists (select 1 from meetings m where m.id = meeting_id and can_see_item(m.workstream_id, m.visible_to_developers)));
create policy mta_write on meeting_attendees for all to authenticated using (has_perm('meeting.edit')) with check (
has_perm('meeting.edit') and exists (select 1 from meetings m where m.id = meeting_id and user_can_see(user_id, m.workstream_id, m.visible_to_developers)));
create policy ai_read on action_items for select to authenticated using (can_see_item(workstream_id, visible_to_developers));
create policy ai_insert on action_items for insert to authenticated with check (has_perm('meeting.edit') and user_can_see(owner_id, workstream_id, visible_to_developers));
create policy ai_update on action_items for update to authenticated using (has_perm('meeting.edit') or owner_id = auth.uid()) with check (has_perm('meeting.edit') or owner_id = auth.uid());
create policy cm_read on comments for select to authenticated using (can_see_item(workstream_id, visible_to_developers));
create policy nt_read on notifications for select to authenticated using (user_id = auth.uid());
create policy nt_mark on notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy audit_read on audit_log for select to authenticated using (has_perm('audit.view'));
create policy rp_read on role_permissions for select to authenticated using (true);
create policy rp_admin on role_permissions for all to authenticated using (has_perm('users.manage')) with check (has_perm('users.manage'));
create policy pc_read on permission_catalogue for select to authenticated using (true);
create policy prr_admin on password_reset_requests for select to authenticated using (has_perm('users.manage'));
create policy prr_handle on password_reset_requests for update to authenticated using (has_perm('users.manage')) with check (has_perm('users.manage'));
create policy rd_read on report_definitions for select to authenticated using (created_by = auth.uid() or (shared and is_oversight()));
create policy rd_insert on report_definitions for insert to authenticated with check (created_by = auth.uid());
create policy rd_delete on report_definitions for delete to authenticated using (created_by = auth.uid());
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete on audit_log, status_history, submissions, reviews, notifications, reminder_flags from authenticated;
grant update (read_at) on notifications to authenticated;
grant execute on all functions in schema public to authenticated;
revoke execute on function recalc_schedule(), notify_users(uuid[], text, text, uuid, boolean, text, uuid, text, text) from authenticated;
create or replace function public.update_progress(p_activity uuid, p_pct int, p_status activity_status,
p_actual_start date, p_actual_finish date, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
a activities%rowtype; me profiles%rowtype; t org_type; lead_org org_type; lock date; corr boolean := false;
v_pct int := greatest(0, least(100, coalesce(p_pct, 0)));
v_status activity_status := p_status; v_as date := p_actual_start; v_af date := p_actual_finish;
begin
select * into me from profiles where id = auth.uid() and active;
if not found then raise exception 'Not signed in.'; end if;
select * into a from activities where id = p_activity and deleted_at is null for update;
if not found or not can_see_item(a.workstream_id, a.visible_to_developers) then raise exception 'Activity not found.'; end if;
t := org_type_of(me.id);
select o.type into lead_org from resources r join organisations o on o.id = r.organisation_id where r.id = a.lead_resource_id;
if has_perm('progress.any') then
null;
elsif has_perm('progress.bocra') and lead_org = 'Client' then
null;
elsif has_perm('progress.own') and exists (select 1 from user_workstreams where user_id = me.id and workstream_id = a.workstream_id) then
null;
else
raise exception 'You cannot update progress on this activity.';
end if;
if not has_perm('progress.any') and v_status is distinct from a.status then
if v_status not in ('Not started', 'In progress') and not (v_status = 'Complete' and not a.submittable) then
raise exception 'Status % is set through the submission workflow or by BDIH.', v_status;
end if;
end if;
if v_status = 'Complete' then
if v_af is null then raise exception 'An actual finish date is required to mark an activity Complete.'; end if;
v_pct := 100;
end if;
if v_status in ('On hold', 'Cancelled', 'Returned to developer') and v_status is distinct from a.status
and coalesce(trim(p_note), '') = '' then
raise exception 'A reason is required for %.', v_status;
end if;
if v_af is not null and v_as is null then v_as := v_af; end if;
if v_pct > 0 and v_as is null and a.type <> 'Milestone' then v_as := current_date; end if;
if v_as > current_date or v_af > current_date then raise exception 'Actual dates cannot be in the future.'; end if;
if v_status = 'Not started' and v_pct > 0 then v_status := 'In progress'; end if;
select locked_through into lock from settings;
if lock is not null and ((a.actual_start is distinct from v_as and least(a.actual_start, v_as) <= lock)
or (a.actual_finish is distinct from v_af and least(a.actual_finish, v_af) <= lock)) then
if coalesce(trim(p_note), '') = '' then raise exception 'Progress is locked through %. Give a reason for this correction.', lock; end if;
corr := true;
end if;
insert into status_history (activity_id, field, old_value, new_value, comment, is_correction)
select a.id, f, o, n, p_note, corr from (values
('pct_done', a.pct_done::text, v_pct::text), ('status', a.status::text, v_status::text),
('actual_start', a.actual_start::text, v_as::text), ('actual_finish', a.actual_finish::text, v_af::text)) x(f, o, n)
where o is distinct from n;
update activities set pct_done = v_pct, status = v_status, actual_start = v_as, actual_finish = v_af,
notes = case when coalesce(trim(p_note), '') <> '' and has_perm('progress.any') then coalesce(notes || E'\n', '') || p_note else notes end
where id = a.id;
end $$;
create or replace function public.activity_predecessors(p_activity uuid)
returns table (predecessor_id uuid, label text, link_type link_type, lag int)
language sql stable security definer set search_path = public as $$
select case when can_see_activity(l.predecessor_id) then l.predecessor_id end,
case when can_see_activity(l.predecessor_id) then p.name else 'Waits for BDIH or BOCRA action' end,
l.link_type, l.lag
from activity_links l join activities p on p.id = l.predecessor_id
where l.successor_id = p_activity and p.deleted_at is null and can_see_activity(p_activity)
$$;
create or replace function public.add_comment(p_activity uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare a activities%rowtype; cid uuid; mentioned uuid[]; blocked int;
begin
select * into a from activities where id = p_activity and deleted_at is null;
if not found or not can_see_item(a.workstream_id, a.visible_to_developers) then raise exception 'Activity not found.'; end if;
select coalesce(array_agg(p.id), '{}') into mentioned from profiles p
where p.active and p.username in (select lower(m[1]) from regexp_matches(p_body, '@([A-Za-z0-9._]+)', 'g') m);
select count(*) into blocked from unnest(mentioned) u where not user_can_see(u, a.workstream_id, a.visible_to_developers);
if blocked > 0 and not is_oversight() then raise exception 'You can only mention people who can see this activity.'; end if;
insert into comments (entity_type, entity_id, workstream_id, visible_to_developers, body)
values ('activity', a.id, a.workstream_id, a.visible_to_developers, p_body) returning id into cid;
perform notify_users(array(select u from unnest(mentioned) u where u <> auth.uid()), 'Mention',
(select full_name from profiles where id = auth.uid()) || ' mentioned you on ' || a.name,
a.workstream_id, a.visible_to_developers, 'activity', a.id, '/activity/' || a.id, 'Mentions');
return cid;
end $$;
create or replace function public.submit_deliverable(p_activity uuid, p_cover_note text, p_document_ids uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
a activities%rowtype; me profiles%rowtype; s settings%rowtype; sid uuid; ver int; via_bdih boolean;
rev_act uuid; reviewer uuid; due date;
begin
select * into me from profiles where id = auth.uid() and active;
select * into a from activities where id = p_activity and deleted_at is null for update;
if not found or not a.submittable or not can_see_item(a.workstream_id, a.visible_to_developers) then raise exception 'Deliverable not found.'; end if;
if not has_perm('submit.deliverable')
or not (org_type_of(me.id) = 'Project Manager'
or exists (select 1 from user_workstreams where user_id = me.id and workstream_id = a.workstream_id)) then
raise exception 'You cannot submit this deliverable.';
end if;
if exists (select 1 from submissions where activity_id = a.id and state in ('Under BDIH review', 'Under BOCRA review')) then
raise exception 'This deliverable is already under review.';
end if;
if coalesce(trim(p_cover_note), '') = '' or coalesce(array_length(p_document_ids, 1), 0) = 0 then
raise exception 'Add a cover note and at least one document.';
end if;
if exists (select 1 from unnest(p_document_ids) d where not exists (
select 1 from documents x where x.id = d and x.workstream_id = a.workstream_id and x.deleted_at is null)) then
raise exception 'Attach documents from this deliverable''s workstream only.';
end if;
select * into s from settings;
via_bdih := not (select is_shared from workstreams where id = a.workstream_id);
select coalesce(max(version), 0) + 1 into ver from submissions where activity_id = a.id;
insert into submissions (activity_id, workstream_id, version, cover_note, state)
values (a.id, a.workstream_id, ver, p_cover_note, case when via_bdih then 'Under BDIH review' else 'Under BOCRA review' end::submission_state)
returning id into sid;
insert into submission_documents (submission_id, document_id, version_no)
select sid, d.id, (select max(version_no) from document_versions v where v.document_id = d.id)
from documents d where d.id = any (p_document_ids);
rev_act := case when via_bdih then a.bdih_review_activity_id else a.bocra_review_activity_id end;
reviewer := coalesce((select resource_user(lead_resource_id) from activities where id = rev_act),
(users_with_role(case when via_bdih then 'BDIH_LEAD' else 'BOCRA_REP' end::app_role))[1]);
due := add_business_days(current_date, case when via_bdih then s.bdih_review_days else s.bocra_review_days end);
insert into reviews (submission_id, stage, reviewer_id, due_date)
values (sid, case when via_bdih then 'BDIH' else 'BOCRA' end::review_stage, reviewer, due);
insert into status_history (activity_id, field, old_value, new_value, comment)
values (a.id, 'status', a.status::text, case when via_bdih then 'Under BDIH review' else 'Under BOCRA review' end, 'Submitted v' || ver);
update activities set status = case when via_bdih then 'Under BDIH review' else 'Under BOCRA review' end::activity_status,
pct_done = 100, actual_start = coalesce(actual_start, current_date), actual_finish = current_date where id = a.id;
if via_bdih then
update activities set actual_start = null, actual_finish = null, pct_done = 0, status = 'Not started' where id = a.bocra_review_activity_id;
end if;
update activities set actual_start = current_date, actual_finish = null, pct_done = 0, status = 'In progress' where id = rev_act;
perform notify_users(array_append(users_with_role(case when via_bdih then 'BDIH_LEAD' else 'BOCRA_REP' end::app_role), reviewer),
'Review assigned', a.name || ' v' || ver || ' submitted for review, due ' || to_char(due, 'DD Mon YYYY'),
a.workstream_id, a.visible_to_developers, 'submission', sid, '/submissions', 'Submissions and reviews');
return sid;
end $$;
create or replace function public.bdih_recommend(p_review uuid, p_outcome text, p_findings text, p_checklist jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare r reviews%rowtype; sb submissions%rowtype; a activities%rowtype; s settings%rowtype; due date; nr uuid;
begin
if not has_perm('review.bdih') then raise exception 'Only BDIH reviewers record a recommendation.'; end if;
select * into r from reviews where id = p_review and stage = 'BDIH' for update;
if not found or r.decided_at is not null then raise exception 'This review is not open.'; end if;
if p_outcome not in ('Ready', 'Not ready') then raise exception 'Outcome must be Ready or Not ready.'; end if;
if p_outcome = 'Not ready' and coalesce(trim(p_findings), '') = '' then raise exception 'Give the reasons for Not ready.'; end if;
select * into sb from submissions where id = r.submission_id for update;
select * into a from activities where id = sb.activity_id for update;
select * into s from settings;
update reviews set outcome = p_outcome, findings = p_findings, checklist_result = p_checklist,
reviewer_id = auth.uid(), decided_at = now() where id = r.id;
if p_outcome = 'Ready' then
due := add_business_days(current_date, s.bocra_review_days);
update submissions set state = 'Under BOCRA review' where id = sb.id;
update activities set status = 'Under BOCRA review' where id = a.id;
update activities set status = 'Complete', pct_done = 100, actual_start = coalesce(actual_start, current_date), actual_finish = current_date
where id = a.bdih_review_activity_id;
update activities set status = 'In progress', pct_done = 0, actual_start = current_date, actual_finish = null
where id = a.bocra_review_activity_id;
insert into reviews (submission_id, stage, reviewer_id, due_date)
values (sb.id, 'BOCRA', coalesce((select resource_user(lead_resource_id) from activities where id = a.bocra_review_activity_id),
(users_with_role('BOCRA_REP'))[1]), due)
returning id into nr;
perform notify_users(users_with_role('BOCRA_REP'), 'Review assigned', 'BOCRA decision needed: ' || a.name || ' v' || sb.version,
a.workstream_id, a.visible_to_developers, 'submission', sb.id, '/submissions', 'Submissions and reviews');
else
update submissions set state = 'Returned' where id = sb.id;
update activities set status = 'Returned to developer', actual_finish = null, pct_done = least(pct_done, 90) where id = a.id;
update activities set status = 'Not started', pct_done = 0, actual_start = null, actual_finish = null where id = a.bdih_review_activity_id;
end if;
insert into status_history (activity_id, field, old_value, new_value, comment)
values (a.id, 'status', a.status::text, case when p_outcome = 'Ready' then 'Under BOCRA review' else 'Returned to developer' end, 'BDIH: ' || p_outcome || coalesce('. ' || p_findings, ''));
perform notify_users(array_append(dev_leads(a.workstream_id), sb.submitted_by),
case when p_outcome = 'Ready' then 'Submission forwarded' else 'Submission returned' end,
a.name || ' v' || sb.version || ': BDIH recommendation ' || p_outcome,
a.workstream_id, a.visible_to_developers, 'submission', sb.id, '/submissions', 'Submissions and reviews');
end $$;
create or replace function public.bocra_decide(p_review uuid, p_outcome text, p_findings text)
returns void language plpgsql security definer set search_path = public as $$
declare r reviews%rowtype; sb submissions%rowtype; a activities%rowtype; shared boolean;
begin
if not has_perm('review.bocra') then raise exception 'Only the BOCRA Project Lead approves or returns.'; end if;
select * into r from reviews where id = p_review and stage = 'BOCRA' for update;
if not found or r.decided_at is not null then raise exception 'This review is not open.'; end if;
if p_outcome not in ('Approved', 'Returned') then raise exception 'Outcome must be Approved or Returned.'; end if;
if p_outcome = 'Returned' and coalesce(trim(p_findings), '') = '' then raise exception 'Give the reasons for returning.'; end if;
select * into sb from submissions where id = r.submission_id for update;
select * into a from activities where id = sb.activity_id for update;
select is_shared into shared from workstreams where id = a.workstream_id;
update reviews set outcome = p_outcome, findings = p_findings, reviewer_id = auth.uid(), decided_at = now() where id = r.id;
if p_outcome = 'Approved' then
update submissions set state = 'Approved' where id = sb.id;
update activities set status = 'Complete', pct_done = 100, actual_finish = coalesce(actual_finish, (sb.submitted_at at time zone 'Africa/Gaborone')::date) where id = a.id;
update activities set status = 'Complete', pct_done = 100, actual_start = coalesce(actual_start, current_date), actual_finish = coalesce(actual_finish, current_date)
where id in (a.bdih_review_activity_id, a.bocra_review_activity_id);
else
update submissions set state = 'Returned' where id = sb.id;
update activities set status = case when shared then 'In progress' else 'Returned to developer' end::activity_status,
actual_finish = null, pct_done = least(pct_done, 90) where id = a.id;
update activities set status = 'Not started', pct_done = 0, actual_start = null, actual_finish = null
where id in (a.bdih_review_activity_id, a.bocra_review_activity_id);
end if;
insert into status_history (activity_id, field, old_value, new_value, comment)
values (a.id, 'status', a.status::text, case when p_outcome = 'Approved' then 'Complete' else 'Returned' end, 'BOCRA: ' || p_outcome || coalesce('. ' || p_findings, ''));
perform notify_users(dev_leads(a.workstream_id) || users_with_role('BDIH_LEAD') || sb.submitted_by,
'Submission ' || lower(p_outcome), a.name || ' v' || sb.version || ' ' || lower(p_outcome) || ' by BOCRA',
a.workstream_id, a.visible_to_developers, 'submission', sb.id, '/submissions', 'Submissions and reviews');
end $$;
create or replace function public.file_weekly_report(p_workstream uuid, p_week_ending date, p_fields jsonb, p_progress jsonb default '[]')
returns uuid language plpgsql security definer set search_path = public as $$
declare me profiles%rowtype; rid uuid; item jsonb; a activities%rowtype; v int;
begin
select * into me from profiles where id = auth.uid() and active;
if not has_perm('weekly.file')
or not exists (select 1 from user_workstreams where user_id = me.id and workstream_id = p_workstream) then
raise exception 'Only the Developer Lead, or a delegated team member, files the weekly report.';
end if;
if extract(isodow from p_week_ending) <> (select weekly_report_day from settings) then
raise exception 'The week ending date must fall on the configured report day.';
end if;
insert into weekly_reports (workstream_id, week_ending, work_completed, work_planned, issues, risks, change_requests, support_needed)
values (p_workstream, p_week_ending, p_fields ->> 'work_completed', p_fields ->> 'work_planned', p_fields ->> 'issues',
p_fields ->> 'risks', p_fields ->> 'change_requests', p_fields ->> 'support_needed')
returning id into rid;
for item in select * from jsonb_array_elements(p_progress) loop
select * into a from activities where id = (item ->> 'activity_id')::uuid and workstream_id = p_workstream and deleted_at is null;
continue when not found;
v := greatest(0, least(100, (item ->> 'pct_done')::int));
insert into weekly_report_items (report_id, activity_id, pct_done) values (rid, a.id, v);
if v <> a.pct_done then
insert into status_history (activity_id, field, old_value, new_value, comment)
values (a.id, 'pct_done', a.pct_done::text, v::text, 'Weekly report ' || p_week_ending);
update activities set pct_done = v, actual_start = case when v > 0 then coalesce(actual_start, current_date) else actual_start end,
status = case when v > 0 and status = 'Not started' then 'In progress' else status end where id = a.id;
end if;
end loop;
perform notify_users(users_with_role('BDIH_LEAD'), 'Weekly report filed', 'Weekly report filed: '
|| (select name from workstreams where id = p_workstream) || ', week ending ' || to_char(p_week_ending, 'DD Mon YYYY'),
p_workstream, false, 'weekly_report', rid, '/weekly', 'Weekly reports');
return rid;
end $$;
create or replace function public.save_baseline(p_name text, p_change_request uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid;
begin
if not has_perm('plan.baseline') then raise exception 'Only the BDIH Project Leader saves baselines.'; end if;
if exists (select 1 from baselines) and not exists (select 1 from change_requests where id = p_change_request and bocra_decision = 'Approved') then
raise exception 'No change is applied to the baseline without an approved change request.';
end if;
insert into baselines (name, change_request_id) values (p_name, p_change_request) returning id into bid;
insert into baseline_items (baseline_id, activity_id, start_date, finish_date)
select bid, id, start_date, finish_date from activities where deleted_at is null;
update settings set current_baseline_id = bid;
return bid;
end $$;
create or replace function public.lock_progress(p_through date) returns void
language plpgsql security definer set search_path = public as $$
begin
if not has_perm('plan.baseline') then raise exception 'Only the BDIH Project Leader locks reporting periods.'; end if;
update settings set locked_through = p_through;
end $$;
create or replace function public.delete_document(p_document uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d documents%rowtype;
begin
select * into d from documents where id = p_document and deleted_at is null;
if not found or not can_see_item(d.workstream_id, d.visible_to_developers) then raise exception 'Document not found.'; end if;
if d.entity_type = 'bank' and not has_perm('bank.upload') then raise exception 'Only BDIH and BOCRA manage the document bank.'; end if;
if not (has_perm('progress.any') or exists (select 1 from document_versions where document_id = d.id and uploaded_by = auth.uid())) then
raise exception 'Only the uploader or BDIH can delete this document.';
end if;
if exists (select 1 from submission_documents sd join submissions s on s.id = sd.submission_id where sd.document_id = d.id and s.state = 'Approved') then
raise exception 'Documents attached to an approved submission cannot be deleted.';
end if;
update documents set deleted_at = now(), deleted_by = auth.uid() where id = d.id;
end $$;
create or replace function public.restore_document(p_document uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
if not has_perm('users.manage') then raise exception 'Only administrators restore documents.'; end if;
update documents set deleted_at = null, deleted_by = null where id = p_document and deleted_at > now() - interval '90 days';
if not found then raise exception 'Document not found or older than 90 days.'; end if;
end $$;
create or replace function public.update_my_preferences(p_prefs jsonb) returns void
language sql security definer set search_path = public as $$
update profiles set notification_prefs = p_prefs || '{"Security": "Immediate"}' where id = auth.uid()
$$;
create or replace function public.admin_unlock_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
if not has_perm('users.manage') then raise exception 'Administrators only.'; end if;
update profiles set locked_until = null, failed_logins = '{}' where id = p_user;
end $$;
create or replace function public.admin_set_active(p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
if not has_perm('users.manage') then raise exception 'Administrators only.'; end if;
if p_user = auth.uid() then raise exception 'You cannot deactivate yourself.'; end if;
update public.profiles set active = p_active where id = p_user;
if not p_active then
delete from auth.refresh_tokens where user_id = p_user::text;
delete from auth.sessions where user_id = p_user;
end if;
end $$;
create or replace function public.admin_set_roles(p_user uuid, p_roles app_role[]) returns void
language plpgsql security definer set search_path = public as $$
begin
if not has_perm('users.manage') then raise exception 'Administrators only.'; end if;
delete from user_roles where user_id = p_user and role <> all (p_roles);
insert into user_roles (user_id, role)
select p_user, r from unnest(p_roles) r where r <> (select role from profiles where id = p_user)
on conflict do nothing;
end $$;
grant execute on function admin_set_roles(uuid, app_role[]) to authenticated;
create or replace function public.auth_lookup(p_username text)
returns table (user_id uuid, email text, active boolean, locked_until timestamptz, must_change_password boolean)
language sql stable security definer set search_path = public, auth as $$
select p.id, u.email, p.active, p.locked_until, p.must_change_password
from public.profiles p join auth.users u on u.id = p.id where p.username = lower(p_username)
$$;
create or replace function public.record_login(p_user uuid, p_success boolean, p_ip text) returns void
language plpgsql security definer set search_path = public as $$
declare fails timestamptz[];
begin
if p_success then
update profiles set failed_logins = '{}', last_login_at = now(), last_login_ip = p_ip where id = p_user;
insert into audit_log (user_id, ip, action, entity_type, entity_id) values (p_user, p_ip, 'login', 'user', p_user::text);
else
select array(select f from unnest(failed_logins || now()) f where f > now() - make_interval(mins => (select lockout_minutes from settings))) into fails from profiles where id = p_user;
if array_length(fails, 1) >= (select lockout_attempts from settings) then
update profiles set failed_logins = '{}', locked_until = now() + make_interval(mins => (select lockout_minutes from settings)) where id = p_user;
insert into audit_log (user_id, ip, action, entity_type, entity_id) values (p_user, p_ip, 'account.locked', 'user', p_user::text);
else
update profiles set failed_logins = fails where id = p_user;
end if;
insert into audit_log (user_id, ip, action, entity_type, entity_id) values (p_user, p_ip, 'login.failed', 'user', p_user::text);
end if;
end $$;
create or replace function public.request_password_reset(p_username text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
select id into uid from profiles where username = lower(trim(p_username)) and active;
if uid is null or exists (select 1 from password_reset_requests where user_id = uid and status = 'Pending') then return; end if;
insert into password_reset_requests (user_id, ip) values (uid, request_ip());
insert into audit_log (user_id, ip, action, entity_type, entity_id) values (null, request_ip(), 'password.resetRequested', 'user', uid::text);
perform notify_users(array(select id from profiles where active and role = 'ADMIN'), 'Password reset',
'Password reset requested for ' || (select full_name from profiles where id = uid), null, false, 'user', uid, '/admin/requests', 'Security');
end $$;
grant execute on function request_password_reset(text) to anon, authenticated;
create or replace function public.document_trail(p_document uuid)
returns table (occurred_at timestamptz, action text, user_name text, version int)
language sql stable security definer set search_path = public as $$
select l.occurred_at, l.action, p.full_name, coalesce((l.after ->> 'version')::int, (l.after ->> 'version_no')::int)
from audit_log l left join profiles p on p.id = l.user_id
where l.entity_id = p_document::text and l.action in ('document_versions.insert', 'documents.insert', 'documents.update', 'document.download')
and is_oversight()
union all
select v.uploaded_at, 'document_versions.insert', p.full_name, v.version_no
from document_versions v join profiles p on p.id = v.uploaded_by
where v.document_id = p_document and is_oversight()
order by 1 desc
$$;
revoke execute on function auth_lookup(text), record_login(uuid, boolean, text) from authenticated, anon, public;
grant execute on function auth_lookup(text), record_login(uuid, boolean, text) to service_role;
create or replace function public.run_reminders() returns void
language plpgsql security definer set search_path = public as $$
declare r record; s settings%rowtype; we date; ws record; today date := (now() at time zone 'Africa/Gaborone')::date; lvl int;
begin
select * into s from settings;
for r in select rv.*, a.name, a.workstream_id, a.visible_to_developers from reviews rv
join submissions sb on sb.id = rv.submission_id join activities a on a.id = sb.activity_id where rv.decided_at is null loop
if not r.due_soon_notified and add_business_days(today, 1) = r.due_date then
perform notify_users(array[r.reviewer_id], 'Review due tomorrow', r.stage || ' review due tomorrow: ' || r.name,
r.workstream_id, r.visible_to_developers, 'review', r.id, '/submissions', 'Submissions and reviews');
update reviews set due_soon_notified = true where id = r.id;
end if;
if not r.overdue_notified and r.due_date < today then
perform notify_users(array[r.reviewer_id] || users_with_role('BDIH_LEAD') || case when r.stage = 'BOCRA' then users_with_role('BOCRA_REP') else '{}' end,
'Review overdue', r.stage || ' review overdue: ' || r.name, r.workstream_id, r.visible_to_developers, 'review', r.id, '/submissions', 'Submissions and reviews');
update reviews set overdue_notified = true where id = r.id;
end if;
end loop;
for ws in select w.* from workstreams w where not w.is_shared loop
for we in select g::date from generate_series(s.project_start, today, interval '1 day') g where extract(isodow from g) = s.weekly_report_day loop
if add_business_days(we + 1, 0) <= today and not exists (select 1 from weekly_reports where workstream_id = ws.id and week_ending = we) then
insert into reminder_flags (key) values ('weekly:' || ws.id || ':' || we) on conflict do nothing;
if found then
perform notify_users(dev_leads(ws.id) || users_with_role('BDIH_LEAD'), 'Weekly report overdue',
ws.name || ' weekly report overdue: week ending ' || to_char(we, 'DD Mon YYYY'), ws.id, false, null, null, '/weekly', 'Weekly reports');
end if;
end if;
end loop;
end loop;
for r in select * from action_items where status = 'Open' and due_date <= today and not reminded loop
perform notify_users(array[r.owner_id], 'Action due', 'Action due: ' || r.description, r.workstream_id, r.visible_to_developers, 'action', r.id, '/tasks', 'Actions');
update action_items set reminded = true where id = r.id;
end loop;
for r in select 'risks' t, id, workstream_id, visible_to_developers, title, owner_id, due_date d, escalation_level from risks where status <> 'Closed' and due_date < today
union all
select 'issues', id, workstream_id, visible_to_developers, title, owner_id, target_date, escalation_level from issues where status not in ('Resolved', 'Closed') and target_date < today loop
lvl := least(3, 1 + (bd_count(r.d + 1, today) - 1) / greatest(1, s.escalation_days));
if lvl > r.escalation_level then
execute format('update %I set escalation_level = $1 where id = $2', r.t) using lvl, r.id;
perform notify_users(array[r.owner_id] || case lvl when 1 then dev_leads(r.workstream_id) || users_with_role('BDIH_LEAD')
when 2 then users_with_role('BDIH_LEAD', 'BOCRA_REP')
else users_with_role('BDIH_LEAD', 'BOCRA_REP', 'ADMIN') end,
'Escalation', 'Escalated (level ' || lvl || '): ' || r.title, r.workstream_id, r.visible_to_developers, r.t, r.id, '/registers', 'Activities');
end if;
end loop;
end $$;
revoke execute on function run_reminders() from authenticated;
grant execute on function update_progress(uuid, int, activity_status, date, date, text), activity_predecessors(uuid), add_comment(uuid, text),
submit_deliverable(uuid, text, uuid[]), bdih_recommend(uuid, text, text, jsonb), bocra_decide(uuid, text, text),
file_weekly_report(uuid, date, jsonb, jsonb), save_baseline(text, uuid), lock_progress(date), delete_document(uuid),
restore_document(uuid), update_my_preferences(jsonb), admin_unlock_user(uuid), admin_set_active(uuid, boolean), document_trail(uuid), has_perm(text) to authenticated;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
('project-files', 'project-files', false, 104857600, array['application/pdf',
'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
'application/vnd.openxmlformats-officedocument.presentationml.presentation',
'image/png', 'image/jpeg', 'image/svg+xml', 'application/zip', 'video/mp4', 'text/csv', 'text/plain', 'text/markdown']),
('reports', 'reports', false, 52428800, array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false;
create or replace function public.is_bank_file(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
select exists (select 1 from document_versions v join documents d on d.id = v.document_id
where v.storage_path = p_name and d.entity_type = 'bank' and d.deleted_at is null)
$$;
create or replace function public.path_workstream(p_name text) returns uuid
language sql immutable as $$
select case when (storage.foldername(p_name))[1] = 'workstreams'
and (storage.foldername(p_name))[2] ~ '^[0-9a-f-]{36}$'
then ((storage.foldername(p_name))[2])::uuid end
$$;
create policy files_read on storage.objects for select to authenticated using (
bucket_id = 'project-files' and (can_see_workstream(path_workstream(name)) or is_bank_file(name)));
create policy files_insert on storage.objects for insert to authenticated with check (
bucket_id = 'project-files' and can_see_workstream(path_workstream(name)));
create policy reports_read on storage.objects for select to authenticated using (
bucket_id = 'reports' and (is_oversight() or ((storage.foldername(name))[1] = 'workstreams' and can_see_workstream(path_workstream(name)))));
create policy reports_insert on storage.objects for insert to authenticated with check (
bucket_id = 'reports' and (is_bdih() or ((storage.foldername(name))[1] = 'workstreams' and can_see_workstream(path_workstream(name)))));
create or replace function public.app_settings() returns settings
language sql stable security definer set search_path = public as $$
select * from settings where id and auth.uid() is not null
$$;
create or replace view public.v_activities with (security_invoker = true) as
select
row_number() over (order by a.display_order) as display_no,
a.*,
w.name as workstream_name,
lr.name as lead_resource, sr.name as support_resource,
activity_duration(a) as duration_bd,
planned_pct(a, current_date) as planned_pct_today,
activity_health(a, current_date) as health_today,
bi.start_date as baseline_start, bi.finish_date as baseline_finish,
case when bi.finish_date is null then null
when a.finish_date >= bi.finish_date then bd_count(bi.finish_date, a.finish_date) - 1
else -(bd_count(a.finish_date, bi.finish_date) - 1) end as slip_bd
from activities a
join workstreams w on w.id = a.workstream_id
left join resources lr on lr.id = a.lead_resource_id
left join resources sr on sr.id = a.support_resource_id
left join app_settings() s on true
left join baseline_items bi on bi.baseline_id = s.current_baseline_id and bi.activity_id = a.id
where a.deleted_at is null;
create or replace function public.activities_at(p_status_date date)
returns table (id uuid, display_no bigint, workstream_id uuid, name text, type activity_type, phase text, start_date date,
finish_date date, pct_done int, planned_pct int, health text, status activity_status, is_critical boolean)
language sql stable as $$
select a.id, row_number() over (order by a.display_order), a.workstream_id, a.name, a.type, a.phase, a.start_date, a.finish_date,
a.pct_done, planned_pct(a, p_status_date), activity_health(a, p_status_date), a.status, a.is_critical
from activities a where a.deleted_at is null
$$;
create or replace function public.workstream_progress(p_status_date date)
returns table (workstream_id uuid, workstream text, planned_pct numeric, actual_pct numeric, spi numeric, status text,
activities_total int, activities_complete int, late int, behind int,
phase1_forecast date, phase2_forecast date, commissioning_forecast date, commissioning_baseline date)
language sql stable as $$
with a as (
select x.*, activity_duration(x) d, planned_pct(x, p_status_date) pl, activity_health(x, p_status_date) h
from activities x where x.deleted_at is null
), agg as (
select a.workstream_id,
sum(d * pl) filter (where type not in ('Meeting', 'Milestone') and status <> 'Cancelled')::numeric / nullif(sum(d) filter (where type not in ('Meeting', 'Milestone') and status <> 'Cancelled'), 0) planned,
sum(d * pct_done) filter (where type not in ('Meeting', 'Milestone') and status <> 'Cancelled')::numeric / nullif(sum(d) filter (where type not in ('Meeting', 'Milestone') and status <> 'Cancelled'), 0) actual,
count(*) filter (where type <> 'Meeting')::int total,
count(*) filter (where type <> 'Meeting' and h = 'Complete')::int done,
count(*) filter (where h = 'Late')::int late,
count(*) filter (where h = 'Behind')::int behind,
max(a.finish_date) filter (where type = 'Milestone' and name = 'Phase 1 complete') p1,
max(a.finish_date) filter (where type = 'Milestone' and name = 'Phase 2 complete') p2,
max(a.finish_date) filter (where type = 'Milestone' and name = 'Website commissioned') comm,
max(bi.finish_date) filter (where type = 'Milestone' and name = 'Website commissioned') comm_bl
from a
left join app_settings() s on true
left join baseline_items bi on bi.baseline_id = s.current_baseline_id and bi.activity_id = a.id
group by a.workstream_id
)
select g.workstream_id, w.name, round(coalesce(planned, 0), 1), round(coalesce(actual, 0), 1),
round(actual / nullif(planned, 0), 2),
case when coalesce(planned, 0) = 0 or actual / planned >= st.threshold_on_track then 'On track'
when actual / planned >= st.threshold_at_risk then 'At risk' else 'Off track' end,
total, done, late, behind, p1, p2, comm, comm_bl
from agg g join workstreams w on w.id = g.workstream_id cross join app_settings() st
$$;
create or replace function public.project_progress(p_status_date date)
returns table (planned_pct numeric, actual_pct numeric, spi numeric, status text, contract_end date, business_days_beyond int)
language sql stable security definer set search_path = public as $$
with a as (select x.*, activity_duration(x) d, planned_pct(x, p_status_date) pl from activities x
where x.deleted_at is null and x.type not in ('Meeting', 'Milestone') and x.status <> 'Cancelled'),
t as (select sum(d * pl)::numeric / nullif(sum(d), 0) planned, sum(d * pct_done)::numeric / nullif(sum(d), 0) actual from a),
c as (select bd_floor((project_start + make_interval(months => contract_months))::date - 1) ce, threshold_on_track, threshold_at_risk from settings),
f as (select max(finish_date) comm from activities where deleted_at is null and type = 'Milestone' and name = 'Website commissioned')
select round(coalesce(planned, 0), 1), round(coalesce(actual, 0), 1), round(actual / nullif(planned, 0), 2),
case when coalesce(planned, 0) = 0 or actual / planned >= threshold_on_track then 'On track'
when actual / planned >= threshold_at_risk then 'At risk' else 'Off track' end,
ce, greatest(0, case when comm > ce then bd_count(ce + 1, comm) else 0 end)
from t, c, f where is_oversight()
$$;
create or replace view public.v_review_timers with (security_invoker = true) as
select r.id as review_id, r.stage, r.due_date, r.reviewer_id, s.id as submission_id, s.version, a.id as activity_id, a.name,
a.workstream_id,
case when r.due_date >= current_date then bd_count(current_date + 1, r.due_date) else -bd_count(r.due_date + 1, current_date) end as business_days_left,
r.due_date < current_date as overdue
from reviews r join submissions s on s.id = r.submission_id join activities a on a.id = s.activity_id
where r.decided_at is null;
create or replace view public.v_deliverables with (security_invoker = true) as
select d.id, d.ref, d.name, d.phase, o.name as owner, w.name as workstream, d.workstream_id, d.activity_id,
va.finish_date as planned_finish, va.baseline_finish, va.slip_bd, va.health_today as health, va.status,
case when va.status in ('Complete', 'Approved') then va.actual_finish end as actual_finish,
(select min(r.due_date) from reviews r join submissions s on s.id = r.submission_id
where s.activity_id = d.activity_id and r.stage = 'BOCRA' and r.decided_at is null) as bocra_review_due
from deliverables d
join organisations o on o.id = d.owner_organisation_id
join workstreams w on w.id = d.workstream_id
left join v_activities va on va.id = d.activity_id;
create or replace view public.v_weekly_status with (security_invoker = true) as
select w.id as workstream_id, w.name, g::date as week_ending, wr.id as report_id,
case when wr.id is not null and wr.reviewed_at is not null then 'Reviewed'
when wr.id is not null then 'Filed'
when add_business_days(g::date + 1, 0) <= current_date then 'Late' else 'Due' end as status
from workstreams w
cross join app_settings() s
cross join generate_series(s.project_start, current_date + 6, interval '1 day') g
left join weekly_reports wr on wr.workstream_id = w.id and wr.week_ending = g::date
where not w.is_shared and can_see_workstream(w.id) and extract(isodow from g) = s.weekly_report_day;
create or replace function public.resource_loading(p_from date, p_weeks int default 16)
returns table (resource text, week_start date, activities int, both_developers boolean)
language sql stable security definer set search_path = public as $$
select r.name, wk::date, count(a.id)::int,
bool_or(w.code = 'A') and bool_or(w.code = 'B') and o.type = 'Project Manager'
from resources r
join organisations o on o.id = r.organisation_id
cross join generate_series(date_trunc('week', p_from), date_trunc('week', p_from) + (p_weeks - 1) * interval '7 days', interval '7 days') wk
left join activities a on (a.lead_resource_id = r.id or a.support_resource_id = r.id) and a.deleted_at is null
and a.type not in ('Meeting', 'Milestone') and a.status not in ('Complete', 'Approved', 'Cancelled')
and a.start_date <= wk::date + 4 and a.finish_date >= wk::date
left join workstreams w on w.id = a.workstream_id
where is_oversight()
group by r.name, wk, o.type
order by r.name, wk
$$;
create or replace view public.v_document_bank with (security_invoker = true) as
select d.id, d.title, d.category, d.created_at, v.version_no as latest_version, v.file_name, v.size_bytes, v.uploaded_at, v.uploaded_by,
p.full_name as uploaded_by_name, o.short_name as uploaded_by_org,
(select count(*) from audit_log l where l.entity_id = d.id::text and l.action = 'document.download') as downloads
from documents d
join lateral (select * from document_versions x where x.document_id = d.id order by x.version_no desc limit 1) v on true
left join profiles p on p.id = v.uploaded_by
left join organisations o on o.id = p.organisation_id
where d.entity_type = 'bank' and d.deleted_at is null;
grant select on v_activities, v_review_timers, v_deliverables, v_weekly_status, v_document_bank to authenticated;
grant execute on function activities_at(date), workstream_progress(date), project_progress(date), resource_loading(date, int), path_workstream(text) to authenticated;
alter publication supabase_realtime add table activities, submissions, reviews, notifications;
create type invoice_status as enum ('Submitted', 'Under review', 'Queried', 'Approved for payment', 'Paid', 'Rejected');
create table invoices (
id uuid primary key default gen_random_uuid(),
invoice_no text not null,
organisation_id uuid not null references organisations,
workstream_id uuid not null references workstreams,
deliverable_id uuid references deliverables,
description text not null,
invoice_date date not null,
amount_excl_vat numeric(14, 2) not null check (amount_excl_vat > 0),
vat_amount numeric(14, 2) not null default 0 check (vat_amount >= 0),
total_amount numeric(14, 2) generated always as (amount_excl_vat + vat_amount) stored,
currency text not null default 'BWP',
status invoice_status not null default 'Submitted',
status_comment text,
status_by uuid references profiles,
status_at timestamptz,
payment_reference text,
paid_on date,
submitted_by uuid not null references profiles default auth.uid(),
submitted_at timestamptz not null default now(),
unique (organisation_id, invoice_no)
);
create table invoice_status_history (
id bigint generated always as identity primary key,
invoice_id uuid not null references invoices on delete cascade,
old_status invoice_status,
new_status invoice_status not null,
comment text,
changed_by uuid references profiles default auth.uid(),
changed_at timestamptz not null default now()
);
alter table documents drop constraint if exists documents_entity_type_check;
alter table documents add constraint documents_entity_type_check check (entity_type in ('library', 'bank', 'activity', 'submission',
'meeting', 'risk', 'issue', 'change_request', 'weekly_report', 'progress_report', 'invoice'));
alter table invoices enable row level security;
alter table invoices force row level security;
alter table invoice_status_history enable row level security;
alter table invoice_status_history force row level security;
create policy inv_read on invoices for select to authenticated using (is_oversight() or organisation_id = my_org());
create policy invh_read on invoice_status_history for select to authenticated using (
exists (select 1 from invoices i where i.id = invoice_id and (is_oversight() or i.organisation_id = my_org())));
revoke insert, update, delete on invoices, invoice_status_history from authenticated;
grant select on invoices, invoice_status_history to authenticated;
create trigger invoices_audit after insert or update or delete on invoices for each row execute function trg_audit();
create or replace function public.submit_invoice(p_invoice_no text, p_description text, p_invoice_date date,
p_amount numeric, p_vat numeric, p_deliverable uuid default null, p_document_ids uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare me profiles%rowtype; t org_type; ws uuid; iid uuid;
begin
select * into me from profiles where id = auth.uid() and active;
t := org_type_of(me.id);
if not has_perm('invoice.submit') then
raise exception 'Only a Developer Lead or the BDIH Project Leader submits invoices.';
elsif t = 'Developer' then
select workstream_id into ws from user_workstreams where user_id = me.id limit 1;
elsif t = 'Project Manager' then
ws := shared_workstream();
else
raise exception 'Only a Developer Lead or the BDIH Project Leader submits invoices.';
end if;
if p_deliverable is not null and not exists (select 1 from deliverables where id = p_deliverable and workstream_id = ws) then
raise exception 'Link the invoice to a deliverable in your own workstream.';
end if;
insert into invoices (invoice_no, organisation_id, workstream_id, deliverable_id, description, invoice_date, amount_excl_vat, vat_amount)
values (trim(p_invoice_no), me.organisation_id, ws, p_deliverable, p_description, p_invoice_date, p_amount, coalesce(p_vat, 0))
returning id into iid;
insert into invoice_status_history (invoice_id, old_status, new_status, comment) values (iid, null, 'Submitted', 'Invoice submitted');
update documents set entity_type = 'invoice', entity_id = iid
where id = any (p_document_ids) and workstream_id = ws and created_by = auth.uid();
perform notify_users(users_with_role('BOCRA_REP') || users_with_role('BDIH_LEAD'),
'Invoice submitted', 'Invoice ' || p_invoice_no || ' submitted by ' || (select name from organisations where id = me.organisation_id),
null, false, 'invoice', iid, '/invoices', 'Invoices');
return iid;
end $$;
create or replace function public.set_invoice_status(p_invoice uuid, p_status invoice_status, p_comment text default null,
p_payment_reference text default null, p_paid_on date default null)
returns void language plpgsql security definer set search_path = public as $$
declare i invoices%rowtype;
begin
if not has_perm('invoice.status') then raise exception 'Only the BOCRA Project Lead updates invoice status.'; end if;
select * into i from invoices where id = p_invoice for update;
if not found then raise exception 'Invoice not found.'; end if;
if i.status in ('Paid', 'Rejected') then raise exception 'This invoice is closed.'; end if;
if p_status in ('Queried', 'Rejected') and coalesce(trim(p_comment), '') = '' then raise exception 'Give a reason for %.', p_status; end if;
if p_status = 'Paid' and (p_paid_on is null or coalesce(trim(p_payment_reference), '') = '') then
raise exception 'Record the payment date and reference.';
end if;
update invoices set status = p_status, status_comment = p_comment, status_by = auth.uid(), status_at = now(),
payment_reference = coalesce(p_payment_reference, payment_reference), paid_on = coalesce(p_paid_on, paid_on)
where id = i.id;
insert into invoice_status_history (invoice_id, old_status, new_status, comment) values (i.id, i.status, p_status, p_comment);
perform notify_users(array(select id from profiles where active and organisation_id = i.organisation_id
and roles_of(id) && array['DEV_LEAD', 'BDIH_LEAD', 'ADMIN']::app_role[]) || array[i.submitted_by] || users_with_role('BDIH_LEAD'),
'Invoice ' || lower(p_status::text), 'Invoice ' || i.invoice_no || ': ' || p_status::text, null, false, 'invoice', i.id, '/invoices', 'Invoices');
end $$;
create or replace function public.resubmit_invoice(p_invoice uuid, p_description text, p_amount numeric, p_vat numeric, p_comment text)
returns void language plpgsql security definer set search_path = public as $$
declare i invoices%rowtype;
begin
select * into i from invoices where id = p_invoice for update;
if not found or i.organisation_id <> my_org() then raise exception 'Invoice not found.'; end if;
if i.status <> 'Queried' then raise exception 'Only queried invoices can be resubmitted.'; end if;
update invoices set description = p_description, amount_excl_vat = p_amount, vat_amount = coalesce(p_vat, 0), status = 'Submitted',
status_comment = p_comment, status_by = auth.uid(), status_at = now() where id = i.id;
insert into invoice_status_history (invoice_id, old_status, new_status, comment) values (i.id, i.status, 'Submitted', p_comment);
perform notify_users(users_with_role('BOCRA_REP'),
'Invoice resubmitted', 'Invoice ' || i.invoice_no || ' resubmitted', null, false, 'invoice', i.id, '/invoices', 'Invoices');
end $$;
create or replace view public.v_invoices with (security_invoker = true) as
select i.*, o.name as organisation, w.name as workstream, d.ref as deliverable_ref, p.full_name as submitted_by_name,
sp.full_name as status_by_name
from invoices i
join organisations o on o.id = i.organisation_id
join workstreams w on w.id = i.workstream_id
left join deliverables d on d.id = i.deliverable_id
left join profiles p on p.id = i.submitted_by
left join profiles sp on sp.id = i.status_by;
grant select on v_invoices to authenticated;
grant execute on function submit_invoice(text, text, date, numeric, numeric, uuid, uuid[]),
set_invoice_status(uuid, invoice_status, text, text, date), resubmit_invoice(uuid, text, numeric, numeric, text) to authenticated;
alter publication supabase_realtime add table invoices;
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
key text unique,
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
create or replace view public.v_tickets with (security_invoker = true) as
select t.*, w.name as workstream, a.full_name as assignee, r.full_name as reporter, ac.name as activity,
(select count(*) from ticket_comments c where c.ticket_id = t.id) as comment_count
from tickets t join workstreams w on w.id = t.workstream_id
left join profiles a on a.id = t.assignee_id left join profiles r on r.id = t.reporter_id
left join activities ac on ac.id = t.activity_id;
grant select on v_tickets to authenticated;
alter publication supabase_realtime add table tickets;
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
return case when lim > 0 then lim - n - 1 else null end;
end $$;
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
alter default privileges in schema public revoke execute on functions from public;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function recalc_schedule(), notify_users(uuid[], text, text, uuid, boolean, text, uuid, text, text),
auth_lookup(text), record_login(uuid, boolean, text), run_reminders() from authenticated;
grant execute on function auth_lookup(text), record_login(uuid, boolean, text), run_reminders() to service_role;
grant execute on function request_password_reset(text) to anon;
create table rate_limits (
key text not null,
window_start timestamptz not null,
hits int not null default 0,
primary key (key, window_start)
);
alter table rate_limits enable row level security;
alter table rate_limits force row level security;
create or replace function public.rate_limit(p_key text, p_max int, p_window_seconds int) returns void
language plpgsql security definer set search_path = public as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds); n int;
begin
insert into rate_limits (key, window_start, hits) values (p_key, w, 1)
on conflict (key, window_start) do update set hits = rate_limits.hits + 1
returning hits into n;
if n > p_max then
raise exception 'Too many requests. Please wait a moment and try again.' using errcode = 'P0429';
end if;
if random() < 0.01 then delete from rate_limits where window_start < now() - interval '1 day'; end if;
end $$;
revoke execute on function rate_limit(text, int, int) from authenticated;
create or replace function public.trg_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
if auth.uid() is not null then
perform rate_limit('w:' || tg_table_name || ':' || auth.uid(), tg_argv[0]::int, tg_argv[1]::int);
end if;
return new;
end $$;
create trigger rl_tickets before insert on tickets for each row execute function trg_rate_limit('30', '60');
create trigger rl_ticket_comments before insert on ticket_comments for each row execute function trg_rate_limit('30', '60');
create trigger rl_comments before insert on comments for each row execute function trg_rate_limit('30', '60');
create trigger rl_documents before insert on documents for each row execute function trg_rate_limit('30', '60');
create trigger rl_document_versions before insert on document_versions for each row execute function trg_rate_limit('30', '60');
create trigger rl_invoices before insert on invoices for each row execute function trg_rate_limit('10', '300');
create trigger rl_submissions before insert on submissions for each row execute function trg_rate_limit('10', '300');
create trigger rl_risks before insert on risks for each row execute function trg_rate_limit('20', '300');
create trigger rl_issues before insert on issues for each row execute function trg_rate_limit('20', '300');
create trigger rl_account_requests before insert on account_requests for each row execute function trg_rate_limit('5', '3600');
create trigger rl_reports before insert on report_definitions for each row execute function trg_rate_limit('20', '300');
create or replace function public.login_rate_limit(p_ip text) returns void
language sql security definer set search_path = public as $$
select rate_limit('login:' || coalesce(nullif(p_ip, ''), 'unknown'), 10, 60)
$$;
revoke execute on function login_rate_limit(text) from public, anon, authenticated;
grant execute on function login_rate_limit(text) to service_role;
create or replace function public.request_password_reset(p_username text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
perform rate_limit('reset:' || coalesce(nullif(request_ip(), ''), 'unknown'), 5, 3600);
select id into uid from profiles where username = lower(trim(p_username)) and active;
if uid is null or exists (select 1 from password_reset_requests where user_id = uid and status = 'Pending') then return; end if;
insert into password_reset_requests (user_id, ip) values (uid, request_ip());
insert into audit_log (user_id, ip, action, entity_type, entity_id) values (null, request_ip(), 'password.resetRequested', 'user', uid::text);
perform notify_users(array(select id from profiles where active and 'ADMIN' = any (roles_of(id))), 'Password reset',
'Password reset requested for ' || (select full_name from profiles where id = uid), null, false, 'user', uid, '/admin/requests', 'Security');
end $$;
grant execute on function request_password_reset(text) to anon, authenticated;
create index if not exists profiles_org on profiles (organisation_id) where active;
create index if not exists user_workstreams_ws on user_workstreams (workstream_id);
create index if not exists user_roles_role on user_roles (role);
create index if not exists activity_links_pred on activity_links (predecessor_id);
create index if not exists activities_lead on activities (lead_resource_id);
create index if not exists activities_support on activities (support_resource_id);
create index if not exists activities_phase on activities (phase) where deleted_at is null;
create index if not exists baseline_items_activity on baseline_items (activity_id);
create index if not exists submissions_activity on submissions (activity_id, version desc);
create index if not exists submissions_ws on submissions (workstream_id);
create index if not exists reviews_submission on reviews (submission_id);
create index if not exists reviews_reviewer on reviews (reviewer_id) where decided_at is null;
create index if not exists documents_ws on documents (workstream_id) where deleted_at is null;
create index if not exists documents_bank on documents (category) where entity_type = 'bank' and deleted_at is null;
create index if not exists document_versions_doc on document_versions (document_id, version_no desc);
create index if not exists submission_documents_doc on submission_documents (document_id);
create index if not exists weekly_reports_ws on weekly_reports (workstream_id, week_ending desc);
create index if not exists deliverables_activity on deliverables (activity_id);
create index if not exists deliverables_ws on deliverables (workstream_id);
create index if not exists risks_ws on risks (workstream_id, status);
create index if not exists issues_ws on issues (workstream_id, status);
create index if not exists decisions_ws on decisions (workstream_id);
create index if not exists change_requests_ws on change_requests (workstream_id, bocra_decision);
create index if not exists meetings_ws on meetings (workstream_id, meeting_date desc);
create index if not exists action_items_owner on action_items (owner_id) where status = 'Open';
create index if not exists action_items_meeting on action_items (meeting_id);
create index if not exists notifications_unread on notifications (user_id) where read_at is null;
create index if not exists invoices_org on invoices (organisation_id, status);
create index if not exists invoices_ws on invoices (workstream_id);
create index if not exists invoice_history_invoice on invoice_status_history (invoice_id);
create index if not exists tickets_assignee on tickets (assignee_id) where status <> 'Done';
create index if not exists tickets_activity on tickets (activity_id);
create index if not exists ticket_comments_ticket on ticket_comments (ticket_id, created_at);
create index if not exists ticket_history_ticket on ticket_history (ticket_id, changed_at);
create index if not exists password_reset_pending on password_reset_requests (user_id) where status = 'Pending';
create index if not exists report_definitions_owner on report_definitions (created_by);
create index if not exists audit_log_downloads on audit_log (user_id, occurred_at) where is_download_action(action);
create index if not exists audit_log_action on audit_log (action, occurred_at desc);
alter table profiles add constraint profiles_len check (length(full_name) <= 120 and length(coalesce(job_title, '')) <= 120
and length(coalesce(phone, '')) <= 40 and length(coalesce(email, '')) <= 200);
alter table organisations add constraint organisations_len check (length(name) <= 120 and length(coalesce(contact, '')) <= 160);
alter table activities add constraint activities_len check (length(coalesce(notes, '')) <= 5000 and length(coalesce(deliverable_ref, '')) <= 20);
alter table documents add constraint documents_len check (length(title) <= 200 and length(category) <= 60);
alter table document_versions add constraint document_versions_len check (length(file_name) <= 255 and length(coalesce(comment, '')) <= 500);
alter table submissions add constraint submissions_len check (length(cover_note) <= 5000);
alter table reviews add constraint reviews_len check (length(coalesce(findings, '')) <= 10000);
alter table weekly_reports add constraint weekly_len check (length(work_completed) <= 10000 and length(work_planned) <= 10000
and length(coalesce(issues, '')) <= 5000 and length(coalesce(risks, '')) <= 5000 and length(coalesce(change_requests, '')) <= 5000
and length(coalesce(support_needed, '')) <= 5000 and length(coalesce(bdih_comment, '')) <= 5000);
alter table risks add constraint risks_len check (length(title) <= 200 and length(coalesce(description, '')) <= 5000 and length(coalesce(mitigation, '')) <= 5000);
alter table issues add constraint issues_len check (length(title) <= 200 and length(coalesce(description, '')) <= 5000 and length(coalesce(resolution, '')) <= 5000);
alter table decisions add constraint decisions_len check (length(decision) <= 2000 and length(coalesce(related_items, '')) <= 500);
alter table change_requests add constraint change_requests_len check (length(title) <= 200 and length(description) <= 5000
and length(coalesce(bdih_recommendation, '')) <= 5000 and length(coalesce(bocra_decision_text, '')) <= 5000 and length(coalesce(plan_changes, '')) <= 5000);
alter table meetings add constraint meetings_len check (length(title) <= 200 and length(coalesce(agenda, '')) <= 10000 and length(coalesce(decisions, '')) <= 10000);
alter table action_items add constraint action_items_len check (length(description) <= 1000);
alter table invoices add constraint invoices_len check (length(invoice_no) <= 40 and length(description) <= 300
and length(coalesce(status_comment, '')) <= 2000 and length(coalesce(payment_reference, '')) <= 80);
alter table tickets add constraint tickets_len check (length(coalesce(description, '')) <= 20000 and cardinality(labels) <= 20);
alter table report_definitions add constraint report_definitions_len check (length(name) <= 120 and pg_column_size(definition) <= 20000);
alter table lookups add constraint lookups_len check (length(value) <= 120 and length(coalesce(label, '')) <= 160);
alter role authenticated set statement_timeout = '15s';
alter role anon set statement_timeout = '3s';
create table ui_labels (
original text primary key check (length(original) <= 80),
label text not null check (length(label) between 1 and 60),
updated_by uuid references profiles default auth.uid(),
updated_at timestamptz not null default now()
);
alter table ui_labels enable row level security;
alter table ui_labels force row level security;
create policy uil_read on ui_labels for select to authenticated using (true);
create policy uil_admin on ui_labels for all to authenticated using (has_perm('users.manage')) with check (has_perm('users.manage'));
grant select, insert, update, delete on ui_labels to authenticated;
create trigger ui_labels_audit after insert or update or delete on ui_labels for each row execute function trg_audit();
alter table settings add column if not exists turnstile_site_key text not null default '0x4AAAAAAFvlUC69yGzxrwc-'
check (turnstile_site_key ~ '^0x[A-Za-z0-9_-]{10,80}$');
alter table settings add column if not exists turnstile_enabled boolean not null default true;
create or replace function public.public_config()
returns table (app_name text, app_subtitle text, turnstile_site_key text, turnstile_enabled boolean)
language sql stable security definer set search_path = public as $$
select app_name, app_subtitle, turnstile_site_key, turnstile_enabled from settings where id
$$;
revoke execute on function public_config() from public;
grant execute on function public_config() to anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, public;
revoke execute on all functions in schema public from anon, public;
grant execute on function request_password_reset(text) to anon;
grant execute on function public_config() to anon;
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
alter function public.trg_touch() set search_path = public;
alter function public.request_ip() set search_path = public;
alter function public.trg_audit_immutable() set search_path = public;
alter function public.is_download_action(text) set search_path = public;
alter function public.path_workstream(text) set search_path = public;
alter function public.activities_at(date) set search_path = public;
alter function public.workstream_progress(date) set search_path = public;
alter table activities add column if not exists key text;
create index if not exists activities_key on activities (key) where key is not null;
alter table settings add column if not exists app_origins text[] not null
default array['http://localhost:8765', 'https://bocratracker.pages.dev'];
create or replace function public.app_settings() returns settings
language sql stable security definer set search_path = public as $$
select * from settings where id and auth.uid() is not null
$$;
grant execute on function app_settings() to authenticated;
create or replace function public.allowed_origins() returns text[]
language sql stable security definer set search_path = public as $$
select app_origins from settings where id
$$;
revoke execute on function allowed_origins() from public, anon, authenticated;
grant execute on function allowed_origins() to service_role;
create or replace function public.password_changed() returns void
language sql security definer set search_path = public as $$
update profiles set must_change_password = false where id = auth.uid();
insert into audit_log (user_id, ip, action, entity_type, entity_id) values (auth.uid(), request_ip(), 'password.change', 'user', auth.uid()::text);
$$;
revoke execute on function password_changed() from public, anon;
grant execute on function password_changed() to authenticated;
insert into organisations (name, short_name, type) values
('Botswana Digital and Innovation Hub', 'BDIH', 'Project Manager'),
('Botswana Communications Regulatory Authority', 'BOCRA', 'Client'),
('Developer A', 'DEVA', 'Developer'),
('Developer B', 'DEVB', 'Developer');
insert into workstreams (code, name, owner_organisation_id, is_shared, website)
select 'A', 'BOCRA website', id, false, 'www.bocra.org.bw' from organisations where short_name = 'DEVA'
union all select 'B', 'UASF website', id, false, 'www.uasf.org.bw' from organisations where short_name = 'DEVB'
union all select 'S', 'Shared', id, true, null from organisations where short_name = 'BDIH';
update workstreams set ticket_prefix = case code when 'A' then 'BOC' when 'B' then 'UAS' end where not is_shared;
insert into settings (project_start, contract_months, bdih_review_days, bocra_review_days, weekly_report_day, festive_start, festive_end)
values ('2026-10-12', 3, 3, 5, 5, '2026-12-21', '2027-01-01');
insert into closure_days (date, reason, source) values
('2026-12-25', 'Christmas Day', 'public holiday'), ('2026-12-26', 'Boxing Day', 'public holiday'),
('2027-01-01', 'New Year''s Day', 'public holiday'), ('2027-01-02', 'New Year Holiday', 'public holiday'),
('2027-03-26', 'Good Friday', 'public holiday'), ('2027-03-27', 'Easter Saturday', 'public holiday'),
('2027-03-29', 'Easter Monday', 'public holiday')
on conflict (date) do nothing;
insert into lookups (list_name, value, sort_order, protected) values
('activity_type', 'Task', 1, true), ('activity_type', 'Review', 2, true), ('activity_type', 'Milestone', 3, true),
('activity_type', 'Meeting', 4, true), ('activity_type', 'Report', 5, true),
('status', 'Complete', 1, true), ('status', 'Cancelled', 2, true),
('document_category', 'PID', 1, false), ('document_category', 'Requirements', 2, false), ('document_category', 'Design', 3, false),
('document_category', 'Test evidence', 4, false), ('document_category', 'Minutes', 5, false), ('document_category', 'Report', 6, false),
('document_category', 'Contract', 7, false), ('document_category', 'Content', 8, false), ('document_category', 'Handover', 9, false),
('document_category', 'Invoice', 10, false), ('document_category', 'Other', 11, false),
('review_checklist', 'Meets BOCRA requirements in the ToR', 1, false),
('review_checklist', 'Complete, consistent and version controlled', 2, false),
('review_checklist', 'Accessibility considered (WCAG 2.1 AA)', 3, false),
('review_checklist', 'Security and data protection considered', 4, false),
('review_checklist', 'Supporting evidence attached', 5, false),
('forum', 'Steering Committee', 1, false), ('forum', 'Project Working Group', 2, false),
('forum', 'Developer Progress Meeting', 3, false), ('forum', 'Kick-off', 4, false),
('severity', 'Low', 1, false), ('severity', 'Medium', 2, false), ('severity', 'High', 3, false), ('severity', 'Critical', 4, false);
insert into resources (name, organisation_id, role_description)
select v.name, o.id, v.descr from (values
('BDIH Project Leader', 'BDIH', 'Owns the plan'), ('BDIH Project Officer', 'BDIH', 'Coordination and reporting'),
('BDIH Business Analyst', 'BDIH', 'Requirements and UAT'), ('BDIH Developer', 'BDIH', 'Technical reviews'),
('BOCRA Project Lead', 'BOCRA', 'Approvals and invoices'), ('BOCRA IT and Communications', 'BOCRA', 'Content, hosting, UAT'),
('Developer A', 'DEVA', 'BOCRA website'), ('Developer B', 'DEVB', 'UASF website')) v(name, org, descr)
join organisations o on o.short_name = v.org;
insert into permission_catalogue (permission, description, sort_order) values
('plan.edit', 'Edit the project plan: activities, links, durations, dates', 1),
('plan.baseline', 'Save baselines and lock reporting periods', 2),
('progress.any', 'Update progress on any activity', 3),
('progress.own', 'Update progress in own workstream', 4),
('progress.bocra', 'Update activities that BOCRA leads', 5),
('submit.deliverable', 'Submit deliverables for review', 6),
('review.bdih', 'Record the BDIH review recommendation', 7),
('review.bocra', 'Approve or return submissions for BOCRA', 8),
('weekly.file', 'File the weekly developer report', 9),
('weekly.review', 'Review weekly developer reports', 10),
('report.publish', 'Publish the official monthly report', 11),
('invoice.submit', 'Raise invoices', 12),
('invoice.status', 'Update invoice status', 13),
('bank.upload', 'Add documents to the document bank', 14),
('register.edit', 'Edit risks, issues and decisions', 15),
('register.delete', 'Delete register entries', 16),
('cr.recommend', 'Assess and recommend change requests', 17),
('cr.decide', 'Decide change requests for BOCRA', 18),
('meeting.edit', 'Record meetings and minutes', 19),
('settings.edit', 'Edit settings and the closure calendar', 20),
('users.manage', 'Manage users, roles and passwords', 21),
('audit.view', 'View the audit log', 22);
insert into role_permissions (permission, role)
select p, r::app_role from (values
('plan.edit', '{ADMIN,BDIH_LEAD,BDIH_PO,BDIH_BA}'),
('plan.baseline', '{ADMIN,BDIH_LEAD}'),
('progress.any', '{ADMIN,BDIH_LEAD,BDIH_PO,BDIH_BA,BDIH_TEAM}'),
('progress.own', '{DEV_LEAD,DEV_MEMBER}'),
('progress.bocra', '{BOCRA_REP,BOCRA_TEAM}'),
('submit.deliverable', '{ADMIN,BDIH_LEAD,DEV_LEAD}'),
('review.bdih', '{ADMIN,BDIH_LEAD,BDIH_PO,BDIH_BA,BDIH_TEAM}'),
('review.bocra', '{ADMIN,BOCRA_REP}'),
('weekly.file', '{DEV_LEAD}'),
('weekly.review', '{ADMIN,BDIH_LEAD,BDIH_PO,BDIH_BA,BDIH_TEAM}'),
('report.publish', '{ADMIN,BDIH_LEAD}'),
('invoice.submit', '{ADMIN,BDIH_LEAD,DEV_LEAD}'),
('invoice.status', '{ADMIN,BOCRA_REP}'),
('bank.upload', '{ADMIN,BDIH_LEAD,BDIH_PO,BDIH_BA,BDIH_TEAM,BOCRA_REP,BOCRA_TEAM}'),
('register.edit', '{ADMIN,BDIH_LEAD,BDIH_PO,BDIH_BA,BDIH_TEAM,BOCRA_REP}'),
('register.delete', '{ADMIN,BDIH_LEAD}'),
('cr.recommend', '{ADMIN,BDIH_LEAD}'),
('cr.decide', '{ADMIN,BOCRA_REP}'),
('meeting.edit', '{ADMIN,BDIH_LEAD,BDIH_PO,BDIH_BA,BDIH_TEAM}'),
('settings.edit', '{ADMIN,BDIH_LEAD}'),
('users.manage', '{ADMIN}'),
('audit.view', '{ADMIN,BDIH_LEAD,BDIH_DIRECTOR}')) v(p, roles)
cross join unnest(roles::text[]) r;
insert into lookups (list_name, value, sort_order, protected) values
('bank_category', 'Template', 1, false), ('bank_category', 'Form', 2, false), ('bank_category', 'Guideline', 3, false),
('bank_category', 'Policy', 4, false), ('bank_category', 'Reference', 5, false);
insert into lookups (list_name, value, sort_order, protected, label) values
('phase', 'Phase 1', 1, false, 'Phase 1: Planning and requirements'),
('phase', 'Phase 2', 2, false, 'Phase 2: Design and build'),
('phase', 'Phase 3', 3, false, 'Phase 3: Testing, commissioning and closure')
on conflict (list_name, value) do update set label = excluded.label;
