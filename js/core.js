'use strict';
/* BDIH Project Tracking Tool: core model, business-day calendar, scheduling engine, health rules
   and access rules. Prototype build: data lives in this browser (localStorage). In production the
   same rules are enforced by Supabase Row Level Security, Storage policies and Edge Functions
   (SRS sections 3 and 5); the user interface only reflects them. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const D = {
  parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); },
  fmt(t) { return t.toISOString().slice(0, 10); },
  add(s, n) { const t = D.parse(s); t.setUTCDate(t.getUTCDate() + n); return D.fmt(t); },
  addMonths(s, n) { const t = D.parse(s); t.setUTCMonth(t.getUTCMonth() + n); return D.fmt(t); },
  dow(s) { return D.parse(s).getUTCDay(); },
  diff(a, b) { return Math.round((D.parse(b) - D.parse(a)) / 864e5); },
  nice(s) { if (!s) return ''; const t = D.parse(s); return t.getUTCDate() + ' ' + MONTHS[t.getUTCMonth()] + ' ' + t.getUTCFullYear(); },
  short(s) { if (!s) return ''; const t = D.parse(s); return t.getUTCDate() + ' ' + MONTHS[t.getUTCMonth()]; },
  month(s) { const t = D.parse(s); return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][t.getUTCMonth()] + ' ' + t.getUTCFullYear(); },
  // Dates display in Botswana local time (UTC+2); timestamps are stored in UTC.
  today() { return new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10); },
  now() { return new Date().toISOString(); },
  dateOf(iso) { return new Date(new Date(iso).getTime() + 2 * 3600e3).toISOString().slice(0, 10); },
  stamp(iso) {
    if (!iso) return '';
    const t = new Date(new Date(iso).getTime() + 2 * 3600e3).toISOString();
    return D.nice(t.slice(0, 10)) + ', ' + t.slice(11, 16);
  }
};

const ROLES = {
  ADMIN: 'System Administrator', BDIH_DIRECTOR: 'BDIH Director', BDIH_LEAD: 'BDIH Project Leader',
  BDIH_PO: 'BDIH Project Officer', BDIH_BA: 'BDIH Business Analyst', BDIH_TEAM: 'BDIH Developer',
  BOCRA_REP: 'BOCRA Project Lead', BOCRA_TEAM: 'BOCRA Team Member',
  DEV_LEAD: 'Developer Lead', DEV_MEMBER: 'Developer Team Member'
};
const ROLE_ORGS = {
  ADMIN: ['BDIH'], BDIH_DIRECTOR: ['BDIH'], BDIH_LEAD: ['BDIH'], BDIH_PO: ['BDIH'], BDIH_BA: ['BDIH'], BDIH_TEAM: ['BDIH'],
  BOCRA_REP: ['BOCRA'], BOCRA_TEAM: ['BOCRA'], DEV_LEAD: ['DEVA', 'DEVB'], DEV_MEMBER: ['DEVA', 'DEVB']
};
const BDIH_STAFF = ['ADMIN', 'BDIH_LEAD', 'BDIH_PO', 'BDIH_BA', 'BDIH_TEAM'];
// Role-based access: each permission lists the roles that hold it by default. Administrators can
// change the grid (Administration, Roles and permissions); scope rules (own workstream) still apply.
const PERMISSIONS = [
  ['plan.edit', 'Edit the project plan: activities, links, durations, dates', ['ADMIN', 'BDIH_LEAD', 'BDIH_PO', 'BDIH_BA']],
  ['plan.baseline', 'Save baselines and lock reporting periods', ['ADMIN', 'BDIH_LEAD']],
  ['progress.any', 'Update progress on any activity', BDIH_STAFF],
  ['progress.own', 'Update progress in own workstream', ['DEV_LEAD', 'DEV_MEMBER']],
  ['progress.bocra', 'Update activities that BOCRA leads', ['BOCRA_REP', 'BOCRA_TEAM']],
  ['submit.deliverable', 'Submit deliverables for review', ['ADMIN', 'BDIH_LEAD', 'DEV_LEAD']],
  ['review.bdih', 'Record the BDIH review recommendation', BDIH_STAFF],
  ['review.bocra', 'Approve or return submissions for BOCRA', ['ADMIN', 'BOCRA_REP']],
  ['weekly.file', 'File the weekly developer report', ['DEV_LEAD']],
  ['weekly.review', 'Review weekly developer reports', BDIH_STAFF],
  ['report.publish', 'Publish the official monthly report', ['ADMIN', 'BDIH_LEAD']],
  ['invoice.submit', 'Raise invoices', ['ADMIN', 'BDIH_LEAD', 'DEV_LEAD']],
  ['invoice.status', 'Update invoice status', ['ADMIN', 'BOCRA_REP']],
  ['bank.upload', 'Add documents to the document bank', BDIH_STAFF.concat(['BOCRA_REP', 'BOCRA_TEAM'])],
  ['register.edit', 'Edit risks, issues and decisions', BDIH_STAFF.concat(['BOCRA_REP'])],
  ['register.delete', 'Delete register entries', ['ADMIN', 'BDIH_LEAD']],
  ['cr.recommend', 'Assess and recommend change requests', ['ADMIN', 'BDIH_LEAD']],
  ['cr.decide', 'Decide change requests for BOCRA', ['ADMIN', 'BOCRA_REP']],
  ['meeting.edit', 'Record meetings and minutes', BDIH_STAFF],
  ['settings.edit', 'Edit settings and the closure calendar', ['ADMIN', 'BDIH_LEAD']],
  ['ticket.create', 'Raise tickets for the developers', BDIH_STAFF.concat(['BOCRA_REP', 'BOCRA_TEAM', 'DEV_LEAD', 'DEV_MEMBER'])],
  ['ticket.manage', 'Move, assign and edit tickets', BDIH_STAFF.concat(['DEV_LEAD', 'DEV_MEMBER'])],
  ['users.manage', 'Manage users, roles and passwords', ['ADMIN']],
  ['audit.view', 'View the audit log', ['ADMIN', 'BDIH_LEAD', 'BDIH_DIRECTOR']]
];
// Permissions a Developer Lead can delegate to a team member
const DELEGABLE = ['submit.deliverable', 'weekly.file', 'invoice.submit'];
function permRoles(key) {
  const o = Store.state && Store.state.rolePerms && Store.state.rolePerms[key];
  return o || (PERMISSIONS.find(p => p[0] === key) || [, , []])[2];
}
function hasPerm(u, key) {
  if (!u || !u.active) return false;
  const rs = rolesOf(u), allowed = permRoles(key);
  if (key === 'users.manage' && rs.includes('ADMIN')) return true;   // never lock out the administrator
  if (rs.some(r => allowed.includes(r))) return true;
  return rs.includes('DEV_MEMBER') && !!u.delegated && DELEGABLE.includes(key) && allowed.includes('DEV_LEAD');
}
// A user can hold several roles: a primary role plus extra roles, all within their organisation
const rolesOf = u => (u ? [u.role].concat((u.extraRoles || []).filter(r => r !== u.role)) : []);
const hasRole = (u, ...roles) => rolesOf(u).some(r => roles.includes(r));
const roleLabel = u => rolesOf(u).map(r => roleName(r)).join(', ');
// The Director view is read-only unless the person also holds a working role
const isViewer = u => !!u && rolesOf(u).every(r => r === 'BDIH_DIRECTOR');
const STATUSES = ['Not started', 'In progress', 'Submitted', 'Under BDIH review', 'Returned to developer',
  'Under BOCRA review', 'Approved', 'Complete', 'On hold', 'Cancelled'];
const TYPES = ['Task', 'Review', 'Milestone', 'Meeting', 'Report'];
const DEFAULT_PHASES = ['Phase 1', 'Phase 2', 'Phase 3'];
const DEFAULT_PHASE_NAMES = {
  'Phase 1': 'Phase 1: Planning and requirements',
  'Phase 2': 'Phase 2: Design and build',
  'Phase 3': 'Phase 3: Testing, commissioning and closure'
};
const HEALTH = ['Complete', 'Cancelled', 'Ongoing', 'Late', 'Behind', 'Not due', 'On track'];
const FILE_TYPES = ['pdf', 'docx', 'xlsx', 'pptx', 'png', 'jpg', 'jpeg', 'svg', 'zip', 'mp4', 'csv', 'txt', 'md'];
const MAX_FILE = 100 * 1024 * 1024;
const COMMON_PASSWORDS = ['password1234', 'password12345', '123456789012', 'qwerty123456', 'botswana2026',
  'letmein12345', 'welcome12345', 'admin1234567', 'iloveyou1234', 'changeme1234', 'gaborone2026', 'abc123456789'];

/* ---------- Business-day calendar ---------- */

