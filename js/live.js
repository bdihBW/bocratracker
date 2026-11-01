'use strict';
/* Live mode: runs the tracker against Supabase.
   - Sign-in goes through the login Edge Function (username, Turnstile, lockout).
   - After sign-in every collection is loaded from Supabase; RLS decides what each person receives.
   - Screens keep working on the in-memory state. After each change, commit() pushes the difference to
     Supabase (tables the access rules allow) and reloads, so the server stays the source of truth.
   - Workflow steps (progress, submissions, reviews, invoices, weekly reports, documents, users) call
     the database functions or Edge Functions directly, never by editing the tables underneath.
   History, audit entries and notifications are written by the database, so the local helpers for
   those do nothing here. Loaded last. */
(function () {
  if (!window.BDIH_LIVE || !window.supabase) return;
  const SB = window.supabase.createClient(BDIH_LIVE.url, BDIH_LIVE.key, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'bdih-tracker-auth' }
  });
  window.LIVE = true;
  window.SB = SB;

  /* ---------- Small helpers ---------- */
  const M = { ws: {}, wsCode: {}, org: {}, orgCode: {} };
  const wsId = c => M.ws[c] || null, wsCodeOf = id => M.wsCode[id] || null;
  const orgId = c => M.org[c] || null, orgCodeOf = id => M.orgCode[id] || null;
  const nul = v => (v === '' || v === undefined ? null : v);
  function must(res, what) { if (res && res.error) throw new Error((what ? what + ': ' : '') + (res.error.message || res.error)); return res ? res.data : null; }
  async function rpc(fn, args) { return must(await SB.rpc(fn, args || {}), fn); }
  async function all(table, order) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      let q = SB.from(table).select('*');
      if (order) q = q.order(order, { ascending: true });
      const res = await q.range(from, from + 999);
      const data = must(res, table) || [];
      out.push(...data);
      if (data.length < 1000) break;
    }
    return out;
  }
  async function fnCall(name, body) {
    const { data, error } = await SB.functions.invoke(name, { body });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) { /* keep message */ }
      throw new Error(msg);
    }
    return data;
  }
  const busy = on => document.body.classList.toggle('busy', !!on);

  // Records created in the browser need real UUIDs so they can be inserted as they are
  uid = () => crypto.randomUUID();
  // The database writes the audit trail, status history and notifications
  audit = () => {};
  hist = () => {};
  notify = () => {};
  runChecks = () => {};
  Store.save = () => {};
  Store.reset = () => {};

  /* ---------- Loading ---------- */
  const SETTINGS = [['projectStart', 'project_start'], ['contractMonths', 'contract_months'], ['bdihReviewDays', 'bdih_review_days'],
    ['bocraReviewDays', 'bocra_review_days'], ['weeklyReportDay', 'weekly_report_day'], ['thrOnTrack', 'threshold_on_track', Number],
    ['thrAtRisk', 'threshold_at_risk', Number], ['festiveStart', 'festive_start'], ['festiveEnd', 'festive_end'],
    ['currentBaselineId', 'current_baseline_id'], ['lockedThrough', 'locked_through'], ['dailyDownloadLimit', 'daily_download_limit'],
    ['appName', 'app_name'], ['appSubtitle', 'app_subtitle'], ['projectName', 'project_name'], ['vatRate', 'vat_rate', Number],
    ['escalationDays', 'escalation_days'], ['idleMinutes', 'idle_minutes'], ['sessionHours', 'session_hours'],
    ['lockoutAttempts', 'lockout_attempts'], ['lockoutMinutes', 'lockout_minutes'], ['passwordMinLength', 'password_min_length'],
    ['turnstileSiteKey', 'turnstile_site_key'], ['turnstileEnabled', 'turnstile_enabled'], ['appOrigins', 'app_origins']];
  const LISTS = { document_category: 'docCategories', bank_category: 'bankCategories', review_checklist: 'checklist', forum: 'forums',
    ticket_status: 'ticketStatuses', ticket_type: 'ticketTypes', ticket_priority: 'ticketPriorities' };
  const link = l => !l ? null : l === '/admin/requests' ? '#/admin?tab=requests' : '#' + l;

  function skeleton() {
    const s = seedState();
    ['users', 'resources', 'activities', 'links', 'baselines', 'history', 'submissions', 'reviews', 'documents', 'weekly', 'reports',
      'deliverables', 'risks', 'issues', 'decisions', 'changes', 'meetings', 'actions', 'comments', 'notifications', 'audit', 'requests',
      'tickets', 'invoices', 'reportDefs'].forEach(k => { s[k] = []; });
    s.flags = {}; s.labels = {}; s.roleNames = null; s.rolePerms = null;
    return s;
  }

  async function loadAll() {
    const me = (await SB.auth.getUser()).data.user;
    if (!me) throw new Error('Not signed in');
    const [orgs, wss, profiles, uroles, resources, settingsRow, cal, lookups, acts, links, baselines, blItems, hist_, subs, subDocs,
      reviews, docs, vers, weekly, wItems, preps, dels, risks, issues, decs, crs, meetings, att, actions, comments, reqs, resets,
      invoices, invHist, tickets, tComments, tHist, rperms, rlabels, uilabels, rdefs] = await Promise.all([
      all('organisations'), all('workstreams'), all('profiles'), all('user_roles'), all('resources'), rpc('app_settings'),
      rpc('closure_calendar'), all('lookups', 'sort_order'), all('activities', 'display_order'), all('activity_links'),
      all('baselines', 'saved_at'), all('baseline_items'), all('status_history', 'changed_at'), all('submissions'),
      all('submission_documents'), all('reviews'), all('documents'), all('document_versions', 'version_no'), all('weekly_reports'),
      all('weekly_report_items'), all('progress_reports'), all('deliverables'), all('risks'), all('issues'), all('decisions'),
      all('change_requests'), all('meetings'), all('meeting_attendees'), all('action_items'), all('comments', 'created_at'),
      all('account_requests'), all('password_reset_requests'), all('invoices'), all('invoice_status_history', 'changed_at'),
      all('tickets'), all('ticket_comments', 'created_at'), all('ticket_history', 'changed_at'), all('role_permissions'),
      all('role_labels'), all('ui_labels'), all('report_definitions')]);
    const notes = must(await SB.from('notifications').select('*').eq('user_id', me.id).order('created_at', { ascending: false }).limit(300), 'notifications');

    const S = skeleton();
    M.ws = {}; M.wsCode = {}; M.org = {}; M.orgCode = {};
    orgs.forEach(o => { M.org[o.short_name] = o.id; M.orgCode[o.id] = o.short_name; });
    wss.forEach(w => { M.ws[w.code] = w.id; M.wsCode[w.id] = w.code; });
    const ws = id => wsCodeOf(id), oc = id => orgCodeOf(id);

    S.orgs = orgs.map(o => ({ id: o.short_name, name: o.name, type: o.type, active: o.active, contact: o.contact || '' }));
    S.workstreams = wss.map(w => ({ id: w.code, name: w.name, owner: oc(w.owner_organisation_id), website: w.website || '', ticketPrefix: w.ticket_prefix || null }));
    const st = settingsRow && (Array.isArray(settingsRow) ? settingsRow[0] : settingsRow);
    if (st) SETTINGS.forEach(([k, c, f]) => { if (st[c] !== undefined) S.settings[k] = f && st[c] != null ? f(st[c]) : st[c]; });
    S.holidays = (cal || []).filter(c => c.reason !== 'Festive closure').map(c => ({ date: c.date, reason: c.reason }));
    const lk = {};
    lookups.forEach(l => { (lk[l.list_name] = lk[l.list_name] || []).push(l); });
    Object.entries(LISTS).forEach(([dbName, k]) => { if (lk[dbName]) S.lookups[k] = lk[dbName].map(l => l.value); });
    if (lk.phase) S.lookups.phases = lk.phase.map(l => ({ key: l.value, name: l.label || l.value }));
    S.users = profiles.map(p => ({ id: p.id, username: p.username, fullName: p.full_name, org: oc(p.organisation_id), role: p.role,
      extraRoles: uroles.filter(r => r.user_id === p.id).map(r => r.role), title: p.job_title || '', phone: p.phone || '', email: p.email || '',
      active: p.active, mustChange: p.must_change_password, delegated: p.delegated, lockedUntil: p.locked_until ? Date.parse(p.locked_until) : 0,
      lastLogin: p.last_login_at, prefs: p.notification_prefs || {}, fails: [] }));
    S.resources = resources.map(r => ({ id: r.id, name: r.name, org: oc(r.organisation_id), linkedUser: r.linked_user_id, description: r.role_description || '' }));
    S.activities = acts.map(a => ({ id: a.id, key: a.key, ws: ws(a.workstream_id), phase: a.phase, type: a.type, name: a.name, duration: a.duration,
      pct: a.pct_done, status: a.status, lead: a.lead_resource_id, support: a.support_resource_id, fixedStart: a.fixed_start,
      actualStart: a.actual_start, actualFinish: a.actual_finish, notes: a.notes || '', visibleToDevs: a.visible_to_developers,
      deliverableRef: a.deliverable_ref || '', reviewStage: a.review_stage, submittable: a.submittable, indent: a.indent,
      docCat: a.doc_category || 'Other', bdihReviewId: a.bdih_review_activity_id, bocraReviewId: a.bocra_review_activity_id,
      forId: a.for_activity_id, autoDone: a.auto_done, deleted: a.deleted_at }));
    S.links = links.map(l => ({ id: l.id, from: l.predecessor_id, to: l.successor_id, type: l.link_type, lag: l.lag }));
    S.baselines = baselines.map(b => ({ id: b.id, name: b.name, savedAt: b.saved_at, savedBy: b.saved_by, crId: b.change_request_id, items: {} }));
    blItems.forEach(i => { const b = S.baselines.find(x => x.id === i.baseline_id); if (b) b.items[i.activity_id] = { start: i.start_date, finish: i.finish_date }; });
    S.history = hist_.map(h => ({ id: String(h.id), activityId: h.activity_id, by: h.changed_by, at: h.changed_at, field: h.field, old: h.old_value, new: h.new_value, comment: h.comment || '', correction: h.is_correction }));
    S.submissions = subs.map(s => ({ id: s.id, activityId: s.activity_id, ws: ws(s.workstream_id), version: s.version, by: s.submitted_by, at: s.submitted_at,
      coverNote: s.cover_note, state: s.state, docIds: subDocs.filter(d => d.submission_id === s.id).map(d => d.document_id) }));
    S.reviews = reviews.map(r => ({ id: r.id, submissionId: r.submission_id, stage: r.stage, reviewer: r.reviewer_id, due: r.due_date, decidedAt: r.decided_at,
      outcome: r.outcome, findings: r.findings || '', checklist: r.checklist_result }));
    S.documents = docs.map(d => ({ id: d.id, title: d.title, category: d.category, ws: ws(d.workstream_id), entityType: d.entity_type, entityId: d.entity_id,
      visibleToDevs: d.visible_to_developers, deleted: d.deleted_at, deletedBy: d.deleted_by,
      versions: vers.filter(v => v.document_id === d.id).map(v => ({ no: v.version_no, name: v.file_name, size: Number(v.size_bytes), by: v.uploaded_by,
        at: v.uploaded_at, comment: v.comment || '', scan: v.scan_status, sha: v.sha256 || '', data: null, path: v.storage_path })) })).filter(d => d.versions.length);
    S.weekly = weekly.map(w => ({ id: w.id, ws: ws(w.workstream_id), weekEnding: w.week_ending, by: w.submitted_by, at: w.submitted_at, completed: w.work_completed,
      planned: w.work_planned, issues: w.issues || '', risks: w.risks || '', crs: w.change_requests || '', support: w.support_needed || '',
      pcts: wItems.filter(i => i.report_id === w.id).map(i => ({ id: i.activity_id, pct: i.pct_done })), reviewedBy: w.reviewed_by, reviewedAt: w.reviewed_at, comment: w.bdih_comment || '' }));
    S.reports = preps.filter(p => p.official_month).map(p => ({ id: p.id, official: true, scope: p.scope, month: p.official_month, start: p.period_start,
      end: p.period_end, by: p.generated_by, at: p.generated_at, html: (p.commentary && p.commentary.html) || '' }));
    S.deliverables = dels.map(d => ({ id: d.id, ref: d.ref, name: d.name, phase: d.phase, owner: oc(d.owner_organisation_id), ws: ws(d.workstream_id), activityId: d.activity_id }));
    S.risks = risks.map(r => ({ id: r.id, ws: ws(r.workstream_id), visibleToDevs: r.visible_to_developers, title: r.title, description: r.description || '',
      likelihood: r.likelihood, impact: r.impact, owner: r.owner_id, mitigation: r.mitigation || '', due: r.due_date, status: r.status, createdBy: r.created_by }));
    S.issues = issues.map(r => ({ id: r.id, ws: ws(r.workstream_id), visibleToDevs: r.visible_to_developers, title: r.title, description: r.description || '',
      severity: r.severity, owner: r.owner_id, raised: r.raised_on, target: r.target_date, status: r.status, resolution: r.resolution || '', createdBy: r.created_by }));
    S.decisions = decs.map(r => ({ id: r.id, ws: ws(r.workstream_id), visibleToDevs: r.visible_to_developers, decision: r.decision, date: r.decision_date,
      madeBy: r.made_by || '', forum: r.forum || '', related: r.related_items || '', status: r.status, createdBy: r.created_by }));
    S.changes = crs.map(r => ({ id: r.id, ws: ws(r.workstream_id), visibleToDevs: r.visible_to_developers, title: r.title, description: r.description,
      requestedBy: r.requested_by, requested: r.requested_on, impactScope: r.impact_scope, impactTime: r.impact_time || '', impactCost: r.impact_cost || '',
      recommendation: r.bdih_recommendation || '', decision: r.bocra_decision, decisionText: r.bocra_decision_text || '', planChanges: r.plan_changes || '',
      status: r.status, createdBy: r.created_by }));
    S.meetings = meetings.map(m => ({ id: m.id, ws: ws(m.workstream_id), visibleToDevs: m.visible_to_developers, forum: m.forum, title: m.title, date: m.meeting_date,
      attendees: att.filter(a => a.meeting_id === m.id).map(a => a.user_id), agenda: m.agenda || '', decisions: m.decisions || '', minutesDoc: m.minutes_document_id }));
    S.actions = actions.map(a => ({ id: a.id, meetingId: a.meeting_id, ws: ws(a.workstream_id), visibleToDevs: a.visible_to_developers, text: a.description,
      owner: a.owner_id, due: a.due_date, status: a.status }));
    S.comments = comments.map(c => ({ id: c.id, entityType: c.entity_type, entityId: c.entity_id, ws: ws(c.workstream_id), author: c.author_id, body: c.body, at: c.created_at }));
    S.notifications = (notes || []).map(n => ({ id: n.id, user: n.user_id, type: n.type, title: n.title, link: link(n.link), at: n.created_at, read: n.read_at }));
    S.requests = reqs.map(r => ({ id: r.id, type: 'account', by: r.requested_by, org: oc(r.organisation_id), role: 'DEV_MEMBER', fullName: r.full_name,
      username: r.username, email: r.email, title: r.job_title || '', at: r.created_at, status: r.status }))
      .concat(resets.map(r => { const u = S.users.find(x => x.id === r.user_id) || {}; return { id: r.id, type: 'reset', userId: r.user_id, fullName: u.fullName || '', username: u.username || '', at: r.requested_at, status: r.status }; }));
    S.invoices = invoices.map(i => ({ id: i.id, no: i.invoice_no, org: oc(i.organisation_id), ws: ws(i.workstream_id), deliverableId: i.deliverable_id,
      description: i.description, date: i.invoice_date, amount: Number(i.amount_excl_vat), vat: Number(i.vat_amount), status: i.status,
      comment: i.status_comment || '', paymentRef: i.payment_reference || '', paidOn: i.paid_on, by: i.submitted_by, at: i.submitted_at,
      docIds: S.documents.filter(d => d.entityType === 'invoice' && d.entityId === i.id).map(d => d.id),
      history: invHist.filter(h => h.invoice_id === i.id).map(h => [h.new_status, h.changed_by, h.comment || '', h.changed_at]) }));
    const tField = { assignee_id: 'assignee', due_date: 'due', activity_id: 'activityId' };
    S.tickets = tickets.map(t => ({ id: t.id, key: t.key, ws: ws(t.workstream_id), type: t.type, title: t.title, description: t.description || '',
      priority: t.priority, status: t.status, assignee: t.assignee_id, reporter: t.reporter_id, activityId: t.activity_id, labels: t.labels || [],
      due: t.due_date, estimate: t.estimate == null ? null : Number(t.estimate), created: t.created_at, updated: t.updated_at,
      comments: tComments.filter(c => c.ticket_id === t.id).map(c => ({ by: c.author_id, at: c.created_at, body: c.body })),
      history: tHist.filter(h => h.ticket_id === t.id).map(h => [h.changed_at, h.changed_by, tField[h.field] || h.field, h.old_value, h.new_value]) }));
    S.rolePerms = {};
    PERMISSIONS.forEach(([k]) => { S.rolePerms[k] = rperms.filter(r => r.permission === k).map(r => r.role); });
    S.roleNames = rlabels.length ? Object.fromEntries(rlabels.map(r => [r.role, r.label])) : null;
    S.labels = Object.fromEntries(uilabels.map(l => [l.original, l.label]));
    S.reportDefs = rdefs.map(r => ({ id: r.id, name: r.name, def: r.definition, by: r.created_by, at: r.created_at, shared: r.shared }));

    Store.state = S;
    const u = S.users.find(x => x.id === me.id);
    // Audit trail and the download log are for those allowed to see them
    if (u && can.audit(u)) {
      const a = must(await SB.from('audit_log').select('*').order('occurred_at', { ascending: false }).limit(3000), 'audit_log');
      S.audit = a.reverse().map(x => ({ id: String(x.id), at: x.occurred_at, user: x.user_id, ip: x.ip, action: x.action, entity: x.entity_type, entityId: x.entity_id, before: x.before, after: x.after }));
    } else if (u && isOversight(u)) {
      const dl = await rpc('download_log', { p_from: D.add(D.today(), -90), p_to: D.today() });
      S.audit = (dl || []).reverse().map((x, k) => ({ id: 'dl' + k, at: x.occurred_at, user: (S.users.find(y => y.fullName === x.user_name) || {}).id, ip: '', action: x.action, entity: x.entity_type, entityId: x.entity_id, before: null, after: x.details }));
    }
    S._errors = runSchedule(S);
    snapshot();
    return me.id;
  }

  /* ---------- Writing: push what changed ---------- */
  const SPECS = [
    { c: 'activities', t: 'activities', when: u => can.editPlan(u), noDelete: true,
      row: (a, i) => ({ id: a.id, display_order: i + 1, workstream_id: wsId(a.ws), phase: a.phase, name: a.name, type: a.type, review_stage: a.type === 'Review' ? a.reviewStage : null,
        deliverable_ref: nul(a.deliverableRef), lead_resource_id: nul(a.lead), support_resource_id: nul(a.support), duration: a.type === 'Milestone' ? 0 : Math.max(1, +a.duration || 1),
        fixed_start: nul(a.fixedStart), visible_to_developers: a.ws === 'S' && !!a.visibleToDevs, submittable: !!a.submittable, doc_category: nul(a.docCat),
        indent: a.indent || 0, key: nul(a.key), notes: nul(a.notes), deleted_at: a.deleted ? (typeof a.deleted === 'string' && a.deleted.length > 10 ? a.deleted : new Date().toISOString()) : null,
        bdih_review_activity_id: nul(a.bdihReviewId), bocra_review_activity_id: nul(a.bocraReviewId), for_activity_id: nul(a.forId) }) },
    { c: 'links', t: 'activity_links', when: u => can.editPlan(u), row: l => ({ id: l.id, predecessor_id: l.from, successor_id: l.to, link_type: l.type || 'FS', lag: +l.lag || 0 }) },
    { c: 'deliverables', t: 'deliverables', when: u => can.editPlan(u),
      row: d => ({ id: d.id, ref: d.ref, name: d.name, phase: d.phase, owner_organisation_id: orgId(d.owner), workstream_id: wsId(d.ws), activity_id: nul(d.activityId) }) },
    { c: 'risks', t: 'risks', created: true, row: r => ({ id: r.id, workstream_id: wsId(r.ws), visible_to_developers: !!r.visibleToDevs, title: r.title, description: nul(r.description),
      likelihood: +r.likelihood, impact: +r.impact, owner_id: nul(r.owner), mitigation: nul(r.mitigation), due_date: nul(r.due), status: r.status || 'Open' }) },
    { c: 'issues', t: 'issues', created: true, row: r => ({ id: r.id, workstream_id: wsId(r.ws), visible_to_developers: !!r.visibleToDevs, title: r.title, description: nul(r.description),
      severity: r.severity || 'Medium', owner_id: nul(r.owner), raised_on: nul(r.raised) || D.today(), target_date: nul(r.target), status: r.status || 'Open', resolution: nul(r.resolution) }) },
    { c: 'decisions', t: 'decisions', created: true, row: r => ({ id: r.id, workstream_id: wsId(r.ws), visible_to_developers: !!r.visibleToDevs, decision: r.decision,
      decision_date: nul(r.date) || D.today(), made_by: nul(r.madeBy), forum: nul(r.forum), related_items: nul(r.related), status: r.status || 'Made' }) },
    { c: 'changes', t: 'change_requests', created: true, row: r => ({ id: r.id, workstream_id: wsId(r.ws), visible_to_developers: !!r.visibleToDevs, title: r.title, description: r.description,
      requested_by: nul(r.requestedBy), requested_on: nul(r.requested) || D.today(), impact_scope: nul(r.impactScope), impact_time: nul(r.impactTime), impact_cost: nul(r.impactCost),
      bdih_recommendation: nul(r.recommendation), bocra_decision: r.decision || 'Pending', bocra_decision_text: nul(r.decisionText), plan_changes: nul(r.planChanges) }) },
    { c: 'meetings', t: 'meetings', when: u => can.meetingEdit(u), created: true, row: m => ({ id: m.id, workstream_id: wsId(m.ws), visible_to_developers: m.ws === 'S' && !!m.visibleToDevs,
      forum: m.forum, title: m.title, meeting_date: m.date, agenda: nul(m.agenda), decisions: nul(m.decisions), minutes_document_id: nul(m.minutesDoc) }) },
    { c: 'actions', t: 'action_items', noDelete: true, row: a => ({ id: a.id, meeting_id: nul(a.meetingId), workstream_id: wsId(a.ws), visible_to_developers: !!a.visibleToDevs,
      description: a.text, owner_id: a.owner, due_date: a.due, status: a.status }) },
    { c: 'tickets', t: 'tickets', row: t => ({ id: t.id, workstream_id: wsId(t.ws), type: t.type, title: t.title, description: nul(t.description), priority: t.priority,
      status: t.status, assignee_id: nul(t.assignee), reporter_id: t.reporter, activity_id: nul(t.activityId), labels: t.labels || [], due_date: nul(t.due), estimate: t.estimate == null || t.estimate === '' ? null : +t.estimate }) },
    { c: 'resources', t: 'resources', when: u => can.admin(u), noDelete: true,
      row: r => ({ id: r.id, name: r.name, organisation_id: orgId(r.org), role_description: nul(r.description), linked_user_id: nul(r.linkedUser) }) },
    { c: 'orgs', t: 'organisations', when: u => can.admin(u), updateOnly: true, key: o => orgId(o.id), row: o => ({ id: orgId(o.id), name: o.name, contact: nul(o.contact) }) },
    { c: 'workstreams', t: 'workstreams', when: u => can.admin(u), updateOnly: true, key: w => wsId(w.id),
      row: w => ({ id: wsId(w.id), name: w.name, website: nul(w.website), owner_organisation_id: orgId(w.owner), ticket_prefix: w.id === 'S' ? null : (w.ticketPrefix || null) }) },
    { c: 'weekly', t: 'weekly_reports', when: u => can.weeklyReview(u), updateOnly: true,
      row: w => ({ id: w.id, reviewed_by: nul(w.reviewedBy), reviewed_at: nul(w.reviewedAt), bdih_comment: nul(w.comment) }) },
    { c: 'notifications', t: 'notifications', updateOnly: true, row: n => ({ id: n.id, read_at: nul(n.read) }) },
    { c: 'reportDefs', t: 'report_definitions', noUpdate: true, row: r => ({ id: r.id, name: r.name, dataset: r.def.ds, definition: r.def, shared: !!r.shared, created_by: r.by }) }
  ];
  const keyOf = (spec, o) => (spec.key ? spec.key(o) : o.id);

  function rowsOf(spec, S) {
    const m = new Map();
    (S[spec.c] || []).forEach((o, i) => { const r = spec.row(o, i); m.set(keyOf(spec, o), r); });
    return m;
  }
  const settingsRow = S => Object.fromEntries(SETTINGS.filter(([k]) => S.settings[k] !== undefined).map(([k, c]) => [c, S.settings[k] ?? null]));
  const ticketCommentCount = S => Object.fromEntries((S.tickets || []).map(t => [t.id, t.comments.length]));
  const listRows = S => { const out = {}; Object.entries(LISTS).forEach(([db, k]) => { out[db] = (S.lookups[k] || []).slice(); }); out.phase = (S.lookups.phases || []).map(p => p.key + '\u0001' + p.name); return out; };
  const permRows = S => Object.fromEntries(PERMISSIONS.map(([k]) => [k, (S.rolePerms && S.rolePerms[k] ? S.rolePerms[k] : permRoles(k)).slice().sort()]));

  let SNAP = null;
  function snapshot() {
    const S = Store.state;
    SNAP = {
      specs: Object.fromEntries(SPECS.map(sp => [sp.c, new Map([...rowsOf(sp, S)].map(([k, v]) => [k, JSON.stringify(v)]))])),
      settings: JSON.stringify(settingsRow(S)), holidays: JSON.stringify(S.holidays.slice().sort((a, b) => a.date < b.date ? -1 : 1)),
      lists: listRows(S), labels: JSON.stringify(S.labels || {}), roleNames: JSON.stringify(S.roleNames || {}), perms: permRows(S),
      tcom: ticketCommentCount(S), att: Object.fromEntries((S.meetings || []).map(m => [m.id, JSON.stringify(m.attendees.slice().sort())])),
      requests: Object.fromEntries((S.requests || []).map(r => [r.id, r.status]))
    };
  }

  async function pushDiffs() {
    const S = Store.state, u = me(), meId = Sess.userId;
    for (const sp of SPECS) {
      if (sp.when && !sp.when(u)) continue;
      const before = SNAP.specs[sp.c] || new Map(), now = rowsOf(sp, S);
      const upserts = [], updates = [], dels = [];
      now.forEach((row, k) => {
        const old = before.get(k), js = JSON.stringify(row);
        if (old === js) return;
        if (!old) { if (sp.updateOnly) return; if (sp.created) row.created_by = meId; upserts.push(row); }
        else if (!sp.noUpdate) { if (sp.updateOnly) updates.push(row); else upserts.push(row); }
      });
      if (!sp.updateOnly && !sp.noDelete) before.forEach((_, k) => { if (!now.has(k)) dels.push(k); });
      if (upserts.length) must(await SB.from(sp.t).upsert(upserts), 'Saving ' + sp.c);
      for (const r of updates) { const { id, ...rest } = r; must(await SB.from(sp.t).update(rest).eq('id', id), 'Saving ' + sp.c); }
      if (dels.length) must(await SB.from(sp.t).delete().in('id', dels), 'Deleting ' + sp.c);
    }
    // Meeting attendees
    if (can.meetingEdit(u)) for (const m of S.meetings) {
      const js = JSON.stringify(m.attendees.slice().sort());
      if (SNAP.att[m.id] === js) continue;
      must(await SB.from('meeting_attendees').delete().eq('meeting_id', m.id), 'Attendees');
      if (m.attendees.length) must(await SB.from('meeting_attendees').insert(m.attendees.map(x => ({ meeting_id: m.id, user_id: x }))), 'Attendees');
    }
    // New ticket comments
    for (const t of S.tickets) {
      const had = SNAP.tcom[t.id] || 0;
      if (t.comments.length > had) must(await SB.from('ticket_comments').insert(t.comments.slice(had).map(c => ({ ticket_id: t.id, body: c.body, author_id: meId }))), 'Comment');
    }
    // Settings, closure calendar, lists, labels, role names and permissions (administrators)
    if (can.editSettings(u) && JSON.stringify(settingsRow(S)) !== SNAP.settings) {
      const r = settingsRow(S); if (!can.admin(u)) delete r.app_origins;
      must(await SB.from('settings').update(r).eq('id', true), 'Settings');
    }
    const hol = S.holidays.slice().sort((a, b) => a.date < b.date ? -1 : 1);
    if (can.editSettings(u) && JSON.stringify(hol) !== SNAP.holidays) {
      const old = JSON.parse(SNAP.holidays), oldD = old.map(h => h.date), nowD = hol.map(h => h.date);
      const gone = oldD.filter(d => !nowD.includes(d)), added = hol.filter(h => !oldD.includes(h.date));
      if (gone.length) must(await SB.from('closure_days').delete().in('date', gone).eq('source', 'public holiday'), 'Closure calendar');
      if (added.length) must(await SB.from('closure_days').upsert(added.map(h => ({ date: h.date, reason: h.reason, source: 'public holiday' }))), 'Closure calendar');
    }
    if (can.admin(u)) {
      const lists = listRows(S);
      for (const [db, vals] of Object.entries(lists)) {
        const old = SNAP.lists[db] || [];
        if (JSON.stringify(old) === JSON.stringify(vals)) continue;
        const keys = vals.map(v => v.split('\u0001')[0]);
        const gone = old.map(v => v.split('\u0001')[0]).filter(v => !keys.includes(v));
        if (gone.length) must(await SB.from('lookups').delete().eq('list_name', db).in('value', gone), 'Lists');
        must(await SB.from('lookups').upsert(vals.map((v, i) => { const [value, label] = v.split('\u0001'); return { list_name: db, value, sort_order: i + 1, label: label || null }; }),
          { onConflict: 'list_name,value' }), 'Lists');
      }
      if (JSON.stringify(S.labels || {}) !== SNAP.labels) {
        const old = JSON.parse(SNAP.labels), now = S.labels || {};
        const gone = Object.keys(old).filter(k => !(k in now));
        if (gone.length) must(await SB.from('ui_labels').delete().in('original', gone), 'Labels');
        const up = Object.entries(now).filter(([k, v]) => old[k] !== v).map(([original, label]) => ({ original, label }));
        if (up.length) must(await SB.from('ui_labels').upsert(up), 'Labels');
      }
      if (JSON.stringify(S.roleNames || {}) !== SNAP.roleNames) {
        must(await SB.from('role_labels').delete().neq('label', ''), 'Role names');
        const rn = Object.entries(S.roleNames || {}).map(([role, label]) => ({ role, label }));
        if (rn.length) must(await SB.from('role_labels').insert(rn), 'Role names');
      }
      const perms = permRows(S);
      for (const [k, roles] of Object.entries(perms)) {
        const old = SNAP.perms[k] || [];
        if (JSON.stringify(old) === JSON.stringify(roles)) continue;
        const gone = old.filter(r => !roles.includes(r)), added = roles.filter(r => !old.includes(r));
        if (gone.length) must(await SB.from('role_permissions').delete().eq('permission', k).in('role', gone), 'Permissions');
        if (added.length) must(await SB.from('role_permissions').insert(added.map(role => ({ permission: k, role }))), 'Permissions');
      }
      // Request status changes (approve or reject)
      for (const r of S.requests) {
        if (SNAP.requests[r.id] === r.status || !SNAP.requests[r.id]) continue;
        if (r.type === 'reset') must(await SB.from('password_reset_requests').update({ status: r.status === 'Rejected' ? 'Dismissed' : r.status, handled_by: meId, handled_at: new Date().toISOString() }).eq('id', r.id), 'Requests');
        else must(await SB.from('account_requests').update({ status: r.status, decided_by: meId, decided_at: new Date().toISOString() }).eq('id', r.id), 'Requests');
      }
    }
    // New account requests from a Developer Lead
    for (const r of S.requests) {
      if (SNAP.requests[r.id] || r.type === 'reset') continue;
      must(await SB.from('account_requests').insert({ id: r.id, requested_by: meId, organisation_id: orgId(r.org), full_name: r.fullName, username: r.username, email: r.email, job_title: nul(r.title), status: 'Pending' }), 'Account request');
    }
  }

  // Changes queue one after another; each ends with a fresh load from Supabase
  let queue = Promise.resolve();
  async function reload(msg) {
    try { await loadAll(); } catch (e) { toast('Could not refresh from the server: ' + e.message, 'err'); }
    render();
    if (msg) toast(msg);
  }
  window.liveReload = reload;
  commit = function (msg) {
    Store.state._errors = runSchedule(Store.state);
    closeModal();
    render();
    queue = queue.then(async () => {
      busy(true);
      try { await pushDiffs(); await reload(msg); } catch (e) { toast(e.message, 'err'); await reload(); } finally { busy(false); }
    });
    return queue;
  };
  // Run a server call, then refresh; errors show as a message and nothing changes locally
  function act(fn, okMsg) {
    queue = queue.then(async () => {
      busy(true);
      try { const r = await fn(); closeModal(); await reload(typeof okMsg === 'function' ? okMsg(r) : okMsg); return r; }
      catch (e) { toast(e.message, 'err'); } finally { busy(false); }
    });
    return queue;
  }

  /* ---------- Files ---------- */
  async function upload(file, meta) {
    const r = await readFile(file);
    if (r.error) throw new Error(r.error);
    const S = Store.state, meId = Sess.userId;
    let doc = meta.docId ? S.documents.find(d => d.id === meta.docId)
      : S.documents.find(d => !d.deleted && d.entityType === meta.entityType && (d.entityId || null) === (meta.entityId || null) && d.ws === meta.ws &&
        d.versions[d.versions.length - 1].name.toLowerCase() === file.name.toLowerCase());
    const ws = doc ? doc.ws : meta.ws, docId = doc ? doc.id : crypto.randomUUID();
    const version = doc ? doc.versions.length + 1 : 1;
    const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120);
    const path = `workstreams/${wsId(ws)}/${(doc ? doc.entityType : meta.entityType) || 'library'}/${(doc ? doc.entityId : meta.entityId) || 'none'}/${version}/${safe}`;
    must(await SB.storage.from('project-files').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false }), 'Upload');
    if (!doc) must(await SB.from('documents').insert({ id: docId, workstream_id: wsId(ws), entity_type: meta.entityType || 'library', entity_id: nul(meta.entityId),
      category: meta.category || 'Other', title: meta.title || file.name.replace(/\.[^.]+$/, ''), visible_to_developers: ws === 'S' && !!meta.visibleToDevs, created_by: meId }), 'Document');
    must(await SB.from('document_versions').insert({ document_id: docId, version_no: version, file_name: file.name, storage_path: path, size_bytes: file.size,
      mime_type: file.type || 'application/octet-stream', sha256: nul(r.sha), comment: nul(meta.comment), uploaded_by: meId }), 'Document version');
    return docId;
  }
  async function signedUrl(docId, version) { return fnCall('signed-url', { document_id: docId, version_no: version ? +version : null }); }

  ACT.download = el => act(async () => {
    const r = await signedUrl(el.dataset.id, el.dataset.v);
    const a = document.createElement('a'); a.href = r.url; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
    return r;
  }, r => r && r.downloads_left_today != null && r.downloads_left_today <= 5 ? r.downloads_left_today + ' downloads left today.' : '');
  ACT.preview = el => act(async () => {
    const d = Store.state.documents.find(x => x.id === el.dataset.id), v = d.versions[d.versions.length - 1];
    const r = await signedUrl(d.id);
    setTimeout(() => modal(d.title, /pdf$/i.test(v.name) ? `<iframe class="pv" src="${esc(r.url)}" title="${esc(d.title)}"></iframe>` : `<img class="pv" src="${esc(r.url)}" alt="${esc(d.title)}">`, true), 50);
  });
  FORM.upload = async fd => {
    const u = me(), S = Store.state, f = fd.get('file');
    if (!f || !f.size) return toast('Choose a file.', 'err');
    const docId = fd.get('doc');
    let meta;
    if (docId) meta = { docId, comment: fd.get('comment') };
    else {
      const ent = fd.get('entity'), eid = fd.get('eid') || null;
      let ws = fd.get('ws'), vis = !!fd.get('vis');
      if (ent === 'activity') { const a = actOf(eid); ws = a.ws; vis = a.visibleToDevs; }
      if (ent === 'meeting') { const m = S.meetings.find(x => x.id === eid); ws = m.ws; vis = !!m.visibleToDevs; }
      if (ent === 'ticket') { const t = S.tickets.find(x => x.id === eid); ws = t.ws; vis = false; }
      if (ent === 'bank') { if (!can.bankUpload(u)) return toast('Only BDIH and BOCRA add documents to the document bank.', 'err'); ws = 'S'; vis = true; }
      meta = { entityType: ent, entityId: eid, ws, visibleToDevs: vis, title: String(fd.get('title') || '').trim(), category: fd.get('category'), comment: fd.get('comment') };
    }
    return act(async () => {
      const id = await upload(f, meta);
      if (meta.entityType === 'meeting') must(await SB.from('meetings').update({ minutes_document_id: id }).eq('id', meta.entityId), 'Minutes');
    }, 'Uploaded ' + f.name + '.');
  };
  ACT.deleteDoc = el => { if (confirm('Delete this document? An administrator can restore it for 90 days.')) act(() => rpc('delete_document', { p_document: el.dataset.id }), 'Document deleted.'); };
  ACT.restoreDoc = el => act(() => rpc('restore_document', { p_document: el.dataset.id }), 'Document restored.');

  /* ---------- Progress, comments, submissions, reviews ---------- */
  FORM.progress = fd => {
    const a = actOf(fd.get('id'));
    let pct = Math.round(clamp(fd.get('pct'))), st = fd.get('status');
    if (st === 'Complete') pct = 100;
    return act(() => rpc('update_progress', { p_activity: a.id, p_pct: pct, p_status: st, p_actual_start: nul(fd.get('actualStart')), p_actual_finish: nul(fd.get('actualFinish')), p_note: nul(String(fd.get('note') || '').trim()) }), 'Progress saved.');
  };
  const _planCell = CHG.planCell;
  CHG.planCell = el => {
    if (el.dataset.k !== 'pct') return _planCell(el);
    const a = actOf(el.dataset.id), pct = Math.round(clamp(el.value));
    act(() => rpc('update_progress', { p_activity: a.id, p_pct: pct, p_status: a.status === 'Not started' && pct > 0 ? 'In progress' : a.status, p_actual_start: a.actualStart || (pct > 0 ? D.today() : null), p_actual_finish: a.actualFinish, p_note: null }), 'Saved.');
  };
  FORM.comment = fd => act(() => rpc('add_comment', { p_activity: fd.get('id'), p_body: String(fd.get('body') || '').trim() }), 'Comment posted.');
  FORM.submit = fd => {
    const a = actOf(fd.get('id')), cover = String(fd.get('cover') || '').trim(), files = fd.getAll('file').filter(f => f && f.size);
    if (!cover || !files.length) return toast('Add a cover note and at least one file.', 'err');
    return act(async () => {
      const ids = [];
      for (const f of files) ids.push(await upload(f, { entityType: 'activity', entityId: a.id, ws: a.ws, visibleToDevs: a.visibleToDevs, category: a.docCat || 'Other', comment: 'Submission' }));
      return rpc('submit_deliverable', { p_activity: a.id, p_cover_note: cover, p_document_ids: ids });
    }, 'Submitted for review.');
  };
  FORM.review = fd => {
    const { r, s, a } = reviewCtx(fd.get('id'));
    const files = fd.getAll('file').filter(f => f && f.size);
    return act(async () => {
      for (const f of files) await upload(f, { entityType: 'activity', entityId: a.id, ws: a.ws, visibleToDevs: a.visibleToDevs, category: 'Other', comment: 'BDIH mark-up v' + s.version });
      return rpc('bdih_recommend', { p_review: r.id, p_outcome: fd.get('outcome'), p_findings: nul(String(fd.get('findings') || '').trim()), p_checklist: Store.state.lookups.checklist.map((c, k) => !!fd.get('c' + k)) });
    }, 'Recommendation recorded.');
  };
  FORM.decide = fd => act(() => rpc('bocra_decide', { p_review: fd.get('id'), p_outcome: fd.get('outcome'), p_findings: nul(String(fd.get('findings') || '').trim()) }), 'Decision recorded.');

  /* ---------- Weekly reports, invoices, plan actions ---------- */
  FORM.weekly = fd => {
    const ws = fd.get('ws'), we = fd.get('we');
    const fields = Object.fromEntries([['work_completed', 'completed'], ['work_planned', 'planned'], ['issues', 'issues'], ['risks', 'risks'], ['change_requests', 'crs'], ['support_needed', 'support']].map(([c, k]) => [c, String(fd.get(k) || '').trim()]));
    const progress = [...fd.entries()].filter(([k]) => k.startsWith('p_')).map(([k, v]) => ({ activity_id: k.slice(2), pct_done: Math.round(clamp(v)) }));
    const files = fd.getAll('file').filter(f => f && f.size);
    return act(async () => {
      const id = await rpc('file_weekly_report', { p_workstream: wsId(ws), p_week_ending: we, p_fields: fields, p_progress: progress });
      for (const f of files) await upload(f, { entityType: 'weekly_report', entityId: id, ws, category: 'Report', comment: 'Weekly report ' + we });
    }, 'Weekly report filed.');
  };
  FORM.invoice = async fd => {
    const u = me(), ws = invoiceWs(u), f = fd.get('file');
    const amount = Math.round(+fd.get('amount') * 100) / 100;
    const vat = fd.get('vat') === '' ? Math.round(amount * vatRate() * 100) / 100 : Math.round(+fd.get('vat') * 100) / 100;
    if (!f || !f.size) return toast('Attach the invoice file.', 'err');
    return act(async () => {
      const docId = await upload(f, { entityType: 'invoice', entityId: null, ws, category: 'Invoice', title: 'Invoice ' + String(fd.get('no')).trim(), comment: 'Invoice' });
      return rpc('submit_invoice', { p_invoice_no: String(fd.get('no')).trim(), p_description: String(fd.get('description')).trim(), p_invoice_date: fd.get('date'),
        p_amount: amount, p_vat: vat, p_deliverable: nul(fd.get('deliverable')), p_document_ids: [docId] });
    }, 'Invoice submitted to the BOCRA Project Lead.');
  };
  FORM.invoiceStatus = fd => act(() => rpc('set_invoice_status', { p_invoice: fd.get('id'), p_status: fd.get('status'), p_comment: nul(String(fd.get('comment') || '').trim()),
    p_payment_reference: nul(String(fd.get('paymentRef') || '').trim()), p_paid_on: nul(fd.get('paidOn')) }), 'Invoice updated.');
  FORM.invoiceResubmit = fd => {
    const i = Store.state.invoices.find(x => x.id === fd.get('id')), f = fd.get('file');
    return act(async () => {
      if (f && f.size) await upload(f, { entityType: 'invoice', entityId: i.id, ws: i.ws, category: 'Invoice', title: 'Invoice ' + i.no, comment: 'Corrected invoice' });
      return rpc('resubmit_invoice', { p_invoice: i.id, p_description: String(fd.get('description')).trim(), p_amount: +fd.get('amount'), p_vat: +fd.get('vat'), p_comment: String(fd.get('comment')).trim() });
    }, 'Invoice resubmitted.');
  };
  ACT.adminInvoice = el => {
    const i = Store.state.invoices.find(x => x.id === el.dataset.id);
    if (el.dataset.op === 'reopen') return toast('Paid and rejected invoices are closed in the live system; raise a new invoice instead.', 'err');
    const why = prompt('Reason for voiding invoice ' + i.no + ':');
    if (why && why.trim()) act(() => rpc('set_invoice_status', { p_invoice: i.id, p_status: 'Rejected', p_comment: 'Voided by administrator: ' + why.trim() }), 'Invoice voided.');
  };
  FORM.baseline = fd => act(() => rpc('save_baseline', { p_name: fd.get('name'), p_change_request: nul(fd.get('cr')) }), 'Baseline saved.');
  ACT.lockPeriod = () => { if (confirm('Lock progress through ' + D.nice(Sess.period.end) + '?')) act(() => rpc('lock_progress', { p_through: Sess.period.end }), 'Progress locked.'); };
  FORM.addDeliverable = fd => act(() => rpc('add_deliverable', { p_name: String(fd.get('name')).trim(), p_ref: String(fd.get('ref')).trim(), p_workstream: wsId(fd.get('ws')),
    p_phase: fd.get('phase'), p_duration: +fd.get('duration') || 1, p_lead: nul(fd.get('lead')), p_predecessor: nul(fd.get('pred')), p_bdih_review: !!fd.get('bdih'), p_doc_category: fd.get('docCat') }),
    'Deliverable added with its review steps.');
  FORM.publish = fd => {
    const html = reportHTML('combined', Sess.period.start, Sess.period.end, Ctx.com || defaultCommentary());
    return act(async () => must(await SB.from('progress_reports').insert({ scope: 'combined', period_start: Sess.period.start, period_end: Sess.period.end,
      official_month: String(fd.get('month')).trim(), generated_by: Sess.userId, commentary: Object.assign({ html }, Ctx.com || {}) }), 'Report'), 'Official report saved.');
  };
  // Reports and exports count towards the daily download limit, checked by the server first
  [['reportPdf', 'report.generate'], ['reportWord', 'report.generate'], ['archivedReport', 'report.download'], ['archivedWord', 'report.download'],
    ['exportSchedule', 'export.schedule'], ['exportMsp', 'export.msproject'], ['exportCustom', 'export.custom'], ['exportUsers', 'export.users'], ['exportAudit', 'export.audit']].forEach(([k, action]) => {
    const f = ACT[k];
    ACT[k] = (el, e) => {
      SB.rpc('record_download', { p_action: action, p_entity_type: 'report', p_entity_id: (el && el.dataset && el.dataset.id) || null, p_details: { format: (el && el.dataset && (el.dataset.f || el.dataset.scope)) || null } })
        .then(res => { if (res.error) toast(res.error.message, 'err'); else f(el, e); });
    };
  });

  /* ---------- Users and roles (administrators) ---------- */
  FORM.user = fd => {
    const S = Store.state, id = fd.get('id');
    const v = { full_name: String(fd.get('fullName')).trim(), username: String(fd.get('username')).trim().toLowerCase(), org: fd.get('org'), role: fd.get('role'),
      job_title: String(fd.get('title') || '').trim(), phone: String(fd.get('phone') || '').trim(), email: String(fd.get('email') || '').trim(), delegated: !!fd.get('delegated') };
    const extra = fd.getAll('extra').filter(r => r !== v.role);
    const bad = [v.role].concat(extra).find(r => !ROLE_ORGS[r].includes(v.org));
    if (bad) return toast(roleName(bad) + ' does not belong to ' + orgName(v.org) + '.', 'err');
    if (!/^[a-z0-9._]{3,30}$/.test(v.username)) return toast('Usernames are 3 to 30 letters, digits, dots or underscores.', 'err');
    if (id) {
      return act(async () => {
        must(await SB.from('profiles').update({ full_name: v.full_name, username: v.username, organisation_id: orgId(v.org), role: v.role, job_title: nul(v.job_title),
          phone: nul(v.phone), email: nul(v.email), delegated: v.delegated }).eq('id', id), 'User');
        await rpc('admin_set_roles', { p_user: id, p_roles: extra });
      }, 'User saved.');
    }
    return act(async () => {
      const r = await fnCall('admin-users', { action: 'create', username: v.username, full_name: v.full_name, organisation_id: orgId(v.org), role: v.role,
        job_title: nul(v.job_title), phone: nul(v.phone), email: nul(v.email), delegated: v.delegated });
      if (extra.length) await rpc('admin_set_roles', { p_user: r.user_id, p_roles: extra });
      setTimeout(() => showTemp({ fullName: v.full_name, username: v.username }, r.temporary_password), 300);
      return r;
    }, 'User created.');
  };
  ACT.resetPw = el => {
    const x = userOf(el.dataset.id);
    if (!confirm('Reset the password for ' + x.fullName + '?')) return;
    act(async () => { const r = await fnCall('admin-users', { action: 'reset_password', user_id: x.id }); setTimeout(() => showTemp(x, r.temporary_password), 300); return r; }, 'Password reset.');
  };
  ACT.toggleUser = el => { const x = userOf(el.dataset.id); if (confirm((x.active ? 'Deactivate ' : 'Reactivate ') + x.fullName + '?')) act(() => rpc('admin_set_active', { p_user: x.id, p_active: !x.active }), x.active ? 'User deactivated.' : 'User reactivated.'); };
  ACT.unlockUser = el => act(() => rpc('admin_unlock_user', { p_user: el.dataset.id }), 'Account unlocked.');
  ACT.toggleLead = el => {
    const x = userOf(el.dataset.id), isLead = hasRole(x, 'DEV_LEAD');
    act(async () => {
      if (isLead && x.role === 'DEV_LEAD') must(await SB.from('profiles').update({ role: 'DEV_MEMBER' }).eq('id', x.id), 'Role');
      const extra = (x.extraRoles || []).filter(r => r !== 'DEV_LEAD').concat(isLead ? [] : ['DEV_LEAD']);
      await rpc('admin_set_roles', { p_user: x.id, p_roles: extra.filter(r => r !== (isLead && x.role === 'DEV_LEAD' ? 'DEV_MEMBER' : x.role)) });
    }, isLead ? 'Lead role removed.' : 'Now a Developer Lead.');
  };
  ACT.approveRequest = el => {
    const r = Store.state.requests.find(x => x.id === el.dataset.id);
    act(async () => {
      const res = await fnCall('admin-users', { action: 'create', username: r.username, full_name: r.fullName, organisation_id: orgId(r.org), role: 'DEV_MEMBER', job_title: nul(r.title), email: nul(r.email) });
      must(await SB.from('account_requests').update({ status: 'Approved', decided_by: Sess.userId, decided_at: new Date().toISOString() }).eq('id', r.id), 'Request');
      setTimeout(() => showTemp({ fullName: r.fullName, username: r.username }, res.temporary_password), 300);
    }, 'Account created.');
  };
  ACT.viewAs = () => toast('Viewing as another user is only available in the demo. Use Access review to check a person\'s permissions.', 'err');
  ACT.resetData = () => toast('This is the live system; there is no demo data to reset.', 'err');
  FORM.prefs = fd => act(() => rpc('update_my_preferences', { p_prefs: Object.fromEntries(NOTE_CATS.map(c => [c, fd.get(c)])) }), 'Preferences saved.');

  /* ---------- Sign-in, password, session ---------- */
  FORM.login = async fd => {
    if (typeof tsCfg === 'function' && tsCfg().on && !tsState.token && !(tsState.failed && devHost())) return toast('Please complete the security check first.', 'err');
    const token = tsState && tsState.token;
    if (window.turnstile && tsState && tsState.widget != null) { try { window.turnstile.reset(tsState.widget); } catch (e) { /* gone */ } }
    busy(true);
    try {
      const r = await fnCall('login', { username: String(fd.get('username') || '').trim(), password: String(fd.get('password') || ''), turnstile_token: token || null });
      must(await SB.auth.setSession(r.session), 'Session');
      await signedIn();
    } catch (e) {
      Ctx.loginMsg = e.message; render();
    } finally { busy(false); }
  };
  FORM.changePw = async fd => {
    const p1 = String(fd.get('pw1')), p2 = String(fd.get('pw2')), u = realMe();
    if (p1 !== p2) return toast('The new passwords do not match.', 'err');
    const prob = passwordProblem(p1, u.username);
    if (prob) return toast(prob, 'err');
    busy(true);
    try {
      must(await SB.auth.updateUser({ password: p1 }), 'Password');
      await rpc('password_changed');
      await reload('Password changed.');
    } catch (e) { toast(e.message, 'err'); } finally { busy(false); }
  };
  FORM.forgotPw = async fd => {
    await SB.rpc('request_password_reset', { p_username: String(fd.get('username') || '').trim() });
    closeModal();
    toast('If that username exists, the administrators have been asked to reset the password.');
  };
  const _logout = logout;
  logout = function (msg) { SB.auth.signOut().catch(() => {}); Store.state = skeleton(); runSchedule(Store.state); _logout(msg); };

  async function signedIn() {
    const uidNow = await loadAll();
    Sess = Object.assign({ period: defaultPeriod() }, Sess.period ? { period: Sess.period } : {}, { userId: uidNow, loginAt: Date.now(), lastActive: Date.now() });
    saveSess();
    location.hash = isOversight(me()) ? '#/dashboard' : '#/devdash';
    render();
  }

  /* ---------- Start ---------- */
  Store.state = skeleton();
  runSchedule(Store.state);
  Sess = {}; saveSess();
  render();
  SB.rpc('public_config').then(res => {
    const c = res.data && res.data[0];
    if (c) { Object.assign(Store.state.settings, { appName: c.app_name, appSubtitle: c.app_subtitle, turnstileSiteKey: c.turnstile_site_key, turnstileEnabled: c.turnstile_enabled }); if (!Sess.userId) render(); }
  });
  SB.auth.getSession().then(async ({ data }) => {
    if (!data.session) return;
    busy(true);
    try { await signedIn(); } catch (e) { await SB.auth.signOut(); render(); } finally { busy(false); }
  });
  // Pick up changes made by other people every two minutes while the tab is visible
  setInterval(() => { if (Sess.userId && document.visibilityState === 'visible' && !document.querySelector('.modal-bg')) queue = queue.then(() => reload()); }, 120000);
})();
