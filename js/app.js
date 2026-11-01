'use strict';
/* App shell: routing, session handling, workflows (submission, review, approval), forms and exports. */

const ACT = {}, FORM = {}, CHG = {};
// Actions allowed while an administrator is viewing as another user (read-only impersonation)
const SAFE = new Set(['closeModal', 'menu', 'logout', 'endViewAs', 'privacy', 'printPage', 'exportSchedule', 'exportMsp', 'download',
  'preview', 'versions', 'reportPdf', 'reportWord', 'archivedReport', 'archivedWord', 'exportUsers', 'exportAudit', 'openNote', 'regEdit',
  'fillLogin', 'period', 'login', 'qset', 'qtoggle', 'resetData', 'forgotPw', 'customReport', 'customDs', 'exportCustom']);

/* ---------- Plumbing ---------- */

function loadSess() { try { Sess = JSON.parse(sessionStorage.getItem('bdih-sess')); } catch (e) { Sess = null; } if (!Sess) Sess = {}; }
function saveSess() { try { sessionStorage.setItem('bdih-sess', JSON.stringify(Sess)); } catch (e) { /* ignore */ } }

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, q] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(q || ''));
  return { route: parts[0] || (isOversight(me()) ? 'dashboard' : 'devdash'), params: parts.slice(1), query };
}
function go(route, query) { location.hash = '#/' + route + (query && qs(query) ? '?' + qs(query) : ''); }

function render() {
  const app = $('#app');
  if (!Sess.userId) { app.innerHTML = loginView(Ctx.loginMsg); Ctx.loginMsg = null; document.title = 'Sign in | BDIH Project Tracker'; return; }
  const ru = realMe();
  if (!ru || !ru.active) return logout('Your session has ended because the account is not active.');
  if (ru.mustChange) { app.innerHTML = changePwView(true); return; }
  const { route, params, query } = parseHash();
  const u = me();
  Ctx.u = u;
  Ctx.num = new Map();
  visActs(u).forEach((a, k) => Ctx.num.set(a.id, k + 1));
  let body;
  try { body = VIEWS[route] ? VIEWS[route](params, query) : notFound(); } catch (e) {
    console.error(e);
    body = `<div class="card"><h1>Something went wrong</h1><pre class="small">${esc(e.stack || e)}</pre></div>`;
  }
  app.innerHTML = shell(route, body);
  document.body.classList.remove('nav-open');
  const h1 = $('#view h1');
  document.title = (h1 ? h1.textContent.trim() + ' | ' : '') + 'BDIH ' + brand().app;
}

function commit(msg) {
  St()._errors = runSchedule(St());
  Store.save();
  closeModal();
  render();
  if (msg) toast(msg);
}

function toast(msg, type) {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + (type || '');
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), type === 'err' ? 6000 : 3500);
}

function modal(title, html, wide) {
  closeModal();
  const d = document.createElement('div');
  d.className = 'modal-bg';
  d.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2><button class="icon" data-act="closeModal" aria-label="Close">&#10005;</button></header><div class="modal-body">${html}</div></div>`;
  document.body.appendChild(d);
  const f = d.querySelector('input:not([type=hidden]),select,textarea');
  (f || d.querySelector('button')).focus();
}
function closeModal() { document.querySelectorAll('.modal-bg').forEach(m => m.remove()); }

function audit(action, entity, entityId, before, after) {
  St().audit.push({ id: uid('au'), at: D.now(), user: Sess.userId || null, ip: 'browser', action, entity, entityId: entityId || null, before: before ?? null, after: after ?? null, viewAs: Sess.viewAs || null });
}
function hist(a, field, old, nw, comment, correction) {
  St().history.push({ id: uid('h'), activityId: a.id, by: Sess.userId, at: D.now(), field, old: old ?? '', new: nw ?? '', comment: comment || '', correction: !!correction });
}
// Notifications are only created for users who can see the underlying item (FR-NTF-02)
function notify(ids, type, title, ent) {
  [...new Set(ids.filter(Boolean))].forEach(id => {
    const u = userOf(id);
    if (!u || !u.active) return;
    if (ent && ent.ws && !canSee(u, ent.ws, ent.visibleToDevs)) return;
    St().notifications.push({ id: uid('n'), user: id, type, title, link: (ent && ent.link) || null, at: D.now(), read: null });
  });
}
const usersWith = (...roles) => St().users.filter(u => u.active && hasRole(u, ...roles)).map(u => u.id);
const devLeads = ws => St().users.filter(u => u.active && hasRole(u, 'DEV_LEAD') && (wsOf(u) || []).includes(ws)).map(u => u.id);
const resUser = rid => (resOf(rid) || {}).linkedUser;
const entOf = a => ({ ws: a.ws, visibleToDevs: a.visibleToDevs, link: '#/activity/' + a.id });