class Calendar {
  constructor(settings, holidays) {
    const closed = new Map();
    if (settings.festiveStart && settings.festiveEnd && settings.festiveStart <= settings.festiveEnd) {
      for (let d = settings.festiveStart; d <= settings.festiveEnd; d = D.add(d, 1)) closed.set(d, 'Festive closure');
    }
    (holidays || []).forEach(h => { if (!closed.has(h.date)) closed.set(h.date, h.reason); });
    this.closed = closed;
    this.from = D.add(settings.projectStart, -400);
    this.to = D.add(settings.projectStart, 1500);
    this.days = [];
    this.idx = new Map();
    for (let d = this.from; d <= this.to; d = D.add(d, 1)) {
      const w = D.dow(d);
      if (w !== 0 && w !== 6 && !closed.has(d)) { this.idx.set(d, this.days.length); this.days.push(d); }
    }
  }
  isClosed(d) { const w = D.dow(d); return w === 0 || w === 6 || this.closed.has(d); }
  // Index of the first business day on or after d
  ceil(d) {
    if (d < this.from) return 0;
    if (d > this.to) return this.days.length - 1;
    for (let g = 0; g < 60 && !this.idx.has(d); g++) d = D.add(d, 1);
    return this.idx.has(d) ? this.idx.get(d) : this.days.length - 1;
  }
  // Index of the last business day on or before d
  floor(d) {
    if (d < this.from) return 0;
    if (d > this.to) return this.days.length - 1;
    for (let g = 0; g < 60 && !this.idx.has(d); g++) d = D.add(d, -1);
    return this.idx.has(d) ? this.idx.get(d) : 0;
  }
  date(i) { return this.days[Math.max(0, Math.min(this.days.length - 1, i))]; }
  addBD(d, n) { return this.date(this.ceil(d) + n); }
}

