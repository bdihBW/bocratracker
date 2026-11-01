-- BDIH Project Tracking Tool: workflow RPCs (call with supabase.rpc('name', {...}))
-- Each function checks the caller's rights itself and runs with definer rights so that
-- developers can only change the columns the SRS allows.

-- Progress update (FR-PRG-01 to FR-PRG-04, FR-PRG-06) -------------------------------------------
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

-- Hidden predecessors appear without details (FR-SCH-12)
create or replace function public.activity_predecessors(p_activity uuid)
returns table (predecessor_id uuid, label text, link_type link_type, lag int)
language sql stable security definer set search_path = public as $$
  select case when can_see_activity(l.predecessor_id) then l.predecessor_id end,
         case when can_see_activity(l.predecessor_id) then p.name else 'Waits for BDIH or BOCRA action' end,
         l.link_type, l.lag
  from activity_links l join activities p on p.id = l.predecessor_id
  where l.successor_id = p_activity and p.deleted_at is null and can_see_activity(p_activity)
$$;

-- Comments with @mentions (FR-PRG-05) ----------------------------------------------------------
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

-- Submissions, BDIH recommendation, BOCRA decision (FR-REV-01 to FR-REV-08) ------------------------

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
  -- The review clock restarts on every resubmission (FR-REV-06)
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
    -- Approval completes the activity and its reviews and releases successors (FR-REV-05)
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

-- Weekly report with progress updates in one step (FR-WKR-01, FR-WKR-02) -------------------------
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

-- Baselines need an approved change request after the first (FR-SCH-09, FR-RSK-04) ---------------
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

-- Documents: soft delete and restore (FR-DOC-08) --------------------------------------------------
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

-- Users: self-service preferences; administrator actions (FR-ADM, FR-AUTH-05, FR-AUTH-10) --------
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

-- Deactivation also revokes refresh tokens; access tokens expire within the JWT lifetime
-- (set JWT expiry to 60 seconds or less in Auth settings to meet the one minute target).
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

-- Login support for the username login Edge Function (service role only) -------------------------
-- Set a user's extra roles (the primary role stays on the profile)
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
-- Forgotten password: callable before sign-in; always returns nothing so it cannot reveal usernames
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

-- Document bank audit trail: uploads, new versions and downloads for one document
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

-- Reminders, timers and escalation; schedule with pg_cron (FR-REV-07, FR-WKR-03, FR-MTG-02, FR-RSK-05)
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

  -- Missing weekly reports are late from the next business day
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
-- With pg_cron enabled:
-- select cron.schedule('bdih-reminders', '0 6 * * 1-5', $$select public.run_reminders()$$);

grant execute on function update_progress(uuid, int, activity_status, date, date, text), activity_predecessors(uuid), add_comment(uuid, text),
  submit_deliverable(uuid, text, uuid[]), bdih_recommend(uuid, text, text, jsonb), bocra_decide(uuid, text, text),
  file_weekly_report(uuid, date, jsonb, jsonb), save_baseline(text, uuid), lock_progress(date), delete_document(uuid),
  restore_document(uuid), update_my_preferences(jsonb), admin_unlock_user(uuid), admin_set_active(uuid, boolean), document_trail(uuid), has_perm(text) to authenticated;