function dl(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function csv(rows) { return '﻿' + rows.map(r => r.map(v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n'); }

function defaultPeriod() { const end = D.today(); return { start: D.add(end, -30), end }; }

/* ---------- Events ---------- */

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const k = el.dataset.act;
  if (!ACT[k]) return;
  e.preventDefault();
  if (RO() && !SAFE.has(k)) return toast(isViewer(me()) ? 'The Director view is read-only.' : 'Read-only view: changes are disabled while viewing as another user.', 'err');
  ACT[k](el, e);
});
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const k = f.dataset.form;
  if (RO() && !SAFE.has(k)) return toast('This view is read-only.', 'err');
  if (FORM[k]) Promise.resolve(FORM[k](new FormData(f), f)).catch(err => { console.error(err); toast(err.message, 'err'); });
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (el && CHG[el.dataset.change]) {
    if (RO() && !SAFE.has(el.dataset.change)) return toast('This view is read-only.', 'err');
    CHG[el.dataset.change](el);
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
['click', 'keydown'].forEach(ev => document.addEventListener(ev, () => { if (Sess && Sess.userId) { Sess.lastActive = Date.now(); Sess.warned = false; saveSess(); } }, true));
window.addEventListener('hashchange', () => { closeModal(); render(); });

CHG.qset = el => { const { route, params, query } = parseHash(); if (el.value) query[el.dataset.k] = el.value; else delete query[el.dataset.k]; location.hash = '#/' + [route].concat(params).join('/') + (qs(query) ? '?' + qs(query) : ''); };
CHG.qtoggle = el => CHG.qset({ dataset: el.dataset, value: el.checked ? '1' : '' });

ACT.closeModal = () => closeModal();
ACT.menu = () => document.body.classList.toggle('nav-open');
ACT.printPage = () => window.print();
ACT.resetData = () => { if (confirm('Reset all demo data in this browser? Everything you changed will be lost.')) { Store.reset(); Sess = {}; saveSess(); location.hash = ''; render(); toast('Demo data reset.'); } };
ACT.privacy = () => modal('Privacy notice', `<p>This tool processes the names, usernames, job titles and contact details of BOCRA, BDIH and developer staff, and records of your actions in the project, under the Botswana Data Protection Act.</p>
 <p>The data is used only to manage the BOCRA and UASF websites project. It is kept for the life of the project plus seven years or as BOCRA directs. You may ask BDIH for access to or correction of your personal data.</p>
 <p>Every sign-in, change, upload, download and export is recorded in an audit log.</p><button class="btn" data-act="closeModal">Close</button>`);

/* ---------- Authentication (FR-AUTH) ---------- */

ACT.fillLogin = el => { const f = $('form[data-form=login]'); f.username.value = el.dataset.u; f.password.value = DEMO_PASSWORD; f.password.focus(); };

FORM.login = fd => {
  const S = St(), un = String(fd.get('username') || '').trim().toLowerCase(), pw = String(fd.get('password') || '');
  const generic = 'The username or password is incorrect, or the account is temporarily locked.';
  const now = Date.now();
  const u = S.users.find(x => x.username === un);
  const fail = (msg) => { Store.save(); Ctx.loginMsg = msg; render(); };
  if (!u) { audit('login.failed', 'user', null, null, { username: un.slice(0, 30) }); return fail(generic); }
  if (u.lockedUntil > now) { audit('login.locked', 'user', u.id); return fail(generic); }
  if (!u.active || hashPw(pw) !== u.pw) {
    const sc = securityCfg();
    u.fails = (u.fails || []).filter(t => now - t < sc.lockMin * 60e3).concat(now);
    audit('login.failed', 'user', u.id);
    if (u.fails.length >= sc.attempts) { u.lockedUntil = now + sc.lockMin * 60e3; u.fails = []; audit('account.locked', 'user', u.id, null, { until: new Date(u.lockedUntil).toISOString() }); }
    return fail(generic);
  }
  u.fails = [];
  const prev = u.lastLogin;
  u.lastLogin = D.now();
  Sess = { userId: u.id, loginAt: now, lastActive: now, period: defaultPeriod() };
  saveSess();
  audit('login', 'user', u.id);
  Store.save();
  runChecks();
  location.hash = isOversight(u) ? '#/dashboard' : '#/devdash';
  render();
  toast(prev ? 'Last successful sign-in: ' + D.stamp(prev) + ' (this browser).' : 'Welcome. This is your first sign-in.');
};

function logout(msg) {
  if (Sess.userId) { audit(msg ? 'session.ended' : 'logout', 'user', Sess.userId, null, msg ? { reason: msg } : null); Store.save(); }
  Sess = {}; saveSess(); closeModal();
  Ctx.loginMsg = msg || null;
  history.replaceState(null, '', location.pathname);
  render();
}
ACT.logout = () => logout();

FORM.changePw = fd => {
  const u = realMe(), cur = fd.get('current'), p1 = fd.get('pw1'), p2 = fd.get('pw2');
  if (hashPw(cur) !== u.pw) return toast('Your current password is not correct.', 'err');
  if (p1 !== p2) return toast('The new passwords do not match.', 'err');
  const prob = passwordProblem(p1, u.username);
  if (prob) return toast(prob, 'err');
  if (hashPw(p1) === u.pw) return toast('Choose a password different from the current one.', 'err');
  u.pw = hashPw(p1); u.mustChange = false;
  audit('password.change', 'user', u.id);
  Store.save(); render(); toast('Password changed.');
};

FORM.prefs = fd => {
  const u = realMe();
  u.prefs = Object.fromEntries(NOTE_CATS.map(c => [c, fd.get(c)]));
  audit('user.prefs', 'user', u.id, null, u.prefs);
  Store.save(); toast('Notification preferences saved.');
};

FORM.period = fd => {
  const s = fd.get('start'), e = fd.get('end');
  if (!s || !e || s > e) return toast('The period start must be on or before its end.', 'err');
  Sess.period = { start: s, end: e }; saveSess(); render();
};

// Inactivity timeout 30 minutes with a 2 minute warning; absolute limit 12 hours; deactivation check (FR-AUTH-07, FR-AUTH-10)
setInterval(() => {
  if (!Sess || !Sess.userId) return;
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) { const fresh = JSON.parse(raw); const fu = fresh.users.find(x => x.id === Sess.userId); if (fu && !fu.active) { Store.load(); return logout('Your account has been deactivated.'); } } } catch (e) { /* ignore */ }
  const now = Date.now(), idle = now - (Sess.lastActive || now), sc = securityCfg();
  if (now - Sess.loginAt > sc.maxHours * 3600e3) return logout('Your session reached the ' + sc.maxHours + ' hour limit. Sign in again.');
  if (idle > sc.idleMin * 60e3) return logout('You were signed out after ' + sc.idleMin + ' minutes of inactivity.');
  if (idle > (sc.idleMin - 2) * 60e3 && !Sess.warned) { Sess.warned = true; modal('Still there?', '<p>You will be signed out in 2 minutes because of inactivity.</p><button class="btn" data-act="closeModal">Stay signed in</button>'); }
}, 15000);

/* ---------- Activities and schedule ---------- */

function activityForm(a, after) {
  const u = me(), S = St(), x = a || { ws: 'S', phase: 'Phase 1', type: 'Task', duration: 1, docCat: 'Other' };
  const pos = S.activities.filter(y => !y.deleted).map((y, k) => [y.id, (k + 1) + '. ' + y.name]);
  modal(a ? 'Edit activity' : 'Insert activity', `<form data-form="activity" class="fgrid">
   <input type="hidden" name="id" value="${a ? a.id : ''}">
   ${fld('Name', inp('name', x.name, 'text', 'required maxlength="200"'), 'span2')}
   ${fld('Workstream', sel('ws', wsOptions(u, true), x.ws))}
   ${fld('Phase', sel('phase', phaseKeys(), x.phase))}
   ${fld('Type', sel('type', TYPES, x.type))}
   ${fld('Review stage (Review type only)', sel('reviewStage', [['', 'Not a review'], ['BDIH', 'BDIH review'], ['BOCRA', 'BOCRA review']], x.reviewStage || ''))}
   ${fld('Duration (business days)', inp('duration', x.duration, 'number', 'min="0" max="400"'))}
   ${fld('Fixed start (overrides links)', inp('fixedStart', x.fixedStart, 'date'))}
   ${fld('Lead resource', sel('lead', resOpts(), x.lead || ''))}
   ${fld('Support resource', sel('support', resOpts(), x.support || ''))}
   ${fld('Deliverable reference', inp('deliverableRef', x.deliverableRef, 'text', 'maxlength="20"'))}
   ${fld('Document category for submissions', sel('docCat', S.lookups.docCategories, x.docCat || 'Other'))}
   <label class="chk"><input type="checkbox" name="submittable" ${x.submittable ? 'checked' : ''}> Submission activity (deliverable goes through review)</label>
   <label class="chk"><input type="checkbox" name="visibleToDevs" ${x.visibleToDevs ? 'checked' : ''}> Visible to developers (Shared items only)</label>
   ${a ? '' : fld('Insert after', sel('after', [['', 'At the end']].concat(pos), after || ''), 'span2')}
   ${fld('Notes', ta('notes', x.notes), 'span2')}
   <div class="span2"><button class="btn">${a ? 'Save and reschedule' : 'Insert and reschedule'}</button></div></form>`, true);
}
ACT.addActivity = () => { const s = [...document.querySelectorAll('.selrow:checked')].pop(); activityForm(null, s && s.value); };
ACT.editActivity = el => activityForm(actOf(el.dataset.id));

FORM.activity = fd => {
  const u = me(), S = St();
  if (!can.editPlan(u)) return toast('Only the BDIH Project Leader and administrators can edit the plan.', 'err');
  const id = fd.get('id');
  const v = {
    name: fd.get('name').trim(), ws: fd.get('ws'), phase: fd.get('phase'), type: fd.get('type'), reviewStage: fd.get('reviewStage') || null,
    duration: Math.max(0, +fd.get('duration') || 0), fixedStart: fd.get('fixedStart') || null, lead: fd.get('lead') || null, support: fd.get('support') || null,
    deliverableRef: fd.get('deliverableRef').trim(), docCat: fd.get('docCat'), submittable: !!fd.get('submittable'), visibleToDevs: fd.get('ws') === 'S' && !!fd.get('visibleToDevs'), notes: fd.get('notes')
  };
  if (!v.name) return toast('Give the activity a name.', 'err');
  if (v.type === 'Review' && !v.reviewStage) return toast('Choose a review stage for a Review activity.', 'err');
  if (v.type !== 'Review') v.reviewStage = null;
  if (v.type !== 'Milestone' && v.type !== 'Review' && v.duration < 1) return toast('Duration must be at least one business day.', 'err');
  if (id) {
    const a = actOf(id), before = {};
    Object.keys(v).forEach(k => { if (String(a[k] ?? '') !== String(v[k] ?? '')) { before[k] = a[k]; hist(a, k, a[k], v[k], 'Plan edit'); } });
    Object.assign(a, v);
    audit('activity.update', 'activity', a.id, before, v);
  } else {
    const a = Object.assign({ id: uid('a'), key: null, pct: 0, status: 'Not started', actualStart: null, actualFinish: null, indent: 0 }, v);
    const after = fd.get('after');
    const k = after ? S.activities.findIndex(x => x.id === after) : -1;
    if (k >= 0) { a.indent = S.activities[k].indent || 0; S.activities.splice(k + 1, 0, a); } else S.activities.push(a);
    audit('activity.create', 'activity', a.id, null, v);
  }
  commit('Activity saved. Downstream activities rescheduled.');
};

ACT.moveAct = el => {
  const S = St(), list = S.activities, k = list.findIndex(a => a.id === el.dataset.id), dir = +el.dataset.dir;
  let j = k + dir;
  while (list[j] && list[j].deleted) j += dir;
  if (!list[j]) return;
  [list[k], list[j]] = [list[j], list[k]];
  audit('activity.move', 'activity', el.dataset.id, null, { dir });
  commit();
};
ACT.indentAct = el => { const a = actOf(el.dataset.id); a.indent = Math.max(0, Math.min(4, (a.indent || 0) + +el.dataset.dir)); commit(); };
ACT.deleteAct = el => {
  const a = actOf(el.dataset.id);
  if (St().submissions.some(s => s.activityId === a.id)) return toast('This activity has submissions and cannot be deleted. Set it to Cancelled instead.', 'err');
  if (!confirm('Delete "' + a.name + '" and its links? This is a soft delete.')) return;
  a.deleted = D.now();
  St().links = St().links.filter(l => l.from !== a.id && l.to !== a.id);
  audit('activity.delete', 'activity', a.id, { name: a.name });
  location.hash = '#/schedule';
  commit('Activity deleted.');
};

FORM.addLink = fd => {
  const S = St(), from = fd.get('from'), to = fd.get('to'), lag = Math.round(+fd.get('lag') || 0);
  if (!can.editPlan(me())) return;
  if (!actOf(from) || !actOf(to)) return toast('That activity does not exist.', 'err');
  if (from === to) return toast('An activity cannot depend on itself.', 'err');
  if (S.links.some(l => l.from === from && l.to === to)) return toast('That link already exists.', 'err');
  if ((S._preds.get(to) || []).length >= 5) return toast('An activity can have at most five predecessors.', 'err');
  const cyc = findCycle(S, from, to);
  if (cyc) return toast('Rejected: this link would create a circular dependency through ' + cyc.map(id => actOf(id).name).concat(actOf(to).name).join(' then ') + '.', 'err');
  const l = { id: uid('l'), from, to, type: fd.get('type') || 'FS', lag };
  S.links.push(l);
  audit('link.create', 'link', l.id, null, l);
  commit('Link added.');
};
ACT.removeLink = el => {
  const S = St(), l = S.links.find(x => x.id === el.dataset.id);
  S.links = S.links.filter(x => x !== l);
  audit('link.delete', 'link', l.id, l);
  commit('Link removed.');
};

ACT.duplicateSel = () => {
  const ids = [...document.querySelectorAll('.selrow:checked')].map(c => c.value);
  if (!ids.length) return toast('Tick the activities to duplicate first (for example a whole developer stream).', 'err');
  modal('Duplicate activities', `<form data-form="duplicate"><input type="hidden" name="ids" value="${ids.join(',')}"><p>${ids.length} activities will be copied with the links between them.</p>
   ${fld('Target workstream', sel('ws', wsOptions(me(), true), actOf(ids[0]).ws))}${fld('Name suffix', inp('suffix', ' (copy)'))}<button class="btn">Duplicate</button></form>`);
};
FORM.duplicate = fd => {
  const S = St(), ids = fd.get('ids').split(','), ws = fd.get('ws'), suffix = fd.get('suffix');
  const map = new Map(), copies = [];
  S.activities.filter(a => ids.includes(a.id)).forEach(a => {
    const c = Object.assign({}, a, { id: uid('a'), key: null, ws, name: a.name + suffix, pct: 0, status: 'Not started', actualStart: null, actualFinish: null, autoDone: false });
    Object.keys(c).forEach(k => { if (k[0] === '_') delete c[k]; });
    map.set(a.id, c.id); copies.push(c);
  });
  copies.forEach(c => ['bdihReviewId', 'bocraReviewId', 'forId'].forEach(k => { if (c[k]) c[k] = map.get(c[k]) || null; }));
  const last = Math.max(...ids.map(id => S.activities.findIndex(a => a.id === id)));
  S.activities.splice(last + 1, 0, ...copies);
  S.links.filter(l => map.has(l.from) && map.has(l.to)).forEach(l => S.links.push({ id: uid('l'), from: map.get(l.from), to: map.get(l.to), type: l.type, lag: l.lag }));
  audit('activity.duplicate', 'activity', null, null, { count: copies.length, ws });
  commit(copies.length + ' activities duplicated.');
};

ACT.baselineModal = () => {
  const S = St();
  const crs = S.changes.filter(c => c.decision === 'Approved');
  modal('Baselines', `${table(['Baseline', 'Saved', 'By', 'Change request', ''], S.baselines.map(b => tr([esc(b.name) + (b.id === S.settings.currentBaselineId ? ' <span class="tag">Current</span>' : ''), D.stamp(b.savedAt), esc(uname(b.savedBy)), esc((S.changes.find(c => c.id === b.crId) || {}).title || ''), b.id === S.settings.currentBaselineId ? '' : `<button class="btn sm ghost" data-act="setBaseline" data-id="${b.id}">Make current</button>`])))}
   <h3>Save a new baseline</h3><form data-form="baseline">${fld('Name', inp('name', 'Baseline ' + (S.baselines.length + 1), 'text', 'required'))}
   ${S.baselines.length ? fld('Approved change request (required)', sel('cr', [['', 'Choose']].concat(crs.map(c => [c.id, c.title])))) : ''}
   <button class="btn">Save baseline from current schedule</button></form>`, true);
};
FORM.baseline = fd => {
  const S = St();
  if (S.baselines.length && !fd.get('cr')) return toast('No change is applied to the baseline without an approved change request.', 'err');
  const items = {};
  S.activities.filter(a => !a.deleted).forEach(a => { items[a.id] = { start: a.start, finish: a.finish }; });
  const b = { id: uid('b'), name: fd.get('name'), savedAt: D.now(), savedBy: Sess.userId, crId: fd.get('cr') || null, items };
  S.baselines.push(b);
  S.settings.currentBaselineId = b.id;
  audit('baseline.save', 'baseline', b.id, null, { name: b.name, crId: b.crId });
  commit('Baseline saved and marked current.');
};
ACT.setBaseline = el => { St().settings.currentBaselineId = el.dataset.id; audit('baseline.current', 'baseline', el.dataset.id); commit('Current baseline changed.'); };

/* ---------- Progress (FR-PRG) ---------- */

FORM.progress = fd => {
  const u = me(), a = actOf(fd.get('id'));
  if (!a || !can.progress(u, a)) return toast('You cannot update this activity.', 'err');
  let pct = Math.round(clamp(fd.get('pct'))), st = fd.get('status'), as = fd.get('actualStart') || null, af = fd.get('actualFinish') || null;
  const note = String(fd.get('note') || '').trim();
  if (!allowedStatuses(u, a).includes(st)) return toast('That status change is not allowed for your role.', 'err');
  if (st === 'Complete') { if (!af) return toast('An actual finish date is required to mark an activity Complete.', 'err'); pct = 100; }
  if (['On hold', 'Cancelled'].includes(st) && st !== a.status && u.org !== 'BDIH') return toast('Only BDIH can put an activity On hold or Cancel it.', 'err');
  if (['On hold', 'Cancelled', 'Returned to developer'].includes(st) && st !== a.status && !note) return toast('Give a reason for ' + st + '.', 'err');
  if (af && !as) as = af;
  if (pct > 0 && !as && a.type !== 'Milestone') as = D.today();
  if (as && af && af < as) return toast('Actual finish cannot be before actual start.', 'err');
  if ((as && as > D.today()) || (af && af > D.today())) return toast('Actual dates cannot be in the future.', 'err');
  if (st === 'Not started' && pct > 0) st = 'In progress';
  const changes = [];
  [['pct', pct], ['status', st], ['actualStart', as], ['actualFinish', af]].forEach(([f, nv]) => { if (String(a[f] ?? '') !== String(nv ?? '')) changes.push([f, a[f], nv]); });
  if (!changes.length && !note) return toast('No changes to save.');
  const lock = St().settings.lockedThrough;
  const corr = !!lock && changes.some(([f, o, n]) => (f === 'actualStart' || f === 'actualFinish') && ((o && o <= lock) || (n && n <= lock)));
  if (corr && !note) return toast('Progress is locked through ' + D.nice(lock) + '. Give a reason for this correction.', 'err');
  const before = {}, after = {};
  changes.forEach(([f, o, n]) => { hist(a, f, o, n, note, corr); before[f] = o; after[f] = n; a[f] = n; });
  if (!changes.length) hist(a, 'note', '', '', note);
  audit('activity.progress', 'activity', a.id, before, Object.assign(after, note ? { note } : {}));
  commit('Progress saved.');
};

FORM.comment = fd => {
  const u = me(), a = actOf(fd.get('id')), body = String(fd.get('body') || '').trim();
  if (!a || !canSeeItem(u, a) || !body) return;
  const names = [...new Set((body.match(/@([a-z0-9._]+)/gi) || []).map(m => m.slice(1).toLowerCase()))];
  const targets = names.map(n => St().users.find(x => x.username === n)).filter(Boolean);
  const blocked = targets.filter(t => !canSeeItem(t, a));
  if (blocked.length && !isOversight(u)) return toast('You can only mention people who can see this activity.', 'err');
  St().comments.push({ id: uid('c'), entityType: 'activity', entityId: a.id, ws: a.ws, author: u.id, body, at: D.now() });
  notify(targets.map(t => t.id).filter(id => id !== u.id), 'Mention', uname(u.id) + ' mentioned you on ' + a.name, entOf(a));
  audit('comment.create', 'activity', a.id, null, { body: body.slice(0, 200) });
  commit('Comment posted.');
};

/* ---------- Files ---------- */

function magicOK(ext, b) {
  const s = (i, n) => String.fromCharCode(...b.slice(i, i + n));
  switch (ext) {
    case 'pdf': return s(0, 4) === '%PDF';
    case 'png': return b[0] === 0x89 && s(1, 3) === 'PNG';
    case 'jpg': case 'jpeg': return b[0] === 0xFF && b[1] === 0xD8;
    case 'zip': case 'docx': case 'xlsx': case 'pptx': return s(0, 2) === 'PK';
    case 'mp4': return s(4, 4) === 'ftyp';
    case 'svg': return /<svg/i.test(new TextDecoder().decode(b));
    default: return !b.slice(0, 1024).includes(0);
  }
}
async function readFile(f) {
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  if (!FILE_TYPES.includes(ext)) return { error: f.name + ': .' + ext + ' files are not accepted. Accepted: ' + FILE_TYPES.join(', ') + '.' };
  if (f.size > MAX_FILE) return { error: f.name + ' is larger than 100 MB.' };
  const head = new Uint8Array(await f.slice(0, 4096).arrayBuffer());
  if (!magicOK(ext, head)) return { error: f.name + ': the file content does not match a .' + ext + ' file.' };
  let data = null, sha = '';
  if (f.size <= 1.5 * 1048576) data = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(f); });
  try {
    if (window.crypto && crypto.subtle && f.size <= 20 * 1048576) {
      const h = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
      sha = [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) { /* hashing unavailable */ }
  return { f, data, sha };
}
// Same file name on the same item creates a new version (FR-DOC-04)
function addFile(info, meta) {
  const S = St(), name = info.f.name;
  let d = meta.docId ? S.documents.find(x => x.id === meta.docId) : S.documents.find(x => !x.deleted && x.entityType === meta.entityType && (x.entityId || null) === (meta.entityId || null) && x.ws === meta.ws && x.versions[x.versions.length - 1].name.toLowerCase() === name.toLowerCase());
  if (!d) {
    d = { id: uid('d'), title: meta.title || name.replace(/\.[^.]+$/, ''), category: meta.category || 'Other', ws: meta.ws, entityType: meta.entityType, entityId: meta.entityId || null, visibleToDevs: !!meta.visibleToDevs, deleted: null, deletedBy: null, versions: [] };
    S.documents.push(d);
  }
  const v = { no: d.versions.length + 1, name, size: info.f.size, by: Sess.userId, at: D.now(), comment: meta.comment || '', scan: 'Not scanned', sha: info.sha, data: info.data };
  d.versions.push(v);
  audit(v.no > 1 ? 'document.version' : 'document.upload', 'document', d.id, null, { name, version: v.no, size: v.size, ws: d.ws, sha256: info.sha });
  return d;
}
async function readAll(files) {
  const out = [];
  for (const f of files) { const r = await readFile(f); if (r.error) return { error: r.error }; out.push(r); }
  return { files: out };
}

ACT.uploadModal = el => {
  const u = me(), S = St(), docId = el.dataset.doc, d = docId && S.documents.find(x => x.id === docId);
  const ent = el.dataset.entity || 'library', eid = el.dataset.eid || '', ws = el.dataset.ws || '';
  if ((ent === 'bank' || (d && d.entityType === 'bank')) && !can.bankUpload(u)) return toast('Only BDIH and BOCRA add documents to the document bank.', 'err');
  modal(d ? 'Upload a new version' : ent === 'bank' ? 'Add to the document bank' : 'Upload document', `<form data-form="upload"><input type="hidden" name="doc" value="${docId || ''}"><input type="hidden" name="entity" value="${ent}"><input type="hidden" name="eid" value="${eid}">
   ${d ? `<p>New version of <strong>${esc(d.title)}</strong> (currently v${d.versions.length}).</p>` : `${fld('Title (defaults to the file name)', inp('title', ''))}${fld('Category', sel('category', ent === 'bank' ? S.lookups.bankCategories : S.lookups.docCategories, el.dataset.cat || (ent === 'bank' ? 'Template' : 'Other')))}
   ${ws ? `<input type="hidden" name="ws" value="${ws}">` : fld('Workstream', sel('ws', wsOptions(u, true), (wsOf(u) || ['S'])[0]))}
   ${isOversight(u) && ent === 'library' ? '<label class="chk"><input type="checkbox" name="vis"> Visible to developers (Shared workstream only)</label>' : ''}`}
   ${fld('File', `<input type="file" name="file" required accept="${FILE_TYPES.map(x => '.' + x).join(',')}">`)}${fld('Version comment', inp('comment', ''))}
   <p class="small muted">Up to 100 MB.</p>
   <button class="btn">Upload</button></form>`);
};
FORM.upload = async fd => {
  const u = me(), S = St(), f = fd.get('file');
  if (!f || !f.size) return toast('Choose a file.', 'err');
  const r = await readFile(f);
  if (r.error) return toast(r.error, 'err');
  let meta;
  const docId = fd.get('doc');
  if (docId) {
    const d = S.documents.find(x => x.id === docId);
    if (!d || !canSeeItem(u, d)) return toast('Not available.', 'err');
    if (d.entityType === 'bank' && !can.bankUpload(u)) return toast('Only BDIH and BOCRA update the document bank.', 'err');
    meta = { docId, comment: fd.get('comment') };
  } else {
    const ent = fd.get('entity'), eid = fd.get('eid') || null;
    let ws = fd.get('ws'), vis = !!fd.get('vis');
    if (ent === 'activity') { const a = actOf(eid); ws = a.ws; vis = a.visibleToDevs; }
    if (ent === 'meeting') { const m = S.meetings.find(x => x.id === eid); ws = m.ws; vis = !!m.visibleToDevs; }
    if (ent === 'bank') { if (!can.bankUpload(u)) return toast('Only BDIH and BOCRA add documents to the document bank.', 'err'); ws = 'S'; vis = true; }
    if (!isOversight(u) && !(wsOf(u) || []).includes(ws)) return toast('You can only upload to your own workstream.', 'err');
    meta = { entityType: ent, entityId: eid, ws, visibleToDevs: ws === 'S' && vis, title: fd.get('title').trim(), category: fd.get('category'), comment: fd.get('comment') };
  }
  const d = addFile(r, meta);
  if (meta.entityType === 'meeting') { const m = S.meetings.find(x => x.id === meta.entityId); if (m) m.minutesDoc = d.id; }
  commit('Uploaded ' + f.name + ' as version ' + d.versions.length + '.');
};

function docVersion(el) {
  const d = St().documents.find(x => x.id === el.dataset.id);
  if (!d || d.deleted || !canSeeItem(me(), d)) { toast('This document is not available.', 'err'); return null; }
  const v = el.dataset.v ? d.versions.find(x => x.no === +el.dataset.v) : d.versions[d.versions.length - 1];
  return { d, v };
}
ACT.download = el => {
  const x = docVersion(el); if (!x) return;
  audit('document.download', 'document', x.d.id, null, { version: x.v.no });
  Store.save();
  if (x.v.data) return fetch(x.v.data).then(r => r.blob()).then(b => dl(b, x.v.name));
  dl(new Blob(['Placeholder for "' + x.v.name + '".\r\nThis sample file has no content.'], { type: 'text/plain' }), x.v.name + '.txt');
};
ACT.preview = el => {
  const x = docVersion(el); if (!x || !x.v.data) return;
  fetch(x.v.data).then(r => r.blob()).then(b => {
    const url = URL.createObjectURL(b);
    modal(x.d.title, /pdf$/i.test(x.v.name) ? `<iframe class="pv" src="${url}" title="${esc(x.d.title)}"></iframe>` : `<img class="pv" src="${url}" alt="${esc(x.d.title)}">`, true);
  });
};
ACT.versions = el => {
  const d = St().documents.find(x => x.id === el.dataset.id);
  modal('Versions of ' + d.title, table(['Version', 'File', 'Size', 'Uploaded by', 'When', 'Comment', 'Scan', ''], d.versions.slice().reverse().map(v => tr(['v' + v.no, esc(v.name), bytes(v.size), esc(uname(v.by)), D.stamp(v.at), esc(v.comment), esc(v.scan), `<button class="btn sm ghost" data-act="download" data-id="${d.id}" data-v="${v.no}">Download</button>`]))), true);
};
ACT.deleteDoc = el => {
  const S = St(), d = S.documents.find(x => x.id === el.dataset.id), u = me();
  if (!can.docDelete(u, d)) return toast('Only the uploader or BDIH can delete this document.', 'err');
  if (S.submissions.some(s => s.state === 'Approved' && (s.docIds || []).includes(d.id))) return toast('Documents attached to an approved submission cannot be deleted.', 'err');
  if (!confirm('Delete "' + d.title + '"? An administrator can restore it for 90 days.')) return;
  d.deleted = D.now(); d.deletedBy = u.id;
  audit('document.delete', 'document', d.id);
  commit('Document deleted.');
};
ACT.restoreDoc = el => { const d = St().documents.find(x => x.id === el.dataset.id); d.deleted = null; d.deletedBy = null; audit('document.restore', 'document', d.id); commit('Document restored.'); };

/* ---------- Submissions, reviews and approvals (FR-REV) ---------- */

function reviewActs(a) { return { ba: a.bdihReviewId && actOf(a.bdihReviewId), oa: a.bocraReviewId && actOf(a.bocraReviewId) }; }
function resetAct(x) { if (x) Object.assign(x, { actualStart: null, actualFinish: null, pct: 0, status: 'Not started' }); }

function openSubmit(a) {
  const u = me();
  const opts = visActs(u).filter(x => can.submit(u, x) && ['Not started', 'In progress', 'Returned to developer'].includes(x.status));
  if (!a && !opts.length) return toast('Nothing is ready for you to submit.', 'err');
  const viaBdih = a ? a.ws !== 'S' : true;
  modal('Submit deliverable', `<form data-form="submit">
   ${a ? `<input type="hidden" name="id" value="${a.id}"><p><strong>${esc(a.name)}</strong> ${wsTag(a.ws)}</p>` : fld('Deliverable', sel('id', opts.map(x => [x.id, x.name + ' (' + wsName(x.ws) + ')'])))}
   ${fld('Cover note', ta('cover', '', 'required'))}
   ${fld('Files (one or more)', `<input type="file" name="file" multiple required accept="${FILE_TYPES.map(x => '.' + x).join(',')}">`)}
   <p class="small muted">${viaBdih ? 'BDIH reviews within ' + St().settings.bdihReviewDays + ' business days, then BOCRA decides within ' + St().settings.bocraReviewDays + '.' : 'BDIH deliverables go to BOCRA for a decision within ' + St().settings.bocraReviewDays + ' business days.'}</p>
   <button class="btn">Submit for review</button></form>`);
}
ACT.submitModal = el => openSubmit(actOf(el.dataset.id));
ACT.submitPick = () => openSubmit(null);

FORM.submit = async fd => {
  const u = me(), S = St(), a = actOf(fd.get('id'));
  if (!can.submit(u, a)) return toast('You cannot submit this deliverable.', 'err');
  if (S.submissions.some(s => s.activityId === a.id && s.state.startsWith('Under'))) return toast('This deliverable is already under review.', 'err');
  const cover = String(fd.get('cover') || '').trim();
  const files = fd.getAll('file').filter(f => f && f.size);
  if (!cover || !files.length) return toast('Add a cover note and at least one file.', 'err');
  const read = await readAll(files);
  if (read.error) return toast(read.error, 'err');
  const docIds = read.files.map(r => addFile(r, { entityType: 'activity', entityId: a.id, ws: a.ws, visibleToDevs: a.visibleToDevs, category: a.docCat || 'Other', comment: 'Submission' }).id);
  const today = D.today(), cal = S._cal;
  const viaBdih = a.ws !== 'S';
  const version = S.submissions.filter(s => s.activityId === a.id).length + 1;
  const sub = { id: uid('s'), activityId: a.id, ws: a.ws, version, by: u.id, at: D.now(), coverNote: cover, docIds, state: viaBdih ? 'Under BDIH review' : 'Under BOCRA review' };
  const { ba, oa } = reviewActs(a);
  const stage = viaBdih ? 'BDIH' : 'BOCRA';
  const ra = viaBdih ? ba : oa;
  const rev = { id: uid('r'), submissionId: sub.id, stage, reviewer: (ra && resUser(ra.lead)) || usersWith(viaBdih ? 'BDIH_LEAD' : 'BOCRA_REP')[0], due: cal.addBD(today, viaBdih ? +S.settings.bdihReviewDays : +S.settings.bocraReviewDays), decidedAt: null, outcome: null, findings: '' };
  S.submissions.push(sub); S.reviews.push(rev);
  hist(a, 'status', a.status, sub.state, 'Submitted v' + version);
  Object.assign(a, { status: sub.state, pct: 100, actualStart: a.actualStart || today, actualFinish: today });
  if (viaBdih) resetAct(oa);
  if (ra) Object.assign(ra, { actualStart: today, actualFinish: null, pct: 0, status: 'In progress' });
  audit('submission.create', 'submission', sub.id, null, { activity: a.name, version, files: docIds.length });
  notify([rev.reviewer].concat(viaBdih ? usersWith('BDIH_LEAD') : usersWith('BOCRA_REP')), 'Review assigned', `${stage} review assigned: ${a.name} v${version}, due ${D.nice(rev.due)}`, Object.assign(entOf(a), { link: '#/submissions?tab=' + stage.toLowerCase() }));
  notify(devLeads(a.ws).filter(x => x !== u.id), 'Submission received', `Submission received: ${a.name} v${version}`, entOf(a));
  commit('Submitted. ' + stage + ' review due ' + D.nice(rev.due) + '.');
};

function reviewCtx(id) { const S = St(), r = S.reviews.find(x => x.id === id), s = S.submissions.find(x => x.id === r.submissionId); return { r, s, a: actOf(s.activityId) }; }
function subSummary(s, a) {
  return `<p><strong>${esc(a.name)}</strong> ${wsTag(a.ws)} version ${s.version}, submitted by ${esc(uname(s.by))} on ${D.stamp(s.at)}</p><blockquote>${esc(s.coverNote)}</blockquote>
   <p class="small">Files: ${(s.docIds || []).map(id => { const d = St().documents.find(x => x.id === id); return d ? `<button class="link" data-act="download" data-id="${d.id}">${esc(d.title)}</button>` : ''; }).join(', ')}</p>`;
}
ACT.reviewModal = el => {
  const { r, s, a } = reviewCtx(el.dataset.id);
  modal('BDIH review recommendation', `<form data-form="review"><input type="hidden" name="id" value="${r.id}">${subSummary(s, a)}<p>Due ${D.nice(r.due)} ${timer(r.due)}</p>
   <fieldset><legend>Checklist against BOCRA's requirements</legend>${St().lookups.checklist.map((c, k) => `<label class="chk"><input type="checkbox" name="c${k}"> ${esc(c)}</label>`).join('')}</fieldset>
   ${fld('Recommendation', sel('outcome', [['Ready', 'Ready: forward to BOCRA'], ['Not ready', 'Not ready: return to developer']]))}
   ${fld('Findings', ta('findings', ''))}${fld('Marked-up files (optional)', '<input type="file" name="file" multiple>')}
   <button class="btn">Record recommendation</button></form>`, true);
};
FORM.review = async fd => {
  const u = me(), S = St();
  if (!can.bdihReview(u)) return toast('Only BDIH reviewers can record a recommendation.', 'err');
  const { r, s, a } = reviewCtx(fd.get('id'));
  if (r.decidedAt) return toast('This review has already been decided.', 'err');
  const outcome = fd.get('outcome'), findings = String(fd.get('findings') || '').trim();
  if (outcome === 'Not ready' && !findings) return toast('Give the reasons for a Not ready recommendation.', 'err');
  const files = fd.getAll('file').filter(f => f && f.size);
  const read = await readAll(files);
  if (read.error) return toast(read.error, 'err');
  read.files.forEach(x => addFile(x, { entityType: 'activity', entityId: a.id, ws: a.ws, visibleToDevs: a.visibleToDevs, category: 'Other', comment: 'BDIH mark-up v' + s.version }));
  const today = D.today(), { ba, oa } = reviewActs(a);
  Object.assign(r, { outcome, findings, reviewer: u.id, decidedAt: D.now(), checklist: S.lookups.checklist.map((c, k) => !!fd.get('c' + k)) });
  if (outcome === 'Ready') {
    s.state = 'Under BOCRA review';
    hist(a, 'status', a.status, s.state, 'BDIH: Ready');
    a.status = s.state;
    if (ba) Object.assign(ba, { actualFinish: today, pct: 100, status: 'Complete', actualStart: ba.actualStart || today });
    const rv = { id: uid('r'), submissionId: s.id, stage: 'BOCRA', reviewer: (oa && resUser(oa.lead)) || usersWith('BOCRA_REP')[0], due: S._cal.addBD(today, +S.settings.bocraReviewDays), decidedAt: null, outcome: null, findings: '' };
    S.reviews.push(rv);
    if (oa) Object.assign(oa, { actualStart: today, actualFinish: null, pct: 0, status: 'In progress' });
    notify([rv.reviewer].concat(usersWith('BOCRA_REP')), 'Review assigned', `BOCRA decision needed: ${a.name} v${s.version}, due ${D.nice(rv.due)}`, Object.assign(entOf(a), { link: '#/submissions?tab=bocra' }));
    notify([s.by].concat(devLeads(a.ws)), 'Submission forwarded', `${a.name} v${s.version} recommended Ready and forwarded to BOCRA`, entOf(a));
  } else {
    s.state = 'Returned';
    hist(a, 'status', a.status, 'Returned to developer', findings);
    Object.assign(a, { status: 'Returned to developer', actualFinish: null, pct: Math.min(a.pct, 90) });
    resetAct(ba);
    notify([s.by].concat(devLeads(a.ws)), 'Submission returned', `${a.name} v${s.version} returned by BDIH: Not ready`, entOf(a));
  }
  audit('review.bdih', 'review', r.id, null, { outcome, findings: findings.slice(0, 200) });
  commit('Recommendation recorded: ' + outcome + '.');
};

ACT.decideModal = el => {
  const { r, s, a } = reviewCtx(el.dataset.id);
  const prev = St().reviews.filter(x => x.submissionId === s.id && x.stage === 'BDIH' && x.decidedAt).pop();
  modal('BOCRA decision', `<form data-form="decide"><input type="hidden" name="id" value="${r.id}">${subSummary(s, a)}
   ${prev ? `<p><strong>BDIH recommendation:</strong> ${stb(prev.outcome)} ${esc(prev.findings)}</p>` : ''}<p>Due ${D.nice(r.due)} ${timer(r.due)}</p>
   ${fld('Decision', sel('outcome', ['Approved', 'Returned']))}${fld('Reasons or comments (required when returning)', ta('findings', ''))}
   <button class="btn">Record decision</button></form>`, true);
};
FORM.decide = fd => {
  const u = me(), S = St();
  if (!can.bocraDecide(u)) return toast('Only the BOCRA Representative can approve or return.', 'err');
  const { r, s, a } = reviewCtx(fd.get('id'));
  if (r.decidedAt) return toast('This review has already been decided.', 'err');
  const outcome = fd.get('outcome'), findings = String(fd.get('findings') || '').trim();
  if (outcome === 'Returned' && !findings) return toast('Give the reasons for returning the submission.', 'err');
  const today = D.today(), { ba, oa } = reviewActs(a);
  Object.assign(r, { outcome, findings, reviewer: u.id, decidedAt: D.now() });
  if (outcome === 'Approved') {
    s.state = 'Approved';
    hist(a, 'status', a.status, 'Complete', 'Approved by BOCRA');
    Object.assign(a, { status: 'Complete', pct: 100, actualFinish: a.actualFinish || D.dateOf(s.at) });
    if (ba && !isDone(ba)) Object.assign(ba, { status: 'Complete', pct: 100, actualStart: ba.actualStart || today, actualFinish: ba.actualFinish || today });
    if (oa) Object.assign(oa, { status: 'Complete', pct: 100, actualStart: oa.actualStart || today, actualFinish: today });
    notify([s.by].concat(devLeads(a.ws), usersWith('BDIH_LEAD')), 'Submission approved', `${a.name} v${s.version} approved by BOCRA`, entOf(a));
  } else {
    s.state = 'Returned';
    hist(a, 'status', a.status, 'Returned to developer', findings);
    Object.assign(a, { status: a.ws === 'S' ? 'In progress' : 'Returned to developer', actualFinish: null, pct: Math.min(a.pct, 90) });
    resetAct(ba); resetAct(oa);
    notify([s.by].concat(devLeads(a.ws), usersWith('BDIH_LEAD')), 'Submission returned', `${a.name} v${s.version} returned by BOCRA`, entOf(a));
  }
  audit('review.bocra', 'review', r.id, null, { outcome, findings: findings.slice(0, 200) });
  commit('Decision recorded: ' + outcome + '. Successor activities rescheduled.');
};

/* ---------- Weekly reports ---------- */

ACT.weeklyForm = el => {
  const u = me(), ws = el.dataset.ws;
  if (!can.weekly(u) || !(wsOf(u) || []).includes(ws)) return toast('Only the Developer Lead, or a delegated team member, files the weekly report.', 'err');
  const weeks = weeklyStatus(ws).filter(w => !w.r).map(w => w.we).reverse();
  const open = St().activities.filter(a => !a.deleted && a.ws === ws && ['Task', 'Report'].includes(a.type) && !isDone(a) && a.status !== 'Cancelled' && !a.status.startsWith('Under') && a._si <= sdi() + 10);
  modal('Weekly report: ' + wsName(ws), `<form data-form="weekly" class="fgrid"><input type="hidden" name="ws" value="${ws}">
   ${fld('Week ending', sel('we', weeks.map(w => [w, D.nice(w)]), el.dataset.we || weeks[0]), 'span2')}
   ${fld('Work completed this week', ta('completed', '', 'required'), 'span2')}${fld('Work planned next week', ta('planned', '', 'required'), 'span2')}
   ${fld('Issues', ta('issues', ''))}${fld('Risks', ta('risks', ''))}${fld('Change requests raised', ta('crs', ''))}${fld('Support needed from BDIH or BOCRA', ta('support', ''))}
   <div class="span2"><h3>Update % complete</h3>${table(['Activity', 'Finish', '% done'], open.map(a => tr([esc(a.name), D.short(a.finish), `<input type="number" name="p_${a.id}" value="${a.pct || 0}" min="0" max="100" step="5" aria-label="% done for ${esc(a.name)}">`])), 'No open activities.')}</div>
   ${fld('Attachments', '<input type="file" name="file" multiple>', 'span2')}
   <div class="span2"><button class="btn">File weekly report</button></div></form>`, true);
};
FORM.weekly = async fd => {
  const u = me(), S = St(), ws = fd.get('ws'), we = fd.get('we');
  if (!can.weekly(u) || !(wsOf(u) || []).includes(ws)) return toast('Not allowed.', 'err');
  if (!we || S.weekly.some(w => w.ws === ws && w.weekEnding === we)) return toast('A report for that week is already filed.', 'err');
  const read = await readAll(fd.getAll('file').filter(f => f && f.size));
  if (read.error) return toast(read.error, 'err');
  const rep = { id: uid('w'), ws, weekEnding: we, by: u.id, at: D.now(), pcts: [], reviewedBy: null, reviewedAt: null, comment: '' };
  ['completed', 'planned', 'issues', 'risks', 'crs', 'support'].forEach(k => { rep[k] = String(fd.get(k) || '').trim(); });
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith('p_')) continue;
    const a = actOf(k.slice(2)), pct = Math.round(clamp(v));
    if (!a || a.ws !== ws) continue;
    rep.pcts.push({ id: a.id, pct });
    if (pct !== (+a.pct || 0)) {
      hist(a, 'pct', a.pct, pct, 'Weekly report ' + D.nice(we));
      a.pct = pct;
      if (pct > 0 && !a.actualStart) { hist(a, 'actualStart', '', D.today(), 'Weekly report'); a.actualStart = D.today(); }
      if (pct > 0 && a.status === 'Not started') a.status = 'In progress';
    }
  }
  S.weekly.push(rep);
  read.files.forEach(x => addFile(x, { entityType: 'weekly', entityId: rep.id, ws, category: 'Report', comment: 'Weekly report ' + we }));
  audit('weekly.create', 'weekly', rep.id, null, { ws, weekEnding: we });
  notify(usersWith('BDIH_LEAD').concat(usersWith('BDIH_PO')), 'Weekly report filed', `Weekly report filed: ${wsName(ws)}, week ending ${D.nice(we)}`, { ws, link: '#/weekly?ws=' + ws + '&id=' + rep.id });
  commit('Weekly report filed and progress updated.');
};
FORM.weeklyReview = fd => {
  const w = St().weekly.find(x => x.id === fd.get('id'));
  Object.assign(w, { comment: String(fd.get('comment') || '').trim(), reviewedBy: Sess.userId, reviewedAt: D.now() });
  audit('weekly.review', 'weekly', w.id);
  notify(devLeads(w.ws), 'Weekly report reviewed', `BDIH reviewed your weekly report for ${D.nice(w.weekEnding)}`, { ws: w.ws, link: '#/weekly?id=' + w.id });
  commit('Marked reviewed.');
};

