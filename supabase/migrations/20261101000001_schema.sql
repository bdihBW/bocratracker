-- BDIH Project Tracking Tool: schema (SRS section 5.1)
-- Run migrations in filename order (supabase db push, or paste into the SQL editor).

create extension if not exists pgcrypto;
create extension if not exists citext;

create type org_type as enum ('Client', 'Project Manager', 'Developer');
-- BOCRA_REP is the BOCRA Project Lead; BDIH_TEAM is the BDIH Developer; BDIH_DIRECTOR is read-only
create type app_role as enum ('ADMIN', 'BDIH_DIRECTOR', 'BDIH_LEAD', 'BDIH_PO', 'BDIH_BA', 'BDIH_TEAM', 'BOCRA_REP', 'BOCRA_TEAM', 'DEV_LEAD', 'DEV_MEMBER');
create type activity_type as enum ('Task', 'Review', 'Milestone', 'Meeting', 'Report');
create type activity_status as enum ('Not started', 'In progress', 'Submitted', 'Under BDIH review', 'Returned to developer',
  'Under BOCRA review', 'Approved', 'Complete', 'On hold', 'Cancelled');
create type review_stage as enum ('BDIH', 'BOCRA');
create type link_type as enum ('FS', 'SS', 'FF');
create type submission_state as enum ('Under BDIH review', 'Under BOCRA review', 'Returned', 'Approved');

-- Organisations, workstreams, people --------------------------------------------------------

create table organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  short_name text not null unique,            -- BDIH, BOCRA, DEVA, DEVB
  type org_type not null,
  contact text,                               -- registered names of Developer A and B are set by the administrator
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table workstreams (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                  -- A, B, S
  name text not null,                         -- BOCRA website, UASF website, Shared
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
  delegated boolean not null default false,   -- developer member may submit and file weekly reports
  failed_logins timestamptz[] not null default '{}',
  locked_until timestamptz,
  last_login_at timestamptz,
  last_login_ip text,
  notification_prefs jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A user can hold more than one role: the primary role sits on profiles.role, extra roles here.
-- Every role must belong to the user's organisation (checked by trigger).
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

-- Configuration -----------------------------------------------------------------------------

create table settings (
  id boolean primary key default true check (id),   -- single row
  project_start date not null,
  contract_months int not null default 3 check (contract_months between 1 and 36),
  bdih_review_days int not null default 3 check (bdih_review_days between 1 and 30),
  bocra_review_days int not null default 5 check (bocra_review_days between 1 and 30),
  weekly_report_day int not null default 5 check (weekly_report_day between 1 and 5),  -- ISO day, 5 = Friday
  threshold_on_track numeric(4, 2) not null default 0.95,
  threshold_at_risk numeric(4, 2) not null default 0.85,
  festive_start date,
  festive_end date,
  current_baseline_id uuid,
  locked_through date,
  -- Administrator-configurable values (Administration, Settings)
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
  label text,                                 -- display name, for example phase names
  primary key (list_name, value)
);

-- Display names for roles, set by the administrator; permissions stay with the role key
create table role_labels (
  role app_role primary key,
  label text not null unique
);

-- Schedule ----------------------------------------------------------------------------------

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
  start_date date,                -- computed by recalc_schedule()
  finish_date date,               -- computed by recalc_schedule()
  total_float int,                -- computed
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

-- Submissions and reviews -------------------------------------------------------------------

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

-- Documents ---------------------------------------------------------------------------------

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
  storage_path text not null unique,   -- workstreams/{workstream_id}/{entity}/{entity_id}/{version}/{filename}
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

-- Reports -----------------------------------------------------------------------------------

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

-- Registers ---------------------------------------------------------------------------------

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

-- Meetings ----------------------------------------------------------------------------------

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

-- Collaboration, notifications, audit ---------------------------------------------------------

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

-- Role-based access: which roles hold which permission (editable by administrators)
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

-- Forgotten passwords: the request goes to administrators, who reset it
create table password_reset_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  requested_at timestamptz not null default now(),
  ip text,
  status text not null default 'Pending' check (status in ('Pending', 'Done', 'Dismissed')),
  handled_by uuid references profiles,
  handled_at timestamptz
);

-- Saved custom reports (report builder)
create table report_definitions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  dataset text not null check (dataset in ('activities', 'deliverables', 'submissions', 'invoices', 'risks', 'issues', 'weekly', 'documents')),
  definition jsonb not null,
  shared boolean not null default false,
  created_by uuid not null references profiles default auth.uid(),
  created_at timestamptz not null default now()
);
