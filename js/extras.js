'use strict';
/* Plan phases that collapse, Add deliverable, daily download limit and download log,
   several leads per developer team. Loaded after app.js. */

/* ---------- Collapsible phases ---------- */

function phaseCollapsed(ph) { return !!(Sess && Sess.collapsed && Sess.collapsed[ph]); }

// Rows grouped under a phase header that collapses; rowFn renders one activity row
function phaseRows(list, ncols, rowFn) {
  const i = sdi(), out = [];
  const phases = phaseKeys().concat([...new Set(list.map(a => a.phase))].filter(p => !phaseKeys().includes(p)));
  phases.forEach(ph => {
    const acts = list.filter(a => a.phase === ph);
    if (!acts.length) return;
    const w = weighted(acts, i), c = phaseCollapsed(ph);
    const late = acts.filter(a => health(a, i) === 'Late').length;
    const ms = acts.filter(a => a.type === 'Milestone').sort((a, b) => b._fi - a._fi)[0];
    out.push(`<tr class="phase-row"><td colspan="${ncols}"><div class="phase-h">
      <button class="phase-tog" data-act="togglePhase" data-ph="${esc(ph)}" aria-expanded="${!c}"><span class="chev" aria-hidden="true"></span>${esc(phaseName(ph) || ph)}</button>
      <span class="ph-meta">${acts.length} activities, ${pc(w.actual)} done of ${pc(w.planned)} planned${late ? `, <span class="bad">${late} late</span>` : ''}${ms ? `, ends ${D.short(ms.finish)}` : ''}</span>
      <span class="ph-bar">${bar(w.actual, w.planned)}</span></div></td></tr>`);
    if (!c) acts.forEach(a => out.push(rowFn(a)));
  });
  return out;
}
ACT.togglePhase = el => { Sess.collapsed = Sess.collapsed || {}; Sess.collapsed[el.dataset.ph] = !Sess.collapsed[el.dataset.ph]; saveSess(); render(); };
ACT.phasesAll = el => { Sess.collapsed = {}; if (el.dataset.v === '1') phaseKeys().forEach(p => { Sess.collapsed[p] = true; }); saveSess(); render(); };
['togglePhase', 'phasesAll'].forEach(k => SAFE.add(k));

/* ---------- Add a deliverable from the plan ---------- */