/* ---------- Scheduling engine (Appendix B.1) ---------- */

function actDuration(a, S) {
  if (a.type === 'Milestone') return 0;
  if (a.type === 'Review' && a.reviewStage === 'BDIH') return +S.settings.bdihReviewDays || 3;
  if (a.type === 'Review' && a.reviewStage === 'BOCRA') return +S.settings.bocraReviewDays || 5;
  return Math.max(1, +a.duration || 1);
}

function isDone(a) { return a.status === 'Complete' || a.status === 'Approved'; }

function runSchedule(S) {
  const cal = new Calendar(S.settings, S.holidays);
  S._cal = cal;
  const acts = S.activities.filter(a => !a.deleted);
  const by = new Map(acts.map(a => [a.id, a]));
  const preds = new Map(), succs = new Map();
  acts.forEach(a => { preds.set(a.id, []); succs.set(a.id, []); });
  S.links.forEach(l => {
    if (by.has(l.from) && by.has(l.to)) { preds.get(l.to).push(l); succs.get(l.from).push(l); }
  });
  S._by = by; S._preds = preds; S._succs = succs;

  // Topological order (Kahn)
  const indeg = new Map(acts.map(a => [a.id, preds.get(a.id).length]));
  const queue = acts.filter(a => !indeg.get(a.id)).map(a => a.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    succs.get(id).forEach(l => { indeg.set(l.to, indeg.get(l.to) - 1); if (!indeg.get(l.to)) queue.push(l.to); });
  }
  const errors = [];
  if (order.length < acts.length) {
    const stuck = acts.filter(a => !order.includes(a.id));
    errors.push('Circular dependency involving: ' + stuck.map(a => a.name).join(', '));
    stuck.forEach(a => order.push(a.id));
  }

  const ps = cal.ceil(S.settings.projectStart);
  order.forEach(id => {
    const a = by.get(id), pl = preds.get(id), ms = a.type === 'Milestone';
    a._dur = actDuration(a, S);
    // Milestones complete themselves when every predecessor is complete
    if (ms && pl.length) {
      const all = pl.every(l => isDone(by.get(l.from)));
      if (all && !isDone(a)) {
        a.status = 'Complete'; a.pct = 100; a.autoDone = true;
        a.actualFinish = cal.date(Math.max(...pl.map(l => by.get(l.from)._fi)));
      } else if (!all && a.autoDone) {
        a.status = 'Not started'; a.pct = 0; a.actualFinish = null; a.autoDone = false;
      }
    }
    let es;
    if (a.actualStart && !ms) es = cal.ceil(a.actualStart);
    else if (a.fixedStart) es = cal.ceil(a.fixedStart);
    else if (pl.length) {
      es = -1e9;
      pl.forEach(l => {
        const pf = by.get(l.from)._fi ?? ps, lag = +l.lag || 0;
        es = Math.max(es, ms ? pf + lag : pf + 1 + lag);
      });
    } else es = ps;
    let ef = ms ? es : es + a._dur - 1;
    if (a.actualFinish) { ef = cal.floor(a.actualFinish); if (ms || ef < es) es = ms ? ef : Math.min(es, ef); }
    a._si = es; a._fi = ef; a.start = cal.date(es); a.finish = cal.date(ef);
  });

  // Backward pass for critical path, per workstream
  const wsEnd = {};
  acts.forEach(a => { wsEnd[a.ws] = Math.max(wsEnd[a.ws] ?? -1e9, a._fi); });
  [...order].reverse().forEach(id => {
    const a = by.get(id);
    const same = succs.get(id).filter(l => by.get(l.to).ws === a.ws);
    let lf;
    if (!same.length) lf = wsEnd[a.ws];
    else {
      lf = 1e9;
      same.forEach(l => {
        const s = by.get(l.to), lag = +l.lag || 0;
        lf = Math.min(lf, s.type === 'Milestone' ? s._ls - lag : s._ls - 1 - lag);
      });
    }
    a._ls = a.type === 'Milestone' ? lf : lf - a._dur + 1;
    a._float = a._ls - a._si;
    a._crit = a._float <= 0 && a.type !== 'Meeting' && !isDone(a) && a.status !== 'Cancelled';
  });
  return errors;
}

