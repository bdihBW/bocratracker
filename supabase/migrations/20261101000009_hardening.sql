-- BDIH Project Tracking Tool: security and performance hardening
-- Covers the usual checklist for AI-assisted builds: no anonymous access, least-privilege function
-- grants, rate limits in the database, indexes behind every RLS check and join, input length limits,
-- query timeouts, and admin-editable labels.

-- 1. Function privileges -------------------------------------------------------------------------
-- New functions are not executable by everyone by default; signed-in users get only what they need.
alter default privileges in schema public revoke execute on functions from public;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function recalc_schedule(), notify_users(uuid[], text, text, uuid, boolean, text, uuid, text, text),
  auth_lookup(text), record_login(uuid, boolean, text), run_reminders() from authenticated;
grant execute on function auth_lookup(text), record_login(uuid, boolean, text), run_reminders() to service_role;
-- The only function callable before sign-in
grant execute on function request_password_reset(text) to anon;

-- 2. Rate limits ---------------------------------------------------------------------------------
create table rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);
alter table rate_limits enable row level security;
alter table rate_limits force row level security;   -- no policies: only definer functions touch it

-- Counts a hit for p_key in the current window and refuses once p_max is passed
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

-- Per-user write limits on busy tables: TG_ARGV = (max hits, window in seconds)
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

-- Sign-in and password reset limits by IP (called by the login Edge Function with the service role)
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

-- 3. Indexes behind RLS checks, foreign keys and common filters ---------------------------------
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

-- 4. Input length limits (defence in depth behind the forms) -------------------------------------
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

-- 5. Query timeouts so one heavy request cannot tie up the database ------------------------------
alter role authenticated set statement_timeout = '15s';
alter role anon set statement_timeout = '3s';

-- 6. Labels: the administrator renames buttons, menu items and tabs -----------------------------
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
