-- BDIH Project Tracking Tool: Storage buckets and policies (SRS 5.3), reporting views and
-- dashboard queries (FR-DSH, FR-RPT). Views use security_invoker so RLS still applies.

-- Storage -------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('project-files', 'project-files', false, 104857600, array['application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/png', 'image/jpeg', 'image/svg+xml', 'application/zip', 'video/mp4', 'text/csv', 'text/plain', 'text/markdown']),
  ('reports', 'reports', false, 52428800, array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false;

-- Paths: workstreams/{workstream_id}/{entity}/{entity_id}/{version}/{filename}
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
-- No update or delete policies: versions are immutable and deletion is a soft delete in documents.

-- Reports bucket: combined/... for oversight only; workstreams/{id}/... for that workstream
create policy reports_read on storage.objects for select to authenticated using (
  bucket_id = 'reports' and (is_oversight() or ((storage.foldername(name))[1] = 'workstreams' and can_see_workstream(path_workstream(name)))));
create policy reports_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'reports' and (is_bdih() or ((storage.foldername(name))[1] = 'workstreams' and can_see_workstream(path_workstream(name)))));

-- Settings are oversight-only (SRS 5.2); views read the values they need through this helper
create or replace function public.app_settings() returns settings
language sql stable security definer set search_path = public as $$
  select * from settings where id and auth.uid() is not null
$$;

-- Activity view with display number, health, planned %, baseline and slip ------------------------
create or replace view public.v_activities with (security_invoker = true) as
select
  row_number() over (order by a.display_order) as display_no,   -- numbered within what the viewer can see
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

-- Health at any status date (period selector)
create or replace function public.activities_at(p_status_date date)
returns table (id uuid, display_no bigint, workstream_id uuid, name text, type activity_type, phase text, start_date date,
  finish_date date, pct_done int, planned_pct int, health text, status activity_status, is_critical boolean)
language sql stable as $$
  select a.id, row_number() over (order by a.display_order), a.workstream_id, a.name, a.type, a.phase, a.start_date, a.finish_date,
         a.pct_done, planned_pct(a, p_status_date), activity_health(a, p_status_date), a.status, a.is_critical
  from activities a where a.deleted_at is null
$$;

-- Workstream progress (FR-DSH-02). Runs as the caller, so a developer only aggregates rows they
-- can see and never receives the other developer's figures.
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

-- Combined project position (FR-DSH-01): oversight users only, no rows for developers
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

-- Open review timers, separately for BDIH and BOCRA (FR-REV-07)
create or replace view public.v_review_timers with (security_invoker = true) as
select r.id as review_id, r.stage, r.due_date, r.reviewer_id, s.id as submission_id, s.version, a.id as activity_id, a.name,
       a.workstream_id,
       case when r.due_date >= current_date then bd_count(current_date + 1, r.due_date) else -bd_count(r.due_date + 1, current_date) end as business_days_left,
       r.due_date < current_date as overdue
from reviews r join submissions s on s.id = r.submission_id join activities a on a.id = s.activity_id
where r.decided_at is null;

-- Deliverables register derived from the linked activity (FR-DLV-01)
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

-- Weekly report status per workstream and week (FR-WKR-03)
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

-- Resource loading per week (FR-DSH-08): oversight only
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

-- Document bank listing with download counts
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

-- Realtime for live dashboards (FR-DSH-05): RLS applies to Realtime as well
alter publication supabase_realtime add table activities, submissions, reviews, notifications;