// Would linking from -> to create a cycle? Returns the path names if so.
function findCycle(S, from, to) {
  const seen = new Set(), stack = [[to, [to]]];
  while (stack.length) {
    const [id, path] = stack.pop();
    if (id === from) return path;
    if (seen.has(id)) continue;
    seen.add(id);
    (S._succs.get(id) || []).forEach(l => stack.push([l.to, path.concat(l.to)]));
  }
  return null;
}

/* ---------- Progress and health (Appendix B.2) ---------- */

function plannedPct(a, sdi) {
  if (a.type === 'Milestone') return sdi >= a._fi ? 100 : 0;
  if (sdi < a._si) return 0;
  return Math.min(100, Math.round((sdi - a._si + 1) / Math.max(1, a._dur) * 100));
}

function health(a, sdi) {
  const pct = +a.pct || 0;
  if (isDone(a)) return 'Complete';
  if (a.status === 'Cancelled') return 'Cancelled';
  if (a.type === 'Meeting' && a._dur > 1 && a._si <= sdi && sdi <= a._fi) return 'Ongoing';
  if (a._fi < sdi && pct < 100) return 'Late';
  if (pct < 100 && plannedPct(a, sdi) - pct > 10) return 'Behind';
  if (a._si > sdi) return 'Not due';
  return 'On track';
}