ACT.addDeliverable = () => {
  const u = me(), S = St();
  if (!can.editPlan(u)) return toast('Only the plan editors can add deliverables.', 'err');
  const acts = visActs(u);
  modal('Add deliverable', `<form data-form="addDeliverable" class="fgrid">
   ${fld('Deliverable name', inp('name', '', 'text', 'required maxlength="160" placeholder="For example: Accessibility audit report"'), 'span2')}
   ${fld('Reference', inp('ref', '', 'text', 'required maxlength="20" placeholder="D8 or DEV-A"'))}
   ${fld('Workstream', sel('ws', S.workstreams.map(w => [w.id, w.name]), 'A', 'data-change="dlvWs"'))}
   ${fld('Phase', sel('phase', phaseKeys(), 'Phase 2'))}
   ${fld('Duration (business days)', inp('duration', 5, 'number', 'min="1" max="200" required'))}
   ${fld('Lead resource', sel('lead', resOpts(), 'R7'))}
   ${fld('Document category', sel('docCat', S.lookups.docCategories, 'Report'))}
   ${fld('Starts after (predecessor)', sel('pred', [['', 'Project start']].concat(acts.map(a => [a.id, num(a) + '. ' + a.name]))), 'span2')}
   <label class="chk span2"><input type="checkbox" name="bdih" checked> BDIH reviews it before BOCRA (usual for developer deliverables)</label>
   <div class="span2"><button class="btn">Add to plan</button></div></form>`, true);
};
CHG.dlvWs = el => { const f = el.form; f.bdih.checked = el.value !== 'S'; f.lead.value = el.value === 'A' ? 'R7' : el.value === 'B' ? 'R8' : 'R1'; };
FORM.addDeliverable = fd => {
  const u = me(), S = St();
  if (!can.editPlan(u)) return toast('Not allowed.', 'err');
  const ws = fd.get('ws'), name = String(fd.get('name')).trim(), ref = String(fd.get('ref')).trim(), phase = fd.get('phase');
  if (!name || !ref) return toast('Give the deliverable a name and reference.', 'err');
  const pred = fd.get('pred') && actOf(fd.get('pred'));
  const mk = o => Object.assign({ id: uid('a'), key: null, ws, phase, pct: 0, status: 'Not started', actualStart: null, actualFinish: null, fixedStart: null, notes: '', visibleToDevs: false, deliverableRef: '', reviewStage: null, submittable: false, indent: 0, docCat: 'Other', lead: null, support: null }, o);
  const d = mk({ name, type: 'Task', duration: Math.max(1, +fd.get('duration') || 1), lead: fd.get('lead') || null, deliverableRef: ref, submittable: true, docCat: fd.get('docCat') });
  const chain = [d];
  let last = d;
  const links = [];
  if (pred) links.push({ id: uid('l'), from: pred.id, to: d.id, type: 'FS', lag: 0 });
  if (fd.get('bdih')) {
    const b = mk({ name: 'BDIH review: ' + name, type: 'Review', reviewStage: 'BDIH', lead: 'R4', support: 'R3', indent: 1, forId: d.id, duration: 1 });
    d.bdihReviewId = b.id; chain.push(b); links.push({ id: uid('l'), from: last.id, to: b.id, type: 'FS', lag: 0 }); last = b;
  }
  const o = mk({ name: 'BOCRA review: ' + name, type: 'Review', reviewStage: 'BOCRA', lead: 'R5', indent: 1, forId: d.id, duration: 1 });
  d.bocraReviewId = o.id; chain.push(o); links.push({ id: uid('l'), from: last.id, to: o.id, type: 'FS', lag: 0 });
  // Place after the predecessor, or after the last activity of the same workstream
  let k = pred ? S.activities.indexOf(pred) : -1;
  if (k < 0) S.activities.forEach((a, j) => { if (a.ws === ws && !a.deleted) k = j; });
  S.activities.splice(k + 1, 0, ...chain);
  S.links.push(...links);
  S.deliverables.push({ id: uid('dl'), ref, name, phase, owner: ws === 'A' ? 'DEVA' : ws === 'B' ? 'DEVB' : 'BDIH', ws, activityId: d.id });
  audit('deliverable.create', 'deliverable', d.id, null, { ref, name, ws, reviews: chain.length - 1 });
  commit(ref + ' ' + name + ' added with its review steps.');
};

/* ---------- Daily download limit and download log ---------- */

const DL_RE = /^(document\.download|report\.generate|report\.download|export\.)/;
const dlLimit = () => Math.max(0, +St().settings.dailyDownloadLimit || 0);
const downloadsToday = uid => { const t = D.today(); return St().audit.filter(x => x.user === uid && DL_RE.test(x.action) && D.dateOf(x.at) === t).length; };

function downloadBanner(u) {
  const lim = dlLimit();
  if (!lim) return '';
  const n = downloadsToday(Sess.userId);
  return `<p class="dl-quota ${n >= lim ? 'bad' : ''}">Downloads today: <strong>${n} of ${lim}</strong>. The count resets at midnight.</p>`;
}

['download', 'reportPdf', 'reportWord', 'archivedReport', 'archivedWord', 'exportSchedule', 'exportMsp', 'exportCustom', 'exportUsers', 'exportAudit'].forEach(k => {
  const f = ACT[k];
  ACT[k] = (el, e) => {
    const lim = dlLimit(), n = downloadsToday(Sess.userId);
    if (lim && n >= lim) return toast(`You have reached today's limit of ${lim} downloads. It resets at midnight; an administrator can change the limit in Settings.`, 'err');
    const r = f(el, e);
    if (lim && lim - n - 1 <= 5) toast(`${Math.max(0, lim - n - 1)} downloads left today.`);
    return r;
  };
});

