'use strict';
/* Screens (SRS section 7). Every list is filtered through canSeeItem() so a developer never
   receives the other developer's rows, combined totals or hidden shared items. */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s, r) => (r || document).querySelector(s);
const St = () => Store.state;
// Read-only when an administrator is viewing as someone else, and always for the BDIH Director
const RO = () => !!(Sess && (Sess.readOnly || isViewer(me())));
let Sess = null;
let Ctx = {};

const me = () => St().users.find(u => u.id === (Sess.viewAs || Sess.userId));
const realMe = () => St().users.find(u => u.id === Sess.userId);
const userOf = id => St().users.find(u => u.id === id);
const uname = id => (userOf(id) || {}).fullName || 'Unassigned';
const resOf = id => St().resources.find(r => r.id === id);
const rname = id => (resOf(id) || {}).name || '';
const actOf = id => St()._by.get(id);
const wsName = id => (St().workstreams.find(w => w.id === id) || {}).name || id;
const orgName = id => (St().orgs.find(o => o.id === id) || {}).name || id;
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');
const clamp = v => Math.max(0, Math.min(100, +v || 0));
const pc = v => Math.round(v || 0) + '%';
const sdi = () => St()._cal.floor(Sess.period.end);
const visActs = u => St().activities.filter(a => !a.deleted && canSeeItem(u, a));
const num = a => Ctx.num.get(a.id) || '';
const actLink = a => `<a href="#/activity/${a.id}">${esc(a.name)}</a>`;
const bytes = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

const hb = h => `<span class="hb h-${slug(h)}">${esc(h)}</span>`;
const stb = s => `<span class="st s-${slug(s)}">${esc(s)}</span>`;
const perfB = s => `<span class="hb p-${slug(s)}">${esc(s)}</span>`;
const wsTag = ws => `<span class="ws ws-${ws}">${esc(wsName(ws))}</span>`;
function bar(actual, planned) {
  return `<div class="bar" role="img" aria-label="Actual ${pc(actual)}, planned ${pc(planned)}"><i style="width:${clamp(actual)}%"></i>${planned != null ? `<b style="left:${clamp(planned)}%" title="Planned ${pc(planned)}"></b>` : ''}</div>`;
}
function bdLeft(due) { const c = St()._cal; return c.ceil(due) - c.floor(D.today()); }
function timer(due) {
  const n = bdLeft(due);
  const cls = n < 0 ? 'over' : n <= 1 ? 'warn' : 'ok';
  const t = n < 0 ? `Overdue by ${-n} business day${n === -1 ? '' : 's'}` : n === 0 ? 'Due today' : `${n} business day${n === 1 ? '' : 's'} left`;
  return `<span class="timer ${cls}">${t}</span>`;
}
function table(heads, rows, empty) {
  if (!rows.length) return `<p class="empty">${empty || 'Nothing to show.'}</p>`;
  return `<div class="tw"><table class="tbl"><thead><tr>${heads.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}
const tr = cells => `<tr>${cells.map(c => `<td>${c ?? ''}</td>`).join('')}</tr>`;
const fld = (label, input, cls) => `<label class="f ${cls || ''}"><span>${label}</span>${input}</label>`;
const inp = (name, val, type, attrs) => `<input name="${name}" type="${type || 'text'}" value="${esc(val ?? '')}" ${attrs || ''}>`;
const ta = (name, val, attrs) => `<textarea name="${name}" rows="3" ${attrs || ''}>${esc(val ?? '')}</textarea>`;
function sel(name, opts, val, attrs) {
  return `<select name="${name}" ${attrs || ''}>${opts.map(o => {
    const [v, t] = Array.isArray(o) ? o : [o, o];
    return `<option value="${esc(v)}" ${String(v) === String(val ?? '') ? 'selected' : ''}>${esc(t)}</option>`;
  }).join('')}</select>`;
}
function wsOptions(u, withShared) {
  const ws = isOversight(u) ? St().workstreams.filter(w => withShared || w.id !== 'S') : St().workstreams.filter(w => wsOf(u).includes(w.id));
  return ws.map(w => [w.id, w.name]);
}
const userOpts = (filter) => St().users.filter(x => x.active && (!filter || filter(x))).map(x => [x.id, x.fullName + ' (' + orgName(x.org).split(' ')[0] + ')']);
const resOpts = () => [['', 'None']].concat(St().resources.map(r => [r.id, r.name]));
const tabs = (items, cur) => `<nav class="tabs" role="tablist">${items.map(([k, t, href]) => `<a href="${href}" role="tab" aria-selected="${k === cur}" class="${k === cur ? 'on' : ''}">${t}</a>`).join('')}</nav>`;
const notFound = () => `<div class="card"><h1>Not found</h1><p>This item does not exist or you do not have access to it.</p></div>`;

/* ---------- Shell ---------- */

const NAV = [
  { r: 'dashboard', t: u => isViewer(u) ? 'Director view' : 'Dashboard', show: isOversight },
  { r: 'devdash', t: u => isOversight(u) ? 'Developer dashboards' : 'My dashboard' },
  { r: 'tasks', t: 'My tasks', show: u => !isViewer(u) },
  { r: 'schedule', t: 'Project plan' },
  { r: 'submissions', t: 'Submissions' },
  { r: 'invoices', t: 'Invoices' },
  { r: 'documents', t: 'Documents' },
  { r: 'bank', t: 'Document bank' },
  { r: 'weekly', t: 'Weekly reports' },
  { r: 'reports', t: 'Reports' },
  { r: 'registers', t: 'Registers' },
  { r: 'meetings', t: 'Meetings' },
  { r: 'resources', t: 'Resource loading', show: isOversight },
  { r: 'people', t: 'People' },
  { r: 'notifications', t: 'Notifications' },
  { r: 'users', t: 'User management', show: u => hasPerm(u, 'users.manage') },
  { r: 'admin', t: 'Administration', show: u => can.admin(u) }
];

function shell(route, body) {
  const u = Ctx.u;
  const unread = St().notifications.filter(n => n.user === u.id && !n.read).length;
  const nav = NAV.filter(n => !n.show || n.show(u)).map(n => {
    const t = typeof n.t === 'function' ? n.t(u) : n.t;
    const on = route === n.r || (route === 'activity' && n.r === 'schedule');
    return `<a href="#/${n.r}" class="${on ? 'on' : ''}" ${on ? 'aria-current="page"' : ''}>${t}${n.r === 'notifications' && unread ? `<b class="pill">${unread}</b>` : ''}</a>`;
  }).join('');
  const initials = u.fullName.split(' ').map(x => x[0]).join('').slice(0, 2);
  return `<div class="layout">
  <aside class="side" id="side">
   <a class="brand" href="#/" aria-label="Home">${bihLogo('brand-logo')}</a>
   <p class="brand-sub">${esc(brand().app)}<span>${esc(brand().sub)}</span></p>
   <nav aria-label="Main">${nav}</nav>
   <div class="side-foot"><div class="partners">${bocraLogo('p-logo')}${uasfLogo('p-logo')}</div>
    ${window.LIVE ? '' : '<p><button class="link" data-act="resetData">Reset demo data</button></p>'}</div></aside>
  <div class="main">
   <header class="top">
    <button class="icon menu" data-act="menu" aria-label="Open menu"><span></span><span></span><span></span></button>
    <form class="period" data-form="period" aria-label="Reporting period">
      <span class="period-l">Reporting period</span>
      ${inp('start', Sess.period.start, 'date', 'required aria-label="Period start"')}<span class="to">to</span>${inp('end', Sess.period.end, 'date', 'required aria-label="Period end"')}
      <button class="btn sm">Apply</button>
      <span class="sd">Status date <strong>${D.nice(St()._cal.date(sdi()))}</strong></span>
    </form>
    <div class="who">
      <a href="#/notifications" class="bell" aria-label="${unread} unread notifications"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6v3.6L4.3 16h15.4L18 12.6V9a6 6 0 0 0-6-6zm-2.2 15a2.3 2.3 0 0 0 4.4 0"/></svg>${unread ? `<b>${unread}</b>` : ''}</a>
      <a href="#/account" class="me" title="My account"><span class="av">${esc(initials)}</span><span><strong>${esc(u.fullName)}</strong><small>${esc(roleLabel(u))}</small></span></a>
      <button class="btn ghost sm" data-act="logout">Sign out</button>
    </div>
   </header>
   ${Sess.viewAs ? `<div class="ro-banner">Read-only view as <strong>${esc(u.fullName)}</strong> (${esc(roleLabel(u))}). Changes are disabled. <button class="btn sm" data-act="endViewAs">Return to my account</button></div>` : ''}
   ${St()._errors && St()._errors.length ? `<div class="ro-banner err">${St()._errors.map(esc).join('<br>')}</div>` : ''}
   <main id="view" tabindex="-1">${body}</main>
  </div></div>`;
}

function loginView(msg) {
  const demo = St().users.filter(u => u.active).map(u => `<tr><td><button type="button" class="link" data-act="fillLogin" data-u="${esc(u.username)}">${esc(u.username)}</button></td><td>${esc(roleLabel(u))}</td><td>${esc(orgName(u.org).replace('Botswana Communications Regulatory Authority', 'BOCRA').replace('Botswana Digital and Innovation Hub', 'BDIH'))}</td></tr>`).join('');
  return `<div class="login-wrap">
  <section class="login-art" aria-hidden="true">${bihMark('login-arc')}</section>
  <div class="login-card">
   ${bihLogo('login-logo')}
   <h2 class="login-h">Sign in to the ${esc(brand().app)}</h2>
   <form data-form="login" autocomplete="on">
    ${msg ? `<p class="alert" role="alert">${esc(msg)}</p>` : ''}
    ${fld('Username', inp('username', '', 'text', 'required autocomplete="username" autocapitalize="none"'))}
    ${fld('Password', inp('password', '', 'password', 'required autocomplete="current-password"'))}
    ${typeof tsCfg === 'function' && tsCfg().on ? '<div id="cf-ts" class="cf-ts" aria-label="Security check"></div><p id="ts-note" class="small muted" role="status"></p>' : ''}
    <button class="btn block">Sign in</button>
    <p class="small"><button type="button" class="link" data-act="forgotPw">Forgotten your password?</button></p>
    <p class="small muted">By signing in you accept the <button type="button" class="link" data-act="privacy">privacy notice</button>. There is no self-registration; contact a BDIH administrator for an account.</p>
   </form>
   ${window.BDIH_LIVE ? '' : `<details class="demo"><summary>Demo accounts</summary>
    <p class="small">All demo accounts use the password <code>${esc(DEMO_PASSWORD)}</code>. Click a username to fill the form.</p>
    <table class="tbl compact"><thead><tr><th>Username</th><th>Role</th><th>Organisation</th></tr></thead><tbody>${demo}</tbody></table>
   </details>`}
  </div></div>`;
}

function changePwView(forced) {
  return `<div class="login-wrap"><div class="login-card"><h1>${forced ? 'Set a new password' : 'Change password'}</h1>
   ${forced ? '<p>Your account was created with a temporary password. Set your own password to continue.</p>' : ''}
   <form data-form="changePw">
    ${fld('Current password', inp('current', '', 'password', 'required autocomplete="current-password"'))}
    ${fld('New password', inp('pw1', '', 'password', 'required minlength="12" autocomplete="new-password"'))}
    ${fld('Confirm new password', inp('pw2', '', 'password', 'required minlength="12" autocomplete="new-password"'))}
    <p class="small muted">At least 12 characters with at least one letter and one digit. Common passwords are rejected.</p>
    <button class="btn block">Save password</button>
    ${forced ? '<button type="button" class="btn ghost block" data-act="logout">Sign out</button>' : ''}
   </form></div></div>`;
}

const VIEWS = {};

/* ---------- Dashboards (FR-DSH) ---------- */

function wsStats(ws) {
  const S = St(), i = sdi();
  const acts = S.activities.filter(a => !a.deleted && a.ws === ws);
  const w = weighted(acts, i), p = perfStatus(w.actual, w.planned, S.settings);
  const hs = new Map(acts.map(a => [a.id, health(a, i)]));
  const work = acts.filter(a => a.type !== 'Meeting');
  const subs = acts.filter(a => a.submittable);
  const open = work.filter(a => !isDone(a) && a.status !== 'Cancelled').sort((a, b) => a._si - b._si);
  const key = k => acts.find(a => a.key === k);
  return Object.assign({ acts, hs }, w, p, {
    late: acts.filter(a => hs.get(a.id) === 'Late'), behind: acts.filter(a => hs.get(a.id) === 'Behind'),
    complete: work.filter(isDone).length, total: work.length,
    phase: (open[0] || {}).phase || 'Complete',
    nextMs: acts.filter(a => a.type === 'Milestone' && !isDone(a)).sort((a, b) => a._fi - b._fi)[0],
    p1: key(ws + '-M1'), p2: key(ws + '-M2'), comm: key(ws + '-COMM'),
    subsDone: subs.filter(isDone).length, subsTotal: subs.length,
    nextDue: subs.filter(a => !isDone(a)).sort((a, b) => a._fi - b._fi)[0],
    inProg: acts.filter(a => a.type !== 'Meeting' && !isDone(a) && a.status !== 'Cancelled' && (a.actualStart || (a._si <= i && a._fi >= i))),
    upcoming: acts.filter(a => !isDone(a) && !a.actualStart && a._si > i && a._si <= i + 10).sort((a, b) => a._si - b._si)
  });
}
function blFinish(a) { const bl = currentBaseline(St()); return a && bl && bl.items[a.id] ? bl.items[a.id].finish : null; }
function slipTxt(a) { const s = slipOf(St(), a); return s == null ? 'n/a' : s === 0 ? 'On baseline' : (s > 0 ? '+' : '') + s + ' business days'; }
function msLine(a) { return a ? `${D.nice(a.finish)} <span class="muted small">baseline ${D.nice(blFinish(a)) || 'n/a'}, ${slipTxt(a)}</span>` : 'n/a'; }

function devPanel(ws, st) {
  const q = h => `#/schedule?ws=${ws}&health=${encodeURIComponent(h)}`;
  return `<section class="card dev-panel ws-${ws}"><header class="ph"><div class="dp-id">${wsLogo(ws, 'dp-logo')}<h2>${esc(wsName(ws))} <small>${esc(orgName(St().workstreams.find(w => w.id === ws).owner))}</small></h2></div>${perfB(st.status)}</header>
  <dl class="kv">
   <dt>Current phase</dt><dd>${esc(phaseName(st.phase) || st.phase)}</dd>
   <dt>Actual and planned</dt><dd>${bar(st.actual, st.planned)}<span class="small">${pc(st.actual)} actual, ${pc(st.planned)} planned</span></dd>
   <dt>Schedule performance</dt><dd>${st.spi == null ? 'n/a' : st.spi.toFixed(2)}</dd>
   <dt>Activities complete</dt><dd><a href="${q('Complete')}">${st.complete} of ${st.total}</a></dd>
   <dt>Late and behind</dt><dd><a href="${q('Late')}" class="${st.late.length ? 'bad' : ''}">${st.late.length} late</a>, <a href="${q('Behind')}" class="${st.behind.length ? 'warnc' : ''}">${st.behind.length} behind</a></dd>
   <dt>Next milestone</dt><dd>${st.nextMs ? actLink(st.nextMs) + ', ' + D.nice(st.nextMs.finish) : 'None outstanding'}</dd>
   <dt>Phase 1 complete</dt><dd>${msLine(st.p1)}</dd>
   <dt>Phase 2 complete</dt><dd>${msLine(st.p2)}</dd>
   <dt>Commissioning</dt><dd><strong>${msLine(st.comm)}</strong></dd>
   <dt>Deliverables approved</dt><dd><a href="#/registers?tab=deliverables&ws=${ws}">${st.subsDone} of ${st.subsTotal}</a></dd>
   <dt>Next deliverable due</dt><dd>${st.nextDue ? actLink(st.nextDue) + ', ' + D.nice(st.nextDue.finish) : 'None'}</dd>
  </dl></section>`;
}