function weighted(acts, sdi) {
  let w = 0, act = 0, pl = 0;
  acts.forEach(a => {
    if (a.deleted || a.type === 'Meeting' || a.type === 'Milestone' || a.status === 'Cancelled') return;
    const d = Math.max(1, a._dur);
    w += d; act += d * (+a.pct || 0); pl += d * plannedPct(a, sdi);
  });
  return { actual: w ? act / w : 0, planned: w ? pl / w : 0 };
}

function perfStatus(actual, planned, s) {
  if (planned <= 0) return { spi: null, status: 'On track' };
  const spi = actual / planned;
  return { spi, status: spi >= s.thrOnTrack ? 'On track' : spi >= s.thrAtRisk ? 'At risk' : 'Off track' };
}

function currentBaseline(S) { return S.baselines.find(b => b.id === S.settings.currentBaselineId) || null; }

function slipOf(S, a) {
  const bl = currentBaseline(S);
  const it = bl && bl.items[a.id];
  if (!it) return null;
  return a._fi - S._cal.ceil(it.finish);
}

function contractEnd(S) {
  const c = S._cal;
  return c.date(c.floor(D.add(D.addMonths(S.settings.projectStart, +S.settings.contractMonths || 3), -1)));
}

/* ---------- Access rules (SRS section 3) ---------- */

function isOversight(u) { return !!u && (u.org === 'BDIH' || u.org === 'BOCRA'); }

// Workstreams a developer is mapped to (user_workstreams); null means oversight (all)
function wsOf(u) {
  if (!u) return [];
  if (isOversight(u)) return null;
  const base = u.org === 'DEVA' ? ['A'] : u.org === 'DEVB' ? ['B'] : [];
  return base.concat(u.extraWs || []);
}

function canSee(u, ws, visibleToDevs) {
  if (!u || !u.active) return false;
  if (isOversight(u)) return true;
  if ((wsOf(u) || []).includes(ws)) return true;
  return ws === 'S' && !!visibleToDevs;
}
function canSeeItem(u, it) { return !!it && canSee(u, it.ws, it.visibleToDevs); }

const can = {
  editPlan: u => hasPerm(u, 'plan.edit'),
  editSettings: u => hasPerm(u, 'settings.edit'),
  admin: u => hasPerm(u, 'users.manage'),
  audit: u => hasPerm(u, 'audit.view'),
  baseline: u => hasPerm(u, 'plan.baseline'),
  progress(u, a) {
    if (!canSeeItem(u, a)) return false;
    if (hasPerm(u, 'progress.any')) return true;
    if (hasPerm(u, 'progress.bocra')) { const r = Store.state.resources.find(x => x.id === a.lead); if (r && r.org === 'BOCRA') return true; }
    return hasPerm(u, 'progress.own') && (wsOf(u) || []).includes(a.ws);
  },
  submit(u, a) {
    if (!a || !a.submittable || !canSeeItem(u, a) || !hasPerm(u, 'submit.deliverable')) return false;
    if (u.org === 'BDIH') return true;
    return a.ws !== 'S' && (wsOf(u) || []).includes(a.ws);
  },
  bdihReview: u => hasPerm(u, 'review.bdih'),
  bocraDecide: u => hasPerm(u, 'review.bocra'),
  weekly: u => hasPerm(u, 'weekly.file'),
  weeklyReview: u => hasPerm(u, 'weekly.review'),
  publish: u => hasPerm(u, 'report.publish'),
  upload: u => !isViewer(u),
  docDelete: (u, d) => hasPerm(u, 'progress.any') || d.versions.some(v => v.by === u.id),
  regCreate: u => !isViewer(u),
  regEdit: u => hasPerm(u, 'register.edit'),
  regDelete: u => hasPerm(u, 'register.delete'),
  crRecommend: u => hasPerm(u, 'cr.recommend'),
  crDecide: u => hasPerm(u, 'cr.decide'),
  meetingEdit: u => hasPerm(u, 'meeting.edit'),
  resources: u => isOversight(u),
  // Invoices: developers and BDIH raise them; they go to the BOCRA Project Lead, who sets the status
  invoiceSubmit: u => hasPerm(u, 'invoice.submit'),
  invoiceStatus: u => hasPerm(u, 'invoice.status'),
  seeInvoice: (u, inv) => isOversight(u) || inv.org === u.org,
  bankUpload: u => hasPerm(u, 'bank.upload')
};
const INVOICE_STATUSES = ['Submitted', 'Under review', 'Queried', 'Approved for payment', 'Paid', 'Rejected'];