function dlDescribe(x) {
  const a = x.after || {};
  if (x.action === 'document.download') {
    const d = St().documents.find(y => y.id === x.entityId);
    return [d ? d.title + (a.version ? ' (v' + a.version + ')' : '') : 'Document', d ? (d.entityType === 'bank' ? 'Document bank' : d.category) : '', 'File'];
  }
  if (x.action === 'report.generate') return ['Progress report: ' + (a.scope === 'combined' ? 'combined' : wsName(a.scope || '')) + (a.period ? ', ' + D.short(a.period.start) + ' to ' + D.short(a.period.end) : ''), 'Report', (a.format || '').toUpperCase()];
  if (x.action === 'report.download') { const r = St().reports.find(y => y.id === x.entityId); return ['Monthly Progress Report ' + (r ? r.month : ''), 'Official report', 'PDF or Word']; }
  const kind = x.action.split('.')[1];
  return [{ schedule: 'Project plan export', msproject: 'MS Project export', custom: 'Custom report: ' + ((DATASETS[a.ds] || {}).label || ''), users: 'Users and access export', audit: 'Audit log export' }[kind] || x.action, 'Export', (a.format || 'CSV').toUpperCase()];
}

function downloadLogView(u, q) {
  const S = St();
  let rows = S.audit.filter(x => DL_RE.test(x.action)).sort((a, b) => a.at < b.at ? 1 : -1);
  if (q.who) rows = rows.filter(x => x.user === q.who);
  if (q.org) rows = rows.filter(x => (userOf(x.user) || {}).org === q.org);
  if (q.day) rows = rows.filter(x => D.dateOf(x.at) === q.day);
  const people = [...new Set(S.audit.filter(x => DL_RE.test(x.action)).map(x => x.user))].filter(Boolean);
  const today = D.today(), lim = dlLimit();
  const top = people.map(id => [id, downloadsToday(id)]).filter(p => p[1]).sort((a, b) => b[1] - a[1]);
  return `<div class="filters">
    <label class="f inline"><span>Person</span>${sel('who', [['', 'Everyone']].concat(people.map(id => [id, uname(id)])), q.who || '', 'data-change="qset" data-k="who"')}</label>
    <label class="f inline"><span>Organisation</span>${sel('org', [['', 'All']].concat(S.orgs.map(o => [o.id, o.name])), q.org || '', 'data-change="qset" data-k="org"')}</label>
    <label class="f inline"><span>Day</span><input type="date" value="${esc(q.day || '')}" data-change="qset" data-k="day"></label></div>
   <div class="grid g2r"><div class="card flush">${table(['When', 'Who', 'Organisation', 'What', 'Area', 'Format'], rows.slice(0, 400).map(x => { const [what, area, fmt] = dlDescribe(x); const p = userOf(x.user) || {}; return tr([D.stamp(x.at), esc(uname(x.user)), esc(orgName(p.org || '').split(' ')[0] || ''), esc(what), esc(area), esc(fmt)]); }), 'No downloads recorded.')}</div>
   <section class="card"><h2>Today</h2>${lim ? `<p class="muted">Limit: ${lim} downloads per person per day.</p>` : '<p class="muted">No daily limit is set.</p>'}
    ${top.length ? `<ul class="alist">${top.map(([id, n]) => `<li><span>${esc(uname(id))}</span> <strong class="${lim && n >= lim ? 'bad' : ''}">${n}${lim ? ' of ' + lim : ''}</strong></li>`).join('')}</ul>` : '<p class="empty">No downloads today.</p>'}
</section></div>`;
}

/* ---------- Several leads per developer team, with the change audited ---------- */

