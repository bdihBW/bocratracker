'use strict';
/* Seed data: the BDIH project plan (stands in for the one-off Excel import, FR-SCH-14),
   demo users for each role, and a realistic position as at the end of October 2026. */

const DEMO_PASSWORD = 'Demo!Pass2026';

function seedState() {
  const S = {
    settings: {
      projectStart: '2026-10-12', contractMonths: 3, bdihReviewDays: 3, bocraReviewDays: 5,
      weeklyReportDay: 5, thrOnTrack: 0.95, thrAtRisk: 0.85,
      festiveStart: '2026-12-21', festiveEnd: '2027-01-01', currentBaselineId: null, lockedThrough: null, dailyDownloadLimit: 30
    },
    holidays: [
      { date: '2026-12-25', reason: 'Christmas Day' }, { date: '2026-12-26', reason: 'Boxing Day' },
      { date: '2027-01-01', reason: "New Year's Day" }, { date: '2027-01-02', reason: 'New Year Holiday' },
      { date: '2027-03-26', reason: 'Good Friday' }, { date: '2027-03-29', reason: 'Easter Monday' }
    ],
    orgs: [
      { id: 'BDIH', name: 'Botswana Digital and Innovation Hub', type: 'Project Manager', active: true },
      { id: 'BOCRA', name: 'Botswana Communications Regulatory Authority', type: 'Client', active: true },
      { id: 'DEVA', name: 'Developer A', type: 'Developer', active: true },
      { id: 'DEVB', name: 'Developer B', type: 'Developer', active: true }
    ],
    workstreams: [
      { id: 'A', name: 'BOCRA website', owner: 'DEVA', website: 'www.bocra.org.bw' },
      { id: 'B', name: 'UASF website', owner: 'DEVB', website: 'www.uasf.org.bw' },
      { id: 'S', name: 'Shared', owner: 'BDIH', website: '' }
    ],
    users: [], resources: [], activities: [], links: [], baselines: [], history: [], submissions: [],
    reviews: [], documents: [], weekly: [], reports: [], deliverables: [], risks: [], issues: [],
    decisions: [], changes: [], meetings: [], actions: [], comments: [], notifications: [], audit: [],
    requests: [], flags: {}, rolePerms: null, reportDefs: [], tickets: [],
    lookups: {
      docCategories: ['PID', 'Requirements', 'Design', 'Test evidence', 'Minutes', 'Report', 'Contract', 'Content', 'Handover', 'Invoice', 'Other'],
      checklist: ['Meets BOCRA requirements in the ToR', 'Complete, consistent and version controlled',
        'Accessibility considered (WCAG 2.1 AA)', 'Security and data protection considered', 'Supporting evidence attached'],
      bankCategories: ['Template', 'Form', 'Guideline', 'Policy', 'Reference'],
      forums: ['Steering Committee', 'Project Working Group', 'Developer Progress Meeting', 'Kick-off']
    }
  };

  const pw = hashPw(DEMO_PASSWORD);
  const U = (id, username, fullName, org, role, title, extra) => S.users.push(Object.assign({
    id, username, fullName, org, role, title, phone: '', email: username.replace('.', '_') + '@example.bw',
    active: true, pw, mustChange: false, fails: [], lockedUntil: 0, lastLogin: null, delegated: false,
    prefs: {}
  }, extra || {}));
  U('u1', 'kletsweletse', 'Kgakgamatso Letsweletse', 'BDIH', 'ADMIN', 'System Administrator, BDIH AI', { email: '' });
  U('u2', 'kbasalumi', 'Kgotlayarona Basalumi', 'BDIH', 'BDIH_LEAD', 'Project Leader', { email: '' });
  U('u3', 'mjerimiah', 'Maipelo Jerimiah', 'BDIH', 'BDIH_PO', 'Project Officer', { email: '' });
  U('u4', 'bdih.analyst', 'Boitumelo Kgari', 'BDIH', 'BDIH_BA', 'Business Analyst');
  U('u5', 'dndubo', 'Duke Ndubo', 'BDIH', 'BDIH_TEAM', 'Developer', { email: '' });
  U('u12', 'bdih.director', 'BDIH Director (demo)', 'BDIH', 'BDIH_DIRECTOR', 'Director');
  U('u6', 'smalefho', 'Seepelo Malefho', 'BOCRA', 'BOCRA_REP', 'BOCRA Project Lead');
  U('u7', 'bocra.it', 'Kabelo Ramotswa', 'BOCRA', 'BOCRA_TEAM', 'IT Officer');
  U('u8', 'deva.lead', 'Onalenna Tau', 'DEVA', 'DEV_LEAD', 'Developer A Lead');
  U('u9', 'deva.dev', 'Katlego Moremi', 'DEVA', 'DEV_MEMBER', 'Frontend Developer');
  U('u10', 'devb.lead', 'Refilwe Mosweu', 'DEVB', 'DEV_LEAD', 'Developer B Lead');
  U('u11', 'devb.dev', 'Gaone Mokgosi', 'DEVB', 'DEV_MEMBER', 'Backend Developer', { delegated: true });

  const R = (id, name, org, user, desc) => S.resources.push({ id, name, org, linkedUser: user, description: desc || '' });
  R('R1', 'BDIH Project Leader', 'BDIH', 'u2'); R('R2', 'BDIH Project Officer', 'BDIH', 'u3');
  R('R3', 'BDIH Business Analyst', 'BDIH', 'u4'); R('R4', 'BDIH Developer', 'BDIH', 'u5');
  R('R5', 'BOCRA Project Lead', 'BOCRA', 'u6'); R('R6', 'BOCRA IT and Communications', 'BOCRA', 'u7');
  R('R7', 'Developer A', 'DEVA', 'u8'); R('R8', 'Developer B', 'DEVB', 'u10');

  /* ---- Plan ---- */
  let n = 0;
  const K = {};
  const A = (key, o) => {
    const a = Object.assign({
      id: 'a' + (++n), key, ws: 'S', phase: 'Phase 1', type: 'Task', name: '', duration: 1, pct: 0,
      status: 'Not started', lead: null, support: null, fixedStart: null, actualStart: null, actualFinish: null,
      notes: '', visibleToDevs: false, deliverableRef: '', reviewStage: null, submittable: false, indent: 0, docCat: 'Other'
    }, o);
    S.activities.push(a);
    if (key) K[key] = a;
    return a;
  };
  const L = (f, t, lag) => S.links.push({ id: 'l' + (S.links.length + 1), from: f.id, to: t.id, type: 'FS', lag: lag || 0 });
  // A deliverable with its review chain (BDIH review then BOCRA review, or BOCRA only)
  const sub = (key, ws, o, preds, bdih) => {
    const t = A(key, Object.assign({ ws, submittable: true }, o));
    let last = t;
    if (bdih) {
      const r = A(key + '-BR', { ws, phase: o.phase || 'Phase 1', type: 'Review', name: 'BDIH review: ' + o.name, reviewStage: 'BDIH', lead: 'R4', support: 'R3', indent: 1, forId: t.id });
      L(t, r); last = r; t.bdihReviewId = r.id;
    }
    const c = A(key + '-OR', { ws, phase: o.phase || 'Phase 1', type: 'Review', name: 'BOCRA review: ' + o.name, reviewStage: 'BOCRA', lead: 'R5', indent: 1, forId: t.id });
    L(last, c); t.bocraReviewId = c.id;
    preds.forEach(p => L(p, t));
    return t;
  };

  const ko = A('KO', { name: 'Project kick-off meeting', type: 'Meeting', lead: 'R1', support: 'R5', fixedStart: '2026-10-12', visibleToDevs: true });
  const guide = A('GUIDE', { name: 'Shared guidance and templates issued to developers', duration: 2, lead: 'R2', visibleToDevs: true });
  L(ko, guide);
  sub('D1', 'S', { name: 'D1 Project Management Plan', duration: 5, lead: 'R1', support: 'R2', deliverableRef: 'D1', docCat: 'Report' }, [ko], false);
  const content = A('CONTENT', { name: 'BOCRA content and branding supplied to developers', duration: 15, lead: 'R6', support: 'R5' });
  L(ko, content);
  A('MR-OCT', { name: 'D3 Monthly progress report: October', type: 'Report', duration: 2, lead: 'R1', support: 'R2', fixedStart: '2026-10-29', deliverableRef: 'D3' });
  A('SC1', { name: 'Steering Committee meeting 1', type: 'Meeting', lead: 'R1', support: 'R5', fixedStart: '2026-11-13' });

  const dev = (ws, R_, tag) => {
    const opt = (o) => Object.assign({ lead: R_, deliverableRef: 'DEV-' + ws }, o);
    A(ws + '-DPM', { ws, name: 'Developer progress meetings (weekly)', type: 'Meeting', duration: 60, lead: 'R2', support: R_, fixedStart: '2026-10-16' });
    sub(ws + '-PID', ws, opt({ name: 'Project Initiation Document (PID)', duration: 4, docCat: 'PID' }), [ko], true);
    sub(ws + '-REQ', ws, opt({ name: 'User requirements specification', duration: 5, docCat: 'Requirements' }), [K[ws + '-PID-BR']], true);
    const m1 = A(ws + '-M1', { ws, type: 'Milestone', name: 'Phase 1 complete', lead: R_ });
    L(K[ws + '-PID-OR'], m1); L(K[ws + '-REQ-OR'], m1);
    sub(ws + '-DES', ws, opt({ phase: 'Phase 2', name: 'Website design (UI and UX)', duration: 7, docCat: 'Design' }), [K[ws + '-REQ-BR']], true);
    sub(ws + '-FE', ws, opt({ phase: 'Phase 2', name: 'Frontend build', duration: 12, docCat: 'Design' }), [K[ws + '-DES-BR'], content], true);
    sub(ws + '-BE', ws, opt({ phase: 'Phase 2', name: 'Backend and CMS build', duration: 12, docCat: 'Design' }), [K[ws + '-DES-BR']], true);
    const m2 = A(ws + '-M2', { ws, phase: 'Phase 2', type: 'Milestone', name: 'Phase 2 complete', lead: R_ });
    [ws + '-DES-OR', ws + '-FE-OR', ws + '-BE-OR'].forEach(k => L(K[k], m2));
    sub(ws + '-UAT', ws, opt({ phase: 'Phase 3', name: 'UAT support and test evidence', duration: 5, docCat: 'Test evidence' }), [m2], true);
    sub(ws + '-HO', ws, opt({ phase: 'Phase 3', name: 'Handover pack', duration: 3, docCat: 'Handover' }), [K[ws + '-UAT-BR']], true);
    sub(ws + '-DEP', ws, opt({ phase: 'Phase 3', name: 'Production deployment', duration: 2, docCat: 'Handover' }), [K[ws + '-HO-BR']], true);
    const comm = A(ws + '-COMM', { ws, phase: 'Phase 3', type: 'Milestone', name: 'Website commissioned', lead: R_ });
    [ws + '-UAT-OR', ws + '-HO-OR', ws + '-DEP-OR'].forEach(k => L(K[k], comm));
  };
  dev('A', 'R7');
  dev('B', 'R8');

  sub('D2', 'S', { name: 'D2 Review of PIDs, plans and user requirements', duration: 3, lead: 'R3', support: 'R1', deliverableRef: 'D2', docCat: 'Report' }, [K['A-REQ-BR'], K['B-REQ-BR']], false);
  A('MR-NOV', { name: 'D3 Monthly progress report: November', type: 'Report', duration: 2, lead: 'R1', support: 'R2', fixedStart: '2026-11-26', deliverableRef: 'D3', phase: 'Phase 2' });
  A('SC2', { name: 'Steering Committee meeting 2', type: 'Meeting', lead: 'R1', support: 'R5', fixedStart: '2026-12-11', phase: 'Phase 2' });
  A('MR-DEC', { name: 'D3 Monthly progress report: December', type: 'Report', duration: 2, lead: 'R1', support: 'R2', fixedStart: '2026-12-17', deliverableRef: 'D3', phase: 'Phase 2' });
  const uatPlan = A('UATPLAN', { name: 'UAT plan and test scripts', duration: 5, lead: 'R3', support: 'R6', phase: 'Phase 2', visibleToDevs: true });
  L(K['D2-OR'], uatPlan);
  L(uatPlan, K['A-UAT']); L(uatPlan, K['B-UAT']);
  sub('D4', 'S', { phase: 'Phase 2', name: 'D4 Milestone readiness recommendations', duration: 2, lead: 'R1', support: 'R4', deliverableRef: 'D4', docCat: 'Report' }, [K['A-M2'], K['B-M2']], false);
  A('SC3', { name: 'Steering Committee meeting 3', type: 'Meeting', lead: 'R1', support: 'R5', fixedStart: '2027-01-22', phase: 'Phase 3' });
  A('MR-JAN', { name: 'D3 Monthly progress report: January', type: 'Report', duration: 2, lead: 'R1', support: 'R2', fixedStart: '2027-01-28', deliverableRef: 'D3', phase: 'Phase 3' });
  sub('D5', 'S', { phase: 'Phase 3', name: 'D5 UAT coordination and defect report', duration: 3, lead: 'R3', deliverableRef: 'D5', docCat: 'Test evidence' }, [K['A-UAT-OR'], K['B-UAT-OR']], false);
  sub('D6', 'S', { phase: 'Phase 3', name: 'D6 Handover verification report', duration: 3, lead: 'R4', deliverableRef: 'D6', docCat: 'Handover' }, [K['A-HO-OR'], K['B-HO-OR']], false);
  sub('D7', 'S', { phase: 'Phase 3', name: 'D7 Closure report and lessons learned', duration: 5, lead: 'R1', deliverableRef: 'D7', docCat: 'Report' }, [K['A-COMM'], K['B-COMM']], false);
  const close = A('CLOSE', { phase: 'Phase 3', type: 'Milestone', name: 'Project closed', lead: 'R1' });
  L(K['D7-OR'], close);

  // Baseline the plan before any progress is recorded
  runSchedule(S);
  const items = {};
  S.activities.forEach(a => { items[a.id] = { start: a.start, finish: a.finish }; });
  S.baselines.push({ id: 'b1', name: 'Original baseline (approved with D1)', savedAt: '2026-10-23T10:00:00Z', savedBy: 'u2', crId: null, items });
  S.settings.currentBaselineId = 'b1';

  /* ---- Progress as at 30 October 2026 ---- */
  const set = (k, o) => Object.assign(K[k], o);
  const done = (k, s, f) => set(k, { actualStart: s, actualFinish: f, pct: 100, status: 'Complete' });
  done('KO', '2026-10-12', '2026-10-12');
  done('GUIDE', '2026-10-13', '2026-10-14');
  done('D1', '2026-10-13', '2026-10-19');
  done('D1-OR', '2026-10-19', '2026-10-23');
  set('CONTENT', { actualStart: '2026-10-13', pct: 40, status: 'In progress' });
  done('MR-OCT', '2026-10-29', '2026-10-30');
  set('A-DPM', { actualStart: '2026-10-16', pct: 20, status: 'In progress' });
  set('B-DPM', { actualStart: '2026-10-16', pct: 20, status: 'In progress' });
  done('A-PID', '2026-10-13', '2026-10-16');
  done('A-PID-BR', '2026-10-16', '2026-10-20');
  done('A-PID-OR', '2026-10-20', '2026-10-27');
  set('A-REQ', { actualStart: '2026-10-21', actualFinish: '2026-10-29', pct: 100, status: 'Under BDIH review' });
  set('A-REQ-BR', { actualStart: '2026-10-29', pct: 30, status: 'In progress' });
  set('B-PID', { actualStart: '2026-10-13', actualFinish: '2026-10-22', pct: 100, status: 'Under BOCRA review' });
  done('B-PID-BR', '2026-10-16', '2026-10-26');
  set('B-PID-OR', { actualStart: '2026-10-26', pct: 40, status: 'In progress' });
  set('B-REQ', { actualStart: '2026-10-27', pct: 30, status: 'In progress' });

  /* ---- Submissions and reviews ---- */
  const T = (d, h) => d + 'T' + (h || '08') + ':00:00Z';
  S.submissions.push(
    { id: 's1', activityId: K.D1.id, ws: 'S', version: 1, by: 'u2', at: T('2026-10-19'), coverNote: 'Project Management Plan for BOCRA approval.', state: 'Approved', docIds: ['d1'] },
    { id: 's2', activityId: K['A-PID'].id, ws: 'A', version: 1, by: 'u8', at: T('2026-10-16'), coverNote: 'PID for the BOCRA website.', state: 'Approved', docIds: ['d2'] },
    { id: 's3', activityId: K['A-REQ'].id, ws: 'A', version: 1, by: 'u8', at: T('2026-10-29', '12'), coverNote: 'User requirements specification, version 1.', state: 'Under BDIH review', docIds: ['d3'] },
    { id: 's4', activityId: K['B-PID'].id, ws: 'B', version: 1, by: 'u10', at: T('2026-10-16', '13'), coverNote: 'PID for the UASF website.', state: 'Returned', docIds: ['d4'] },
    { id: 's5', activityId: K['B-PID'].id, ws: 'B', version: 2, by: 'u10', at: T('2026-10-22', '09'), coverNote: 'Revised PID addressing BDIH findings on the grants module.', state: 'Under BOCRA review', docIds: ['d4'] }
  );
  const ok = [true, true, true, true, true];
  S.reviews.push(
    { id: 'r1', submissionId: 's1', stage: 'BOCRA', reviewer: 'u6', due: '2026-10-26', decidedAt: T('2026-10-23', '10'), outcome: 'Approved', findings: 'Approved as submitted.' },
    { id: 'r2', submissionId: 's2', stage: 'BDIH', reviewer: 'u5', due: '2026-10-21', decidedAt: T('2026-10-20', '11'), outcome: 'Ready', findings: 'Complete. Minor comments on the risk log, to be addressed in the requirements.', checklist: ok },
    { id: 'r3', submissionId: 's2', stage: 'BOCRA', reviewer: 'u6', due: '2026-10-27', decidedAt: T('2026-10-27', '09'), outcome: 'Approved', findings: 'Approved.' },
    { id: 'r4', submissionId: 's3', stage: 'BDIH', reviewer: 'u5', due: '2026-11-03', decidedAt: null, outcome: null, findings: '' },
    { id: 'r5', submissionId: 's4', stage: 'BDIH', reviewer: 'u5', due: '2026-10-21', decidedAt: T('2026-10-20', '14'), outcome: 'Not ready', findings: 'Scope does not cover the UASF grant applications module; risk log missing.', checklist: [false, true, true, true, false] },
    { id: 'r6', submissionId: 's5', stage: 'BDIH', reviewer: 'u5', due: '2026-10-27', decidedAt: T('2026-10-26', '10'), outcome: 'Ready', findings: 'Findings addressed.', checklist: ok },
    { id: 'r7', submissionId: 's5', stage: 'BOCRA', reviewer: 'u6', due: '2026-11-02', decidedAt: null, outcome: null, findings: '' }
  );

  /* ---- Documents (metadata only; seeded files download as a placeholder) ---- */
  const doc = (id, title, category, ws, entityType, entityId, versions, vis) => S.documents.push({
    id, title, category, ws, entityType, entityId, visibleToDevs: !!vis, deleted: null, deletedBy: null,
    versions: versions.map((v, i) => ({ no: i + 1, name: v[0], size: v[1], by: v[2], at: v[3], comment: v[4] || '', scan: 'Clean', sha: '', data: null }))
  });
  doc('d1', 'D1 Project Management Plan', 'Report', 'S', 'activity', K.D1.id, [['D1 Project Management Plan.pdf', 845000, 'u2', T('2026-10-19')]]);
  doc('d2', 'BOCRA website PID', 'PID', 'A', 'activity', K['A-PID'].id, [['BOCRA website PID.pdf', 612000, 'u8', T('2026-10-16')]]);
  doc('d3', 'BOCRA website user requirements', 'Requirements', 'A', 'activity', K['A-REQ'].id, [['BOCRA website user requirements.docx', 388000, 'u8', T('2026-10-29', '12')]]);
  doc('d4', 'UASF website PID', 'PID', 'B', 'activity', K['B-PID'].id, [['UASF website PID.pdf', 540000, 'u10', T('2026-10-16', '13')], ['UASF website PID.pdf', 598000, 'u10', T('2026-10-22', '09'), 'Grants module added']]);
  doc('d5', 'Kick-off meeting minutes', 'Minutes', 'S', 'meeting', 'm1', [['Kick-off minutes 12 Oct.pdf', 210000, 'u3', T('2026-10-13')]], true);
  doc('d6', 'Steering Committee pack 1 (draft)', 'Report', 'S', 'library', null, [['Steering Committee pack 1.pptx', 1430000, 'u2', T('2026-10-28')]]);
  doc('d7', 'BOCRA brand guidelines', 'Guideline', 'S', 'bank', null, [['BOCRA brand guidelines.pdf', 2900000, 'u7', T('2026-10-14')]], true);
  doc('d8', 'Monthly Progress Report October 2026', 'Report', 'S', 'activity', K['MR-OCT'].id, [['Monthly Progress Report October 2026.pdf', 455000, 'u2', T('2026-10-30', '14')]]);
  doc('d9', 'UASF wireframes (early draft)', 'Design', 'B', 'activity', K['B-REQ'].id, [['UASF wireframes draft.pdf', 1720000, 'u11', T('2026-10-29')]]);

  /* ---- Weekly reports: Developer B has missed the week ending 23 October ---- */
  const wk = (id, ws, we, by, completed, planned, reviewed) => S.weekly.push({
    id, ws, weekEnding: we, by, at: T(we, '14'), completed, planned, issues: '', risks: '', crs: '', support: '',
    pcts: [], reviewedBy: reviewed ? 'u3' : null, reviewedAt: reviewed ? T(D.add(we, 3)) : null, comment: reviewed ? 'Noted, thank you.' : ''
  });
  wk('w1', 'A', '2026-10-16', 'u8', 'Attended kick-off. Drafted and submitted the PID.', 'Start user requirements workshops with BOCRA.', true);
  wk('w2', 'A', '2026-10-23', 'u8', 'Requirements workshops held with BOCRA IT and Communications.', 'Complete and submit user requirements.', true);
  wk('w3', 'A', '2026-10-30', 'u8', 'Submitted user requirements for BDIH review.', 'Begin design concepts while BDIH reviews.', false);
  wk('w4', 'B', '2026-10-16', 'u10', 'Submitted PID.', 'Address any BDIH findings; start requirements.', true);

  /* ---- Registers ---- */
  S.risks.push(
    { id: 'rk1', ws: 'S', visibleToDevs: true, title: 'Festive closure compresses the build phase', description: 'Closure from 21 December to 1 January falls in the middle of the build.', likelihood: 4, impact: 4, owner: 'u2', mitigation: 'Front-load design approvals and agree an interim build review before 18 December.', due: '2026-12-11', status: 'Open', createdBy: 'u2' },
    { id: 'rk2', ws: 'S', title: 'BOCRA content not supplied on time', description: 'Frontend build depends on final content and branding.', likelihood: 3, impact: 5, owner: 'u6', mitigation: 'Weekly content check-in; developers to use placeholder content.', due: '2026-11-06', status: 'Open', createdBy: 'u2' },
    { id: 'rk3', ws: 'B', title: 'Developer B team capacity', description: 'One developer shared with another client.', likelihood: 3, impact: 3, owner: 'u10', mitigation: 'Revised resourcing plan to be provided.', due: '2026-11-04', status: 'Open', createdBy: 'u10' },
    { id: 'rk4', ws: 'A', title: 'Hosting environment not ready for deployment', description: 'Production hosting in Botswana not yet provisioned.', likelihood: 2, impact: 4, owner: 'u8', mitigation: 'Raise hosting request with BOCRA IT early.', due: '2026-12-04', status: 'Open', createdBy: 'u8' },
    { id: 'rk5', ws: 'S', title: 'Data residency for the tracking tool not confirmed', description: 'The hosting region may be outside Botswana.', likelihood: 3, impact: 4, owner: 'u6', mitigation: 'BOCRA to confirm; self-host if required.', due: '2026-10-28', status: 'Open', createdBy: 'u2' }
  );
  S.issues.push(
    { id: 'is1', ws: 'B', title: 'UASF PID returned: grants module scope missing', description: 'See BDIH review findings.', severity: 'Medium', owner: 'u10', raised: '2026-10-20', target: '2026-10-22', status: 'Resolved', resolution: 'Revised PID submitted on 22 October.', createdBy: 'u5' },
    { id: 'is2', ws: 'A', title: 'Staging server credentials not issued', description: 'Developer A cannot deploy test builds.', severity: 'High', owner: 'u7', raised: '2026-10-26', target: '2026-10-28', status: 'Open', resolution: '', createdBy: 'u8' },
    { id: 'is3', ws: 'S', title: 'Content delivery behind plan', description: 'Content task at 40% against about 85% planned.', severity: 'High', owner: 'u6', raised: '2026-10-28', target: '2026-11-06', status: 'Open', resolution: '', createdBy: 'u3' }
  );
  S.decisions.push(
    { id: 'dc1', ws: 'S', visibleToDevs: true, decision: 'Developers may begin the next activity once BDIH marks a submission Ready, while BOCRA review continues.', date: '2026-10-12', madeBy: 'BOCRA Representative', forum: 'Kick-off', related: 'Schedule', status: 'Made', createdBy: 'u2' },
    { id: 'dc2', ws: 'S', visibleToDevs: true, decision: 'Festive closure from 21 December 2026 to 1 January 2027 applies to all parties.', date: '2026-10-12', madeBy: 'Steering Committee', forum: 'Kick-off', related: 'Closure calendar', status: 'Made', createdBy: 'u2' },
    { id: 'dc3', ws: 'S', decision: 'Confirm data residency for the project tracking tool.', date: '2026-11-06', madeBy: 'BOCRA', forum: 'Steering Committee', related: 'Risk: data residency', status: 'Required', createdBy: 'u2' }
  );
  S.changes.push(
    { id: 'cr1', ws: 'B', title: 'Add online grant application form to UASF website', description: 'Applicants submit grant applications online with document upload.', requestedBy: 'u10', requested: '2026-10-27', impactScope: 'Medium', impactTime: '+5 business days to backend build', impactCost: 'To be confirmed', recommendation: '', decision: 'Pending', decisionText: '', planChanges: '', status: 'Under assessment', createdBy: 'u10' },
    { id: 'cr2', ws: 'A', title: 'Bilingual (Setswana) content on the BOCRA website', description: 'Key pages available in English and Setswana.', requestedBy: 'u6', requested: '2026-10-20', impactScope: 'Low', impactTime: 'None to build; content task extended', impactCost: 'None', recommendation: 'Recommend approval; absorb within frontend build.', decision: 'Approved', decisionText: 'Approved by BOCRA letter dated 26 October 2026.', planChanges: 'Content task extended; frontend build unchanged.', status: 'Approved', createdBy: 'u6' }
  );
  S.meetings.push(
    { id: 'm1', ws: 'S', visibleToDevs: true, forum: 'Kick-off', title: 'Project kick-off', date: '2026-10-12', attendees: ['u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8', 'u10'], agenda: 'Introductions; scope; governance; schedule; review periods.', decisions: 'Review periods confirmed: BDIH 3 business days, BOCRA 5 business days.', minutesDoc: 'd5' },
    { id: 'm2', ws: 'A', forum: 'Developer Progress Meeting', title: 'Developer A progress meeting', date: '2026-10-23', attendees: ['u3', 'u5', 'u8', 'u9'], agenda: 'PID outcome; requirements workshops; staging access.', decisions: '', minutesDoc: null },
    { id: 'm3', ws: 'B', forum: 'Developer Progress Meeting', title: 'Developer B progress meeting', date: '2026-10-23', attendees: ['u3', 'u5', 'u10', 'u11'], agenda: 'PID findings; resubmission; resourcing.', decisions: '', minutesDoc: null },
    { id: 'm4', ws: 'S', forum: 'Project Working Group', title: 'Project Working Group 1', date: '2026-10-28', attendees: ['u2', 'u3', 'u4', 'u6', 'u7'], agenda: 'Content readiness; data residency; UAT approach.', decisions: 'Data residency decision required from BOCRA by 6 November.', minutesDoc: null }
  );
  S.actions.push(
    { id: 'ac1', meetingId: 'm2', ws: 'A', text: 'Request staging server access from BOCRA IT', owner: 'u8', due: '2026-10-26', status: 'Done' },
    { id: 'ac2', meetingId: 'm3', ws: 'B', text: 'Resubmit PID with grants module scope', owner: 'u10', due: '2026-10-22', status: 'Done' },
    { id: 'ac3', meetingId: 'm3', ws: 'B', text: 'Provide revised resourcing plan', owner: 'u10', due: '2026-11-04', status: 'Open' },
    { id: 'ac4', meetingId: 'm4', ws: 'S', text: 'Confirm content delivery schedule', owner: 'u6', due: '2026-11-03', status: 'Open' },
    { id: 'ac5', meetingId: 'm4', ws: 'S', text: 'Draft UAT plan outline', owner: 'u4', due: '2026-11-06', status: 'Open' }
  );
  S.comments.push({ id: 'c1', entityType: 'activity', entityId: K['A-REQ'].id, ws: 'A', author: 'u5', body: 'Reviewing now; I will revert by Tuesday.', at: T('2026-10-30', '07') });

  S.deliverables = S.activities.filter(a => a.submittable).map((a, i) => ({
    id: 'dl' + (i + 1), ref: a.deliverableRef, name: a.ws === 'S' ? a.name : a.name + ' (' + (a.ws === 'A' ? 'BOCRA' : 'UASF') + ' website)',
    phase: a.phase, owner: a.ws === 'A' ? 'DEVA' : a.ws === 'B' ? 'DEVB' : 'BDIH', ws: a.ws, activityId: a.id
  }));
  S.deliverables.push({ id: 'dl-d3', ref: 'D3', name: 'D3 Monthly progress reports', phase: 'Phase 2', owner: 'BDIH', ws: 'S', activityId: K['MR-NOV'].id });

  /* ---- Document bank: templates and guidance for everyone ---- */
  doc('b1', 'Weekly developer report template', 'Template', 'S', 'bank', null, [['Weekly report template v1.docx', 52000, 'u3', T('2026-10-09')], ['Weekly report template.docx', 54000, 'u3', T('2026-10-20'), 'Added change request section']], true);
  doc('b2', 'Submission cover note template', 'Template', 'S', 'bank', null, [['Submission cover note.docx', 31000, 'u3', T('2026-10-09')]], true);
  doc('b3', 'UAT test script template', 'Template', 'S', 'bank', null, [['UAT test script template.xlsx', 46000, 'u4', T('2026-10-21')]], true);
  doc('b4', 'Change request form', 'Form', 'S', 'bank', null, [['Change request form.docx', 28000, 'u2', T('2026-10-12')]], true);
  doc('b5', 'BOCRA website content style guide', 'Guideline', 'S', 'bank', null, [['Content style guide.pdf', 820000, 'u7', T('2026-10-15')]], true);
  doc('b6', 'Data protection checklist for websites', 'Policy', 'S', 'bank', null, [['Data protection checklist.pdf', 210000, 'u6', T('2026-10-19')]], true);
  S.documents.filter(d => d.entityType === 'bank').forEach(d => d.versions.forEach(v => S.audit.push({ id: 'au-' + d.id + v.no, at: v.at, user: v.by, ip: 'seed', action: v.no > 1 ? 'document.version' : 'document.upload', entity: 'document', entityId: d.id, before: null, after: { name: v.name, version: v.no } })));
  S.audit.push({ id: 'au-b1d', at: T('2026-10-23', '09'), user: 'u8', ip: 'seed', action: 'document.download', entity: 'document', entityId: 'b1', before: null, after: { version: 2 } });
  S.audit.push({ id: 'au-b1e', at: T('2026-10-23', '11'), user: 'u10', ip: 'seed', action: 'document.download', entity: 'document', entityId: 'b1', before: null, after: { version: 2 } });

  /* ---- Developer tickets (Jira style); each developer sees only its own board ---- */
  const tk = (key, ws, type, title, priority, status, assignee, reporter, created, extra) => S.tickets.push(Object.assign({
    id: 't-' + key, key, ws, type, title, description: '', priority, status, assignee, reporter, activityId: null, labels: [], due: null,
    estimate: null, created: T(created), updated: T(created), comments: [], history: [[T(created), reporter, 'created', '', status]]
  }, extra || {}));
  tk('BOC-1', 'A', 'Story', 'As a licensee I can search the spectrum licence register', 'High', 'In progress', 'u9', 'u8', '2026-10-22', { activityId: K['A-DES'].id, estimate: 5, labels: ['search', 'register'], description: 'Search by licensee, licence type and expiry. Results exportable to CSV.' });
  tk('BOC-2', 'A', 'Task', 'Set up staging environment and CI pipeline', 'Highest', 'Blocked', 'u8', 'u8', '2026-10-23', { due: '2026-10-30', description: 'Blocked until BOCRA IT issues staging server credentials (issue raised).', comments: [{ by: 'u5', at: T('2026-10-27', '10'), body: 'Escalated to BOCRA IT at the Project Working Group.' }] });
  tk('BOC-3', 'A', 'Story', 'Bilingual page templates (English and Setswana)', 'Medium', 'To do', 'u9', 'u8', '2026-10-27', { labels: ['CR-2'], estimate: 3 });
  tk('BOC-4', 'A', 'Bug', 'Requirements matrix missing accessibility criteria', 'Medium', 'In review', 'u8', 'u5', '2026-10-29', { activityId: K['A-REQ'].id, description: 'Raised during BDIH review of the user requirements. Add WCAG 2.1 AA criteria per page type.' });
  tk('BOC-5', 'A', 'Task', 'Content migration plan for consultation documents', 'Low', 'Done', 'u9', 'u8', '2026-10-19');
  tk('UAS-1', 'B', 'Story', 'Online grant application form with document upload', 'High', 'To do', 'u11', 'u10', '2026-10-27', { labels: ['CR-1'], estimate: 8, description: 'Depends on change request CR-1 being approved by BOCRA.' });
  tk('UAS-2', 'B', 'Bug', 'PID resourcing section incomplete', 'High', 'Done', 'u10', 'u5', '2026-10-20', { activityId: K['B-PID'].id });
  tk('UAS-3', 'B', 'Task', 'Wireframes for projects map page', 'Medium', 'In progress', 'u11', 'u10', '2026-10-28', { activityId: K['B-REQ'].id, estimate: 3 });
  tk('UAS-4', 'B', 'Support request', 'Need UASF logo files in vector format', 'Medium', 'To do', 'u10', 'u10', '2026-10-29', { description: 'Request to BOCRA Communications for SVG or EPS logo files.', comments: [{ by: 'u7', at: T('2026-10-30', '09'), body: 'Requested from the UASF Trust; expected next week.' }] });

  /* ---- Invoices ---- */
  const inv = (id, no, org, ws, deliv, description, date, amount, status, by, hist) => S.invoices.push({
    id, no, org, ws, deliverableId: deliv, description, date, amount, vat: Math.round(amount * vatRate() * 100) / 100,
    status, comment: hist.length ? hist[hist.length - 1][2] : '', paymentRef: '', paidOn: null, by, at: T(date, '10'),
    docIds: [], history: [['Submitted', by, 'Invoice submitted', T(date, '10')]].concat(hist.map(h => [h[0], h[1], h[2], h[3]]))
  });
  S.invoices = [];
  inv('iv1', 'INV-A-001', 'DEVA', 'A', 'dl2', 'Phase 1 milestone: PID approved (BOCRA website)', '2026-10-28', 85000, 'Under review', 'u8',
    [['Under review', 'u6', 'Received; checking against the payment schedule.', T('2026-10-29', '09')]]);
  inv('iv2', 'BDIH-2026-014', 'BDIH', 'S', null, 'Project management services, October 2026', '2026-10-30', 120000, 'Submitted', 'u2', []);
  inv('iv3', 'UASF-INV-01', 'DEVB', 'B', null, 'Mobilisation fee (UASF website)', '2026-10-20', 40000, 'Queried', 'u10',
    [['Queried', 'u6', 'Purchase order number missing. Please resubmit with PO reference.', T('2026-10-22', '11')]]);
  doc('d10', 'Invoice INV-A-001', 'Invoice', 'A', 'invoice', 'iv1', [['INV-A-001.pdf', 98000, 'u8', T('2026-10-28', '10')]]);
  doc('d11', 'Invoice BDIH-2026-014', 'Invoice', 'S', 'invoice', 'iv2', [['BDIH-2026-014.pdf', 112000, 'u2', T('2026-10-30', '10')]]);
  S.invoices[0].docIds = ['d10']; S.invoices[1].docIds = ['d11'];

  S.audit.push({ id: 'au0', at: T('2026-10-12', '06'), user: 'u1', ip: 'seed', action: 'import.plan', entity: 'activities', entityId: null, before: null, after: { activities: S.activities.length, links: S.links.length } });
  return S;
}
