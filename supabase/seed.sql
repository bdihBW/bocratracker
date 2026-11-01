-- Reference data. Users are created through the admin-users Edge Function (Supabase Auth),
-- and the project plan through the one-off Excel import (FR-SCH-14).

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

-- The festive closure trigger generates closure days from these dates
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

-- Default role permissions (Administration, Roles and permissions). Keep in step with js/core.js PERMISSIONS.
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

-- Phases with their display names (Administration, Lists)
insert into lookups (list_name, value, sort_order, protected, label) values
  ('phase', 'Phase 1', 1, false, 'Phase 1: Planning and requirements'),
  ('phase', 'Phase 2', 2, false, 'Phase 2: Design and build'),
  ('phase', 'Phase 3', 3, false, 'Phase 3: Testing, commissioning and closure')
on conflict (list_name, value) do update set label = excluded.label;