ACT.toggleLead = el => {
  const S = St(), x = userOf(el.dataset.id);
  if (!can.admin(me())) return toast('Only administrators change roles.', 'err');
  const isLead = hasRole(x, 'DEV_LEAD');
  const leads = S.users.filter(y => y.active && y.org === x.org && hasRole(y, 'DEV_LEAD'));
  if (isLead && leads.length <= 1) return toast('A developer team needs at least one lead.', 'err');
  const before = { role: x.role, extraRoles: (x.extraRoles || []).slice() };
  if (isLead) {
    x.extraRoles = (x.extraRoles || []).filter(r => r !== 'DEV_LEAD');
    if (x.role === 'DEV_LEAD') x.role = 'DEV_MEMBER';
  } else {
    x.extraRoles = [...new Set((x.extraRoles || []).concat('DEV_LEAD'))].filter(r => r !== x.role);
  }
  audit(isLead ? 'user.role.revoke' : 'user.role.grant', 'user', x.id, before, { role: x.role, extraRoles: x.extraRoles, changed: 'DEV_LEAD' });
  notify([x.id], 'Account change', isLead ? 'You are no longer a Developer Lead' : 'You are now a Developer Lead');
  commit(x.fullName + (isLead ? ' is no longer a lead.' : ' is now a Developer Lead.'));
};

ACT.userHistory = el => {
  const x = userOf(el.dataset.id);
  const label = a => ({ 'user.create': 'Account created', 'user.update': 'Details or roles changed', 'user.role.grant': 'Role granted', 'user.role.revoke': 'Role removed', 'user.passwordReset': 'Password reset', 'user.deactivate': 'Deactivated', 'user.reactivate': 'Reactivated', 'user.unlock': 'Unlocked', 'login': 'Signed in', 'login.failed': 'Failed sign-in', 'account.locked': 'Locked after failed sign-ins', 'password.change': 'Changed own password', 'impersonate.start': 'Viewed as by an administrator' }[a] || a);
  const rows = St().audit.filter(a => a.entityId === x.id && (/^(user|login|account|password|impersonate)/.test(a.action))).sort((a, b) => a.at < b.at ? 1 : -1);
  const detail = a => a.after && (a.after.changed || a.after.role) ? esc([a.after.changed ? roleName(a.after.changed) : '', a.after.role ? 'primary ' + roleName(a.after.role) : '', (a.after.extraRoles || []).length ? 'also ' + a.after.extraRoles.map(r => roleName(r)).join(', ') : ''].filter(Boolean).join('; ')) : '';
  modal('History: ' + x.fullName, `<p class="muted">Current roles: ${esc(roleLabel(x))}</p>${table(['When', 'Event', 'By', 'Detail'], rows.map(a => tr([D.stamp(a.at), esc(label(a.action)), esc(a.user ? uname(a.user) : 'System'), detail(a)])), 'No history yet.')}`, true);
};
SAFE.add('userHistory');

/* ---------- Organisation names: Developer A and B can carry the real company names ---------- */

ACT.orgModal = el => {
  const o = St().orgs.find(x => x.id === el.dataset.id);
  if (!can.admin(me())) return toast('Only administrators edit organisations.', 'err');
  modal('Edit organisation', `<form data-form="org" class="fgrid"><input type="hidden" name="id" value="${o.id}">
   ${fld('Registered name', inp('name', o.name, 'text', 'required maxlength="120"'), 'span2')}
   ${fld('Contact person or address (optional)', inp('contact', o.contact || '', 'text', 'maxlength="160"'), 'span2')}
   <p class="small muted span2">${o.type === 'Developer' ? `This is the company building the ${esc(wsName(o.id === 'DEVA' ? 'A' : 'B'))}. Its name appears on dashboards, boards, reports and invoices. Its workstream, users and data are unchanged.` : 'The name appears throughout the tracker.'}</p>
   <div class="span2"><button class="btn">Save</button></div></form>`);
};
FORM.org = fd => {
  const S = St(), o = S.orgs.find(x => x.id === fd.get('id')), name = String(fd.get('name')).trim();
  if (!can.admin(me())) return toast('Not allowed.', 'err');
  if (!name) return toast('Give the organisation a name.', 'err');
  if (S.orgs.some(x => x.id !== o.id && x.name.toLowerCase() === name.toLowerCase())) return toast('Another organisation already has that name.', 'err');
  const before = { name: o.name, contact: o.contact || '' };
  // Keep the matching plan resource in step (for example the "Developer A" resource)
  S.resources.filter(r => r.org === o.id && r.name === o.name).forEach(r => { r.name = name; });
  o.name = name; o.contact = String(fd.get('contact') || '').trim();
  audit('organisation.update', 'organisation', o.id, before, { name: o.name, contact: o.contact });
  commit('Organisation renamed to ' + name + '.');
};