function actList(list, empty) {
  const i = sdi();
  return list.length ? `<ul class="alist">${list.map(a => `<li>${hb(health(a, i))} ${actLink(a)} <span class="muted small">${D.short(a.start)} to ${D.short(a.finish)}, ${a.pct || 0}%</span></li>`).join('')}</ul>` : `<p class="empty">${empty}</p>`;
}

function phaseChart(wss) {
  const i = sdi(), W = 560, lw = 120, bw = 330;
  let y = 4, out = '';
  phaseKeys().forEach(ph => {
    out += `<text x="0" y="${y + 13}" class="ct-h">${esc(phaseName(ph))}</text>`;
    y += 20;
    wss.forEach(ws => {
      const r = weighted(St().activities.filter(a => !a.deleted && a.ws === ws && a.phase === ph), i);
      out += `<text x="8" y="${y + 13}" class="ct">${esc(wsName(ws))}</text>
        <rect x="${lw}" y="${y + 1}" width="${Math.max(1, bw * r.planned / 100)}" height="8" rx="2" class="c-pl"><title>Planned ${pc(r.planned)}</title></rect>
        <rect x="${lw}" y="${y + 11}" width="${Math.max(1, bw * r.actual / 100)}" height="8" rx="2" class="c-ac ws-${ws}"><title>Actual ${pc(r.actual)}</title></rect>
        <text x="${lw + bw + 10}" y="${y + 14}" class="ct">${pc(r.actual)} of ${pc(r.planned)}</text>`;
      y += 24;
    });
    y += 6;
  });
  return `<svg viewBox="0 0 ${W} ${y}" class="chart" role="img" aria-label="Planned against actual percent complete by phase">${out}</svg>
   <p class="legend small"><span class="sw c-pl"></span> Planned <span class="sw c-ac ws-A"></span> Actual, BOCRA website <span class="sw c-ac ws-B"></span> Actual, UASF website</p>`;
}

function openReviews(u) {
  const S = St();
  return S.reviews.filter(r => !r.decidedAt).map(r => {
    const s = S.submissions.find(x => x.id === r.submissionId);
    const a = s && actOf(s.activityId);
    return a && canSeeItem(u, a) ? { r, s, a } : null;
  }).filter(Boolean).sort((x, y) => x.r.due < y.r.due ? -1 : 1);
}
function reviewRows(list) {
  return list.map(({ r, s, a }) => tr([actLink(a) + ` <span class="muted small">v${s.version}</span>`, wsTag(a.ws), r.stage, D.nice(r.due), timer(r.due), `<a href="#/submissions?tab=${r.stage === 'BDIH' ? 'bdih' : 'bocra'}">Open</a>`]));
}

VIEWS.dashboard = () => {
  const u = Ctx.u;
  if (!isOversight(u)) return VIEWS.devdash({}, {});
  const S = St(), i = sdi(), c = S._cal;
  const all = S.activities.filter(a => !a.deleted);
  const w = weighted(all, i), p = perfStatus(w.actual, w.planned, S.settings);
  const A = wsStats('A'), B = wsStats('B');
  const ce = contractEnd(S);
  const beyond = x => x ? Math.max(0, x._fi - c.ceil(ce)) : 0;
  const maxBeyond = Math.max(beyond(A.comm), beyond(B.comm));
  const bds = all.filter(a => a.ws === 'S' && a.submittable).sort((a, b) => a._fi - b._fi);
  const nextSC = all.filter(a => a.ws === 'S' && /Steering/.test(a.name) && !isDone(a) && a._fi >= i).sort((a, b) => a._si - b._si)[0];
  const reports = all.filter(a => a.type === 'Report' && !isDone(a)).sort((a, b) => a._si - b._si).slice(0, 3);
  const revs = openReviews(u);
  return `<div class="page-h"><h1>Project dashboard</h1><div class="actions"><button class="btn ghost" data-act="printPage">Export to PDF</button></div></div>
  <section class="kpis">
    <div class="kpi"><span class="l">Overall status</span><span class="v">${perfB(p.status)}</span><span class="s">Schedule performance ${p.spi == null ? 'n/a' : p.spi.toFixed(2)}</span></div>
    <div class="kpi wide"><span class="l">Actual and planned complete</span>${bar(w.actual, w.planned)}<span class="s">${pc(w.actual)} actual, ${pc(w.planned)} planned</span></div>
    <div class="kpi"><span class="l">Forecast commissioning</span><span class="v sm">${A.comm ? D.short(A.comm.finish) : 'n/a'} <small>BOCRA</small></span><span class="v sm">${B.comm ? D.short(B.comm.finish) : 'n/a'} <small>UASF</small></span></div>
    <div class="kpi"><span class="l">Baseline commissioning</span><span class="v sm">${D.short(blFinish(A.comm)) || 'n/a'} <small>BOCRA</small></span><span class="v sm">${D.short(blFinish(B.comm)) || 'n/a'} <small>UASF</small></span></div>
    <div class="kpi"><span class="l">Contract end</span><span class="v sm">${D.nice(ce)}</span></div>
    <div class="kpi ${maxBeyond ? 'alert-k' : ''}"><span class="l">Beyond contract end</span><span class="v">${maxBeyond}</span><span class="s">business days</span></div>
  </section>
  <div class="grid g2">${devPanel('A', A)}${devPanel('B', B)}</div>
  <div class="grid g2">
   <section class="card"><h2>Planned and actual by phase</h2>${phaseChart(['A', 'B'])}</section>
   <section class="card"><h2>Open review timers</h2>${table(['Submission', 'Workstream', 'Stage', 'Due', 'Timer', ''], reviewRows(revs), 'No reviews open.')}</section>
  </div>
  <div class="grid g2">
   <section class="card"><h2>BOCRA website: late or behind</h2>${actList(A.late.concat(A.behind), 'Nothing late or behind.')}<h3>In progress or due in the next 10 business days</h3>${actList(A.inProg.concat(A.upcoming), 'Nothing in progress.')}</section>
   <section class="card"><h2>UASF website: late or behind</h2>${actList(B.late.concat(B.behind), 'Nothing late or behind.')}<h3>In progress or due in the next 10 business days</h3>${actList(B.inProg.concat(B.upcoming), 'Nothing in progress.')}</section>
  </div>
  <section class="card"><h2>Shared: BDIH deliverables and governance</h2>
   <div class="grid g2"><div>${table(['Ref', 'Deliverable', 'Forecast finish', 'Status', 'Health'], bds.map(a => tr([esc(a.deliverableRef), actLink(a), D.nice(a.finish), stb(a.status), hb(health(a, i))])))}</div>
   <div><dl class="kv"><dt>Next Steering Committee</dt><dd>${nextSC ? actLink(nextSC) + ', ' + D.nice(nextSC.start) : 'None scheduled'}</dd>
   ${reports.map(r => `<dt>Report due</dt><dd>${actLink(r)}, ${D.nice(r.finish)}</dd>`).join('')}
   <dt>BDIH deliverables approved</dt><dd>${bds.filter(isDone).length} of ${bds.length}</dd></dl></div></div>
  </section>`;
};

VIEWS.devdash = (p, q) => {
  const u = Ctx.u, S = St(), i = sdi();
  const mine = wsOf(u);
  let ws = mine ? mine[0] : (q.ws || 'A');
  if (mine && q.ws && mine.includes(q.ws)) ws = q.ws;
  const st = wsStats(ws);
  const ms = st.acts.filter(a => a.type === 'Milestone').sort((a, b) => a._fi - b._fi);
  const subs = S.submissions.filter(s => s.ws === ws).sort((a, b) => b.at < a.at ? -1 : 1).slice(0, 6);
  const weeks = weeklyStatus(ws).slice(-4).reverse();
  const head = mine && mine.length === 1 ? '' : tabs((mine ? S.workstreams.filter(w => mine.includes(w.id)) : S.workstreams.filter(w => w.id !== 'S')).map(w => [w.id, w.name, `#/devdash?ws=${w.id}`]), ws);
  return `<div class="page-h"><h1>${esc(wsName(ws))} dashboard</h1><div class="actions"><button class="btn ghost" data-act="printPage">Export to PDF</button></div></div>${head}
  <div class="grid g2">${devPanel(ws, st)}
   <section class="card"><h2>Planned and actual by phase</h2>${phaseChart([ws])}</section></div>
  <div class="grid g2">
   <section class="card"><h2>Milestones</h2>${table(['Milestone', 'Forecast', 'Baseline', 'Slip', 'Health'], ms.map(a => tr([actLink(a), D.nice(a.finish), D.nice(blFinish(a)), slipTxt(a), hb(health(a, i))])))}</section>
   <section class="card"><h2>Submissions and review status</h2>${table(['Deliverable', 'Version', 'Submitted', 'State'], subs.map(s => tr([actLink(actOf(s.activityId)), 'v' + s.version, D.stamp(s.at), stb(s.state)])), 'No submissions yet.')}</section>
  </div>
  <div class="grid g2">
   <section class="card"><h2>Late and behind</h2>${actList(st.late.concat(st.behind), 'Nothing late or behind.')}<h3>In progress and coming up</h3>${actList(st.inProg.concat(st.upcoming), 'Nothing in progress.')}</section>
   <section class="card"><h2>Weekly reports</h2>${table(['Week ending', 'Status'], weeks.map(w => tr([D.nice(w.we), stb(w.status)])), 'No weeks due yet.')}<p><a href="#/weekly" class="btn sm">Go to weekly reports</a></p></section>
  </div>`;
};

/* ---------- My tasks ---------- */

VIEWS.tasks = () => {
  const u = Ctx.u, S = St(), i = sdi();
  const myRes = S.resources.filter(r => r.linkedUser === u.id).map(r => r.id);
  const acts = visActs(u).filter(a => (myRes.includes(a.lead) || myRes.includes(a.support)) && !isDone(a) && a.status !== 'Cancelled' && a.type !== 'Meeting').sort((a, b) => a._fi - b._fi);
  const revs = openReviews(u).filter(x => x.r.reviewer === u.id || (x.r.stage === 'BDIH' && hasRole(u, 'BDIH_LEAD')) || (x.r.stage === 'BOCRA' && hasRole(u, 'BOCRA_REP')));
  const actions = S.actions.filter(x => x.owner === u.id && x.status !== 'Done');
  const subs = visActs(u).filter(a => can.submit(u, a) && ['Not started', 'In progress', 'Returned to developer'].includes(a.status) && a._si <= i + 10);
  return `<h1>My tasks</h1>
  <section class="card"><h2>Activities assigned to me</h2>${table(['ID', 'Activity', 'Finish', 'Progress', 'Status', 'Health'], acts.map(a => tr([num(a), actLink(a), D.nice(a.finish), (a.pct || 0) + '%', stb(a.status), hb(health(a, i))])), 'No open activities are assigned to you.')}</section>
  <section class="card"><h2>Reviews waiting for me</h2>${table(['Submission', 'Workstream', 'Stage', 'Due', 'Timer', ''], reviewRows(revs), 'No reviews waiting.')}</section>
  ${subs.length ? `<section class="card"><h2>Deliverables I can submit</h2>${table(['Deliverable', 'Planned finish', 'Status', ''], subs.map(a => tr([actLink(a), D.nice(a.finish), stb(a.status), `<button class="btn sm" data-act="submitModal" data-id="${a.id}">Submit</button>`])))}</section>` : ''}
  <section class="card"><h2>Meeting action items</h2>${table(['Action', 'Due', 'Status', ''], actions.map(x => tr([esc(x.text), D.nice(x.due) + (x.due < D.today() ? ' <span class="timer over">Overdue</span>' : ''), stb(x.status), `<button class="btn sm ghost" data-act="actionDone" data-id="${x.id}">Mark done</button>`])), 'No open actions.')}</section>`;
};

/* ---------- Schedule (FR-SCH) ---------- */

function predText(a, u) {
  const out = [];
  (St()._preds.get(a.id) || []).forEach(l => {
    const p = actOf(l.from);
    const t = canSeeItem(u, p) ? `<a href="#/activity/${p.id}">${num(p)}</a>${l.lag ? (l.lag > 0 ? '+' : '') + l.lag : ''}` : '<span class="muted">Waits for BDIH or BOCRA action</span>';
    if (!out.includes(t)) out.push(t);
  });
  return out.join(', ');
}