/* ---------- Values the administrator can change (Administration, Settings and Lists) ---------- */
const cfg = () => (Store.state && Store.state.settings) || {};
const lists = () => (Store.state && Store.state.lookups) || {};
// Phases: keys stay stable on activities; the administrator edits the display names and adds phases
function phaseKeys() { return (lists().phases || DEFAULT_PHASES.map(k => ({ key: k, name: DEFAULT_PHASE_NAMES[k] }))).map(p => p.key); }
function phaseName(k) { const p = (lists().phases || []).find(x => x.key === k); return p ? p.name : DEFAULT_PHASE_NAMES[k] || k; }
// Role names can be relabelled; the role keys and their permissions stay the same
function roleName(r) { return ((Store.state && Store.state.roleNames) || {})[r] || ROLES[r] || r; }
function roleEntries() { return Object.keys(ROLES).map(r => [r, roleName(r)]); }
const vatRate = () => (cfg().vatRate ?? 14) / 100;
const securityCfg = () => ({ idleMin: +cfg().idleMinutes || 30, maxHours: +cfg().sessionHours || 12, attempts: +cfg().lockoutAttempts || 5, lockMin: +cfg().lockoutMinutes || 15, pwMin: +cfg().passwordMinLength || 12 });
const brand = () => ({ app: cfg().appName || 'Project Tracker', project: cfg().projectName || 'BOCRA and UASF Trust websites', sub: cfg().appSubtitle || 'BOCRA and UASF Trust websites' });

/* ---------- Store ---------- */

const STORE_KEY = 'bdih-ptt-v6';
const Store = {
  state: null,
  load() {
    try { const raw = localStorage.getItem(STORE_KEY); if (raw) this.state = JSON.parse(raw); } catch (e) { this.state = null; }
    if (!this.state || !this.state.settings) this.state = seedState();
    runSchedule(this.state);
  },
  save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.state, (k, v) => (k[0] === '_' ? undefined : v)));
    } catch (e) {
      if (typeof toast === 'function') toast('Could not save in this browser: ' + e.message, 'err');
    }
  },
  reset() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
    this.state = seedState();
    runSchedule(this.state);
    this.save();
  }
};

function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// Prototype only: a salted FNV-1a hash. Production uses Supabase Auth hashing.
function hashPw(pw) {
  let h = 0x811c9dc5;
  const s = 'bdih-ptt:' + pw;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return 'fnv$' + h.toString(16);
}

function passwordProblem(pw, username) {
  const min = securityCfg().pwMin;
  if (pw.length < min) return 'Passwords must be at least ' + min + ' characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Passwords need at least one letter and one digit.';
  const low = pw.toLowerCase();
  if (COMMON_PASSWORDS.includes(low) || (username && low.includes(username.toLowerCase()))) return 'That password is too common or contains your username. Choose another.';
  return null;
}