/* ---------- Administration: editable lists, role names, workstreams ---------- */

// [key, title, current values, rule]; rules protect values the system relies on
const ADMIN_LISTS = () => [
  ['phases', 'Project phases', phaseKeys().map(k => k + ' = ' + phaseName(k)), 'One per line as "key = display name". Keys already used by activities cannot be removed.'],
  ['ticketStatuses', 'Ticket board columns', ticketStatuses(), 'Left to right. "Done" must stay; columns with tickets in them cannot be removed.'],
  ['ticketTypes', 'Ticket types', ticketTypes(), 'Types already used by tickets cannot be removed.'],
  ['ticketPriorities', 'Ticket priorities', ticketPriorities(), 'Highest first. Priorities already used cannot be removed.'],
  ['docCategories', 'Document categories', lists().docCategories || [], ''],
  ['bankCategories', 'Document bank categories', lists().bankCategories || [], ''],
  ['checklist', 'Review checklist', lists().checklist || [], 'Shown to BDIH reviewers on every submission.'],
  ['forums', 'Meeting forums', lists().forums || [], '']
];

function adminLists(u, A, prot) {
  return `
   <div class="grid g2">${ADMIN_LISTS().map(([k, t, vals, rule]) => `<section class="card"><h2>${esc(t)}</h2>
    <form data-form="lookup"><input type="hidden" name="k" value="${k}">${fld('One value per line', `<textarea name="v" rows="${Math.min(10, Math.max(4, vals.length + 1))}" ${A ? '' : 'disabled'}>${esc(vals.join('\n'))}</textarea>`)}
    ${rule ? `<p class="small muted">${esc(rule)}</p>` : ''}${A ? '<button class="btn sm">Save list</button>' : ''}</form></section>`).join('')}
    ${prot('Activity types', TYPES)}${prot('Activity statuses', STATUSES)}${prot('Health ratings', HEALTH)}${prot('Invoice statuses', INVOICE_STATUSES)}</div>`;
}

// Replaces the simple list save with checks for values in use
FORM.lookup = fd => {
  const S = St(), k = fd.get('k');
  if (!can.admin(me())) return toast('Only administrators edit lists.', 'err');
  const vals = [...new Set(String(fd.get('v')).split('\n').map(s => s.trim()).filter(Boolean))];
  if (!vals.length) return toast('A list needs at least one value.', 'err');
  const missing = used => [...new Set(used)].filter(x => x && !vals.includes(x));
  let store = vals, gone = [];
  if (k === 'phases') {
    const parsed = vals.map(l => { const m = l.split('='); return { key: m[0].trim(), name: (m.slice(1).join('=').trim() || m[0].trim()) }; });
    const keys = parsed.map(p => p.key);
    if (new Set(keys).size !== keys.length) return toast('Each phase key must be unique.', 'err');
    gone = [...new Set(S.activities.filter(a => !a.deleted).map(a => a.phase))].filter(x => !keys.includes(x));
    store = parsed;
  } else if (k === 'ticketStatuses') {
    if (!vals.includes('Done')) return toast('The "Done" column must stay.', 'err');
    gone = missing(S.tickets.map(t => t.status));
  } else if (k === 'ticketTypes') gone = missing(S.tickets.map(t => t.type));
  else if (k === 'ticketPriorities') gone = missing(S.tickets.map(t => t.priority));
  else if (k === 'docCategories') gone = missing(S.documents.filter(d => d.entityType !== 'bank').map(d => d.category));
  else if (k === 'bankCategories') gone = missing(S.documents.filter(d => d.entityType === 'bank').map(d => d.category));
  if (gone.length) return toast('Still in use, so it cannot be removed: ' + gone.join(', ') + '.', 'err');
  const before = S.lookups[k];
  S.lookups[k] = store;
  audit('lookup.update', 'lookups', k, before || null, store);
  commit('List saved.');
};