function filterActs(list, q) {
  const i = sdi();
  if (q.ws) list = list.filter(a => a.ws === q.ws);
  if (q.phase) list = list.filter(a => a.phase === q.phase);
  if (q.res) list = list.filter(a => a.lead === q.res || a.support === q.res);
  if (q.health) list = list.filter(a => health(a, i) === q.health);
  if (q.type) list = list.filter(a => a.type === q.type);
  if (q.crit === '1') list = list.filter(a => a._crit);
  if (q.q) { const s = q.q.toLowerCase(); list = list.filter(a => a.name.toLowerCase().includes(s) || (a.deliverableRef || '').toLowerCase().includes(s)); }
  return list;
}

VIEWS.schedule = (p, q) => {
  const u = Ctx.u, S = St(), i = sdi();
  const list = filterActs(visActs(u), q);
  const view = q.view || 'table';
  const edit = can.editPlan(u);
  const bls = S.baselines.map(b => [b.id, b.name + (b.id === S.settings.currentBaselineId ? ' (current)' : '')]);
  const f = (k, label, opts) => `<label class="f inline"><span>${label}</span>${sel(k, [['', 'All']].concat(opts), q[k] || '', `data-change="qset" data-k="${k}"`)}</label>`;
  const filters = `<div class="filters">
    ${f('ws', 'Workstream', wsOptions(u, true))}
    ${f('phase', 'Phase', phaseKeys())}
    ${isOversight(u) ? f('res', 'Resource', S.resources.map(r => [r.id, r.name])) : ''}
    ${f('health', 'Health', HEALTH)}
    ${f('type', 'Type', TYPES)}
    <label class="f inline"><span>Search</span><input type="search" value="${esc(q.q || '')}" data-change="qset" data-k="q" placeholder="Name or ref"></label>
    <label class="chk"><input type="checkbox" ${q.crit === '1' ? 'checked' : ''} data-change="qtoggle" data-k="crit"> Critical path only</label>
  </div>`;
  const toolbar = `<div class="toolbar">
    ${tabs([['table', 'Table', '#/schedule?' + qs(Object.assign({}, q, { view: 'table' }))], ['gantt', 'Gantt', '#/schedule?' + qs(Object.assign({}, q, { view: 'gantt' }))]].concat(edit ? [['grid', 'Edit grid', '#/schedule?' + qs(Object.assign({}, q, { view: 'grid' }))]] : []), view)}
    ${view === 'gantt' ? `<label class="f inline"><span>Scale</span>${sel('scale', [['day', 'Day'], ['week', 'Week']], q.scale || 'day', 'data-change="qset" data-k="scale"')}</label>` : ''}
    <span class="grow"></span>
    <button class="btn sm ghost" data-act="phasesAll" data-v="1">Collapse phases</button><button class="btn sm ghost" data-act="phasesAll" data-v="0">Expand phases</button>
    ${edit ? `<button class="btn sm" data-act="addDeliverable">Add deliverable</button><button class="btn sm ghost" data-act="addActivity">Insert activity</button><button class="btn sm ghost" data-act="duplicateSel">Duplicate selected</button>` : ''}
    ${can.baseline(u) ? `<button class="btn sm ghost" data-act="baselineModal">Baselines</button>` : ''}
    <button class="btn sm ghost" data-act="exportSchedule">Export to Excel (CSV)</button>
    ${isOversight(u) ? '<button class="btn sm ghost" data-act="exportMsp">Export MS Project XML</button>' : ''}
  </div>`;
  let body;
  if (view === 'grid' && edit) return `<div class="page-h"><h1>Project plan</h1></div>${filters}${toolbar}` + adminPlan(u, q);
  if (view === 'gantt') body = gantt(list.filter(a => !phaseCollapsed(a.phase)), q.scale || 'day');
  else {
    body = table([edit ? '<span class="sr">Select</span>' : '', 'ID', 'Activity', 'Workstream', 'Phase', 'Type', 'Lead', 'Dur', 'Start', 'Finish', 'Baseline finish', 'Slip', 'Predecessors', 'Done', 'Status', 'Health'],
      phaseRows(list, 16, a => {
        const s = slipOf(S, a);
        return `<tr class="${a._crit ? 'crit' : ''} ${a.type === 'Milestone' ? 'ms' : ''}">
        <td>${edit ? `<input type="checkbox" class="selrow" value="${a.id}" aria-label="Select ${esc(a.name)}">` : ''}</td>
        <td class="num">${num(a)}</td>
        <td style="padding-left:${8 + (a.indent || 0) * 18}px">${a.type === 'Milestone' ? '&#9670; ' : ''}${actLink(a)}${a.ws === 'S' && a.visibleToDevs && isOversight(u) ? ' <span class="tag">Visible to developers</span>' : ''}${a._crit ? ' <span class="tag crit">Critical</span>' : ''}</td>
        <td>${wsTag(a.ws)}</td><td>${esc(a.phase)}</td><td>${esc(a.type)}${a.reviewStage ? ' (' + a.reviewStage + ')' : ''}</td><td>${esc(rname(a.lead))}</td>
        <td class="num">${a._dur}</td><td>${D.short(a.start)}</td><td>${D.short(a.finish)}</td><td>${D.short(blFinish(a))}</td>
        <td class="num ${s > 0 ? 'bad' : ''}">${s == null ? '' : (s > 0 ? '+' : '') + s}</td>
        <td class="small">${predText(a, u)}</td>
        <td>${bar(a.pct, plannedPct(a, i))}<span class="small">${a.pct || 0}%</span></td><td>${stb(a.status)}</td><td>${hb(health(a, i))}</td></tr>`;
      }), 'No activities match these filters.');
  }
  return `<div class="page-h"><h1>Project plan</h1><p class="muted">${list.length} activities</p></div>${filters}${toolbar}<div class="card flush">${body}</div>`;
};

