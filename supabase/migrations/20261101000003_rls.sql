-- BDIH Project Tracking Tool: Row Level Security (SRS sections 3 and 5.2)
-- RLS is the authority. Developers never receive the other developer's rows, through the API,
-- search, exports or aggregates. Privileged writes go through the RPCs in the next migration.

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

-- Reference data ------------------------------------------------------------------------------

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

-- Users: developers see their own organisation plus named BDIH and BOCRA contacts
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

-- Schedule ------------------------------------------------------------------------------------

create policy act_read on activities for select to authenticated using (
  (deleted_at is null and can_see_item(workstream_id, visible_to_developers)) or has_role('ADMIN'));
-- The Project Leader, Project Officer, Business Analyst and administrators edit the plan (plan.edit)
create policy act_insert on activities for insert to authenticated with check (has_perm('plan.edit'));
create policy act_update on activities for update to authenticated using (has_perm('plan.edit')) with check (has_perm('plan.edit'));
create policy act_delete on activities for delete to authenticated using (has_role('ADMIN'));
-- Progress by developers, BOCRA and BDIH team members goes through update_progress(), which
-- restricts the columns (pct_done, actual dates, status within allowed transitions, notes).

-- A developer sees a link only when both ends are visible; hidden predecessors are reported by
-- activity_predecessors() as "Waits for BDIH or BOCRA action" without details.
create policy links_read on activity_links for select to authenticated using (
  can_see_activity(predecessor_id) and can_see_activity(successor_id));
create policy links_write on activity_links for all to authenticated using (has_perm('plan.edit')) with check (has_perm('plan.edit'));

create policy bl_read on baselines for select to authenticated using (true);
create policy bl_write on baselines for insert to authenticated with check (has_perm('plan.baseline'));
create policy bli_read on baseline_items for select to authenticated using (can_see_activity(activity_id));
create policy bli_write on baseline_items for insert to authenticated with check (has_perm('plan.baseline'));

create policy hist_read on status_history for select to authenticated using (can_see_activity(activity_id));

-- Submissions and reviews ---------------------------------------------------------------------

create policy sub_read on submissions for select to authenticated using (can_see_activity(activity_id));
create policy rev_read on reviews for select to authenticated using (
  exists (select 1 from submissions s where s.id = submission_id and can_see_activity(s.activity_id)));
create policy subdoc_read on submission_documents for select to authenticated using (
  exists (select 1 from submissions s where s.id = submission_id and can_see_activity(s.activity_id)));

-- Documents (FR-DOC-02): developers can read and upload only in their own workstream ----------

create policy doc_read on documents for select to authenticated using (
  (deleted_at is null and can_see_item(workstream_id, visible_to_developers)) or has_role('ADMIN'));
create policy doc_insert on documents for insert to authenticated with check (
  created_by = auth.uid() and can_see_workstream(workstream_id) and deleted_at is null and not has_role('BDIH_DIRECTOR')
  and (is_oversight() or not visible_to_developers)
  -- Document bank: BDIH and BOCRA only, always in Shared and visible to everyone
  and (entity_type <> 'bank' or (has_perm('bank.upload') and workstream_id = shared_workstream() and visible_to_developers)));
-- Soft delete and restore go through delete_document() / restore_document()

create policy docv_read on document_versions for select to authenticated using (
  exists (select 1 from documents d where d.id = document_id
          and ((d.deleted_at is null and can_see_item(d.workstream_id, d.visible_to_developers)) or has_role('ADMIN'))));
create policy docv_insert on document_versions for insert to authenticated with check (
  uploaded_by = auth.uid()
  and exists (select 1 from documents d where d.id = document_id and d.deleted_at is null and can_see_workstream(d.workstream_id)
              and (d.entity_type <> 'bank' or has_perm('bank.upload'))
              and storage_path like 'workstreams/' || d.workstream_id || '/%'));

-- Weekly and progress reports -------------------------------------------------------------------

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

-- Registers (FR-RSK) --------------------------------------------------------------------------

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
-- Column-level rules for change requests are in trg_cr_guard()
create policy change_requests_update on change_requests for update to authenticated
  using (has_perm('cr.recommend') or has_perm('cr.decide')) with check (true);

-- Meetings (FR-MTG): developer progress meetings sit in the developer's own workstream ----------

create policy mtg_read on meetings for select to authenticated using (can_see_item(workstream_id, visible_to_developers));
create policy mtg_write on meetings for all to authenticated using (has_perm('meeting.edit')) with check (has_perm('meeting.edit'));
create policy mta_read on meeting_attendees for select to authenticated using (
  exists (select 1 from meetings m where m.id = meeting_id and can_see_item(m.workstream_id, m.visible_to_developers)));
create policy mta_write on meeting_attendees for all to authenticated using (has_perm('meeting.edit')) with check (
  has_perm('meeting.edit') and exists (select 1 from meetings m where m.id = meeting_id and user_can_see(user_id, m.workstream_id, m.visible_to_developers)));
create policy ai_read on action_items for select to authenticated using (can_see_item(workstream_id, visible_to_developers));
create policy ai_insert on action_items for insert to authenticated with check (has_perm('meeting.edit') and user_can_see(owner_id, workstream_id, visible_to_developers));
create policy ai_update on action_items for update to authenticated using (has_perm('meeting.edit') or owner_id = auth.uid()) with check (has_perm('meeting.edit') or owner_id = auth.uid());

-- Comments, notifications, audit ----------------------------------------------------------------

create policy cm_read on comments for select to authenticated using (can_see_item(workstream_id, visible_to_developers));
-- Inserts go through add_comment(), which checks the entity and mentions

create policy nt_read on notifications for select to authenticated using (user_id = auth.uid());
create policy nt_mark on notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy audit_read on audit_log for select to authenticated using (has_perm('audit.view'));

-- Roles and permissions: everyone can read the grid (the app hides what you cannot do); admins edit it
create policy rp_read on role_permissions for select to authenticated using (true);
create policy rp_admin on role_permissions for all to authenticated using (has_perm('users.manage')) with check (has_perm('users.manage'));
create policy pc_read on permission_catalogue for select to authenticated using (true);

create policy prr_admin on password_reset_requests for select to authenticated using (has_perm('users.manage'));
create policy prr_handle on password_reset_requests for update to authenticated using (has_perm('users.manage')) with check (has_perm('users.manage'));

-- Saved reports: your own, plus shared ones from colleagues (results still follow RLS)
create policy rd_read on report_definitions for select to authenticated using (created_by = auth.uid() or (shared and is_oversight()));
create policy rd_insert on report_definitions for insert to authenticated with check (created_by = auth.uid());
create policy rd_delete on report_definitions for delete to authenticated using (created_by = auth.uid());
-- No insert, update or delete policy on audit_log for anyone; rows arrive only from triggers and log_event().

-- Grants: the anon role gets nothing; signed-in users get table access filtered by the policies.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete on audit_log, status_history, submissions, reviews, notifications, reminder_flags from authenticated;
grant update (read_at) on notifications to authenticated;
grant execute on all functions in schema public to authenticated;
revoke execute on function recalc_schedule(), notify_users(uuid[], text, text, uuid, boolean, text, uuid, text, text) from authenticated;