function adminRoleNames(u) {
  const A = can.admin(u) && !RO();
  return `<section class="card"><h2>Role names</h2>
   <form data-form="roleNames" class="fgrid">${Object.keys(ROLES).map(r => fld(roleName(r) === ROLES[r] ? esc(ROLES[r]) : esc(roleName(r)) + ' <span class="muted">(originally ' + esc(ROLES[r]) + ')</span>', inp('r_' + r, roleName(r), 'text', (A ? '' : 'disabled') + ' maxlength="60" required'))).join('')}
   ${A ? '<div class="span2 btns"><button class="btn sm">Save role names</button><button type="button" class="btn sm ghost" data-act="resetRoleNames">Restore original names</button></div>' : ''}</form></section>`;
}
FORM.roleNames = fd => {
  const S = St();
  if (!can.admin(me())) return toast('Not allowed.', 'err');
  const names = {};
  Object.keys(ROLES).forEach(r => { const v = String(fd.get('r_' + r) || '').trim(); if (v && v !== ROLES[r]) names[r] = v; });
  const all = Object.keys(ROLES).map(r => (names[r] || ROLES[r]).toLowerCase());
  if (new Set(all).size !== all.length) return toast('Two roles cannot have the same name.', 'err');
  audit('roles.rename', 'roles', null, S.roleNames || null, names);
  S.roleNames = names;
  commit('Role names saved.');
};
ACT.resetRoleNames = () => { St().roleNames = null; audit('roles.rename', 'roles', null, null, { reset: true }); commit('Original role names restored.'); };

ACT.wsModal = el => {
  const w = St().workstreams.find(x => x.id === el.dataset.id);
  modal('Edit workstream', `<form data-form="ws" class="fgrid"><input type="hidden" name="id" value="${w.id}">
   ${fld('Name', inp('name', w.name, 'text', 'required maxlength="80"'))}${fld('Website', inp('website', w.website, 'text', 'maxlength="120"'))}
   ${w.id !== 'S' ? fld('Ticket key prefix', inp('prefix', ticketPrefix(w.id), 'text', 'required pattern="[A-Za-z]{2,6}" maxlength="6"')) + '<p class="small muted">Applies to new tickets; existing keys stay as they are.</p>' : ''}
   <div class="span2"><button class="btn">Save</button></div></form>`);
};
FORM.ws = fd => {
  const S = St(), w = S.workstreams.find(x => x.id === fd.get('id'));
  if (!can.admin(me())) return toast('Not allowed.', 'err');
  const before = { name: w.name, website: w.website, ticketPrefix: w.ticketPrefix };
  if (fd.get('prefix')) {
    const p = String(fd.get('prefix')).trim().toUpperCase();
    if (S.workstreams.some(x => x.id !== w.id && x.id !== 'S' && ticketPrefix(x.id) === p)) return toast('Another board already uses ' + p + '.', 'err');
    w.ticketPrefix = p;
  }
  w.name = String(fd.get('name')).trim() || w.name;
  w.website = String(fd.get('website') || '').trim();
  audit('workstream.update', 'workstream', w.id, before, { name: w.name, website: w.website, ticketPrefix: w.ticketPrefix });
  commit('Workstream saved.');
};

/* ---------- Administrator overrides on records ---------- */