function qs(o) { return Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&'); }

function gantt(list, scale) {
  if (!list.length) return '<p class="empty">No activities match these filters.</p>';
  const S = St(), cal = S._cal, i = sdi(), bl = currentBaseline(S);
  const minD = D.add(cal.date(Math.min(...list.map(a => a._si))), -3);
  const maxD = D.add(cal.date(Math.max(...list.map(a => a._fi), i)), 7);
  const pd = scale === 'week' ? 6 : 26, LW = 360, RH = 30, HH = 44;
  const days = D.diff(minD, maxD) + 1, W = LW + days * pd, H = HH + list.length * RH + 6;
  const x = d => LW + D.diff(minD, d) * pd;
  const g = [];
  for (let k = 0; k < days; k++) {
    const d = D.add(minD, k), w = D.dow(d), cl = cal.closed.get(d);
    if (cl) g.push(`<rect x="${x(d)}" y="${HH}" width="${pd}" height="${H - HH}" class="g-closed"><title>${esc(cl)}, ${D.nice(d)}</title></rect>`);
    else if (scale === 'day' && (w === 0 || w === 6)) g.push(`<rect x="${x(d)}" y="${HH}" width="${pd}" height="${H - HH}" class="g-we"/>`);
    if (w === 1) g.push(`<line x1="${x(d)}" x2="${x(d)}" y1="18" y2="${H}" class="g-wk"/><text x="${x(d) + 2}" y="${scale === 'day' ? 16 : 34}" class="g-t">${D.short(d)}</text>`);
    if (scale === 'day') g.push(`<text x="${x(d) + pd / 2}" y="38" class="g-d" text-anchor="middle">${D.parse(d).getUTCDate()}</text>`);
    if (D.parse(d).getUTCDate() === 1 && scale === 'week') g.push(`<text x="${x(d) + 2}" y="14" class="g-t b">${D.month(d)}</text>`);
  }
  const pos = new Map();
  list.forEach((a, r) => {
    const y = HH + r * RH, cy = y + RH / 2;
    if (r % 2) g.push(`<rect x="0" y="${y}" width="${W}" height="${RH}" class="g-stripe"/>`);
    const label = (num(a) + '  ' + a.name);
    g.push(`<a href="#/activity/${a.id}"><text x="${6 + (a.indent || 0) * 10}" y="${cy + 4}" class="g-l">${esc(label.length > 40 ? label.slice(0, 39) + '...' : label)}</text></a>`);
    const h = health(a, i);
    if (a.type === 'Milestone') {
      const mx = x(a.finish) + pd / 2;
      g.push(`<path d="M${mx} ${cy - 7} L${mx + 7} ${cy} L${mx} ${cy + 7} L${mx - 7} ${cy} Z" class="g-ms h-${slug(h)}"><title>${esc(a.name)}: ${D.nice(a.finish)} (${h})</title></path>`);
      pos.set(a.id, { x1: mx - 7, x2: mx + 7, cy });
    } else {
      const x1 = x(a.start), x2 = x(a.finish) + pd;
      g.push(`<rect x="${x1}" y="${cy - 7}" width="${Math.max(3, x2 - x1)}" height="14" rx="2" class="g-bar ${a._crit ? 'crit' : ''} t-${slug(a.type)}"><title>${esc(a.name)}: ${D.nice(a.start)} to ${D.nice(a.finish)}, ${a.pct || 0}% done, ${h}</title></rect>`);
      if (a.pct > 0) {
        const doneEnd = a.pct >= 100 ? x2 : x(cal.date(a._si + Math.max(0, Math.round(a.pct / 100 * a._dur) - 1))) + pd;
        g.push(`<rect x="${x1}" y="${cy - 7}" width="${Math.max(2, doneEnd - x1)}" height="14" rx="2" class="g-done"/>`);
        if ((h === 'Behind' || h === 'Late')) {
          const plEnd = x(cal.date(Math.min(a._fi, a._si + Math.round(plannedPct(a, i) / 100 * a._dur) - 1))) + pd;
          if (plEnd > doneEnd) g.push(`<rect x="${doneEnd}" y="${cy - 7}" width="${plEnd - doneEnd}" height="14" class="g-behind"><title>Behind plan</title></rect>`);
        }
      } else if (h === 'Late' || h === 'Behind') {
        const plEnd = x(cal.date(Math.min(a._fi, i))) + pd;
        g.push(`<rect x="${x1}" y="${cy - 7}" width="${Math.max(0, plEnd - x1)}" height="14" class="g-behind"><title>Behind plan</title></rect>`);
      }
      pos.set(a.id, { x1, x2, cy });
    }
    const b = bl && bl.items[a.id];
    if (b && b.finish) {
      const bx1 = x(b.start), bx2 = x(b.finish) + pd;
      g.push(`<rect x="${bx1}" y="${cy + 8}" width="${Math.max(2, bx2 - bx1)}" height="3" class="g-bl"><title>Baseline ${D.nice(b.start)} to ${D.nice(b.finish)}</title></rect>`);
    }
  });
  list.forEach(a => (S._preds.get(a.id) || []).forEach(l => {
    const P = pos.get(l.from), A = pos.get(a.id);
    if (!P || !A) return;
    const mid = Math.max(P.x2 + 6, Math.min(A.x1 - 4, P.x2 + 6));
    g.push(`<path d="M${P.x2} ${P.cy} H${mid} V${A.cy} H${A.x1 - 1}" class="g-link" marker-end="url(#arr)"/>`);
  }));
  const sx = x(cal.date(i)) + pd;
  g.push(`<line x1="${sx}" x2="${sx}" y1="${HH - 4}" y2="${H}" class="g-sd"/><text x="${sx + 3}" y="${HH - 6}" class="g-t sd">Status date</text>`);
  return `<div class="gantt-wrap"><svg width="${W}" height="${H}" role="img" aria-label="Gantt chart of ${list.length} activities">
   <defs><marker id="arr" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L6 3 L0 6 Z" class="g-arr"/></marker>
   <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" class="g-hatch"/></pattern></defs>
   <rect x="0" y="0" width="${LW}" height="${H}" class="g-left"/>${g.join('')}</svg></div>
   <p class="legend small"><span class="sw g-done"></span> Done <span class="sw g-bar"></span> Remaining <span class="sw g-behind"></span> Behind plan <span class="sw g-bl"></span> Baseline <span class="sw g-closed"></span> Closure day <span class="sw crit-sw"></span> Critical</p>`;
}

/* ---------- Activity detail ---------- */

function allowedStatuses(u, a) {
  if (hasPerm(u, 'progress.any')) return STATUSES;
  const base = ['Not started', 'In progress'];
  if (!a.submittable) base.push('Complete');
  if (!base.includes(a.status)) base.unshift(a.status);
  return base;
}

VIEWS.activity = ([id]) => {
  const u = Ctx.u, S = St(), a = actOf(id);
  if (!a || !canSeeItem(u, a)) return notFound();
  const i = sdi(), h = health(a, i), edit = can.editPlan(u), prog = can.progress(u, a);
  const forA = a.forId && actOf(a.forId);
  const linkRow = (l, other, dir) => {
    if (!canSeeItem(u, other)) return tr([dir === 'p' ? 'Waits for BDIH or BOCRA action' : 'Followed by BDIH or BOCRA action', '', '', '', '']);
    return tr([`${num(other)} ${actLink(other)}`, l.type, l.lag || 0, D.nice(dir === 'p' ? other.finish : other.start), edit ? `<button class="btn sm ghost" data-act="removeLink" data-id="${l.id}">Remove</button>` : '']);
  };
  const preds = (S._preds.get(a.id) || []).map(l => linkRow(l, actOf(l.from), 'p'));
  const succs = (S._succs.get(a.id) || []).map(l => linkRow(l, actOf(l.to), 's'));
  const subs = S.submissions.filter(s => s.activityId === a.id).sort((x, y) => y.version - x.version);
  const docs = S.documents.filter(d => !d.deleted && d.entityType === 'activity' && d.entityId === a.id && canSeeItem(u, d));
  const hist = S.history.filter(x => x.activityId === a.id).sort((x, y) => y.at < x.at ? -1 : 1);
  const comments = S.comments.filter(c => c.entityType === 'activity' && c.entityId === a.id).sort((x, y) => x.at < y.at ? -1 : 1);
  const openSub = subs.find(s => s.state.startsWith('Under'));
  const canSub = can.submit(u, a) && !openSub && !isDone(a);
  return `<div class="page-h"><div><p class="crumb"><a href="#/schedule">Schedule</a> / ${wsTag(a.ws)}</p>
   <h1>${num(a)}. ${esc(a.name)}</h1><p>${stb(a.status)} ${hb(h)} ${a._crit ? '<span class="tag crit">Critical path</span>' : ''} ${a.deliverableRef ? `<span class="tag">${esc(a.deliverableRef)}</span>` : ''}</p></div>
   <div class="actions">
    ${canSub ? `<button class="btn" data-act="submitModal" data-id="${a.id}">Submit deliverable</button>` : ''}
    ${edit ? `<button class="btn ghost" data-act="editActivity" data-id="${a.id}">Edit</button>
      <button class="btn ghost icon" data-act="moveAct" data-dir="-1" data-id="${a.id}" title="Move up" aria-label="Move up">&#8593;</button>
      <button class="btn ghost icon" data-act="moveAct" data-dir="1" data-id="${a.id}" title="Move down" aria-label="Move down">&#8595;</button>
      <button class="btn ghost icon" data-act="indentAct" data-dir="-1" data-id="${a.id}" title="Outdent" aria-label="Outdent">&#8676;</button>
      <button class="btn ghost icon" data-act="indentAct" data-dir="1" data-id="${a.id}" title="Indent" aria-label="Indent">&#8677;</button>
      <button class="btn ghost danger" data-act="deleteAct" data-id="${a.id}">Delete</button>` : ''}
   </div></div>
  <div class="grid g2">
   <section class="card"><h2>Details</h2><dl class="kv">
    <dt>Phase</dt><dd>${esc(phaseName(a.phase) || a.phase)}</dd>
    <dt>Type</dt><dd>${esc(a.type)}${a.reviewStage ? ', ' + a.reviewStage + ' review (' + a._dur + ' business days from settings)' : ''}</dd>
    ${forA ? `<dt>Reviews</dt><dd>${actLink(forA)}</dd>` : ''}
    <dt>Lead resource</dt><dd>${esc(rname(a.lead)) || 'None'}</dd>
    <dt>Support resource</dt><dd>${esc(rname(a.support)) || 'None'}</dd>
    <dt>Duration</dt><dd>${a._dur} business days</dd>
    <dt>Scheduled</dt><dd>${D.nice(a.start)} to ${D.nice(a.finish)}${a.fixedStart ? ' <span class="tag">Fixed start ' + D.short(a.fixedStart) + '</span>' : ''}</dd>
    <dt>Baseline</dt><dd>${blFinish(a) ? D.nice(currentBaseline(S).items[a.id].start) + ' to ' + D.nice(blFinish(a)) + ', ' + slipTxt(a) : 'Not in baseline'}</dd>
    <dt>Actual</dt><dd>${a.actualStart ? D.nice(a.actualStart) : 'Not started'}${a.actualFinish ? ' to ' + D.nice(a.actualFinish) : ''}</dd>
    <dt>Progress</dt><dd>${bar(a.pct, plannedPct(a, i))}<span class="small">${a.pct || 0}% done, ${plannedPct(a, i)}% planned at the status date</span></dd>
    <dt>Total float</dt><dd>${a._float} business days</dd>
    ${a.ws === 'S' && isOversight(u) ? `<dt>Visible to developers</dt><dd>${a.visibleToDevs ? 'Yes' : 'No'}</dd>` : ''}
    <dt>Notes</dt><dd>${esc(a.notes) || '<span class="muted">None</span>'}</dd>
   </dl></section>
   <section class="card"><h2>Update progress</h2>${prog && !RO() ? `<form data-form="progress" class="fgrid">
     <input type="hidden" name="id" value="${a.id}">
     ${fld('% done', inp('pct', a.pct || 0, 'number', 'min="0" max="100" step="5"'))}
     ${fld('Status', sel('status', allowedStatuses(u, a), a.status))}
     ${fld('Actual start', inp('actualStart', a.actualStart, 'date'))}
     ${fld('Actual finish', inp('actualFinish', a.actualFinish, 'date'))}
     ${fld('Progress note or reason', ta('note', ''), 'span2')}
     <div class="span2"><button class="btn">Save progress</button> <span class="small muted">A reason is required for On hold, Cancelled and Returned. Complete needs an actual finish.</span></div>
    </form>` : '<p class="muted">You can view this activity but not update its progress.</p>'}</section>
  </div>
  <div class="grid g2">
   <section class="card"><h2>Predecessors</h2>${table(['Activity', 'Link', 'Lag', 'Finish', ''], preds, 'No predecessors.')}
    ${edit ? `<form data-form="addLink" class="inline-form"><input type="hidden" name="to" value="${a.id}">
     ${fld('Add predecessor', sel('from', visActs(u).filter(x => x.id !== a.id).map(x => [x.id, num(x) + '. ' + x.name])))}
     ${fld('Type', sel('type', [['FS', 'Finish to start'], ['SS', 'Start to start (Could)'], ['FF', 'Finish to finish (Could)']], 'FS'))}
     ${fld('Lag (bd)', inp('lag', 0, 'number', 'step="1"'))}<button class="btn sm">Add link</button></form>` : ''}</section>
   <section class="card"><h2>Successors</h2>${table(['Activity', 'Link', 'Lag', 'Start', ''], succs, 'No successors.')}</section>
  </div>
  ${a.submittable ? `<section class="card"><h2>Submissions and reviews</h2>${subHistory(subs)}</section>` : ''}
  <section class="card"><div class="ph"><h2>Documents</h2>${!RO() ? `<button class="btn sm" data-act="uploadModal" data-entity="activity" data-eid="${a.id}" data-ws="${a.ws}">Upload</button>` : ''}</div>${docTable(docs, u)}</section>
  <div class="grid g2">
   <section class="card"><h2>Comments</h2>
    ${comments.map(c => `<div class="comment"><strong>${esc(uname(c.author))}</strong> <span class="muted small">${D.stamp(c.at)}</span><p>${esc(c.body).replace(/@([a-z0-9._]+)/gi, '<span class="mention">@$1</span>')}</p></div>`).join('') || '<p class="empty">No comments yet.</p>'}
    <form data-form="comment"><input type="hidden" name="id" value="${a.id}">${fld('Add a comment (use @username to mention)', ta('body', '', 'required'))}<button class="btn sm">Post comment</button></form>
   </section>
   <section class="card"><h2>History</h2>${table(['When', 'Who', 'Field', 'Change', 'Comment'], hist.slice(0, 40).map(x => tr([D.stamp(x.at), esc(uname(x.by)), esc(x.field), `${esc(x.old ?? '')} &#8594; ${esc(x.new ?? '')}`, esc(x.comment || '') + (x.correction ? ' <span class="tag crit">Correction after lock</span>' : '')])), 'No changes recorded.')}</section>
  </div>`;
};

function subHistory(subs) {
  if (!subs.length) return '<p class="empty">Nothing submitted yet.</p>';
  const S = St();
  return subs.map(s => {
    const revs = S.reviews.filter(r => r.submissionId === s.id);
    return `<div class="subv"><div class="ph"><h3>Version ${s.version} ${stb(s.state)}</h3><span class="muted small">Submitted by ${esc(uname(s.by))}, ${D.stamp(s.at)}</span></div>
     <p>${esc(s.coverNote)}</p>
     <p class="small">Files: ${(s.docIds || []).map(id => { const d = S.documents.find(x => x.id === id); return d ? `<button class="link" data-act="download" data-id="${d.id}">${esc(d.title)}</button>` : ''; }).join(', ') || 'None'}</p>
     ${revs.map(r => `<div class="rev"><strong>${r.stage} review</strong> by ${esc(uname(r.reviewer))}, due ${D.nice(r.due)}: ${r.outcome ? stb(r.outcome) + ' on ' + D.stamp(r.decidedAt) : timer(r.due)}
       ${r.findings ? `<p>${esc(r.findings)}</p>` : ''}
       ${r.checklist ? `<ul class="check">${St().lookups.checklist.map((c, k) => `<li class="${r.checklist[k] ? 'y' : 'n'}">${r.checklist[k] ? 'Met' : 'Not met'}: ${esc(c)}</li>`).join('')}</ul>` : ''}</div>`).join('')}</div>`;
  }).join('');
}

/* ---------- Submissions (FR-REV) ---------- */

VIEWS.submissions = (p, q) => {
  const u = Ctx.u, S = St();
  const tab = q.tab || 'bdih';
  const states = { bdih: ['Under BDIH review'], bocra: ['Under BOCRA review'], returned: ['Returned'], approved: ['Approved'] };
  const latest = new Map();
  S.submissions.forEach(s => { const cur = latest.get(s.activityId); if (!cur || cur.version < s.version) latest.set(s.activityId, s); });
  const list = [...latest.values()].filter(s => canSeeItem(u, actOf(s.activityId)) && (tab === 'all' || states[tab].includes(s.state))).sort((a, b) => a.at < b.at ? 1 : -1);
  const count = k => [...latest.values()].filter(s => canSeeItem(u, actOf(s.activityId)) && states[k].includes(s.state)).length;
  const rows = list.map(s => {
    const a = actOf(s.activityId);
    const r = S.reviews.filter(x => x.submissionId === s.id && !x.decidedAt)[0];
    let btn = '';
    if (r && r.stage === 'BDIH' && can.bdihReview(u)) btn = `<button class="btn sm" data-act="reviewModal" data-id="${r.id}">Record recommendation</button>`;
    if (r && r.stage === 'BOCRA' && can.bocraDecide(u)) btn = `<button class="btn sm" data-act="decideModal" data-id="${r.id}">Approve or return</button>`;
    if (s.state === 'Returned' && can.submit(u, a)) btn = `<button class="btn sm" data-act="submitModal" data-id="${a.id}">Resubmit</button>`;
    return tr([actLink(a), wsTag(a.ws), 'v' + s.version, esc(uname(s.by)) + '<br><span class="small muted">' + D.stamp(s.at) + '</span>', stb(s.state), r ? D.nice(r.due) + '<br>' + timer(r.due) : '', btn]);
  });
  const subm = visActs(u).filter(a => can.submit(u, a) && ['Not started', 'In progress', 'Returned to developer'].includes(a.status));
  return `<div class="page-h"><h1>Submissions</h1><div class="actions">${subm.length && !RO() ? `<button class="btn" data-act="submitPick">New submission</button>` : ''}</div></div>
  ${tabs([['bdih', `Awaiting BDIH (${count('bdih')})`, '#/submissions?tab=bdih'], ['bocra', `Awaiting BOCRA (${count('bocra')})`, '#/submissions?tab=bocra'], ['returned', `Returned (${count('returned')})`, '#/submissions?tab=returned'], ['approved', `Approved (${count('approved')})`, '#/submissions?tab=approved'], ['all', 'All', '#/submissions?tab=all']], tab)}
  <div class="card flush">${table(['Deliverable', 'Workstream', 'Version', 'Submitted', 'State', 'Review due', ''], rows, 'Nothing in this queue.')}</div>`;
};

/* ---------- Invoices ---------- */

const money = n => 'P ' + (+n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

VIEWS.invoices = (p, q) => {
  const u = Ctx.u, S = St();
  let list = S.invoices.filter(i => can.seeInvoice(u, i));
  const all = list;
  if (q.org) list = list.filter(i => i.org === q.org);
  if (q.status) list = list.filter(i => i.status === q.status);
  list = list.slice().sort((a, b) => a.at < b.at ? 1 : -1);
  const sum = f => all.filter(f).reduce((t, i) => t + i.amount + i.vat, 0);
  const cur = q.id && all.find(i => i.id === q.id);
  const orgs = [...new Set(all.map(i => i.org))];
  const act = i => {
    const b = [`<a class="btn sm ghost" href="#/invoices?${qs(Object.assign({}, q, { id: i.id }))}">Open</a>`];
    if (can.invoiceStatus(u) && !['Paid', 'Rejected'].includes(i.status) && !RO()) b.push(`<button class="btn sm" data-act="invoiceStatus" data-id="${i.id}">Update status</button>`);
    if (i.status === 'Queried' && i.org === u.org && can.invoiceSubmit(u) && !RO()) b.push(`<button class="btn sm" data-act="invoiceResubmit" data-id="${i.id}">Resubmit</button>`);
    if (can.admin(u) && !RO()) b.push(['Paid', 'Rejected'].includes(i.status) ? `<button class="btn sm ghost" data-act="adminInvoice" data-op="reopen" data-id="${i.id}">Reopen</button>` : `<button class="btn sm ghost danger" data-act="adminInvoice" data-op="void" data-id="${i.id}">Void</button>`);
    return `<div class="btns">${b.join('')}</div>`;
  };
  return `<div class="page-h"><div><h1>Invoices</h1></div>
   ${can.invoiceSubmit(u) && !RO() ? '<div class="actions"><button class="btn" data-act="invoiceModal">Submit invoice</button></div>' : ''}</div>
  <section class="ledger">
   <div><span>Submitted, awaiting BOCRA</span><strong>${money(sum(i => ['Submitted', 'Under review'].includes(i.status)))}</strong></div>
   <div><span>Queried</span><strong>${money(sum(i => i.status === 'Queried'))}</strong></div>
   <div><span>Approved for payment</span><strong>${money(sum(i => i.status === 'Approved for payment'))}</strong></div>
   <div><span>Paid</span><strong>${money(sum(i => i.status === 'Paid'))}</strong></div>
  </section>
  <div class="filters">
   ${isOversight(u) ? `<label class="f inline"><span>Submitted by</span>${sel('org', [['', 'All']].concat(orgs.map(o => [o, orgName(o)])), q.org || '', 'data-change="qset" data-k="org"')}</label>` : ''}
   <label class="f inline"><span>Status</span>${sel('status', [['', 'All']].concat(INVOICE_STATUSES), q.status || '', 'data-change="qset" data-k="status"')}</label>
  </div>
  <div class="card flush">${table(['Invoice', 'From', 'Workstream', 'Date', 'Excl. VAT', 'VAT', 'Total', 'Status', ''], list.map(i => tr([
    `<strong>${esc(i.no)}</strong><br><span class="small muted">${esc(i.description)}</span>`, esc(orgName(i.org)), wsTag(i.ws), D.nice(i.date),
    `<span class="num">${money(i.amount)}</span>`, `<span class="num">${money(i.vat)}</span>`, `<strong class="num">${money(i.amount + i.vat)}</strong>`,
    stb(i.status) + (i.comment && ['Queried', 'Rejected'].includes(i.status) ? `<br><span class="small">${esc(i.comment)}</span>` : ''), act(i)])), 'No invoices.')}</div>
  ${cur ? invoiceDetail(cur, u) : ''}`;
};

function invoiceDetail(i, u) {
  const S = St(), dl = i.deliverableId && S.deliverables.find(d => d.id === i.deliverableId);
  const docs = S.documents.filter(d => !d.deleted && d.entityType === 'invoice' && d.entityId === i.id && canSeeItem(u, d));
  return `<section class="card" id="inv"><div class="ph"><h2>Invoice ${esc(i.no)}</h2>${stb(i.status)}</div>
   <div class="grid g2"><dl class="kv">
    <dt>From</dt><dd>${esc(orgName(i.org))}</dd><dt>Workstream</dt><dd>${wsTag(i.ws)}</dd>
    <dt>Description</dt><dd>${esc(i.description)}</dd>${dl ? `<dt>Deliverable</dt><dd>${esc(dl.ref)}: <a href="#/activity/${dl.activityId}">${esc(dl.name)}</a></dd>` : ''}
    <dt>Invoice date</dt><dd>${D.nice(i.date)}</dd><dt>Submitted</dt><dd>${esc(uname(i.by))}, ${D.stamp(i.at)}</dd>
    <dt>Amount</dt><dd>${money(i.amount)} plus VAT ${money(i.vat)} = <strong>${money(i.amount + i.vat)}</strong></dd>
    ${i.status === 'Paid' ? `<dt>Paid</dt><dd>${D.nice(i.paidOn)}, reference ${esc(i.paymentRef)}</dd>` : ''}
    <dt>Files</dt><dd>${docs.map(d => `<button class="link" data-act="download" data-id="${d.id}">${esc(d.title)}</button>`).join(', ') || 'None'}</dd></dl>
   <div><h3>Status history</h3><ol class="timeline">${i.history.map(h => `<li><strong>${esc(h[0])}</strong> <span class="muted small">${esc(uname(h[1]))}, ${D.stamp(h[3])}</span>${h[2] ? `<p>${esc(h[2])}</p>` : ''}</li>`).join('')}</ol></div></div></section>`;
}

/* ---------- Documents (FR-DOC) ---------- */

function entityLabel(d) {
  if (d.entityType === 'activity') { const a = actOf(d.entityId); return a ? actLink(a) : 'Activity'; }
  if (d.entityType === 'meeting') { const m = St().meetings.find(x => x.id === d.entityId); return m ? 'Meeting: ' + esc(m.title) : 'Meeting'; }
  if (d.entityType === 'invoice') { const i = St().invoices.find(x => x.id === d.entityId); return i ? `<a href="#/invoices?id=${i.id}">Invoice ${esc(i.no)}</a>` : 'Invoice'; }
  if (d.entityType && d.entityType !== 'library') return esc(d.entityType);
  return 'Library';
}
function docTable(docs, u) {
  return table(['Title', 'Category', 'Workstream', 'Linked to', 'Version', 'Size', 'Uploaded', ''], docs.map(d => {
    const v = d.versions[d.versions.length - 1];
    const prev = /\.(png|jpe?g|svg|pdf)$/i.test(v.name) && v.data;
    return tr([`<strong>${esc(d.title)}</strong><br><span class="small muted">${esc(v.name)}</span>`, esc(d.category), wsTag(d.ws) + (d.ws === 'S' && d.visibleToDevs && isOversight(u) ? ' <span class="tag">Visible to developers</span>' : ''), entityLabel(d),
      `<button class="link" data-act="versions" data-id="${d.id}">v${v.no}${d.versions.length > 1 ? ' of ' + d.versions.length : ''}</button>`, bytes(v.size), esc(uname(v.by)) + '<br><span class="small muted">' + D.stamp(v.at) + '</span>',
      `<div class="btns"><button class="btn sm ghost" data-act="download" data-id="${d.id}">Download</button>${prev ? `<button class="btn sm ghost" data-act="preview" data-id="${d.id}">Preview</button>` : ''}${!RO() ? `<button class="btn sm ghost" data-act="uploadModal" data-doc="${d.id}">New version</button>` : ''}${can.docDelete(u, d) && !RO() ? `<button class="btn sm ghost danger" data-act="deleteDoc" data-id="${d.id}">Delete</button>` : ''}</div>`]);
  }), 'No documents.');
}

VIEWS.documents = (p, q) => {
  const u = Ctx.u, S = St();
  let docs = S.documents.filter(d => !d.deleted && d.entityType !== 'bank' && canSeeItem(u, d));
  if (q.ws) docs = docs.filter(d => d.ws === q.ws);
  if (q.cat) docs = docs.filter(d => d.category === q.cat);
  if (q.q) { const s = q.q.toLowerCase(); docs = docs.filter(d => (d.title + ' ' + d.category + ' ' + d.versions.map(v => v.name + ' ' + v.comment).join(' ')).toLowerCase().includes(s)); }
  docs.sort((a, b) => a.versions[a.versions.length - 1].at < b.versions[b.versions.length - 1].at ? 1 : -1);
  const counts = {};
  S.documents.filter(d => !d.deleted && d.entityType !== 'bank' && canSeeItem(u, d)).forEach(d => { counts[d.ws] = (counts[d.ws] || 0) + 1; });
  return `<div class="page-h"><h1>Documents</h1><div class="actions">${!RO() ? '<button class="btn" data-act="uploadModal" data-entity="library">Upload document</button>' : ''}</div></div>
  <div class="folders">${wsOptions(u, true).map(([id, n]) => `<a href="#/documents?${qs(Object.assign({}, q, { ws: q.ws === id ? '' : id }))}" class="folder ${q.ws === id ? 'on' : ''}">${wsLogo(id, 'f-logo')}<span>${esc(n)}</span><em>${counts[id] || 0}</em></a>`).join('')}</div>
  <div class="filters">
   <label class="f inline"><span>Category</span>${sel('cat', [['', 'All']].concat(S.lookups.docCategories), q.cat || '', 'data-change="qset" data-k="cat"')}</label>
   <label class="f inline"><span>Search</span><input type="search" value="${esc(q.q || '')}" data-change="qset" data-k="q" placeholder="Name, category or note"></label>
  </div>
  <div class="card flush">${docTable(docs, u)}</div>
  <p class="small muted">${FILE_TYPES.join(', ').toUpperCase()}. Up to 100 MB.</p>`;
};

/* ---------- Weekly reports (FR-WKR) ---------- */

function weekEndings() {
  const S = St(), day = +S.settings.weeklyReportDay;
  let d = S.settings.projectStart;
  while (D.dow(d) !== day) d = D.add(d, 1);
  const out = [], lim = D.add(D.today(), 6);
  for (; d <= lim; d = D.add(d, 7)) out.push(d);
  return out;
}
function weeklyStatus(ws) {
  const S = St(), cal = S._cal, today = D.today();
  return weekEndings().map(we => {
    const r = S.weekly.find(w => w.ws === ws && w.weekEnding === we);
    const lateFrom = cal.addBD(D.add(we, 1), 0);
    const status = r ? (r.reviewedAt ? 'Reviewed' : 'Filed') : (today >= lateFrom ? 'Late' : 'Due');
    return { we, r, status, lateFrom };
  });
}

VIEWS.weekly = (p, q) => {
  const u = Ctx.u, S = St();
  const wss = isOversight(u) ? ['A', 'B'] : wsOf(u);
  const ws = q.ws && wss.includes(q.ws) ? q.ws : wss[0];
  const rows = weeklyStatus(ws).reverse();
  const canFile = can.weekly(u) && (wsOf(u) || []).includes(ws) && !RO();
  const open = rows.filter(r => !r.r);
  const sel_ = q.id && S.weekly.find(w => w.id === q.id && w.ws === ws);
  return `<div class="page-h"><h1>Weekly developer reports</h1><div class="actions">${canFile && open.length ? `<button class="btn" data-act="weeklyForm" data-ws="${ws}">File weekly report</button>` : ''}</div></div>
  ${wss.length > 1 ? tabs(wss.map(w => [w, wsName(w), '#/weekly?ws=' + w]), ws) : ''}
  <p class="muted">Due every ${DAYS[S.settings.weeklyReportDay]}.</p>
  <div class="card flush">${table(['Week ending', 'Status', 'Filed by', 'Filed at', 'BDIH review', ''], rows.map(w => tr([D.nice(w.we), stb(w.status), w.r ? esc(uname(w.r.by)) : '', w.r ? D.stamp(w.r.at) : (w.status === 'Late' ? 'Late since ' + D.nice(w.lateFrom) : ''), w.r && w.r.reviewedAt ? 'Reviewed by ' + esc(uname(w.r.reviewedBy)) : '', w.r ? `<a class="btn sm ghost" href="#/weekly?ws=${ws}&id=${w.r.id}">Open</a>` : (canFile ? `<button class="btn sm" data-act="weeklyForm" data-ws="${ws}" data-we="${w.we}">File</button>` : '')])))}</div>
  ${sel_ ? weeklyDetail(sel_, u) : ''}`;
};

function weeklyDetail(w, u) {
  const blk = (t, v) => `<dt>${t}</dt><dd>${esc(v) || '<span class="muted">None</span>'}</dd>`;
  return `<section class="card" id="wk"><h2>${esc(wsName(w.ws))}: week ending ${D.nice(w.weekEnding)}</h2>
   <dl class="kv">${blk('Work completed', w.completed)}${blk('Planned next week', w.planned)}${blk('Issues', w.issues)}${blk('Risks', w.risks)}${blk('Change requests raised', w.crs)}${blk('Support needed from BDIH or BOCRA', w.support)}</dl>
   ${w.pcts && w.pcts.length ? table(['Activity', '% done reported'], w.pcts.map(x => { const a = actOf(x.id); return a ? tr([actLink(a), x.pct + '%']) : ''; }).filter(Boolean)) : ''}
   ${w.comment ? `<p><strong>BDIH comment:</strong> ${esc(w.comment)}</p>` : ''}
   ${can.weeklyReview(u) && !w.reviewedAt && !RO() ? `<form data-form="weeklyReview"><input type="hidden" name="id" value="${w.id}">${fld('BDIH comment', ta('comment', ''))}<button class="btn sm">Mark reviewed</button></form>` : ''}
  </section>`;
}

/* ---------- Progress reports (FR-RPT) ---------- */

function reportData(scope, start, end) {
  const S = St(), cal = S._cal, i = cal.floor(end), si = cal.ceil(start);
  const inScope = a => !a.deleted && (scope === 'combined' ? true : a.ws === scope || (a.ws === 'S' && a.visibleToDevs));
  const acts = S.activities.filter(inScope);
  const statsActs = scope === 'combined' ? acts : acts.filter(a => a.ws === scope);
  const w = weighted(statsActs, i), p = perfStatus(w.actual, w.planned, S.settings);
  const h = a => health(a, i);
  return {
    i, w, p,
    completed: acts.filter(a => a.actualFinish && a.actualFinish >= start && a.actualFinish <= end && isDone(a)),
    late: acts.filter(a => ['Late', 'Behind'].includes(h(a))),
    inProg: acts.filter(a => a.type !== 'Meeting' && a.actualStart && !isDone(a) && a.status !== 'Cancelled'),
    upcoming: acts.filter(a => !isDone(a) && !a.actualStart && a._si > i && a._si <= i + 10).sort((a, b) => a._si - b._si),
    milestones: acts.filter(a => a.type === 'Milestone').sort((a, b) => a._fi - b._fi),
    deliverables: S.deliverables.filter(d => scope === 'combined' || d.ws === scope).map(d => ({ d, a: actOf(d.activityId) })).filter(x => x.a),
    corrections: S.history.filter(x => x.correction && x.at.slice(0, 10) >= start && (scope === 'combined' || (actOf(x.activityId) || {}).ws === scope)),
    si
  };
}

function defaultCommentary() {
  const S = St(), u = Ctx.u;
  const open = (l) => l.filter(x => !['Closed', 'Resolved'].includes(x.status));
  return {
    issues: open(S.issues).map(x => x.title + ' (' + x.severity + ', owner ' + uname(x.owner) + ')').join('\n'),
    risks: open(S.risks).sort((a, b) => b.likelihood * b.impact - a.likelihood * a.impact).slice(0, 5).map(x => x.title + ' (score ' + x.likelihood * x.impact + ')').join('\n'),
    decisions: S.decisions.filter(x => x.status === 'Required').map(x => x.decision + ' (by ' + D.nice(x.date) + ')').join('\n'),
    next: 'Complete open BDIH and BOCRA reviews within their service levels.\nTrack content delivery against the frontend build start.'
  };
}

function reportHTML(scope, start, end, com) {
  const S = St(), r = reportData(scope, start, end), u = Ctx.u;
  const h = a => health(a, r.i);
  const T = (heads, rows) => rows.length ? `<table><thead><tr>${heads.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map(c => `<tr>${c.map(x => `<td>${x ?? ''}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p><em>None.</em></p>';
  const actRow = a => [esc(a.name), esc(wsName(a.ws)), D.nice(a.start), D.nice(a.finish), (a.pct || 0) + '%', h(a)];
  const ce = contractEnd(S);
  const devSum = ws => { const st = wsStats(ws); return [esc(wsName(ws)), st.status, pc(st.planned), pc(st.actual), st.spi == null ? 'n/a' : st.spi.toFixed(2), st.late.length + ' late, ' + st.behind.length + ' behind', st.comm ? D.nice(st.comm.finish) : 'n/a', st.comm ? D.nice(blFinish(st.comm)) : 'n/a', st.comm ? slipTxt(st.comm) : 'n/a']; };
  const comms = ['A', 'B'].map(w => S.activities.find(a => a.key === w + '-COMM')).filter(Boolean);
  const beyond = Math.max(0, ...comms.map(a => a._fi - S._cal.ceil(ce)));
  const para = t => esc(t || 'None.').split('\n').map(x => `<p>${x}</p>`).join('');
  const title = scope === 'combined' ? 'Progress Report' : 'Progress Report: ' + wsName(scope);
  return `<div class="rpt-head"><div class="rpt-brand">${bihLogo('rpt-logo')}</div><div><h1>${esc(title)}</h1>
   <p>Design, Development and Implementation of the BOCRA and UASF Trust Websites</p>
   <p>Reporting period ${D.nice(start)} to ${D.nice(end)}. Status date ${D.nice(S._cal.date(r.i))}. Generated ${D.stamp(D.now())} by ${esc(u.fullName)}.</p></div></div>
  <h2>1. Overall position</h2>
  ${T(['Measure', 'Value'], [['Planned complete', pc(r.w.planned)], ['Actual complete', pc(r.w.actual)], ['Schedule performance', r.p.spi == null ? 'n/a' : r.p.spi.toFixed(2)], ['Overall status', r.p.status]]
    .concat(scope === 'combined' ? [['Contract end', D.nice(ce)], ['Business days beyond contract end (forecast)', String(beyond)]] : []))}
  <h2>2. ${scope === 'combined' ? 'Developer summary' : 'Workstream summary'}</h2>
  ${T(['Workstream', 'Status', 'Planned', 'Actual', 'SPI', 'Late and behind', 'Forecast commissioning', 'Baseline commissioning', 'Slip'], (scope === 'combined' ? ['A', 'B'] : [scope]).map(devSum))}
  <h2>3. Activities completed in the period</h2>${T(['Activity', 'Workstream', 'Actual start', 'Actual finish'], r.completed.map(a => [esc(a.name), esc(wsName(a.ws)), D.nice(a.actualStart), D.nice(a.actualFinish)]))}
  <h2>4. Late and behind activities</h2>${T(['Activity', 'Workstream', 'Start', 'Finish', 'Done', 'Health'], r.late.map(actRow))}
  <h2>5. Activities in progress</h2>${T(['Activity', 'Workstream', 'Start', 'Finish', 'Done', 'Health'], r.inProg.map(actRow))}
  <h2>6. Coming up in the next 10 business days</h2>${T(['Activity', 'Workstream', 'Start', 'Finish', 'Done', 'Health'], r.upcoming.map(actRow))}
  <h2>7. Milestones</h2>${T(['Milestone', 'Workstream', 'Forecast', 'Baseline', 'Slip', 'Health'], r.milestones.map(a => [esc(a.name), esc(wsName(a.ws)), D.nice(a.finish), D.nice(blFinish(a)), slipTxt(a), h(a)]))}
  <h2>8. Deliverables</h2>${T(['Ref', 'Deliverable', 'Planned finish', 'Baseline finish', 'Actual finish', 'Status'], r.deliverables.map(({ d, a }) => [esc(d.ref), esc(d.name), D.nice(a.finish), D.nice(blFinish(a)), D.nice(a.actualFinish && isDone(a) ? a.actualFinish : ''), esc(a.status)]))}
  ${scope === 'combined' ? `<h2>9. BDIH commentary</h2><h3>Issues</h3>${para(com.issues)}<h3>Risks</h3>${para(com.risks)}<h3>Decisions required from BOCRA</h3>${para(com.decisions)}<h3>Next steps</h3>${para(com.next)}` : ''}
  ${r.corrections.length ? `<h2>Corrections after a locked period</h2>${T(['When', 'Activity', 'Field', 'Change', 'Reason'], r.corrections.map(x => [D.stamp(x.at), esc((actOf(x.activityId) || {}).name), esc(x.field), esc(x.old) + ' to ' + esc(x.new), esc(x.comment)]))}` : ''}`;
}

const RPT_CSS = `body{font-family:'Times New Roman',Times,serif;font-size:11pt;color:#000;margin:24px}
h1{font-size:18pt;margin:0 0 4pt}h2{font-size:13pt;margin:16pt 0 4pt}h3{font-size:11pt;margin:8pt 0 2pt}p{margin:2pt 0}
table{border-collapse:collapse;width:100%;margin:4pt 0 10pt}th{background:#7b4a24;color:#fff;border:1px solid #000;padding:3pt 5pt;text-align:left}
td{border:1px solid #000;padding:3pt 5pt;vertical-align:top}.rpt-head{display:flex;gap:14pt;align-items:center;border-bottom:2px solid #7b4a24;padding-bottom:8pt}
.rpt-brand{width:150pt;flex:none}.rpt-brand svg,.rpt-brand img{width:150pt;height:auto}`;

VIEWS.reports = (p, q) => {
  const u = Ctx.u, S = St();
  const scope = isOversight(u) ? (q.scope || 'combined') : wsOf(u)[0];
  Ctx.com = Ctx.com || defaultCommentary();
  const html = reportHTML(scope, Sess.period.start, Sess.period.end, Ctx.com);
  const official = S.reports.filter(r => r.official && (isOversight(u) || (r.scope === scope)));
  return `<div class="page-h"><h1>Progress reports</h1></div>
  <section class="card"><div class="filters">
   ${isOversight(u) ? `<label class="f inline"><span>Scope</span>${sel('scope', [['combined', 'Combined report'], ['A', 'BOCRA website only'], ['B', 'UASF website only']], scope, 'data-change="qset" data-k="scope"')}</label>` : `<span class="muted">Report for ${esc(wsName(scope))} only.</span>`}
   <span class="muted">Period ${D.nice(Sess.period.start)} to ${D.nice(Sess.period.end)} (change it in the bar above).</span></div>
   <div class="toolbar"><button class="btn" data-act="reportPdf" data-scope="${scope}">Download PDF</button><button class="btn ghost" data-act="reportWord" data-scope="${scope}">Download Word</button>
    <button class="btn ghost" data-act="exportSchedule">Export activities (CSV)</button>
    ${scope === 'combined' && hasPerm(u, 'progress.any') && !RO() ? '<button class="btn ghost" data-act="commentaryModal">Edit BDIH commentary</button>' : ''}
    ${can.publish(u) && scope === 'combined' && !RO() ? '<button class="btn ghost" data-act="publishReport">Save as official Monthly Progress Report</button><button class="btn ghost" data-act="lockPeriod">Lock progress to status date</button>' : ''}
   </div>${S.settings.lockedThrough ? `<p class="small muted">Progress is locked through ${D.nice(S.settings.lockedThrough)}. Later corrections need a reason and are flagged in the next report.</p>` : ''}</section>
  <article class="rpt paper">${html}</article>
  <section class="card"><h2>Official monthly archive</h2>${table(['Month', 'Period', 'Saved by', 'Saved at', ''], official.map(r => tr([esc(r.month), D.nice(r.start) + ' to ' + D.nice(r.end), esc(uname(r.by)), D.stamp(r.at), `<button class="btn sm ghost" data-act="archivedReport" data-id="${r.id}">Download PDF</button> <button class="btn sm ghost" data-act="archivedWord" data-id="${r.id}">Word</button>`])), 'No official reports saved yet.')}</section>`;
};

/* ---------- Registers (FR-DLV, FR-RSK) ---------- */

const REG = {
  risks: { title: 'Risks', key: 'risks', fields: [['title', 'Title', 'text', 1], ['description', 'Description', 'textarea'], ['ws', 'Workstream', 'ws', 1], ['likelihood', 'Likelihood (1 to 5)', [1, 2, 3, 4, 5], 1], ['impact', 'Impact (1 to 5)', [1, 2, 3, 4, 5], 1], ['owner', 'Owner', 'user', 1], ['mitigation', 'Mitigation', 'textarea'], ['due', 'Due date', 'date'], ['status', 'Status', ['Open', 'Monitoring', 'Closed']]] },
  issues: { title: 'Issues', key: 'issues', fields: [['title', 'Title', 'text', 1], ['description', 'Description', 'textarea'], ['ws', 'Workstream', 'ws', 1], ['severity', 'Severity', ['Low', 'Medium', 'High', 'Critical']], ['owner', 'Owner', 'user', 1], ['raised', 'Raised', 'date'], ['target', 'Target date', 'date'], ['status', 'Status', ['Open', 'In progress', 'Resolved', 'Closed']], ['resolution', 'Resolution', 'textarea']] },
  decisions: { title: 'Decisions', key: 'decisions', fields: [['decision', 'Decision', 'textarea', 1], ['ws', 'Workstream', 'ws', 1], ['date', 'Date (or date needed)', 'date', 1], ['madeBy', 'Made by', 'text'], ['forum', 'Forum', 'forum'], ['related', 'Related items', 'text'], ['status', 'Status', ['Made', 'Required']]] },
  changes: { title: 'Change requests', key: 'changes', fields: [['title', 'Title', 'text', 1], ['description', 'Description', 'textarea', 1], ['ws', 'Workstream', 'ws', 1], ['requestedBy', 'Requested by', 'user'], ['requested', 'Requested on', 'date'], ['impactScope', 'Impact on scope (BDIH)', ['Low', 'Medium', 'High'], 0, 'crRecommend'], ['impactTime', 'Impact on time (BDIH)', 'text', 0, 'crRecommend'], ['impactCost', 'Impact on cost (BDIH)', 'text', 0, 'crRecommend'], ['recommendation', 'BDIH recommendation', 'textarea', 0, 'crRecommend'], ['decision', 'BOCRA decision', ['Pending', 'Approved', 'Rejected'], 0, 'crDecide'], ['decisionText', 'BOCRA decision in writing', 'textarea', 0, 'crDecide'], ['planChanges', 'Resulting plan changes', 'textarea', 0, 'crRecommend']] }
};

function escalation(it, dueField) {
  if (['Closed', 'Resolved'].includes(it.status) || !it[dueField]) return '';
  const c = St()._cal, over = c.floor(D.today()) - c.ceil(it[dueField]);
  if (over <= 0) return '';
  const ladder = it.ws === 'S' ? ['BDIH Project Leader', 'BOCRA Representative', 'Steering Committee'] : ['Developer Lead', 'BDIH Project Leader', 'BOCRA Representative', 'Steering Committee'];
  return `<span class="timer over">Escalated to ${ladder[Math.min(ladder.length - 1, Math.floor((over - 1) / (+cfg().escalationDays || 3)))]}</span>`;
}

function heatMap(risks) {
  let cells = '';
  for (let l = 5; l >= 1; l--) {
    cells += `<div class="hm-y">${l}</div>`;
    for (let im = 1; im <= 5; im++) {
      const n = risks.filter(r => +r.likelihood === l && +r.impact === im).length;
      const sc = l * im;
      cells += `<div class="hm-c ${sc >= 15 ? 'hi' : sc >= 8 ? 'md' : 'lo'}" title="Likelihood ${l}, impact ${im}: ${n} risk${n === 1 ? '' : 's'}">${n || ''}</div>`;
    }
  }
  return `<div class="heat" role="img" aria-label="Risk heat map of open risks"><div class="hm-ylab">Likelihood</div>${cells}<div></div>${[1, 2, 3, 4, 5].map(x => `<div class="hm-x">${x}</div>`).join('')}<div class="hm-xlab">Impact</div></div>`;
}

VIEWS.registers = (p, q) => {
  const u = Ctx.u, S = St(), i = sdi();
  const tab = q.tab || 'deliverables';
  const head = tabs([['deliverables', 'Deliverables', '#/registers?tab=deliverables'], ['risks', 'Risks', '#/registers?tab=risks'], ['issues', 'Issues', '#/registers?tab=issues'], ['decisions', 'Decisions', '#/registers?tab=decisions'], ['changes', 'Change requests', '#/registers?tab=changes']], tab);
  const fws = it => !q.ws || it.ws === q.ws;
  if (tab === 'deliverables') {
    const rows = S.deliverables.filter(d => canSeeItem(u, d) && fws(d)).map(d => {
      const a = actOf(d.activityId); if (!a || !canSeeItem(u, a)) return '';
      const bor = S.reviews.filter(r => r.stage === 'BOCRA' && !r.decidedAt && S.submissions.some(s => s.id === r.submissionId && s.activityId === a.id))[0];
      return tr([`<strong>${esc(d.ref)}</strong>`, actLink(a) + `<br><span class="small muted">${esc(d.name)}</span>`, esc(d.phase), esc(orgName(d.owner)), wsTag(d.ws), D.nice(a.finish), D.nice(blFinish(a)), bor ? D.nice(bor.due) : '', isDone(a) ? D.nice(a.actualFinish) : '', hb(health(a, i)), slipTxt(a), can.editPlan(u) && !RO() ? `<button class="btn sm ghost" data-act="editDeliverable" data-id="${d.id}">Edit</button>` : '']);
    }).filter(Boolean);
    return `<div class="page-h"><h1>Registers</h1>${can.editPlan(u) && !RO() ? '<div class="actions"><button class="btn" data-act="editDeliverable">Add deliverable</button></div>' : ''}</div>${head}
     <div class="card flush">${table(['Ref', 'Deliverable', 'Phase', 'Owner', 'Workstream', 'Planned finish', 'Baseline finish', 'BOCRA review due', 'Actual finish', 'Health', 'Slip', ''], rows)}</div>
`;
  }
  const cfg = REG[tab];
  const items = S[cfg.key].filter(it => canSeeItem(u, it) && fws(it));
  let cols, rows;
  const editBtn = it => `<button class="btn sm ghost" data-act="regEdit" data-reg="${tab}" data-id="${it.id}">${can.regEdit(u) || (tab === 'changes' && (can.crDecide(u) || can.crRecommend(u))) ? 'Edit' : 'View'}</button>`;
  if (tab === 'risks') {
    cols = ['Risk', 'Workstream', 'L', 'I', 'Score', 'Owner', 'Due', 'Status', ''];
    rows = items.sort((a, b) => b.likelihood * b.impact - a.likelihood * a.impact).map(it => tr([`<strong>${esc(it.title)}</strong><br><span class="small muted">${esc(it.mitigation)}</span>`, wsTag(it.ws), it.likelihood, it.impact, `<span class="score s${it.likelihood * it.impact >= 15 ? 'hi' : it.likelihood * it.impact >= 8 ? 'md' : 'lo'}">${it.likelihood * it.impact}</span>`, esc(uname(it.owner)), D.nice(it.due) + ' ' + escalation(it, 'due'), stb(it.status), editBtn(it)]));
  } else if (tab === 'issues') {
    cols = ['Issue', 'Workstream', 'Severity', 'Owner', 'Raised', 'Target', 'Status', ''];
    rows = items.map(it => tr([`<strong>${esc(it.title)}</strong><br><span class="small muted">${esc(it.resolution || it.description)}</span>`, wsTag(it.ws), esc(it.severity), esc(uname(it.owner)), D.nice(it.raised), D.nice(it.target) + ' ' + escalation(it, 'target'), stb(it.status), editBtn(it)]));
  } else if (tab === 'decisions') {
    cols = ['Decision', 'Workstream', 'Date', 'Made by', 'Forum', 'Status', ''];
    rows = items.map(it => tr([esc(it.decision), wsTag(it.ws), D.nice(it.date), esc(it.madeBy), esc(it.forum), stb(it.status), editBtn(it)]));
  } else {
    cols = ['Change request', 'Workstream', 'Requested', 'Impact', 'BDIH recommendation', 'BOCRA decision', ''];
    rows = items.map(it => tr([`<strong>${esc(it.title)}</strong><br><span class="small muted">${esc(it.description)}</span>`, wsTag(it.ws), esc(uname(it.requestedBy)) + '<br>' + D.nice(it.requested), `Scope ${esc(it.impactScope || 'n/a')}<br>Time ${esc(it.impactTime || 'n/a')}<br>Cost ${esc(it.impactCost || 'n/a')}`, esc(it.recommendation) || '<span class="muted">Pending</span>', stb(it.decision) + (it.decisionText ? `<br><span class="small">${esc(it.decisionText)}</span>` : ''), editBtn(it)]));
  }
  const open = items.filter(r => r.status !== 'Closed');
  return `<div class="page-h"><h1>Registers</h1>${!RO() ? `<div class="actions"><button class="btn" data-act="regEdit" data-reg="${tab}">Add ${cfg.title.toLowerCase().replace(/s$/, '')}</button></div>` : ''}</div>${head}
   <div class="filters"><label class="f inline"><span>Workstream</span>${sel('ws', [['', 'All']].concat(wsOptions(u, true)), q.ws || '', 'data-change="qset" data-k="ws"')}</label></div>
   ${tab === 'risks' ? `<div class="grid g2r"><div class="card flush">${table(cols, rows)}</div><section class="card"><h2>Heat map (open risks)</h2>${heatMap(open)}</section></div>` : `<div class="card flush">${table(cols, rows)}</div>`}
   ${tab === 'changes' ? '<p class="small muted">A new baseline needs an approved change request.</p>' : ''}`;
};

/* ---------- Meetings (FR-MTG) ---------- */

VIEWS.meetings = (p, q) => {
  const u = Ctx.u, S = St();
  const ms = S.meetings.filter(m => canSeeItem(u, m)).sort((a, b) => a.date < b.date ? 1 : -1);
  const acts = S.actions.filter(x => canSeeItem(u, x)).sort((a, b) => a.due < b.due ? -1 : 1);
  const upcoming = visActs(u).filter(a => a.type === 'Meeting' && a._dur === 1 && a.start >= D.today()).sort((a, b) => a._si - b._si).slice(0, 6);
  const cur = q.id && ms.find(m => m.id === q.id);
  return `<div class="page-h"><h1>Meetings and governance</h1>${can.meetingEdit(u) && !RO() ? '<div class="actions"><button class="btn" data-act="meetingModal">Record meeting</button></div>' : ''}</div>
  <div class="grid g2r">
   <section class="card flush">${table(['Date', 'Meeting', 'Forum', 'Workstream', 'Actions open', ''], ms.map(m => tr([D.nice(m.date), esc(m.title), esc(m.forum), wsTag(m.ws), acts.filter(x => x.meetingId === m.id && x.status !== 'Done').length, `<a class="btn sm ghost" href="#/meetings?id=${m.id}">Open</a>`])), 'No meetings recorded.')}</section>
   <section class="card"><h2>Coming up</h2>${upcoming.length ? `<ul class="alist">${upcoming.map(a => `<li><strong>${D.nice(a.start)}</strong> ${actLink(a)}</li>`).join('')}</ul>` : '<p class="empty">None scheduled.</p>'}</section>
  </div>
  ${cur ? meetingDetail(cur, u, acts.filter(x => x.meetingId === cur.id)) : ''}
  <section class="card"><h2>All action items</h2>${table(['Action', 'Owner', 'Due', 'Status', ''], acts.map(x => tr([esc(x.text), esc(uname(x.owner)), D.nice(x.due) + (x.status !== 'Done' && x.due < D.today() ? ' <span class="timer over">Overdue</span>' : ''), stb(x.status), (x.owner === u.id || can.meetingEdit(u)) && x.status !== 'Done' && !RO() ? `<button class="btn sm ghost" data-act="actionDone" data-id="${x.id}">Mark done</button>` : ''])), 'No actions.')}</section>`;
};

function meetingDetail(m, u, acts) {
  const S = St();
  const minutes = m.minutesDoc && S.documents.find(d => d.id === m.minutesDoc && !d.deleted);
  return `<section class="card"><div class="ph"><h2>${esc(m.title)}, ${D.nice(m.date)}</h2><div class="btns">${can.meetingEdit(u) && !RO() ? `<button class="btn sm ghost" data-act="meetingModal" data-id="${m.id}">Edit</button>` : ''}${can.admin(u) && !RO() ? `<button class="btn sm ghost danger" data-act="adminDeleteMeeting" data-id="${m.id}">Delete</button>` : ''}</div></div>
   <dl class="kv"><dt>Forum</dt><dd>${esc(m.forum)}</dd><dt>Attendees</dt><dd>${m.attendees.map(id => esc(uname(id))).join(', ')}</dd>
   <dt>Agenda</dt><dd>${esc(m.agenda)}</dd><dt>Decisions</dt><dd>${esc(m.decisions) || 'None recorded'}</dd>
   <dt>Minutes</dt><dd>${minutes ? `<button class="link" data-act="download" data-id="${minutes.id}">${esc(minutes.title)}</button>` : 'Not uploaded'} ${!RO() && can.meetingEdit(u) ? `<button class="btn sm ghost" data-act="uploadModal" data-entity="meeting" data-eid="${m.id}" data-ws="${m.ws}" data-cat="Minutes">Upload minutes</button>` : ''}</dd></dl>
   <h3>Action items</h3>${table(['Action', 'Owner', 'Due', 'Status'], acts.map(x => tr([esc(x.text), esc(uname(x.owner)), D.nice(x.due), stb(x.status)])), 'No actions.')}
   ${can.meetingEdit(u) && !RO() ? `<form data-form="addAction" class="inline-form"><input type="hidden" name="meetingId" value="${m.id}">${fld('New action', inp('text', '', 'text', 'required'))}${fld('Owner', sel('owner', userOpts(x => canSee(x, m.ws, m.visibleToDevs))))}${fld('Due', inp('due', D.today(), 'date', 'required'))}<button class="btn sm">Add action</button></form>` : ''}
  </section>`;
}

/* ---------- Resource loading (FR-DSH-08) ---------- */

VIEWS.resources = () => {
  const S = St(), cal = S._cal;
  if (!isOversight(Ctx.u)) return notFound();
  const acts = S.activities.filter(a => !a.deleted && a.type !== 'Meeting' && a.type !== 'Milestone' && !isDone(a) && a.status !== 'Cancelled');
  let wk = S.settings.projectStart;
  while (D.dow(wk) !== 1) wk = D.add(wk, -1);
  const end = D.add(cal.date(Math.max(...acts.map(a => a._fi), 0)), 7);
  const weeks = [];
  for (let d = wk; d <= end && weeks.length < 30; d = D.add(d, 7)) weeks.push(d);
  const rows = S.resources.map(r => {
    const cells = weeks.map(w => {
      const s = cal.ceil(w), e = cal.floor(D.add(w, 4));
      const on = acts.filter(a => (a.lead === r.id || a.support === r.id) && a._si <= e && a._fi >= s);
      const both = on.some(a => a.ws === 'A') && on.some(a => a.ws === 'B') && r.org === 'BDIH';
      const cls = on.length >= 3 || both ? 'over' : on.length ? 'some' : '';
      return `<td class="rl ${cls}" title="${esc(on.map(a => a.name + ' (' + wsName(a.ws) + ')').join('\n'))}">${on.length || ''}${both ? '<sup>A+B</sup>' : ''}</td>`;
    }).join('');
    return `<tr><th scope="row">${esc(r.name)}</th>${cells}</tr>`;
  }).join('');
  return `<div class="page-h"><h1>Resource loading</h1><p class="muted">Open activities per person per week. Red means overloaded.</p></div>
  <div class="card flush"><div class="tw"><table class="tbl rltable"><thead><tr><th>Resource</th>${weeks.map(w => `<th>${D.short(w)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
};

/* ---------- People, notifications, account ---------- */

VIEWS.people = () => {
  const u = Ctx.u, S = St();
  const list = S.users.filter(x => isOversight(u) || x.org === u.org || (isOversight(x) && x.active && hasRole(x, 'BDIH_LEAD', 'BDIH_PO', 'BDIH_BA', 'BDIH_TEAM', 'BOCRA_REP')));
  return `<div class="page-h"><h1>People</h1>${hasRole(u, 'DEV_LEAD') && !RO() ? '<div class="actions"><button class="btn" data-act="requestUser">Request team member account</button></div>' : ''}</div>
  <div class="card flush">${table(['Name', 'Organisation', 'Role', 'Job title', 'Email', 'Phone'], list.map(x => tr([esc(x.fullName) + (x.active ? '' : ' <span class="tag">Inactive</span>'), esc(orgName(x.org)), esc(roleLabel(x)), esc(x.title), esc(x.email), esc(x.phone)])))}</div>
  ${hasRole(u, 'DEV_LEAD') ? `<section class="card"><h2>My account requests</h2>${table(['Name', 'Requested', 'Status'], S.requests.filter(r => r.by === u.id).map(r => tr([esc(r.fullName), D.stamp(r.at), stb(r.status)])), 'None.')}</section>` : ''}`;
};

VIEWS.notifications = () => {
  const u = Ctx.u;
  const list = St().notifications.filter(n => n.user === u.id).sort((a, b) => a.at < b.at ? 1 : -1);
  return `<div class="page-h"><h1>Notifications</h1>${list.some(n => !n.read) && !RO() ? '<div class="actions"><button class="btn ghost" data-act="readAll">Mark all read</button></div>' : ''}</div>
  <div class="card flush">${list.length ? `<ul class="notes">${list.map(n => `<li class="${n.read ? '' : 'unread'}"><a href="${n.link || '#/notifications'}" data-act="openNote" data-id="${n.id}">${esc(n.title)}</a><span class="muted small">${esc(n.type)}, ${D.stamp(n.at)}</span></li>`).join('')}</ul>` : '<p class="empty">No notifications.</p>'}</div>`;
};

const NOTE_CATS = ['Submissions and reviews', 'Weekly reports', 'Activities', 'Change requests', 'Actions', 'Mentions'];
VIEWS.account = () => {
  const u = realMe();
  return `<h1>My account</h1><div class="grid g2">
  <section class="card"><h2>Profile</h2><dl class="kv"><dt>Name</dt><dd>${esc(u.fullName)}</dd><dt>Username</dt><dd>${esc(u.username)}</dd><dt>Roles</dt><dd>${esc(roleLabel(u))}</dd><dt>Organisation</dt><dd>${esc(orgName(u.org))}</dd><dt>Last successful login</dt><dd>${D.stamp(u.lastLogin) || 'n/a'} (this browser)</dd></dl>
   <h3>Change password</h3><form data-form="changePw" class="fgrid">${fld('Current password', inp('current', '', 'password', 'required autocomplete="current-password"'))}${fld('New password', inp('pw1', '', 'password', 'required minlength="12" autocomplete="new-password"'))}${fld('Confirm new password', inp('pw2', '', 'password', 'required minlength="12" autocomplete="new-password"'))}<div><button class="btn">Change password</button></div></form>
</section>
  <section class="card"><h2>Email notifications</h2><form data-form="prefs">${NOTE_CATS.map(c => fld(c, sel(c, ['Immediate', 'Daily digest', 'Off'], (u.prefs || {})[c] || 'Immediate'))).join('')}${fld('Security and account changes', '<input value="Immediate (cannot be turned off)" disabled>')}<button class="btn">Save preferences</button></form></section>
  </div>`;
};

/* ---------- Administration (FR-ADM, FR-AUD) ---------- */

VIEWS.admin = (p, q) => {
  const u = Ctx.u, S = St();
  if (!can.admin(u)) return notFound();
  const tab = q.tab || 'plan';
  const A = can.admin(u) && !RO(), E = can.editSettings(u) && !RO();
  const items = [['plan', 'Project plan'], ['calendar', 'Closure calendar'], ['settings', 'Settings'], ['orgs', 'Organisations and workstreams'], ['resources', 'Resources'], ['lists', 'Lists'], ['roles', 'Roles and permissions']];
  if (can.audit(u)) items.push(['audit', 'Audit log']);
  if (can.admin(u)) items.push(['labels', 'Labels'], ['access', 'Access review'], ['bin', 'Recycle bin'], ['requests', `Requests (${S.requests.filter(r => r.status === 'Pending').length})`]);
  const head = `<div class="page-h"><h1>Administration</h1>${can.admin(u) ? '<div class="actions"><a class="btn ghost" href="database.html" target="_blank" rel="noopener">Database scripts</a></div>' : ''}</div>` + tabs(items.map(([k, t]) => [k, t, '#/admin?tab=' + k]), tab);
  let body = '';
  if (tab === 'users') {
    body = `${A ? '<div class="toolbar"><button class="btn" data-act="userModal">Add user</button><button class="btn ghost" data-act="exportUsers">Export users and access (CSV)</button></div>' : ''}
    <div class="card flush">${table(['Name', 'Username', 'Organisation', 'Role', 'Status', 'Last login', ''], S.users.map(x => {
      const locked = x.lockedUntil > Date.now();
      return tr([esc(x.fullName) + `<br><span class="small muted">${esc(x.title)}</span>`, esc(x.username), esc(orgName(x.org)), roleName(x.role) + (x.delegated ? ' <span class="tag">Delegated</span>' : ''), (x.active ? stb('Active') : stb('Inactive')) + (locked ? ' <span class="timer over">Locked</span>' : '') + (x.mustChange ? ' <span class="tag">Must change password</span>' : ''), D.stamp(x.lastLogin), A ? `<div class="btns"><button class="btn sm ghost" data-act="userModal" data-id="${x.id}">Edit</button>${locked ? `<button class="btn sm ghost" data-act="unlockUser" data-id="${x.id}">Unlock</button>` : ''}<button class="btn sm ghost" data-act="resetPw" data-id="${x.id}">Reset password</button>${x.id !== u.id ? `<button class="btn sm ghost" data-act="toggleUser" data-id="${x.id}">${x.active ? 'Deactivate' : 'Reactivate'}</button><button class="btn sm ghost" data-act="viewAs" data-id="${x.id}">View as</button>` : ''}</div>` : '']);
    }))}</div>`;
  } else if (tab === 'orgs') {
    body = `<div class="grid g2"><section class="card"><h2>Organisations</h2>${table(['Organisation', 'Type', 'Users', ''], S.orgs.map(o => tr([esc(o.name) + (o.contact ? `<br><span class="muted">${esc(o.contact)}</span>` : ''), esc(o.type), S.users.filter(x => x.org === o.id && x.active).length, A ? `<button class="btn sm ghost" data-act="orgModal" data-id="${o.id}">Edit</button>` : ''])))}<p class="small muted">Developer A and Developer B are placeholders. Edit them to show each company's registered name everywhere in the tracker, including reports and invoices.</p></section>
    <section class="card"><h2>Workstreams</h2>${table(['Workstream', 'Owner', 'Website', ''], S.workstreams.map(w => tr([esc(w.name) + (w.id !== 'S' ? `<br><span class="muted">Tickets ${esc(ticketPrefix(w.id))}-</span>` : ''), A ? sel('owner', S.orgs.map(o => [o.id, o.name]), w.owner, `data-change="wsOwner" data-id="${w.id}"`) : esc(orgName(w.owner)), esc(w.website), A ? `<button class="btn sm ghost" data-act="wsModal" data-id="${w.id}">Edit</button>` : ''])))}</section></div>`;
  } else if (tab === 'resources') {
    body = `${A ? '<div class="toolbar"><button class="btn" data-act="resourceModal">Add resource</button></div>' : ''}<div class="card flush">${table(['Resource', 'Organisation', 'Linked user', 'Description', ''], S.resources.map(r => tr([esc(r.name), esc(orgName(r.org)), esc(uname(r.linkedUser)), esc(r.description), A ? `<button class="btn sm ghost" data-act="resourceModal" data-id="${r.id}">Edit</button>` : ''])))}</div>`;
  } else if (tab === 'lists') {
    const prot = (t, l) => `<section class="card"><h2>${t} <span class="tag">Protected</span></h2><p>${l.map(esc).join(', ')}</p><p class="small muted">Used by system logic; cannot be renamed or deleted.</p></section>`;
    const ed = (k, t) => `<section class="card"><h2>${t}</h2><form data-form="lookup"><input type="hidden" name="k" value="${k}">${fld('One value per line', `<textarea name="v" rows="7" ${A ? '' : 'disabled'}>${esc(S.lookups[k].join('\n'))}</textarea>`)}${A ? '<button class="btn sm">Save list</button>' : ''}</form></section>`;
    body = adminLists(u, A, prot);
  } else if (tab === 'settings') {
    const s = S.settings, dis = E ? '' : 'disabled';
    body = `<section class="card"><form data-form="settings" class="fgrid">
     ${fld('Project start date', inp('projectStart', s.projectStart, 'date', dis + ' required'))}
     ${fld('Contract duration (months)', inp('contractMonths', s.contractMonths, 'number', dis + ' min="1" max="36"'))}
     ${fld('BDIH review (business days)', inp('bdihReviewDays', s.bdihReviewDays, 'number', dis + ' min="1" max="20"'))}
     ${fld('BOCRA review (business days)', inp('bocraReviewDays', s.bocraReviewDays, 'number', dis + ' min="1" max="20"'))}
     ${fld('Weekly report due day', sel('weeklyReportDay', [1, 2, 3, 4, 5].map(d => [d, DAYS[d]]), s.weeklyReportDay, dis))}
     ${fld('On track threshold (SPI)', inp('thrOnTrack', s.thrOnTrack, 'number', dis + ' step="0.01" min="0" max="1"'))}
     ${fld('At risk threshold (SPI)', inp('thrAtRisk', s.thrAtRisk, 'number', dis + ' step="0.01" min="0" max="1"'))}
     <h3 class="span2">Name and branding</h3>
     ${fld('Application name', inp('appName', s.appName || 'Project Tracker', 'text', dis + ' maxlength="60"'))}${fld('Subtitle under the logo', inp('appSubtitle', s.appSubtitle || 'BOCRA and UASF Trust websites', 'text', dis + ' maxlength="80"'))}
     ${fld('Project name on the dashboard', inp('projectName', s.projectName || 'BOCRA and UASF Trust websites', 'text', dis + ' maxlength="120"'), 'span2')}
     <h3 class="span2">Invoices, escalation and downloads</h3>
     ${fld('VAT rate (%)', inp('vatRate', s.vatRate ?? 14, 'number', dis + ' min="0" max="50" step="0.5"'))}
     ${fld('Escalate overdue risks and issues every (business days)', inp('escalationDays', s.escalationDays || 3, 'number', dis + ' min="1" max="30"'))}
     ${fld('Downloads allowed per person per day (0 = no limit)', inp('dailyDownloadLimit', s.dailyDownloadLimit ?? 30, 'number', dis + ' min="0" max="1000"'))}
     <h3 class="span2">Sign-in and sessions</h3>
     ${fld('Cloudflare Turnstile site key', inp('turnstileSiteKey', s.turnstileSiteKey || DEFAULT_TURNSTILE_KEY, 'text', dis + ' maxlength="80" pattern="0x[A-Za-z0-9_-]+"'))}
     <label class="chk"><input type="checkbox" name="turnstileEnabled" ${s.turnstileEnabled !== false ? 'checked' : ''} ${dis}> Ask for the Turnstile security check at sign-in</label>
     ${fld('Sign out after inactivity (minutes)', inp('idleMinutes', s.idleMinutes || 30, 'number', dis + ' min="5" max="480"'))}${fld('Longest session (hours)', inp('sessionHours', s.sessionHours || 12, 'number', dis + ' min="1" max="24"'))}
     ${fld('Failed sign-ins before lockout', inp('lockoutAttempts', s.lockoutAttempts || 5, 'number', dis + ' min="3" max="20"'))}${fld('Lockout length (minutes)', inp('lockoutMinutes', s.lockoutMinutes || 15, 'number', dis + ' min="1" max="1440"'))}
     ${fld('Minimum password length', inp('passwordMinLength', s.passwordMinLength || 12, 'number', dis + ' min="8" max="64"'))}
     <div class="span2">${E ? '<button class="btn">Save settings and reschedule</button>' : '<p class="muted">Only administrators and the BDIH Project Leader can change settings.</p>'}</div></form></section>`;
  } else if (tab === 'calendar') {
    const c = S._cal, list = [...c.closed.entries()].filter(([d]) => D.dow(d) !== 0 && D.dow(d) !== 6).sort();
    body = `<div class="grid g2"><section class="card"><h2>Festive closure</h2><form data-form="festive" class="fgrid">
      ${fld('Closure starts', inp('festiveStart', S.settings.festiveStart, 'date', A ? '' : 'disabled'))}${fld('Closure ends', inp('festiveEnd', S.settings.festiveEnd, 'date', A ? '' : 'disabled'))}
      <div class="span2">${A ? '<button class="btn">Save and reschedule</button>' : ''}</div></form>
      <h2>Public holidays</h2>${table(['Date', 'Holiday', ''], S.holidays.slice().sort((a, b) => a.date < b.date ? -1 : 1).map(h => tr([D.nice(h.date), esc(h.reason), A ? `<button class="btn sm ghost" data-act="removeHoliday" data-d="${h.date}">Remove</button>` : ''])))}
      ${A ? `<form data-form="holiday" class="inline-form">${fld('Date', inp('date', '', 'date', 'required'))}${fld('Holiday', inp('reason', '', 'text', 'required'))}<button class="btn sm">Add holiday</button></form>` : ''}</section>
     <section class="card"><h2>Closure days on business days (${list.length})</h2><div class="closure-list">${list.map(([d, r]) => `<span>${D.nice(d)} <small>${esc(r)}</small></span>`).join('')}</div></section></div>`;
  } else if (tab === 'audit' && can.audit(u)) {
    let list = S.audit.slice().reverse();
    if (q.au) list = list.filter(x => x.user === q.au);
    if (q.aq) { const s = q.aq.toLowerCase(); list = list.filter(x => (x.action + ' ' + x.entity + ' ' + JSON.stringify(x.after || '')).toLowerCase().includes(s)); }
    body = `<div class="filters"><label class="f inline"><span>User</span>${sel('au', [['', 'All']].concat(S.users.map(x => [x.id, x.fullName])), q.au || '', 'data-change="qset" data-k="au"')}</label>
     <label class="f inline"><span>Search</span><input type="search" value="${esc(q.aq || '')}" data-change="qset" data-k="aq" placeholder="Action or entity"></label><button class="btn sm ghost" data-act="exportAudit">Export CSV</button></div>

     <div class="card flush">${table(['When', 'User', 'Action', 'Entity', 'Before', 'After', 'IP'], list.slice(0, 300).map(x => tr([D.stamp(x.at), esc(uname(x.user)), `<code>${esc(x.action)}</code>`, esc(x.entity) + (x.entityId ? ' ' + esc(x.entityId) : ''), `<code class="small">${esc(x.before ? JSON.stringify(x.before).slice(0, 120) : '')}</code>`, `<code class="small">${esc(x.after ? JSON.stringify(x.after).slice(0, 120) : '')}</code>`, esc(x.ip)])))}</div>`;
  } else if (tab === 'access' && can.admin(u)) {
    const sid = q.uid || u.id, x = userOf(sid);
    const a0 = S.activities.find(a => a.ws === (wsOf(x) || ['A'])[0] && a.submittable);
    const checks = [['See all workstreams', isOversight(x)], ['Edit plan, links and baselines', can.editPlan(x)], ['Update progress (own scope)', a0 ? can.progress(x, a0) : false], ['Submit deliverables', a0 ? can.submit(x, a0) : false], ['BDIH review recommendation', can.bdihReview(x)], ['BOCRA approval or return', can.bocraDecide(x)], ['File weekly report', can.weekly(x)], ['Publish monthly report', can.publish(x)], ['Change requests: recommend', can.crRecommend(x)], ['Change requests: decide', can.crDecide(x)], ['Settings and closure calendar', can.editSettings(x)], ['Audit log', can.audit(x)], ['Administer users', can.admin(x)]];
    body = `<section class="card"><h2>Effective permissions</h2><label class="f inline"><span>User</span>${sel('uid', S.users.map(y => [y.id, y.fullName + ' (' + roleLabel(y) + ')']), sid, 'data-change="qset" data-k="uid"')}</label>
     <p>Workstreams: ${(wsOf(x) || ['A', 'B', 'S']).map(wsName).join(', ')}${isOversight(x) ? '' : ', plus Shared items marked Visible to developers'}</p>
     ${table(['Permission', 'Granted'], checks.map(([t, v]) => tr([t, v ? stb('Yes') : stb('No')])))}<button class="btn sm ghost" data-act="exportUsers">Export users and access (CSV)</button></section>`;
  } else if (tab === 'bin' && can.admin(u)) {
    const del = S.documents.filter(d => d.deleted && Date.now() - new Date(d.deleted).getTime() < 90 * 864e5);
    body = `<div class="card flush">${table(['Document', 'Workstream', 'Deleted', 'By', ''], del.map(d => tr([esc(d.title), wsTag(d.ws), D.stamp(d.deleted), esc(uname(d.deletedBy)), `<button class="btn sm" data-act="restoreDoc" data-id="${d.id}">Restore</button>`])), 'Recycle bin is empty. Deleted documents are recoverable for 90 days.')}</div>`;
  } else if (tab === 'plan') {
    body = adminPlan(u, q);
  } else if (tab === 'labels') {
    body = adminLabels(u, q);
  } else if (tab === 'roles') {
    body = adminRoleNames(u) + adminRoles(u);
  } else if (tab === 'requests' && can.admin(u)) {
    body = adminRequests(u);
  } else if (tab === 'requests-old') {
    body = `<div class="card flush">${table(['Requested by', 'Name', 'Username', 'Role', 'Email', 'Status', ''], S.requests.map(r => tr([esc(uname(r.by)), esc(r.fullName), esc(r.username), roleName(r.role), esc(r.email), stb(r.status), r.status === 'Pending' ? `<button class="btn sm" data-act="approveRequest" data-id="${r.id}">Approve</button> <button class="btn sm ghost" data-act="rejectRequest" data-id="${r.id}">Reject</button>` : ''])), 'No requests.')}</div>`;
  }
  return head + body;
};