/* ---------- Reports and exports ---------- */

function printHTML(title, html) {
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  const d = f.contentDocument;
  d.open();
  d.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${RPT_CSS}@page{size:A4;margin:16mm}</style></head><body>${html}</body></html>`);
  d.close();
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 3000); }, 300);
}
function wordBlob(html) {
  return new Blob(['﻿<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><style>' + RPT_CSS + '</style></head><body>' + html + '</body></html>'], { type: 'application/msword' });
}
function rptScope(el) { const u = me(); return isOversight(u) ? el.dataset.scope : wsOf(u)[0]; }
function rptName(scope) { return 'Progress Report ' + (scope === 'combined' ? '' : wsName(scope) + ' ') + Sess.period.start + ' to ' + Sess.period.end; }
ACT.reportPdf = el => { const sc = rptScope(el); audit('report.generate', 'report', null, null, { scope: sc, format: 'pdf', period: Sess.period }); Store.save(); printHTML(rptName(sc), reportHTML(sc, Sess.period.start, Sess.period.end, Ctx.com || defaultCommentary())); };
ACT.reportWord = el => { const sc = rptScope(el); audit('report.generate', 'report', null, null, { scope: sc, format: 'word', period: Sess.period }); Store.save(); dl(wordBlob(reportHTML(sc, Sess.period.start, Sess.period.end, Ctx.com || defaultCommentary())), rptName(sc) + '.doc'); };
ACT.archivedReport = el => { const r = St().reports.find(x => x.id === el.dataset.id); audit('report.download', 'report', r.id); Store.save(); printHTML('Monthly Progress Report ' + r.month, r.html); };
ACT.archivedWord = el => { const r = St().reports.find(x => x.id === el.dataset.id); audit('report.download', 'report', r.id); Store.save(); dl(wordBlob(r.html), 'Monthly Progress Report ' + r.month + '.doc'); };

ACT.commentaryModal = () => {
  const c = Ctx.com || defaultCommentary();
  modal('BDIH commentary', `<form data-form="commentary">${fld('Issues', ta('issues', c.issues, 'rows="4"'))}${fld('Risks', ta('risks', c.risks, 'rows="4"'))}${fld('Decisions required from BOCRA', ta('decisions', c.decisions, 'rows="3"'))}${fld('Next steps', ta('next', c.next, 'rows="3"'))}<button class="btn">Use in report</button></form>`, true);
};
FORM.commentary = fd => { Ctx.com = { issues: fd.get('issues'), risks: fd.get('risks'), decisions: fd.get('decisions'), next: fd.get('next') }; closeModal(); render(); };

ACT.publishReport = () => {
  const m = D.month(Sess.period.end);
  modal('Save official Monthly Progress Report', `<form data-form="publish"><p>This saves the combined report for ${D.nice(Sess.period.start)} to ${D.nice(Sess.period.end)} as the official report, stores it in the document library, links it to D3 and notifies BOCRA.</p>${fld('Report month', inp('month', m, 'text', 'required'))}<button class="btn">Save and notify BOCRA</button></form>`);
};
FORM.publish = fd => {
  const u = me(), S = St();
  if (!can.publish(u)) return toast('Only the BDIH Project Leader can publish the official report.', 'err');
  const month = fd.get('month').trim();
  const html = reportHTML('combined', Sess.period.start, Sess.period.end, Ctx.com || defaultCommentary());
  const rep = { id: uid('pr'), official: true, scope: 'combined', month, start: Sess.period.start, end: Sess.period.end, by: u.id, at: D.now(), html };
  S.reports.push(rep);
  const mon = { January: 'JAN', October: 'OCT', November: 'NOV', December: 'DEC' }[month.split(' ')[0]];
  const ma = S.activities.find(a => a.key === 'MR-' + mon) || S.activities.find(a => a.deliverableRef === 'D3' && !isDone(a));
  const reader = new FileReader();
  const blob = wordBlob(html);
  reader.onload = () => {
    addFile({ f: { name: 'Monthly Progress Report ' + month + '.doc', size: blob.size }, data: reader.result, sha: '' }, { entityType: ma ? 'activity' : 'library', entityId: ma ? ma.id : null, ws: 'S', category: 'Report', title: 'Monthly Progress Report ' + month, comment: 'Official D3 report' });
    if (ma && !isDone(ma)) { hist(ma, 'status', ma.status, 'Complete', 'Official report saved'); Object.assign(ma, { status: 'Complete', pct: 100, actualStart: ma.actualStart || D.today(), actualFinish: D.today() }); }
    audit('report.publish', 'report', rep.id, null, { month, period: [rep.start, rep.end] });
    notify(St().users.filter(x => x.org === 'BOCRA').map(x => x.id), 'Monthly report', 'Monthly Progress Report ' + month + ' is available', { ws: 'S', link: '#/reports' });
    commit('Official report saved for ' + month + '. BOCRA notified.');
  };
  reader.readAsDataURL(blob);
};
ACT.lockPeriod = () => {
  const d = Sess.period.end;
  if (!confirm('Lock progress through ' + D.nice(d) + '? Later corrections to actual dates on or before this date will need a reason and be flagged.')) return;
  St().settings.lockedThrough = d;
  audit('progress.lock', 'settings', null, null, { through: d });
  commit('Progress locked through ' + D.nice(d) + '.');
};

ACT.exportSchedule = () => {
  const u = me(), S = St(), i = sdi();
  const { route, query } = parseHash();
  const list = route === 'schedule' ? filterActs(visActs(u), query) : visActs(u);
  const rows = [['ID', 'Activity', 'Workstream', 'Phase', 'Type', 'Deliverable', 'Lead', 'Support', 'Duration (bd)', 'Start', 'Finish', 'Baseline start', 'Baseline finish', 'Slip (bd)', 'Actual start', 'Actual finish', '% done', 'Planned %', 'Status', 'Health', 'Predecessors']];
  const bl = currentBaseline(S);
  list.forEach(a => rows.push([num(a), a.name, wsName(a.ws), a.phase, a.type, a.deliverableRef, rname(a.lead), rname(a.support), a._dur, a.start, a.finish, bl && bl.items[a.id] ? bl.items[a.id].start : '', blFinish(a) || '', slipOf(S, a) ?? '', a.actualStart || '', a.actualFinish || '', a.pct || 0, plannedPct(a, i), a.status, health(a, i),
    (S._preds.get(a.id) || []).map(l => canSeeItem(u, actOf(l.from)) ? num(actOf(l.from)) : 'BDIH or BOCRA action').join('; ')]));
  audit('export.schedule', 'activities', null, null, { rows: list.length });
  Store.save();
  dl(new Blob([csv(rows)], { type: 'text/csv' }), 'BDIH schedule ' + D.today() + '.csv');
};
ACT.exportMsp = () => {
  const u = me(), S = St(), list = visActs(u);
  const x = s => esc(s);
  const uidOf = new Map(list.map((a, k) => [a.id, k + 1]));
  const tasks = list.map((a, k) => `<Task><UID>${k + 1}</UID><ID>${k + 1}</ID><Name>${x(a.name)}</Name><OutlineLevel>${(a.indent || 0) + 1}</OutlineLevel><Start>${a.start}T08:00:00</Start><Finish>${a.finish}T17:00:00</Finish><Duration>PT${a._dur * 8}H0M0S</Duration><Milestone>${a.type === 'Milestone' ? 1 : 0}</Milestone><PercentComplete>${a.pct || 0}</PercentComplete>${(S._preds.get(a.id) || []).filter(l => uidOf.has(l.from)).map(l => `<PredecessorLink><PredecessorUID>${uidOf.get(l.from)}</PredecessorUID><Type>1</Type><LinkLag>${(l.lag || 0) * 4800}</LinkLag><LagFormat>7</LagFormat></PredecessorLink>`).join('')}</Task>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Project xmlns="http://schemas.microsoft.com/project"><Name>BOCRA and UASF Websites</Name><StartDate>${S.settings.projectStart}T08:00:00</StartDate><Tasks>${tasks}</Tasks></Project>`;
  audit('export.msproject', 'activities', null, null, { rows: list.length });
  Store.save();
  dl(new Blob([xml], { type: 'application/xml' }), 'BDIH schedule ' + D.today() + '.xml');
};

/* ---------- Registers ---------- */

ACT.regEdit = el => {
  const reg = el.dataset.reg, cfg = REG[reg], u = me(), S = St();
  const it = el.dataset.id ? S[cfg.key].find(x => x.id === el.dataset.id) : null;
  const ro = Sess.readOnly || (it && !can.regEdit(u) && !(reg === 'changes' && (can.crRecommend(u) || can.crDecide(u))));
  const x = it || { ws: (wsOf(u) || ['S'])[0], owner: u.id, requestedBy: u.id, raised: D.today(), requested: D.today(), date: D.today(), likelihood: 3, impact: 3, decision: 'Pending', status: '' };
  const field = ([k, label, type, req, perm]) => {
    const dis = ro || (perm && !can[perm](u)) || (reg === 'changes' && !perm && it && !can.regEdit(u)) ? 'disabled' : '';
    const r = req ? 'required' : '';
    let input;
    if (type === 'textarea') input = ta(k, x[k], `${dis} ${r}`);
    else if (type === 'date') input = inp(k, x[k], 'date', `${dis} ${r}`);
    else if (type === 'ws') input = sel(k, wsOptions(u, true), x[k], dis);
    else if (type === 'user') input = sel(k, userOpts(y => isOversight(u) || y.org === u.org || isOversight(y)), x[k], dis);
    else if (type === 'forum') input = sel(k, S.lookups.forums, x[k], dis);
    else if (Array.isArray(type)) input = sel(k, type, x[k] ?? type[0], dis);
    else input = inp(k, x[k], 'text', `${dis} ${r}`);
    return fld(label, input, type === 'textarea' ? 'span2' : '');
  };
  modal((it ? (ro ? '' : 'Edit ') : 'Add ') + cfg.title.replace(/s$/, '').toLowerCase().replace(/^./, c => c.toUpperCase()), `<form data-form="reg" class="fgrid"><input type="hidden" name="reg" value="${reg}"><input type="hidden" name="id" value="${it ? it.id : ''}">
    ${cfg.fields.map(field).join('')}
    ${isOversight(u) ? `<label class="chk span2"><input type="checkbox" name="visibleToDevs" ${x.visibleToDevs ? 'checked' : ''} ${ro ? 'disabled' : ''}> Visible to developers (Shared items only)</label>` : ''}
    <div class="span2 btns">${ro ? '<button type="button" class="btn ghost" data-act="closeModal">Close</button>' : '<button class="btn">Save</button>'}${it && hasPerm(u, 'register.delete') && !RO() ? `<button type="button" class="btn ghost danger" data-act="adminDeleteReg" data-reg="${reg}" data-id="${it.id}">Delete</button>` : ''}</div></form>`, true);
};
FORM.reg = fd => {
  const u = me(), S = St(), reg = fd.get('reg'), cfg = REG[reg], id = fd.get('id');
  let it = id ? S[cfg.key].find(x => x.id === id) : null;
  const vals = {};
  cfg.fields.forEach(([k, , type, req]) => {
    if (!fd.has(k)) return;
    let v = fd.get(k);
    if (k === 'likelihood' || k === 'impact') v = Math.max(1, Math.min(5, +v || 1));
    if (req && !String(v).trim()) vals._missing = true;
    vals[k] = v;
  });
  if (vals._missing) return toast('Complete the required fields.', 'err');
  delete vals._missing;
  const ws = vals.ws || (it && it.ws);
  if (ws && !isOversight(u) && !(wsOf(u) || []).includes(ws)) return toast('You can only raise items in your own workstream.', 'err');
  if (isOversight(u)) vals.visibleToDevs = ws === 'S' && !!fd.get('visibleToDevs');
  const before = it ? Object.assign({}, it) : null;
  if (!it) { it = { id: uid(reg.slice(0, 2)), createdBy: u.id }; S[cfg.key].push(it); }
  Object.assign(it, vals);
  if (reg === 'changes') {
    it.status = ['Approved', 'Rejected'].includes(it.decision) ? it.decision : it.recommendation ? 'Recommended' : 'Under assessment';
    if (before && before.decision !== it.decision && it.decision !== 'Pending') {
      notify([it.requestedBy, it.createdBy].concat(usersWith('BDIH_LEAD'), devLeads(it.ws)), 'Change request decided', `Change request ${it.decision.toLowerCase()}: ${it.title}`, { ws: it.ws, visibleToDevs: it.visibleToDevs, link: '#/registers?tab=changes' });
    }
  }
  audit(reg + (before ? '.update' : '.create'), reg, it.id, before, vals);
  commit('Saved.');
};

ACT.editDeliverable = el => {
  const S = St(), d = el.dataset.id ? S.deliverables.find(x => x.id === el.dataset.id) : { ref: '', name: '', phase: 'Phase 1', owner: 'BDIH', ws: 'S', activityId: '' };
  modal(el.dataset.id ? 'Edit deliverable' : 'Add deliverable', `<form data-form="deliverable" class="fgrid"><input type="hidden" name="id" value="${d.id || ''}">
   ${fld('Reference', inp('ref', d.ref, 'text', 'required'))}${fld('Name', inp('name', d.name, 'text', 'required'))}
   ${fld('Phase', sel('phase', phaseKeys(), d.phase))}${fld('Owner', sel('owner', S.orgs.map(o => [o.id, o.name]), d.owner))}
   ${fld('Workstream', sel('ws', S.workstreams.map(w => [w.id, w.name]), d.ws))}${fld('Linked activity', sel('activityId', S.activities.filter(a => !a.deleted).map(a => [a.id, a.name + ' (' + wsName(a.ws) + ')']), d.activityId))}
   <div class="span2"><button class="btn">Save</button></div></form>`, true);
};
FORM.deliverable = fd => {
  const S = St(), id = fd.get('id');
  const v = Object.fromEntries(['ref', 'name', 'phase', 'owner', 'ws', 'activityId'].map(k => [k, fd.get(k)]));
  const a = actOf(v.activityId);
  if (a && a.ws !== v.ws) return toast('The linked activity must be in the same workstream.', 'err');
  if (id) Object.assign(S.deliverables.find(x => x.id === id), v); else S.deliverables.push(Object.assign({ id: uid('dl') }, v));
  audit('deliverable.' + (id ? 'update' : 'create'), 'deliverable', id, null, v);
  commit('Deliverable saved.');
};

/* ---------- Meetings ---------- */

ACT.meetingModal = el => {
  const S = St(), m = el.dataset.id ? S.meetings.find(x => x.id === el.dataset.id) : { forum: 'Project Working Group', title: '', date: D.today(), ws: 'S', attendees: [], agenda: '', decisions: '' };
  modal(el.dataset.id ? 'Edit meeting' : 'Record meeting', `<form data-form="meeting" class="fgrid"><input type="hidden" name="id" value="${m.id || ''}">
   ${fld('Forum', sel('forum', S.lookups.forums, m.forum))}${fld('Title', inp('title', m.title, 'text', 'required'))}
   ${fld('Date', inp('date', m.date, 'date', 'required'))}${fld('Workstream', sel('ws', S.workstreams.map(w => [w.id, w.name]), m.ws))}
   <label class="chk span2"><input type="checkbox" name="vis" ${m.visibleToDevs ? 'checked' : ''}> Visible to developers (Shared meetings only). Developer Progress Meetings belong in the developer's own workstream.</label>
   <fieldset class="span2"><legend>Attendees</legend><div class="cols">${S.users.filter(x => x.active).map(x => `<label class="chk"><input type="checkbox" name="att" value="${x.id}" ${m.attendees.includes(x.id) ? 'checked' : ''}> ${esc(x.fullName)} <small class="muted">${esc(orgName(x.org).split(' ')[0])}</small></label>`).join('')}</div></fieldset>
   ${fld('Agenda', ta('agenda', m.agenda), 'span2')}${fld('Decisions', ta('decisions', m.decisions), 'span2')}
   <div class="span2"><button class="btn">Save meeting</button></div></form>`, true);
};
FORM.meeting = fd => {
  const S = St(), id = fd.get('id');
  const v = { forum: fd.get('forum'), title: fd.get('title').trim(), date: fd.get('date'), ws: fd.get('ws'), visibleToDevs: fd.get('ws') === 'S' && !!fd.get('vis'), attendees: fd.getAll('att'), agenda: fd.get('agenda'), decisions: fd.get('decisions') };
  const bad = v.attendees.filter(x => !canSee(userOf(x), v.ws, v.visibleToDevs));
  if (bad.length) return toast('These attendees cannot see this meeting: ' + bad.map(uname).join(', ') + '. Change the workstream or visibility.', 'err');
  let m;
  if (id) { m = S.meetings.find(x => x.id === id); Object.assign(m, v); } else { m = Object.assign({ id: uid('m'), minutesDoc: null }, v); S.meetings.push(m); }
  audit('meeting.' + (id ? 'update' : 'create'), 'meeting', m.id, null, { title: v.title, ws: v.ws });
  closeModal();
  go('meetings', { id: m.id });
  commit('Meeting saved.');
};
FORM.addAction = fd => {
  const S = St(), m = S.meetings.find(x => x.id === fd.get('meetingId'));
  const x = { id: uid('ac'), meetingId: m.id, ws: m.ws, visibleToDevs: m.visibleToDevs, text: fd.get('text').trim(), owner: fd.get('owner'), due: fd.get('due'), status: 'Open' };
  S.actions.push(x);
  notify([x.owner], 'Action assigned', 'Action assigned to you: ' + x.text + ', due ' + D.nice(x.due), { ws: x.ws, visibleToDevs: x.visibleToDevs, link: '#/tasks' });
  audit('action.create', 'action', x.id, null, x);
  commit('Action added.');
};
ACT.actionDone = el => {
  const x = St().actions.find(y => y.id === el.dataset.id), u = me();
  if (x.owner !== u.id && u.org !== 'BDIH') return toast('Only the owner or BDIH can close this action.', 'err');
  x.status = 'Done';
  audit('action.done', 'action', x.id);
  commit('Action closed.');
};

/* ---------- Invoices: developers and BDIH submit, BOCRA updates status ---------- */

function invoiceWs(u) { return u.org === 'BDIH' ? 'S' : (wsOf(u) || [])[0]; }
ACT.invoiceModal = () => {
  const u = me(), S = St(), ws = invoiceWs(u);
  if (!can.invoiceSubmit(u)) return toast('Only a Developer Lead or the BDIH Project Leader submits invoices.', 'err');
  const dls = S.deliverables.filter(d => d.ws === ws);
  modal('Submit invoice', `<form data-form="invoice" class="fgrid">
   ${fld('Invoice number', inp('no', '', 'text', 'required maxlength="40"'))}${fld('Invoice date', inp('date', D.today(), 'date', 'required'))}
   ${fld('Description', inp('description', '', 'text', 'required maxlength="200"'), 'span2')}
   ${fld('Deliverable or milestone (optional)', sel('deliverable', [['', 'None']].concat(dls.map(d => [d.id, d.ref + ': ' + d.name]))), 'span2')}
   ${fld('Amount excluding VAT (BWP)', inp('amount', '', 'number', 'required min="0.01" step="0.01" data-change="vatCalc"'))}
   ${fld('VAT (14%)', inp('vat', '', 'number', 'min="0" step="0.01"'))}
   ${fld('Invoice file (PDF)', '<input type="file" name="file" required accept=".pdf">', 'span2')}
   <p class="small muted span2">Submitted as ${esc(orgName(u.org))} for ${esc(wsName(ws))}. BOCRA and BDIH will see this invoice${u.org === 'BDIH' ? '' : '; the other developer will not'}.</p>
   <div class="span2"><button class="btn">Submit invoice</button></div></form>`, true);
};
CHG.vatCalc = el => { const v = el.form.vat; if (v && !v.dataset.touched) v.value = (Math.round((+el.value || 0) * vatRate() * 100) / 100).toFixed(2); };
document.addEventListener('input', e => { if (e.target.name === 'vat') e.target.dataset.touched = '1'; });

FORM.invoice = async fd => {
  const u = me(), S = St(), ws = invoiceWs(u);
  if (!can.invoiceSubmit(u) || !ws) return toast('Not allowed.', 'err');
  const no = String(fd.get('no')).trim(), amount = Math.round(+fd.get('amount') * 100) / 100;
  if (S.invoices.some(i => i.org === u.org && i.no.toLowerCase() === no.toLowerCase())) return toast('Invoice number ' + no + ' already exists for your organisation.', 'err');
  if (!(amount > 0)) return toast('Enter the amount excluding VAT.', 'err');
  const vat = fd.get('vat') === '' ? Math.round(amount * vatRate() * 100) / 100 : Math.round(+fd.get('vat') * 100) / 100;
  const r = await readFile(fd.get('file'));
  if (r.error) return toast(r.error, 'err');
  const i = { id: uid('iv'), no, org: u.org, ws, deliverableId: fd.get('deliverable') || null, description: String(fd.get('description')).trim(), date: fd.get('date'), amount, vat, status: 'Submitted', comment: '', paymentRef: '', paidOn: null, by: u.id, at: D.now(), docIds: [], history: [['Submitted', u.id, 'Invoice submitted', D.now()]] };
  S.invoices.push(i);
  i.docIds.push(addFile(r, { entityType: 'invoice', entityId: i.id, ws, category: 'Invoice', title: 'Invoice ' + no, comment: 'Invoice' }).id);
  audit('invoice.submit', 'invoice', i.id, null, { no, amount, vat });
  notify(usersWith('BOCRA_REP').concat(usersWith('BDIH_LEAD')), 'Invoice submitted', `Invoice ${no} (${money(amount + vat)}) submitted by ${orgName(u.org)}`, { link: '#/invoices?id=' + i.id });
  commit('Invoice ' + no + ' submitted to BOCRA.');
};

ACT.invoiceStatus = el => {
  const i = St().invoices.find(x => x.id === el.dataset.id);
  const next = INVOICE_STATUSES.filter(s => s !== 'Submitted' && s !== i.status);
  modal('Update invoice ' + i.no, `<form data-form="invoiceStatus" class="fgrid"><input type="hidden" name="id" value="${i.id}">
   <p class="span2">${esc(orgName(i.org))}: ${esc(i.description)}. Total <strong>${money(i.amount + i.vat)}</strong>. Current status ${stb(i.status)}</p>
   ${fld('New status', sel('status', next, next[0]), 'span2')}
   ${fld('Comment (required for Queried or Rejected)', ta('comment', ''), 'span2')}
   ${fld('Payment reference (when Paid)', inp('paymentRef', ''))}${fld('Payment date (when Paid)', inp('paidOn', '', 'date'))}
   <div class="span2"><button class="btn">Save status</button></div></form>`, true);
};
FORM.invoiceStatus = fd => {
  const u = me(), i = St().invoices.find(x => x.id === fd.get('id'));
  if (!can.invoiceStatus(u)) return toast('Only BOCRA updates invoice status.', 'err');
  if (['Paid', 'Rejected'].includes(i.status)) return toast('This invoice is closed.', 'err');
  const st = fd.get('status'), comment = String(fd.get('comment') || '').trim();
  if (['Queried', 'Rejected'].includes(st) && !comment) return toast('Give a reason for ' + st + '.', 'err');
  if (st === 'Paid' && (!fd.get('paidOn') || !String(fd.get('paymentRef')).trim())) return toast('Record the payment date and reference.', 'err');
  const before = i.status;
  Object.assign(i, { status: st, comment });
  if (st === 'Paid') Object.assign(i, { paidOn: fd.get('paidOn'), paymentRef: String(fd.get('paymentRef')).trim() });
  i.history.push([st, u.id, comment, D.now()]);
  audit('invoice.status', 'invoice', i.id, { status: before }, { status: st, comment });
  notify(St().users.filter(x => x.org === i.org && hasRole(x, 'DEV_LEAD', 'BDIH_LEAD')).map(x => x.id).concat([i.by], usersWith('BDIH_LEAD')), 'Invoice ' + st.toLowerCase(), `Invoice ${i.no}: ${st}${comment ? '. ' + comment : ''}`, { link: '#/invoices?id=' + i.id });
  commit('Invoice ' + i.no + ' marked ' + st + '.');
};

ACT.invoiceResubmit = el => {
  const i = St().invoices.find(x => x.id === el.dataset.id);
  modal('Resubmit invoice ' + i.no, `<form data-form="invoiceResubmit" class="fgrid"><input type="hidden" name="id" value="${i.id}">
   <p class="span2"><strong>BOCRA query:</strong> ${esc(i.comment)}</p>
   ${fld('Description', inp('description', i.description, 'text', 'required'), 'span2')}
   ${fld('Amount excluding VAT (BWP)', inp('amount', i.amount, 'number', 'required min="0.01" step="0.01"'))}${fld('VAT', inp('vat', i.vat, 'number', 'min="0" step="0.01"'))}
   ${fld('Corrected invoice file (PDF, optional)', '<input type="file" name="file" accept=".pdf">', 'span2')}
   ${fld('Response to the query', ta('comment', '', 'required'), 'span2')}
   <div class="span2"><button class="btn">Resubmit</button></div></form>`, true);
};
FORM.invoiceResubmit = async fd => {
  const u = me(), i = St().invoices.find(x => x.id === fd.get('id'));
  if (i.org !== u.org || i.status !== 'Queried') return toast('Only queried invoices from your organisation can be resubmitted.', 'err');
  const f = fd.get('file');
  if (f && f.size) {
    const r = await readFile(f);
    if (r.error) return toast(r.error, 'err');
    const d = addFile(r, { entityType: 'invoice', entityId: i.id, ws: i.ws, category: 'Invoice', title: 'Invoice ' + i.no, comment: 'Corrected invoice' });
    if (!i.docIds.includes(d.id)) i.docIds.push(d.id);
  }
  Object.assign(i, { description: String(fd.get('description')).trim(), amount: Math.round(+fd.get('amount') * 100) / 100, vat: Math.round(+fd.get('vat') * 100) / 100, status: 'Submitted', comment: String(fd.get('comment')).trim() });
  i.history.push(['Submitted', u.id, 'Resubmitted: ' + i.comment, D.now()]);
  audit('invoice.resubmit', 'invoice', i.id);
  notify(usersWith('BOCRA_REP'), 'Invoice resubmitted', 'Invoice ' + i.no + ' resubmitted', { link: '#/invoices?id=' + i.id });
  commit('Invoice resubmitted.');
};

CHG.userOrg = el => {
  const f = el.form, roles = roleEntries().filter(([r]) => ROLE_ORGS[r].includes(el.value));
  f.role.innerHTML = roles.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('');
  const box = f.querySelector('#extra-roles');
  if (box) box.innerHTML = roles.map(([r, t]) => `<label class="chk"><input type="checkbox" name="extra" value="${r}"> ${esc(t)}</label>`).join('');
};

/* ---------- Forgotten password: request goes to the administrators ---------- */

ACT.forgotPw = () => modal('Forgotten password', `<form data-form="forgotPw"><p>Enter your username. An administrator will reset your password and give you a temporary one; you set your own at the next sign-in.</p>
  ${fld('Username', inp('username', '', 'text', 'required autocomplete="username"'))}<button class="btn">Request a reset</button></form>`);
FORM.forgotPw = fd => {
  const S = St(), un = String(fd.get('username') || '').trim().toLowerCase(), u = S.users.find(x => x.username === un && x.active);
  if (u && !S.requests.some(r => r.type === 'reset' && r.userId === u.id && r.status === 'Pending')) {
    S.requests.push({ id: uid('rq'), type: 'reset', userId: u.id, fullName: u.fullName, username: u.username, at: D.now(), status: 'Pending' });
    S.audit.push({ id: uid('au'), at: D.now(), user: null, ip: 'browser', action: 'password.resetRequested', entity: 'user', entityId: u.id, before: null, after: null });
    S.users.filter(x => x.active && hasPerm(x, 'users.manage')).forEach(x => S.notifications.push({ id: uid('n'), user: x.id, type: 'Password reset', title: 'Password reset requested for ' + u.fullName, link: '#/admin?tab=requests', at: D.now(), read: null }));
    Store.save();
  }
  closeModal();
  // Same answer whether or not the username exists
  toast('If that username exists, the administrators have been asked to reset the password.');
};

/* ---------- Editable project plan (Administration) ---------- */

function setPreds(a, text) {
  const S = St(), list = visActs(me());
  const want = [];
  for (const part of String(text).split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)([+-]\d+)?$/);
    if (!m) return 'Write predecessors as activity numbers with an optional lag, for example "4, 7+2".';
    const p = list[+m[1] - 1];
    if (!p) return 'There is no activity number ' + m[1] + '.';
    if (p.id === a.id) return 'An activity cannot depend on itself.';
    want.push({ from: p.id, lag: m[2] ? +m[2] : 0 });
  }
  if (want.length > 5) return 'An activity can have at most five predecessors.';
  const old = S.links.filter(l => l.to === a.id);
  S.links = S.links.filter(l => l.to !== a.id);
  runSchedule(S);
  for (const w of want) {
    const cyc = findCycle(S, w.from, a.id);
    if (cyc) {
      S.links = S.links.filter(l => l.to !== a.id).concat(old);
      return 'Rejected: that creates a circular dependency through ' + cyc.map(id => actOf(id).name).concat(a.name).join(' then ') + '.';
    }
    S.links.push({ id: uid('l'), from: w.from, to: a.id, type: 'FS', lag: w.lag });
    runSchedule(S);
  }
  audit('activity.predecessors', 'activity', a.id, old.map(l => l.from), want);
  return null;
}
CHG.planCell = el => {
  const u = me(), a = actOf(el.dataset.id), k = el.dataset.k;
  if (!a) return;
  if (k === 'pct') {
    if (!can.progress(u, a)) return toast('You cannot update progress on this activity.', 'err');
    const pct = Math.round(clamp(el.value));
    hist(a, 'pct', a.pct, pct, 'Plan grid');
    audit('activity.progress', 'activity', a.id, { pct: a.pct }, { pct });
    a.pct = pct;
    if (pct > 0 && !a.actualStart) a.actualStart = D.today();
    if (pct > 0 && a.status === 'Not started') a.status = 'In progress';
    return commit('Saved.');
  }
  if (!can.editPlan(u)) return toast('You cannot edit the plan.', 'err');
  if (k === 'preds') { const err = setPreds(a, el.value); if (err) { toast(err, 'err'); return commit(); } return commit('Predecessors saved. Plan rescheduled.'); }
  let v = el.value;
  if (k === 'name' && !v.trim()) return toast('An activity needs a name.', 'err');
  if (k === 'duration') v = Math.max(1, Math.min(400, Math.round(+v || 1)));
  if (k === 'fixedStart' || k === 'lead') v = v || null;
  if (k === 'ws' && v !== 'S') a.visibleToDevs = false;
  if (k === 'type' && v === 'Review' && !a.reviewStage) a.reviewStage = 'BDIH';
  if (String(a[k] ?? '') === String(v ?? '')) return;
  hist(a, k, a[k], v, 'Plan grid');
  audit('activity.update', 'activity', a.id, { [k]: a[k] }, { [k]: v });
  a[k] = v;
  commit('Saved. Plan rescheduled.');
};

/* ---------- Roles and permissions ---------- */

CHG.permToggle = el => {
  const S = St(), u = me();
  if (!can.admin(u)) return toast('Only administrators change permissions.', 'err');
  const k = el.dataset.k, r = el.dataset.r;
  S.rolePerms = S.rolePerms || {};
  const cur = permRoles(k).slice();
  S.rolePerms[k] = el.checked ? [...new Set(cur.concat(r))] : cur.filter(x => x !== r);
  audit('permission.' + (el.checked ? 'grant' : 'revoke'), 'role_permissions', k, { roles: cur }, { roles: S.rolePerms[k] });
  commit((el.checked ? 'Granted' : 'Removed') + ': ' + roleName(r) + ', ' + PERMISSIONS.find(p => p[0] === k)[1].toLowerCase() + '.');
};
ACT.resetPerms = () => {
  if (!confirm('Restore the default permissions for every role?')) return;
  St().rolePerms = null;
  audit('permission.reset', 'role_permissions', null);
  commit('Default permissions restored.');
};

/* ---------- Custom report builder ---------- */

function readCustom(fd) {
  return { ds: fd.get('ds'), title: String(fd.get('title') || '').trim(), cols: fd.getAll('col'), ws: fd.get('ws') || '', status: fd.get('status') || '', from: fd.get('from') || '', to: fd.get('to') || '', group: fd.get('group') || '', sort: fd.get('sort') || '', desc: !!fd.get('desc') };
}
CHG.customDs = el => { Ctx.custom = null; go('reports', { tab: 'custom', ds: el.value }); };
FORM.customReport = fd => {
  const def = readCustom(fd);
  if (!def.cols.length) return toast('Choose at least one column.', 'err');
  def._from = Ctx.custom && Ctx.custom._from;
  Ctx.custom = def;
  audit('report.custom', 'report', null, null, { ds: def.ds, cols: def.cols.length });
  Store.save();
  render();
};
ACT.exportCustom = el => {
  const u = me(), def = Ctx.custom;
  if (!def) return;
  const name = (def.title || DATASETS[def.ds].label + ' report') + ' ' + D.today();
  audit('export.custom', 'report', null, null, { ds: def.ds, format: el.dataset.f });
  Store.save();
  if (el.dataset.f === 'pdf') return printHTML(name, customHTML(def, u, true));
  if (el.dataset.f === 'word') return dl(wordBlob(customHTML(def, u, true)), name + '.doc');
  const ds = DATASETS[def.ds], cols = ds.cols.filter(c => def.cols.includes(c[0]));
  dl(new Blob([csv([cols.map(c => c[1])].concat(runCustom(def, u).map(r => cols.map(c => r[c[0]]))))], { type: 'text/csv' }), name + '.csv');
};
ACT.saveReportDef = () => {
  if (!Ctx.custom) return;
  modal('Save report', `<form data-form="saveReportDef">${fld('Name', inp('name', Ctx.custom.title || DATASETS[Ctx.custom.ds].label + ' report', 'text', 'required'))}
    <label class="chk"><input type="checkbox" name="shared"> Share with colleagues. It only ever shows each person what they are allowed to see.</label><button class="btn">Save</button></form>`);
};
FORM.saveReportDef = fd => {
  const S = St(), def = Object.assign({}, Ctx.custom);
  delete def._from;
  const r = { id: uid('rd'), name: String(fd.get('name')).trim(), def, by: Sess.userId, at: D.now(), shared: !!fd.get('shared') };
  S.reportDefs.push(r);
  audit('report.save', 'report_definition', r.id, null, { name: r.name });
  commit('Report saved.');
};
ACT.deleteReportDef = el => { const S = St(); S.reportDefs = S.reportDefs.filter(r => !(r.id === el.dataset.id && r.by === Sess.userId)); commit('Report deleted.'); };

/* ---------- People and administration ---------- */

ACT.requestUser = () => modal('Request a team member account', `<form data-form="request" class="fgrid">${fld('Full name', inp('fullName', '', 'text', 'required'))}${fld('Preferred username', inp('username', '', 'text', 'required pattern="[A-Za-z0-9._]{3,30}"'))}${fld('Email', inp('email', '', 'email', 'required'))}${fld('Job title', inp('title', ''))}<div class="span2"><button class="btn">Send to administrators</button></div></form>`);
FORM.request = fd => {
  const u = me(), S = St();
  const r = { id: uid('rq'), by: u.id, org: u.org, role: 'DEV_MEMBER', fullName: fd.get('fullName').trim(), username: fd.get('username').trim().toLowerCase(), email: fd.get('email').trim(), title: fd.get('title').trim(), at: D.now(), status: 'Pending' };
  S.requests.push(r);
  notify(usersWith('ADMIN'), 'Account request', 'New account request from ' + u.fullName + ' for ' + r.fullName, { link: '#/admin?tab=requests' });
  audit('request.create', 'request', r.id, null, r);
  commit('Request sent to administrators.');
};

function tempPassword() { const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; let s = ''; const b = new Uint32Array(14); crypto.getRandomValues(b); b.forEach(n => { s += c[n % c.length]; }); return s.slice(0, 10) + '7' + 'x' + s.slice(10, 12); }
function showTemp(u, pw) { modal('Temporary password', `<p>Give this temporary password to <strong>${esc(u.fullName)}</strong> (username <code>${esc(u.username)}</code>) through a secure channel. They must set a new password at first sign-in.</p><p class="temp"><code>${esc(pw)}</code></p><button class="btn" data-act="closeModal">Done</button>`); }

ACT.approveRequest = el => {
  const S = St(), r = S.requests.find(x => x.id === el.dataset.id);
  if (S.users.some(x => x.username === r.username)) return toast('That username is taken. Create the user manually with another username.', 'err');
  const pw = tempPassword();
  const nu = { id: uid('u'), username: r.username, fullName: r.fullName, org: r.org, role: r.role, title: r.title, phone: '', email: r.email, active: true, pw: hashPw(pw), mustChange: true, fails: [], lockedUntil: 0, lastLogin: null, delegated: false, prefs: {} };
  S.users.push(nu); r.status = 'Approved';
  audit('user.create', 'user', nu.id, null, { username: nu.username, role: nu.role, fromRequest: r.id });
  notify([r.by], 'Account request', 'Account approved for ' + r.fullName);
  Store.save(); render(); showTemp(nu, pw);
};
ACT.rejectRequest = el => {
  const r = St().requests.find(x => x.id === el.dataset.id);
  r.status = r.type === 'reset' ? 'Dismissed' : 'Rejected';
  audit('request.' + r.status.toLowerCase(), 'request', r.id);
  if (r.type !== 'reset') notify([r.by], 'Account request', 'Account request for ' + r.fullName + ' was not approved');
  commit();
};

ACT.userModal = el => {
  const S = St(), org = el.dataset.org || 'BDIH';
  const x = el.dataset.id ? userOf(el.dataset.id) : { org, role: Object.keys(ROLES).find(r => ROLE_ORGS[r].includes(org)), active: true };
  const roleOpts = roleEntries().filter(([r]) => ROLE_ORGS[r].includes(x.org));
  modal(el.dataset.id ? 'Edit user' : 'Add user', `<form data-form="user" class="fgrid"><input type="hidden" name="id" value="${x.id || ''}">
   ${fld('Full name', inp('fullName', x.fullName, 'text', 'required'))}${fld('Username', inp('username', x.username, 'text', 'required pattern="[A-Za-z0-9._]{3,30}"'))}
   ${el.dataset.id ? fld('Organisation', sel('org', S.orgs.map(o => [o.id, o.name]), x.org, 'data-change="userOrg"')) : `<input type="hidden" name="org" value="${x.org}">` + fld('Organisation', `<input value="${esc(orgName(x.org))}" disabled>`)}${fld('Primary role', sel('role', roleOpts, x.role))}
   <fieldset class="span2"><legend>Additional roles (optional)</legend><div class="cols" id="extra-roles">${roleOpts.map(([r, t]) => `<label class="chk"><input type="checkbox" name="extra" value="${r}" ${(x.extraRoles || []).includes(r) ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</div>
   <p class="small muted">A person gets every permission of every role they hold. Roles must belong to their organisation.</p></fieldset>
   ${fld('Job title', inp('title', x.title))}${fld('Phone', inp('phone', x.phone, 'tel'))}${fld('Email', inp('email', x.email, 'email'))}
   <label class="chk"><input type="checkbox" name="delegated" ${x.delegated ? 'checked' : ''}> Developer team member may submit and file weekly reports (delegated)</label>
   <div class="span2"><button class="btn">${x.id ? 'Save user' : 'Create user with temporary password'}</button></div></form>`, true);
};
FORM.user = fd => {
  const S = St(), id = fd.get('id');
  const v = { fullName: fd.get('fullName').trim(), username: fd.get('username').trim().toLowerCase(), org: fd.get('org'), role: fd.get('role'), title: fd.get('title').trim(), phone: fd.get('phone').trim(), email: fd.get('email').trim(), delegated: !!fd.get('delegated') };
  v.extraRoles = fd.getAll('extra').filter(r => r !== v.role);
  const badRole = v.extraRoles.find(r => !ROLE_ORGS[r].includes(v.org));
  if (badRole) return toast(roleName(badRole) + ' does not belong to ' + orgName(v.org) + '.', 'err');
  if (!/^[a-z0-9._]{3,30}$/.test(v.username)) return toast('Usernames are 3 to 30 letters, digits, dots or underscores.', 'err');
  if (S.users.some(x => x.username === v.username && x.id !== id)) return toast('That username is already in use.', 'err');
  if (!ROLE_ORGS[v.role].includes(v.org)) return toast(roleName(v.role) + ' is not a valid role for ' + orgName(v.org) + '.', 'err');
  if (![v.role].concat(v.extraRoles).includes('DEV_MEMBER')) v.delegated = false;
  if (id) {
    const x = userOf(id), before = { role: x.role, extraRoles: x.extraRoles || [], org: x.org, username: x.username };
    if (x.id === Sess.userId && !rolesOf(v).includes('ADMIN')) return toast('You cannot remove your own administrator role.', 'err');
    Object.assign(x, v);
    audit('user.update', 'user', id, before, v);
    notify([id], 'Account change', 'Your account details were updated by an administrator');
    commit('User saved.');
  } else {
    if (!hasPerm(me(), 'users.manage')) return toast('Only administrators add users.', 'err');
    const pw = tempPassword();
    const nu = Object.assign({ id: uid('u'), active: true, pw: hashPw(pw), mustChange: true, fails: [], lockedUntil: 0, lastLogin: null, prefs: {} }, v);
    S.users.push(nu);
    audit('user.create', 'user', nu.id, null, { username: nu.username, role: nu.role, extraRoles: nu.extraRoles, org: nu.org });
    Store.save(); render(); showTemp(nu, pw);
  }
};
ACT.toggleUser = el => {
  const x = userOf(el.dataset.id);
  if (!confirm((x.active ? 'Deactivate ' : 'Reactivate ') + x.fullName + '?' + (x.active ? ' Their sessions end within one minute.' : ''))) return;
  x.active = !x.active;
  audit(x.active ? 'user.reactivate' : 'user.deactivate', 'user', x.id);
  commit(x.fullName + (x.active ? ' reactivated.' : ' deactivated.'));
};
ACT.unlockUser = el => { const x = userOf(el.dataset.id); x.lockedUntil = 0; x.fails = []; audit('user.unlock', 'user', x.id); commit('Account unlocked.'); };
ACT.resetPw = el => {
  const x = userOf(el.dataset.id);
  if (!confirm('Reset the password for ' + x.fullName + '?')) return;
  const pw = tempPassword();
  x.pw = hashPw(pw); x.mustChange = true; x.lockedUntil = 0; x.fails = [];
  audit('user.passwordReset', 'user', x.id);
  St().requests.filter(r => r.type === 'reset' && r.userId === x.id && r.status === 'Pending').forEach(r => { r.status = 'Done'; });
  notify([x.id], 'Account change', 'Your password was reset by an administrator');
  Store.save(); render(); showTemp(x, pw);
};
ACT.viewAs = el => {
  const x = userOf(el.dataset.id);
  Sess.viewAs = x.id; Sess.readOnly = true; saveSess();
  audit('impersonate.start', 'user', x.id);
  Store.save();
  location.hash = isOversight(x) ? '#/dashboard' : '#/devdash';
  render();
  toast('Viewing as ' + x.fullName + ' (read-only).');
};
ACT.endViewAs = () => { audit('impersonate.end', 'user', Sess.viewAs); Sess.viewAs = null; Sess.readOnly = false; saveSess(); Store.save(); location.hash = '#/users'; render(); };

ACT.exportUsers = () => {
  const S = St();
  const rows = [['Username', 'Full name', 'Organisation', 'Role', 'Job title', 'Email', 'Active', 'Workstreams', 'Last login', 'Edit plan', 'Submit', 'BDIH review', 'BOCRA approve', 'Audit log', 'Admin']];
  S.users.forEach(x => rows.push([x.username, x.fullName, orgName(x.org), roleLabel(x), x.title, x.email, x.active ? 'Yes' : 'No', (wsOf(x) || ['All']).map(w => w === 'All' ? w : wsName(w)).join('; '), x.lastLogin || '', can.editPlan(x) ? 'Yes' : 'No', hasPerm(x, 'submit.deliverable') ? 'Yes' : 'No', can.bdihReview(x) ? 'Yes' : 'No', can.bocraDecide(x) ? 'Yes' : 'No', can.audit(x) ? 'Yes' : 'No', can.admin(x) ? 'Yes' : 'No']));
  audit('export.users', 'users');
  Store.save();
  dl(new Blob([csv(rows)], { type: 'text/csv' }), 'BDIH users and access ' + D.today() + '.csv');
};
ACT.exportAudit = () => {
  const rows = [['When (UTC)', 'User', 'Action', 'Entity', 'Entity ID', 'Before', 'After', 'IP', 'Viewing as']].concat(St().audit.map(x => [x.at, uname(x.user), x.action, x.entity, x.entityId, JSON.stringify(x.before || ''), JSON.stringify(x.after || ''), x.ip, x.viewAs ? uname(x.viewAs) : '']));
  audit('export.audit', 'audit');
  Store.save();
  dl(new Blob([csv(rows)], { type: 'text/csv' }), 'BDIH audit log ' + D.today() + '.csv');
};

ACT.resourceModal = el => {
  const S = St(), r = el.dataset.id ? resOf(el.dataset.id) : { name: '', org: 'BDIH', linkedUser: '', description: '' };
  modal(el.dataset.id ? 'Edit resource' : 'Add resource', `<form data-form="resource" class="fgrid"><input type="hidden" name="id" value="${r.id || ''}">${fld('Name', inp('name', r.name, 'text', 'required'))}${fld('Organisation', sel('org', S.orgs.map(o => [o.id, o.name]), r.org))}${fld('Linked user', sel('linkedUser', [['', 'None']].concat(userOpts()), r.linkedUser || ''))}${fld('Description', inp('description', r.description))}<div class="span2"><button class="btn">Save</button></div></form>`);
};
FORM.resource = fd => {
  const S = St(), id = fd.get('id');
  const v = { name: fd.get('name').trim(), org: fd.get('org'), linkedUser: fd.get('linkedUser') || null, description: fd.get('description') };
  if (id) Object.assign(resOf(id), v); else S.resources.push(Object.assign({ id: uid('R') }, v));
  audit('resource.' + (id ? 'update' : 'create'), 'resource', id, null, v);
  commit('Resource saved.');
};
CHG.wsOwner = el => { const w = St().workstreams.find(x => x.id === el.dataset.id); const b = w.owner; w.owner = el.value; audit('workstream.update', 'workstream', w.id, { owner: b }, { owner: w.owner }); commit('Workstream owner changed.'); };

FORM.lookup = fd => {
  const k = fd.get('k'), vals = String(fd.get('v')).split('\n').map(s => s.trim()).filter(Boolean);
  if (!vals.length) return toast('A list needs at least one value.', 'err');
  const before = St().lookups[k];
  St().lookups[k] = vals;
  audit('lookup.update', 'lookups', k, before, vals);
  commit('List saved.');
};
FORM.settings = fd => {
  const S = St(), s = S.settings, before = Object.assign({}, s);
  if (!can.editSettings(me())) return toast('Not allowed.', 'err');
  const n = { projectStart: fd.get('projectStart'), contractMonths: +fd.get('contractMonths'), bdihReviewDays: +fd.get('bdihReviewDays'), bocraReviewDays: +fd.get('bocraReviewDays'), weeklyReportDay: +fd.get('weeklyReportDay'), thrOnTrack: +fd.get('thrOnTrack'), thrAtRisk: +fd.get('thrAtRisk'),
    appName: String(fd.get('appName') || '').trim(), projectName: String(fd.get('projectName') || '').trim(), appSubtitle: String(fd.get('appSubtitle') || '').trim(),
    vatRate: Math.max(0, Math.min(50, +fd.get('vatRate'))), idleMinutes: Math.max(5, +fd.get('idleMinutes') || 30), sessionHours: Math.max(1, +fd.get('sessionHours') || 12),
    lockoutAttempts: Math.max(3, +fd.get('lockoutAttempts') || 5), lockoutMinutes: Math.max(1, +fd.get('lockoutMinutes') || 15), passwordMinLength: Math.max(8, +fd.get('passwordMinLength') || 12),
    escalationDays: Math.max(1, +fd.get('escalationDays') || 3),
    turnstileSiteKey: String(fd.get('turnstileSiteKey') || '').trim(), turnstileEnabled: !!fd.get('turnstileEnabled'), dailyDownloadLimit: Math.max(0, Math.round(+fd.get('dailyDownloadLimit') || 0)) };
  if (n.thrAtRisk > n.thrOnTrack) return toast('The At risk threshold must be below the On track threshold.', 'err');
  Object.assign(s, n);
  audit('settings.update', 'settings', null, before, n);
  commit('Settings saved. All activities rescheduled.');
};
FORM.festive = fd => {
  const s = St().settings, a = fd.get('festiveStart'), b = fd.get('festiveEnd');
  if (a && b && a > b) return toast('The closure must end on or after it starts.', 'err');
  const before = { festiveStart: s.festiveStart, festiveEnd: s.festiveEnd };
  s.festiveStart = a; s.festiveEnd = b;
  audit('calendar.festive', 'settings', null, before, { festiveStart: a, festiveEnd: b });
  commit('Festive closure saved. All affected activities rescheduled.');
};
FORM.holiday = fd => {
  const S = St(), d = fd.get('date');
  if (S.holidays.some(h => h.date === d)) return toast('That date is already a holiday.', 'err');
  S.holidays.push({ date: d, reason: fd.get('reason').trim() });
  audit('calendar.holiday.add', 'closure_days', d);
  commit('Holiday added. Schedule updated.');
};
ACT.removeHoliday = el => { const S = St(); S.holidays = S.holidays.filter(h => h.date !== el.dataset.d); audit('calendar.holiday.remove', 'closure_days', el.dataset.d); commit('Holiday removed. Schedule updated.'); };

/* ---------- Notifications ---------- */

ACT.readAll = () => { St().notifications.filter(n => n.user === me().id).forEach(n => { n.read = n.read || D.now(); }); commit(); };
ACT.openNote = el => {
  const n = St().notifications.find(x => x.id === el.dataset.id);
  if (n && !Sess.readOnly) { n.read = n.read || D.now(); Store.save(); }
  location.hash = n && n.link ? n.link : '#/notifications';
  render();
};

// Timers, reminders and escalations raised once each (FR-REV-07, FR-WKR-03, FR-MTG-02, FR-RSK-05)
function runChecks() {
  const S = St(), cal = S._cal, today = D.today(), ti = cal.floor(today);
  let changed = false;
  const once = k => { if (S.flags[k]) return false; S.flags[k] = 1; changed = true; return true; };
  S.reviews.filter(r => !r.decidedAt).forEach(r => {
    const s = S.submissions.find(x => x.id === r.submissionId), a = s && actOf(s.activityId);
    if (!a) return;
    const left = cal.ceil(r.due) - ti, ent = Object.assign(entOf(a), { link: '#/submissions?tab=' + r.stage.toLowerCase() });
    if (left === 1 && once('due1:' + r.id)) notify([r.reviewer], 'Review due tomorrow', `${r.stage} review due tomorrow: ${a.name}`, ent);
    if (left < 0 && once('over:' + r.id)) notify([r.reviewer].concat(usersWith('BDIH_LEAD'), r.stage === 'BOCRA' ? usersWith('BOCRA_REP') : []), 'Review overdue', `${r.stage} review overdue: ${a.name} (due ${D.nice(r.due)})`, ent);
  });
  ['A', 'B'].forEach(ws => weeklyStatus(ws).forEach(w => {
    if (w.status === 'Late' && once('wk:' + ws + w.we)) {
      notify(devLeads(ws), 'Weekly report overdue', `Weekly report overdue: week ending ${D.nice(w.we)}`, { ws, link: '#/weekly' });
      notify(usersWith('BDIH_LEAD'), 'Weekly report overdue', `${wsName(ws)} weekly report overdue: week ending ${D.nice(w.we)}`, { ws, link: '#/weekly?ws=' + ws });
    }
  }));
  S.actions.filter(x => x.status !== 'Done' && x.due <= today).forEach(x => { if (once('act:' + x.id)) notify([x.owner], 'Action due', 'Action due: ' + x.text, { ws: x.ws, visibleToDevs: x.visibleToDevs, link: '#/tasks' }); });
  S.activities.filter(a => !a.deleted && health(a, ti) === 'Late').forEach(a => { if (once('late:' + a.id)) notify([resUser(a.lead)], 'Activity late', 'Activity late: ' + a.name, entOf(a)); });
  [['risks', 'due'], ['issues', 'target']].forEach(([k, f]) => S[k].forEach(it => {
    if (['Closed', 'Resolved'].includes(it.status) || !it[f]) return;
    const over = ti - cal.ceil(it[f]);
    if (over <= 0) return;
    const lvl = Math.floor((over - 1) / 3);
    if (once('esc:' + it.id + ':' + lvl)) {
      const to = lvl === 0 ? (it.ws === 'S' ? usersWith('BDIH_LEAD') : devLeads(it.ws)) : lvl === 1 ? usersWith('BDIH_LEAD') : usersWith('BOCRA_REP', 'BDIH_LEAD');
      notify(to.concat([it.owner]), 'Escalation', `Escalated (${k.slice(0, -1)} past target): ${it.title}`, { ws: it.ws, visibleToDevs: it.visibleToDevs, link: '#/registers?tab=' + k });
    }
  }));
  if (changed) Store.save();
}

/* ---------- Boot ---------- */

Store.load();
St()._errors = runSchedule(St());
loadSess();
if (Sess.userId && !Sess.period) Sess.period = defaultPeriod();
if (Sess.userId) runChecks();
render();
probeLogos(() => { if (Object.values(LOGO_FILES).some(Boolean)) render(); });
setInterval(() => { if (Sess.userId) runChecks(); }, 5 * 60e3);