ACT.adminDeleteTicket = el => {
  const S = St(), t = S.tickets.find(x => x.id === el.dataset.id);
  if (!can.admin(me())) return;
  if (!confirm('Delete ' + t.key + '? It stays in the audit log.')) return;
  S.tickets = S.tickets.filter(x => x !== t);
  audit('ticket.delete', 'ticket', t.key, { title: t.title, status: t.status }, null);
  go('tickets', { ws: t.ws });
  commit(t.key + ' deleted.');
};
ACT.adminInvoice = el => {
  const S = St(), i = S.invoices.find(x => x.id === el.dataset.id), u = me();
  if (!can.admin(u)) return;
  const reopen = el.dataset.op === 'reopen';
  const why = prompt((reopen ? 'Reason for reopening invoice ' : 'Reason for voiding invoice ') + i.no + ':');
  if (!why || !why.trim()) return toast('A reason is required.', 'err');
  const st = reopen ? 'Under review' : 'Rejected';
  i.history.push([st, u.id, (reopen ? 'Reopened by administrator: ' : 'Voided by administrator: ') + why.trim(), D.now()]);
  audit(reopen ? 'invoice.reopen' : 'invoice.void', 'invoice', i.id, { status: i.status }, { status: st, reason: why.trim() });
  i.status = st; i.comment = why.trim();
  commit('Invoice ' + i.no + (reopen ? ' reopened.' : ' voided.'));
};
ACT.adminDeleteReg = el => {
  const S = St(), rc = REG[el.dataset.reg], it = S[rc.key].find(x => x.id === el.dataset.id);
  if (!hasPerm(me(), 'register.delete')) return toast('Not allowed.', 'err');
  if (!confirm('Delete "' + (it.title || it.decision) + '" from the register?')) return;
  S[rc.key] = S[rc.key].filter(x => x !== it);
  audit(el.dataset.reg + '.delete', el.dataset.reg, it.id, it, null);
  closeModal();
  commit('Deleted.');
};
ACT.adminDeleteMeeting = el => {
  const S = St(), m = S.meetings.find(x => x.id === el.dataset.id);
  if (!can.admin(me())) return;
  if (!confirm('Delete the meeting "' + m.title + '" and its action items?')) return;
  S.meetings = S.meetings.filter(x => x !== m);
  S.actions = S.actions.filter(x => x.meetingId !== m.id);
  audit('meeting.delete', 'meeting', m.id, { title: m.title }, null);
  go('meetings');
  commit('Meeting deleted.');
};

/* ---------- Labels: the administrator renames any button, tab or menu item ---------- */

const LABEL_SEL = 'button, a.btn, .side nav a, .tabs a, .board-tabs a span, .chip, legend, .bcol header h2';
const seenLabels = new Set();

// Swap the first text of each control for the administrator's label; remember what we saw
function applyLabels(root) {
  if (!root || !Store.state) return;
  const L = St().labels || {};
  root.querySelectorAll(LABEL_SEL).forEach(el => {
    const node = [...el.childNodes].find(n => n.nodeType === 3 && n.nodeValue.trim());
    if (!node) return;
    const txt = node.nodeValue.trim();
    const orig = el.dataset.label || txt;
    if (!el.dataset.label) el.dataset.label = orig;
    if (orig.length < 60 && !/^\d/.test(orig)) seenLabels.add(orig);
    if (L[orig]) node.nodeValue = node.nodeValue.replace(txt, L[orig]);
  });
}
const _render = render;
render = function () { _render(); applyLabels(document.getElementById('app')); };
const _modal = modal;
modal = function (title, html, wide) {
  const L = St().labels || {};
  _modal(L[title] || title, html, wide);
  applyLabels(document.querySelector('.modal-bg'));
};

function adminLabels(u, q) {
  const A = can.admin(u) && !RO(), L = St().labels || {};
  const all = [...new Set(KNOWN_LABELS.concat([...seenLabels], Object.keys(L)))].sort((a, b) => a.localeCompare(b));
  const list = q.lq ? all.filter(x => (x + ' ' + (L[x] || '')).toLowerCase().includes(q.lq.toLowerCase())) : all;
  return `
   <div class="filters"><label class="f inline grow"><span>Find a label</span><input type="search" value="${esc(q.lq || '')}" data-change="qset" data-k="lq" placeholder="For example: Submit"></label>
    <span class="muted">${Object.keys(L).length} renamed</span></div>
   <form data-form="labels"><div class="card flush"><div class="tw"><table class="tbl"><thead><tr><th>Original</th><th>Shown as</th></tr></thead><tbody>
   ${list.map(x => `<tr><td>${esc(x)}</td><td><input name="l::${esc(x)}" value="${esc(L[x] || '')}" placeholder="${esc(x)}" maxlength="60" ${A ? '' : 'disabled'} aria-label="New label for ${esc(x)}"></td></tr>`).join('')}
   </tbody></table></div></div>${A ? '<div class="btns"><button class="btn">Save labels</button><button type="button" class="btn ghost" data-act="resetLabels">Restore all original labels</button></div>' : ''}</form>`;
}
FORM.labels = fd => {
  const S = St();
  if (!can.admin(me())) return toast('Not allowed.', 'err');
  const next = Object.assign({}, S.labels || {});
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith('l::')) continue;
    const orig = k.slice(3), val = String(v).trim();
    if (val && val !== orig) next[orig] = val; else delete next[orig];
  }
  audit('labels.update', 'ui_labels', null, S.labels || null, next);
  S.labels = next;
  commit('Labels saved.');
};
ACT.resetLabels = () => {
  if (!confirm('Restore every original label?')) return;
  audit('labels.reset', 'ui_labels', null, St().labels || null, null);
  St().labels = {};
  commit('Original labels restored.');
};

/* ---------- Cloudflare Turnstile on sign-in (site key set in Administration, Settings) ---------- */

var DEFAULT_TURNSTILE_KEY = '0x4AAAAAAFvlUC69yGzxrwc-';
function tsCfg() { return { key: cfg().turnstileSiteKey || DEFAULT_TURNSTILE_KEY || '0x4AAAAAAFvlUC69yGzxrwc-', on: cfg().turnstileEnabled !== false }; }
// Turnstile only works on hostnames added in the Cloudflare dashboard; local test copies may not be
const devHost = () => location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
let tsState = { token: null, failed: false, widget: null };

function tsNote(msg) { const n = document.getElementById('ts-note'); if (n) n.textContent = msg; }
function loadTurnstile(cb) {
  if (window.turnstile) return cb();
  let s = document.getElementById('ts-api');
  if (!s) {
    s = document.createElement('script');
    s.id = 'ts-api';
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onerror = () => { tsState.failed = true; tsNote(devHost() ? '' : 'The security check could not load. Check your connection and reload the page.'); };
    document.head.appendChild(s);
  }
  s.addEventListener('load', cb, { once: true });
}
function mountTurnstile() {
  const box = document.getElementById('cf-ts');
  if (!box || !tsCfg().on) return;
  tsState = { token: null, failed: false, widget: null };
  loadTurnstile(() => {
    if (!document.getElementById('cf-ts') || !window.turnstile) return;
    tsState.widget = window.turnstile.render('#cf-ts', {
      sitekey: tsCfg().key, theme: 'light', size: 'flexible',
      callback: t => { tsState.token = t; tsNote(''); },
      'expired-callback': () => { tsState.token = null; tsNote('The security check expired. Please tick it again.'); },
      'error-callback': () => {
        tsState.failed = true;
        tsNote(devHost() ? '' : 'The security check failed. Reload the page and try again.');
        return true;
      }
    });
  });
}
const _renderTs = render;
render = function () { _renderTs(); if (!Sess || !Sess.userId) mountTurnstile(); };

// Sign-in needs a Turnstile token; the login Edge Function verifies it with Cloudflare in production
const _login = FORM.login;
FORM.login = (fd, f) => {
  if (tsCfg().on && !tsState.token && !(tsState.failed && devHost())) return toast('Please complete the security check first.', 'err');
  Ctx.turnstileToken = tsState.token;
  if (window.turnstile && tsState.widget != null) { try { window.turnstile.reset(tsState.widget); } catch (e) { /* widget gone */ } }
  tsState.token = null;
  return _login(fd, f);
};
