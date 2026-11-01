'use strict';
/* Main dashboard, document bank, user management, project plan editor, roles and permissions,
   requests and the custom report builder. Loaded after views.js; same helpers and visibility rules. */

/* ---------- Dashboard charts ---------- */

function ring(actual, planned, cls) {
  const R = 54, C = 2 * Math.PI * R, a = clamp(actual) / 100, p = clamp(planned) / 100;
  return `<svg class="ring ${cls || ''}" viewBox="0 0 140 140" role="img" aria-label="${pc(actual)} complete against ${pc(planned)} planned">
    <circle cx="70" cy="70" r="${R}" class="rg-track"/>
    <circle cx="70" cy="70" r="${R + 9}" class="rg-plan-track"/>
    <circle cx="70" cy="70" r="${R + 9}" class="rg-plan" stroke-dasharray="${(2 * Math.PI * (R + 9) * p).toFixed(1)} 999" transform="rotate(-90 70 70)"/>
    <circle cx="70" cy="70" r="${R}" class="rg-act" stroke-dasharray="${(C * a).toFixed(1)} 999" transform="rotate(-90 70 70)"/>
    <text x="70" y="70" class="rg-v" text-anchor="middle">${pc(actual)}</text>
    <text x="70" y="92" class="rg-l" text-anchor="middle">of ${pc(planned)} planned</text></svg>`;
}

// Planned (baseline), forecast and actual cumulative % complete over time for one workstream
function sCurve(ws) {
  const S = St(), cal = S._cal, bl = currentBaseline(S), todayI = cal.floor(D.today());
  const acts = S.activities.filter(a => !a.deleted && a.ws === ws && !['Meeting', 'Milestone'].includes(a.type) && a.status !== 'Cancelled');
  if (!acts.length) return '';
  const start = S.settings.projectStart;
  const endD = cal.date(Math.max(cal.ceil(contractEnd(S)), ...acts.map(a => a._fi)) + 3);
  const days = D.diff(start, endD);
  const W = 560, H = 230, L = 46, Rp = 14, T = 14, B = 34;
  const x = d => L + (D.diff(start, d) / days) * (W - L - Rp);
  const y = v => T + (1 - v / 100) * (H - T - B);
  const tot = acts.reduce((t, a) => t + a._dur, 0);
  const blPct = d => {
    const di = cal.floor(d);
    return acts.reduce((t, a) => {
      const it = bl && bl.items[a.id]; if (!it) return t;
      const si = cal.ceil(it.start);
      return t + a._dur * Math.min(1, Math.max(0, (di - si + 1) / a._dur));
    }, 0) / tot * 100;
  };
  const fcPct = d => acts.reduce((t, a) => t + a._dur * plannedPct(a, cal.floor(d)) / 100, 0) / tot * 100;
  const acPct = d => {
    const di = cal.floor(d);
    return acts.reduce((t, a) => {
      if (!a.actualStart || d < a.actualStart) return t;
      const s = cal.ceil(a.actualStart), e = a.actualFinish ? cal.floor(a.actualFinish) : todayI;
      const share = e <= s ? 1 : Math.min(1, (di - s + 1) / (e - s + 1));
      return t + a._dur * (+a.pct || 0) / 100 * share;
    }, 0) / tot * 100;
  };
  const pts = [];
  for (let d = start; d <= endD; d = D.add(d, 3)) pts.push(d);
  const today = D.today() < endD ? D.today() : endD;
  const line = (f, until) => pts.filter(d => !until || d <= until).concat(until && until > start ? [until] : []).map((d, k) => (k ? 'L' : 'M') + x(d).toFixed(1) + ' ' + y(f(d)).toFixed(1)).join(' ');
  let g = '';
  [0, 25, 50, 75, 100].forEach(v => { g += `<line x1="${L}" x2="${W - Rp}" y1="${y(v)}" y2="${y(v)}" class="sc-grid"/><text x="${L - 8}" y="${y(v) + 5}" class="sc-ax" text-anchor="end">${v}%</text>`; });
  for (let d = D.add(start, 0); d <= endD; d = D.add(d, 1)) if (D.parse(d).getUTCDate() === 1) g += `<text x="${x(d)}" y="${H - 10}" class="sc-ax" text-anchor="middle">${MONTHS[D.parse(d).getUTCMonth()]}</text><line x1="${x(d)}" x2="${x(d)}" y1="${H - B}" y2="${H - B + 5}" class="sc-grid"/>`;
  if (S.settings.festiveStart) g += `<rect x="${x(S.settings.festiveStart)}" y="${T}" width="${Math.max(2, x(S.settings.festiveEnd) - x(S.settings.festiveStart))}" height="${H - T - B}" class="sc-closed"><title>Festive closure</title></rect>`;
  const ce = contractEnd(S);
  g += `<line x1="${x(ce)}" x2="${x(ce)}" y1="${T}" y2="${H - B}" class="sc-ce"/><text x="${x(ce) - 4}" y="${T + 14}" class="sc-ax" text-anchor="end">Contract end</text>`;
  g += `<line x1="${x(today)}" x2="${x(today)}" y1="${T}" y2="${H - B}" class="sc-today"/>`;
  if (bl) g += `<path d="${line(blPct)}" class="sc-bl"/>`;
  g += `<path d="${line(fcPct)}" class="sc-fc ws-${ws}"/>`;
  g += `<path d="${line(acPct, today)}" class="sc-ac ws-${ws}"/><circle cx="${x(today)}" cy="${y(acPct(today))}" r="5" class="sc-dot ws-${ws}"/>`;
  return `<svg class="scurve" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative progress for ${esc(wsName(ws))}: baseline, forecast and actual">${g}</svg>
   <p class="legend"><span class="ln dash"></span>Baseline <span class="ln fc ws-${ws}"></span>Forecast <span class="ln ac ws-${ws}"></span>Actual</p>`;
}

// Programme timeline: phases per website, milestones, closure, today and contract end
function programmeTimeline() {
  const S = St(), cal = S._cal, start = S.settings.projectStart, ce = contractEnd(S);
  const key = k => S.activities.find(a => a.key === k && !a.deleted);
  const lastFin = Math.max(...['A-COMM', 'B-COMM', 'CLOSE'].map(k => (key(k) || {})._fi || 0), cal.ceil(ce));
  const end = D.add(cal.date(lastFin), 6);
  const days = D.diff(start, end), W = 1000, L = 150, Rp = 16;
  const x = d => L + D.diff(start, d) / days * (W - L - Rp);
  const rows = [['A', 'BOCRA website'], ['B', 'UASF website']];
  const H = 70 + rows.length * 52 + 26;
  let g = '';
  for (let d = start; d <= end; d = D.add(d, 1)) if (D.parse(d).getUTCDate() === 1 || d === start) g += `<line x1="${x(d)}" x2="${x(d)}" y1="30" y2="${H - 26}" class="tl-grid"/><text x="${x(d) + 4}" y="22" class="tl-ax">${D.month(d)}</text>`;
  if (S.settings.festiveStart) g += `<rect x="${x(S.settings.festiveStart)}" y="34" width="${x(S.settings.festiveEnd) - x(S.settings.festiveStart)}" height="${H - 60}" class="tl-closed"/><text x="${(x(S.settings.festiveStart) + x(S.settings.festiveEnd)) / 2}" y="${H - 8}" class="tl-ax" text-anchor="middle">Festive closure</text>`;
  rows.forEach(([ws, name], r) => {
    const y0 = 52 + r * 52, p1 = key(ws + '-M1'), p2 = key(ws + '-M2'), cm = key(ws + '-COMM');
    g += `<text x="0" y="${y0 + 19}" class="tl-row">${esc(name)}</text>`;
    const segs = [[start, p1 && p1.finish, 'Phase 1', 'p1'], [p1 && p1.finish, p2 && p2.finish, 'Phase 2', 'p2'], [p2 && p2.finish, cm && cm.finish, 'Phase 3', 'p3']];
    segs.forEach(([a, b, t, c]) => {
      if (!a || !b) return;
      const w = Math.max(2, x(b) - x(a));
      g += `<rect x="${x(a)}" y="${y0}" width="${w}" height="26" class="tl-${c}"><title>${t}: ${D.nice(a)} to ${D.nice(b)}</title></rect>`;
      if (w > 70) g += `<text x="${x(a) + 8}" y="${y0 + 18}" class="tl-seg">${t}</text>`;
    });
    [p1, p2, cm].forEach(m => {
      if (!m) return;
      const mx = x(m.finish), done = isDone(m), late = health(m, sdi()) === 'Late';
      g += `<path d="M${mx} ${y0 - 6} l7 7 -7 7 -7 -7z" class="tl-ms ${done ? 'done' : late ? 'late' : ''}"><title>${esc(m.name)}: ${D.nice(m.finish)}${done ? ' (complete)' : ''}</title></path>`;
      const b = blFinish(m);
      if (b && b !== m.finish) g += `<line x1="${x(b)}" x2="${x(b)}" y1="${y0 + 28}" y2="${y0 + 36}" class="tl-bl"><title>Baseline ${D.nice(b)}</title></line>`;
    });
    if (cm) g += `<text x="${Math.min(x(cm.finish) + 12, W - Rp - 4)}" y="${y0 + 19}" class="tl-lab" ${x(cm.finish) + 120 > W ? 'text-anchor="end"' : ''}>${D.short(cm.finish)}</text>`;
  });
  const tx = x(D.today());
  g += `<line x1="${tx}" x2="${tx}" y1="30" y2="${H - 26}" class="tl-today"/><text x="${tx + 4}" y="44" class="tl-lab today">Today</text>`;
  g += `<line x1="${x(ce)}" x2="${x(ce)}" y1="30" y2="${H - 26}" class="tl-ce"/><text x="${x(ce) - 4}" y="44" class="tl-lab ce" text-anchor="end">Contract end ${D.short(ce)}</text>`;
  return `<div class="tl-wrap"><svg class="timeline-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Programme timeline by website">${g}</svg></div>
   <p class="legend"><span class="sw tl-p1"></span>Phase 1 <span class="sw tl-p2"></span>Phase 2 <span class="sw tl-p3"></span>Phase 3 <span class="sw diamond"></span>Milestone <span class="sw tick"></span>Baseline date</p>`;
}

function devColumn(ws) {
  const st = wsStats(ws), S = St(), i = sdi();
  const q = h => `#/schedule?ws=${ws}&health=${encodeURIComponent(h)}`;
  const subs = S.submissions.filter(s => s.ws === ws && s.state.startsWith('Under'));
  const comm = st.comm, slip = comm ? slipOf(S, comm) : null;
  return `<section class="dcol ws-${ws}">
   <header class="dcol-h">${wsLogo(ws, 'dcol-logo')}<div><h2>${esc(wsName(ws))}</h2><p>${esc(orgName(S.workstreams.find(w => w.id === ws).owner))}, ${esc(phaseName(st.phase) || st.phase)}</p></div>${perfB(st.status)}</header>
   <div class="dcol-top">${ring(st.actual, st.planned, 'ws-' + ws)}
    <dl class="mini">
     <div><dt>Schedule performance</dt><dd>${st.spi == null ? 'n/a' : st.spi.toFixed(2)}</dd></div>
     <div><dt>Commissioning</dt><dd>${comm ? D.short(comm.finish) : 'n/a'} <small class="${slip > 0 ? 'bad' : ''}">${slip == null ? '' : slip > 0 ? '+' + slip + ' bd' : slip < 0 ? slip + ' bd' : 'on baseline'}</small></dd></div>
     <div><dt>Complete</dt><dd><a href="${q('Complete')}">${st.complete}</a> <small>of ${st.total}</small></dd></div>
     <div><dt>Late / behind</dt><dd><a class="${st.late.length ? 'bad' : ''}" href="${q('Late')}">${st.late.length}</a> / <a class="${st.behind.length ? 'warnc' : ''}" href="${q('Behind')}">${st.behind.length}</a></dd></div>
    </dl></div>
   <div class="dcol-chart">${sCurve(ws)}</div>
   <div class="dcol-row"><span>Deliverables approved</span><div class="seg">${Array.from({ length: st.subsTotal }, (_, k) => `<i class="${k < st.subsDone ? 'on' : ''}"></i>`).join('')}</div><strong>${st.subsDone}/${st.subsTotal}</strong></div>
   <div class="dcol-row"><span>Next milestone</span><strong>${st.nextMs ? actLink(st.nextMs) + ', ' + D.short(st.nextMs.finish) : 'None'}</strong></div>
   <div class="dcol-row"><span>Open tickets</span><a class="tk" href="#/tickets?ws=${ws}">${(S.tickets || []).filter(t => t.ws === ws && t.status !== 'Done').length} open, ${(S.tickets || []).filter(t => t.ws === ws && t.status === 'Blocked').length} blocked</a></div>
   <div class="dcol-row"><span>Next deliverable</span><strong>${st.nextDue ? actLink(st.nextDue) + ', ' + D.short(st.nextDue.finish) : 'None'}</strong></div>
   <h3>In review</h3>${subs.length ? `<ul class="alist">${subs.map(s => { const r = S.reviews.find(x => x.submissionId === s.id && !x.decidedAt); return `<li>${actLink(actOf(s.activityId))} <span class="muted">v${s.version}, ${r ? r.stage : ''}</span> ${r ? timer(r.due) : ''}</li>`; }).join('')}</ul>` : '<p class="empty">Nothing in review.</p>'}
   <h3>Needs attention</h3>${actList(st.late.concat(st.behind).slice(0, 5), 'Nothing late or behind.')}
  </section>`;
}

VIEWS.dashboard = () => {
  const u = Ctx.u;
  if (!isOversight(u)) return VIEWS.devdash({}, {});
  const S = St(), i = sdi(), cal = S._cal;
  const all = S.activities.filter(a => !a.deleted);
  const w = weighted(all, i), p = perfStatus(w.actual, w.planned, S.settings);
  const A = wsStats('A'), B = wsStats('B'), ce = contractEnd(S);
  const bdToCe = cal.ceil(ce) - cal.floor(D.today());
  const slipTxt2 = st => { const s = st.comm ? slipOf(S, st.comm) : null; return s > 0 ? `${s} business days behind baseline` : s < 0 ? `${-s} business days ahead of baseline` : 'on baseline'; };
  const revs = openReviews(u);
  const overdue = revs.filter(x => bdLeft(x.r.due) < 0).length;
  const subsAll = all.filter(a => a.submittable);
  const invOpen = S.invoices.filter(x => ['Submitted', 'Under review', 'Queried'].includes(x.status));
  const highRisks = S.risks.filter(r => r.status !== 'Closed').sort((a, b) => b.likelihood * b.impact - a.likelihood * a.impact);
  const upcoming = all.filter(a => !isDone(a) && a._si > i && a._si <= i + 10 && a.type !== 'Meeting').sort((a, b) => a._si - b._si).slice(0, 8);
  const lates = all.filter(a => health(a, i) === 'Late').length;
  return `<section class="hero">
   <div class="hero-l"><p class="eyebrow">Project position at ${D.nice(cal.date(i))}</p>
    <h1>${esc(brand().project)}</h1>
    <p class="lede">The project is <strong class="p-${slug(p.status)}">${p.status.toLowerCase()}</strong>: ${pc(w.actual)} complete against ${pc(w.planned)} planned.
    The BOCRA website is forecast to be commissioned on ${A.comm ? D.nice(A.comm.finish) : 'n/a'} (${slipTxt2(A)}) and the UASF website on ${B.comm ? D.nice(B.comm.finish) : 'n/a'} (${slipTxt2(B)}).</p>
    <div class="actions"><a class="btn" href="#/reports">Progress report</a><button class="btn ghost" data-act="printPage">Export to PDF</button></div></div>
   <div class="hero-r">${ring(w.actual, w.planned, 'big')}<p class="small muted">Whole project, weighted by duration</p></div>
  </section>
  <section class="stats">
   <a href="#/admin?tab=calendar"><span>Contract end</span><strong>${D.short(ce)}</strong><em>${bdToCe >= 0 ? bdToCe + ' business days left' : -bdToCe + ' business days past'}</em></a>
   <a href="#/registers?tab=deliverables"><span>Deliverables approved</span><strong>${subsAll.filter(isDone).length}<small>/${subsAll.length}</small></strong><em>across both websites and BDIH</em></a>
   <a href="#/submissions"><span>Reviews open</span><strong>${revs.length}</strong><em class="${overdue ? 'bad' : ''}">${overdue} overdue</em></a>
   <a href="#/schedule?health=Late"><span>Late activities</span><strong class="${lates ? 'bad' : ''}">${lates}</strong><em>finish date passed</em></a>
   <a href="#/invoices"><span>Invoices with BOCRA</span><strong>${invOpen.length}</strong><em>${money(invOpen.reduce((t, x) => t + x.amount + x.vat, 0))}</em></a>
   <a href="#/registers?tab=risks"><span>High risks</span><strong>${highRisks.filter(r => r.likelihood * r.impact >= 15).length}</strong><em>${highRisks.length} open in total</em></a>
  </section>
  <section class="card"><div class="ph"><h2>Programme timeline</h2></div>${programmeTimeline()}</section>
  <div class="dcols">${devColumn('A')}${devColumn('B')}</div>
  <div class="grid g3">
   <section class="card"><h2>Review timers</h2>${['BDIH', 'BOCRA'].map(stg => { const l = revs.filter(x => x.r.stage === stg); return `<h3>${stg} (${stg === 'BDIH' ? S.settings.bdihReviewDays : S.settings.bocraReviewDays} business days)</h3>${l.length ? `<ul class="alist">${l.map(({ r, s, a }) => `<li>${wsTag(a.ws)} ${actLink(a)} ${timer(r.due)}</li>`).join('')}</ul>` : '<p class="empty">None open.</p>'}`; }).join('')}</section>
   <section class="card"><h2>Next 10 business days</h2>${upcoming.length ? `<ul class="alist">${upcoming.map(a => `<li><span class="when">${D.short(a.start)}</span> ${wsTag(a.ws)} ${actLink(a)}</li>`).join('')}</ul>` : '<p class="empty">Nothing starting.</p>'}</section>
   <section class="card"><h2>Top risks</h2>${highRisks.length ? `<ul class="alist">${highRisks.slice(0, 5).map(r => `<li><span class="score s${r.likelihood * r.impact >= 15 ? 'hi' : r.likelihood * r.impact >= 8 ? 'md' : 'lo'}">${r.likelihood * r.impact}</span> ${esc(r.title)} ${wsTag(r.ws)}</li>`).join('')}</ul>` : '<p class="empty">No open risks.</p>'}<p><a href="#/registers?tab=risks">Risk register</a></p></section>
  </div>`;
};

/* ---------- Document bank: templates and guidance from BDIH and BOCRA ---------- */

VIEWS.bank = (p, q) => {
  const u = Ctx.u, S = St();
  let docs = S.documents.filter(d => !d.deleted && d.entityType === 'bank');
  const cats = S.lookups.bankCategories || [];
  if (q.cat) docs = docs.filter(d => d.category === q.cat);
  if (q.q) { const s = q.q.toLowerCase(); docs = docs.filter(d => (d.title + ' ' + d.category + ' ' + d.versions.map(v => v.name + ' ' + v.comment).join(' ')).toLowerCase().includes(s)); }
  docs.sort((a, b) => a.title.localeCompare(b.title));
  const dlCount = id => S.audit.filter(x => x.action === 'document.download' && x.entityId === id).length;
  const cur = q.id && docs.concat(S.documents.filter(d => d.entityType === 'bank')).find(d => d.id === q.id);
  const up = can.bankUpload(u) && !RO();
  return `<div class="page-h"><div><h1>Document bank</h1></div>
   ${up ? `<div class="actions"><button class="btn" data-act="uploadModal" data-entity="bank" data-ws="S">Add document</button></div>` : ''}</div>
  <div class="chips">${[['', 'All']].concat(cats.map(c => [c, c])).map(([v, t]) => `<a class="chip ${(q.cat || '') === v ? 'on' : ''}" href="#/bank?${qs({ cat: v, q: q.q })}">${esc(t)} <em>${v ? S.documents.filter(d => !d.deleted && d.entityType === 'bank' && d.category === v).length : S.documents.filter(d => !d.deleted && d.entityType === 'bank').length}</em></a>`).join('')}
   <label class="f inline grow"><span class="sr">Search</span><input type="search" value="${esc(q.q || '')}" data-change="qset" data-k="q" placeholder="Search the document bank"></label></div>
  <div class="bank">${docs.map(d => {
    const v = d.versions[d.versions.length - 1], ext = (v.name.split('.').pop() || '').toUpperCase();
    return `<article class="bank-item"><div class="ext ext-${ext.toLowerCase()}">${esc(ext)}</div>
     <div class="bank-body"><h3><a href="#/bank?${qs({ cat: q.cat, q: q.q, id: d.id })}">${esc(d.title)}</a></h3>
      <p>${esc(d.category)}, version ${v.no}, updated ${D.nice(D.dateOf(v.at))} by ${esc(uname(v.by))} (${esc(orgName((userOf(v.by) || {}).org).split(' ')[0])})</p>
      <p class="muted">${bytes(v.size)}. Downloaded ${dlCount(d.id)} time${dlCount(d.id) === 1 ? '' : 's'}.</p></div>
     <div class="btns"><button class="btn sm" data-act="download" data-id="${d.id}">Download</button>${up ? `<button class="btn sm ghost" data-act="uploadModal" data-doc="${d.id}">New version</button>` : ''}</div></article>`;
  }).join('') || '<p class="empty">No documents match.</p>'}</div>
  ${cur ? bankDetail(cur, u) : ''}`;
};

function bankDetail(d, u) {
  const S = St();
  const trail = S.audit.filter(x => x.entityId === d.id && /^document\./.test(x.action)).sort((a, b) => a.at < b.at ? 1 : -1);
  const label = a => ({ 'document.upload': 'Uploaded', 'document.version': 'New version', 'document.download': 'Downloaded', 'document.delete': 'Deleted', 'document.restore': 'Restored' }[a] || a);
  return `<section class="card" id="bank-detail"><div class="ph"><h2>${esc(d.title)}</h2>${d.deleted ? stb('Deleted') : ''}</div>
   <div class="grid g2"><div><h3>Versions</h3>${table(['Version', 'File', 'Size', 'By', 'When', 'Note', ''], d.versions.slice().reverse().map(v => tr(['v' + v.no, esc(v.name), bytes(v.size), esc(uname(v.by)), D.stamp(v.at), esc(v.comment), `<button class="btn sm ghost" data-act="download" data-id="${d.id}" data-v="${v.no}">Download</button>`])))}
    ${can.bankUpload(u) && !RO() && hasPerm(u, 'progress.any') && !d.deleted ? `<p><button class="btn sm ghost danger" data-act="deleteDoc" data-id="${d.id}">Delete from the bank</button></p>` : ''}</div>
   <div><h3>Audit trail</h3>${isOversight(u) ? (trail.length ? `<ol class="timeline">${trail.map(t => `<li><strong>${label(t.action)}</strong>${t.after && t.after.version ? ' v' + t.after.version : ''} <span class="muted">${esc(uname(t.user))}, ${D.stamp(t.at)}</span></li>`).join('')}</ol>` : '<p class="empty">No activity yet.</p>') : '<p class="muted">The full audit trail is visible to BDIH and BOCRA.</p>'}</div></div></section>`;
}

/* ---------- User management: one basket per organisation ---------- */

VIEWS.users = (p, q) => {
  const u = Ctx.u, S = St();
  if (!can.admin(u)) return notFound();
  const org = q.org || 'BDIH';
  const list = S.users.filter(x => x.org === org).sort((a, b) => a.fullName.localeCompare(b.fullName));
  const resets = S.requests.filter(r => r.type === 'reset' && r.status === 'Pending');
  const accounts = S.requests.filter(r => r.type !== 'reset' && r.status === 'Pending');
  const ro = RO();
  return `<div class="page-h"><div><h1>User management</h1></div>
   <div class="actions"><button class="btn ghost" data-act="exportUsers">Export users and access</button></div></div>
  ${resets.length || accounts.length ? `<div class="notice">${resets.length ? `${resets.length} password reset request${resets.length === 1 ? '' : 's'} waiting. ` : ''}${accounts.length ? `${accounts.length} account request${accounts.length === 1 ? '' : 's'} from developer leads. ` : ''}<a href="#/admin?tab=requests">Review requests</a></div>` : ''}
  <div class="baskets">${S.orgs.map(o => {
    const us = S.users.filter(x => x.org === o.id);
    return `<a class="basket ${o.id === org ? 'on' : ''}" href="#/users?org=${o.id}">${o.id === 'BDIH' ? bihMark('bk-logo') : o.id === 'BOCRA' ? bocraLogo('bk-logo') : `<span class="bk-mono ws-${o.id === 'DEVA' ? 'A' : 'B'}">${o.id === 'DEVA' ? 'A' : 'B'}</span>`}
      <span class="bk-name">${esc(o.id === 'BDIH' ? 'BDIH' : o.id === 'BOCRA' ? 'BOCRA' : o.name)}</span><span class="bk-sub">${o.type}${o.id === 'DEVA' ? ', BOCRA website' : o.id === 'DEVB' ? ', UASF website' : ''}</span>
      <span class="bk-n"><strong>${us.filter(x => x.active).length}</strong> active${us.some(x => !x.active) ? `, ${us.filter(x => !x.active).length} inactive` : ''}</span></a>`;
  }).join('')}</div>
  ${org === 'DEVA' || org === 'DEVB' ? `<p class="leads">Developer leads: <strong>${list.filter(x => x.active && hasRole(x, 'DEV_LEAD')).map(x => esc(x.fullName)).join(', ') || 'none'}</strong>. A team can have several leads; each one can submit, file weekly reports and raise invoices.</p>` : ''}
  <section class="card flush"><div class="ph pad"><h2>${esc(orgName(org))}</h2>${!ro ? `<button class="btn" data-act="userModal" data-org="${org}">Add user to ${esc(org === 'BDIH' || org === 'BOCRA' ? org : orgName(org))}</button>` : ''}</div>
  ${table(['Name', 'Username', 'Role', 'Contact', 'Status', 'Last sign-in', ''], list.map(x => {
    const locked = x.lockedUntil > Date.now();
    return tr([`<strong>${esc(x.fullName)}</strong><br><span class="muted">${esc(x.title)}</span>`, esc(x.username), `<strong>${roleName(x.role)}</strong>${(x.extraRoles || []).length ? '<br><span class="muted">also ' + esc(x.extraRoles.map(r => roleName(r)).join(', ')) + '</span>' : ''}` + (x.delegated ? ' <span class="tag">Delegated</span>' : ''),
      [x.email, x.phone].filter(Boolean).map(esc).join('<br>') || '<span class="muted">None</span>',
      (x.active ? stb('Active') : stb('Inactive')) + (locked ? ' <span class="timer over">Locked</span>' : '') + (x.mustChange ? '<br><span class="tag">Must change password</span>' : ''),
      D.stamp(x.lastLogin) || '<span class="muted">Never</span>',
      ro ? '' : `<div class="btns"><button class="btn sm ghost" data-act="userModal" data-id="${x.id}">Edit</button>${(org === 'DEVA' || org === 'DEVB') && x.active ? `<button class="btn sm ghost" data-act="toggleLead" data-id="${x.id}">${hasRole(x, 'DEV_LEAD') ? 'Remove as lead' : 'Make lead'}</button>` : ''}<button class="btn sm ghost" data-act="userHistory" data-id="${x.id}">History</button><button class="btn sm ghost" data-act="resetPw" data-id="${x.id}">Reset password</button>${locked ? `<button class="btn sm ghost" data-act="unlockUser" data-id="${x.id}">Unlock</button>` : ''}${x.id !== u.id ? `<button class="btn sm ghost" data-act="toggleUser" data-id="${x.id}">${x.active ? 'Deactivate' : 'Reactivate'}</button><button class="btn sm ghost" data-act="viewAs" data-id="${x.id}">View as</button>` : ''}</div>`]);
  }), 'No users in this organisation yet.')}</section>`;
};

/* ---------- Administration: editable project plan ---------- */

function predEditText(a) {
  return (St()._preds.get(a.id) || []).map(l => { const p = actOf(l.from); return num(p) + (l.lag ? (l.lag > 0 ? '+' : '') + l.lag : ''); }).join(', ');
}

function adminPlan(u, q) {
  const S = St(), i = sdi(), edit = can.editPlan(u) && !RO();
  const list = filterActs(visActs(u), q);
  const res = resOpts();
  const cell = (a, k, html) => `<td class="pc">${html}</td>`;
  const I = (a, k, val, type, attrs) => edit ? `<input class="pe" data-change="planCell" data-id="${a.id}" data-k="${k}" type="${type || 'text'}" value="${esc(val ?? '')}" aria-label="${k} for ${esc(a.name)}" ${attrs || ''}>` : esc(val ?? '');
  const Sl = (a, k, opts, val) => edit ? `<select class="pe" data-change="planCell" data-id="${a.id}" data-k="${k}" aria-label="${k} for ${esc(a.name)}">${opts.map(o => { const [v, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(val ?? '') ? 'selected' : ''}>${esc(t)}</option>`; }).join('')}</select>` : esc((opts.find(o => (Array.isArray(o) ? o[0] : o) === val) || [val, val])[1] || val || '');
  return `<div class="toolbar"><p class="muted grow">${edit ? 'Changes save as you leave each cell. Predecessors: activity numbers, for example 4, 7+2.' : ''}</p>
    <button class="btn ghost" data-act="phasesAll" data-v="1">Collapse phases</button><button class="btn ghost" data-act="phasesAll" data-v="0">Expand phases</button>
    ${edit ? '<button class="btn" data-act="addDeliverable">Add deliverable</button><button class="btn ghost" data-act="addActivity">Insert activity</button>' : ''}</div>
   <div class="filters">${['ws', 'phase'].map(k => `<label class="f inline"><span>${k === 'ws' ? 'Workstream' : 'Phase'}</span>${sel(k, [['', 'All']].concat(k === 'ws' ? wsOptions(u, true) : phaseKeys()), q[k] || '', `data-change="qset" data-k="${k}"`)}</label>`).join('')}</div>
   <div class="card flush"><div class="tw"><table class="tbl plan-grid"><thead><tr><th>#</th><th>Activity</th><th>Workstream</th><th>Phase</th><th>Type</th><th>Lead</th><th>Days</th><th>Fixed start</th><th>Predecessors</th><th>Start</th><th>Finish</th><th>Done %</th><th>Health</th></tr></thead><tbody>
   ${phaseRows(list, 13, a => `<tr class="${a.type === 'Milestone' ? 'ms' : ''}"><td class="num"><a href="#/activity/${a.id}">${num(a)}</a></td>
     ${cell(a, 'name', I(a, 'name', a.name, 'text', `style="padding-left:${8 + (a.indent || 0) * 16}px"`))}
     ${cell(a, 'ws', Sl(a, 'ws', wsOptions(u, true), a.ws))}${cell(a, 'phase', Sl(a, 'phase', phaseKeys(), a.phase))}${cell(a, 'type', Sl(a, 'type', TYPES, a.type))}
     ${cell(a, 'lead', Sl(a, 'lead', res, a.lead || ''))}
     ${cell(a, 'duration', a.type === 'Review' ? `<span class="muted" title="Set by review days in Settings">${a._dur}</span>` : a.type === 'Milestone' ? '0' : I(a, 'duration', a.duration, 'number', 'min="1" max="400" class="pe n"'))}
     ${cell(a, 'fixedStart', I(a, 'fixedStart', a.fixedStart, 'date'))}
     ${cell(a, 'preds', I(a, 'preds', predEditText(a), 'text', 'placeholder="none"'))}
     <td class="nowrap">${D.short(a.start)}</td><td class="nowrap">${D.short(a.finish)}</td>
     ${cell(a, 'pct', can.progress(u, a) && !RO() ? `<input class="pe n" data-change="planCell" data-id="${a.id}" data-k="pct" type="number" min="0" max="100" step="5" value="${a.pct || 0}" aria-label="Done % for ${esc(a.name)}">` : (a.pct || 0) + '%')}
     <td>${hb(health(a, i))}</td></tr>`).join('')}</tbody></table></div></div>`;
}

/* ---------- Administration: roles and permissions ---------- */

function adminRoles(u) {
  const edit = can.admin(u) && !RO();
  const roles = Object.keys(ROLES);
  return `
   <div class="card flush"><div class="tw"><table class="tbl perm-grid"><thead><tr><th>Permission</th>${roles.map(r => `<th class="rot"><span>${roleName(r)}</span></th>`).join('')}</tr></thead><tbody>
   ${PERMISSIONS.map(([k, label]) => `<tr><th scope="row">${esc(label)}</th>${roles.map(r => {
     const on = permRoles(k).includes(r), locked = (k === 'users.manage' && r === 'ADMIN') || r === 'BDIH_DIRECTOR' && k !== 'audit.view';
     return `<td class="pc-c"><input type="checkbox" ${on ? 'checked' : ''} ${!edit || locked ? 'disabled' : ''} data-change="permToggle" data-k="${k}" data-r="${r}" aria-label="${esc(roleName(r))}: ${esc(label)}"></td>`;
   }).join('')}</tr>`).join('')}</tbody></table></div></div>
   ${edit ? '<p><button class="btn ghost" data-act="resetPerms">Restore default permissions</button></p>' : ''}`;
}

function adminRequests(u) {
  const S = St();
  const rows = S.requests.slice().sort((a, b) => a.at < b.at ? 1 : -1).map(r => r.type === 'reset'
    ? tr(['Password reset', esc(r.fullName || uname(r.userId)), esc(r.username), D.stamp(r.at), stb(r.status), r.status === 'Pending' ? `<button class="btn sm" data-act="resetPw" data-id="${r.userId}" data-req="${r.id}">Reset password</button> <button class="btn sm ghost" data-act="rejectRequest" data-id="${r.id}">Dismiss</button>` : ''])
    : tr(['New account (' + esc(uname(r.by)) + ')', esc(r.fullName), esc(r.username), D.stamp(r.at), stb(r.status), r.status === 'Pending' ? `<button class="btn sm" data-act="approveRequest" data-id="${r.id}">Approve</button> <button class="btn sm ghost" data-act="rejectRequest" data-id="${r.id}">Reject</button>` : '']));
  return `<div class="card flush">${table(['Request', 'Name', 'Username', 'Received', 'Status', ''], rows, 'No requests.')}</div>`;
}

/* ---------- Reports: standard report plus a custom report builder ---------- */

const DATASETS = {
  activities: {
    label: 'Activities', date: 'finish', status: 'health',
    cols: [['no', '#'], ['name', 'Activity'], ['ws', 'Workstream'], ['phase', 'Phase'], ['type', 'Type'], ['lead', 'Lead'], ['duration', 'Days'], ['start', 'Start'], ['finish', 'Finish'], ['blFinish', 'Baseline finish'], ['slip', 'Slip (bd)'], ['actualStart', 'Actual start'], ['actualFinish', 'Actual finish'], ['pct', 'Done %'], ['planned', 'Planned %'], ['status', 'Status'], ['health', 'Health']],
    def: ['no', 'name', 'ws', 'finish', 'pct', 'health'],
    rows: u => { const i = sdi(); return visActs(u).map(a => ({ no: num(a), name: a.name, ws: wsName(a.ws), phase: a.phase, type: a.type, lead: rname(a.lead), duration: a._dur, start: a.start, finish: a.finish, blFinish: blFinish(a) || '', slip: slipOf(St(), a) ?? '', actualStart: a.actualStart || '', actualFinish: a.actualFinish || '', pct: a.pct || 0, planned: plannedPct(a, i), status: a.status, health: health(a, i) })); }
  },
  deliverables: {
    label: 'Deliverables', date: 'finish', status: 'health',
    cols: [['ref', 'Ref'], ['name', 'Deliverable'], ['ws', 'Workstream'], ['owner', 'Owner'], ['phase', 'Phase'], ['finish', 'Planned finish'], ['blFinish', 'Baseline finish'], ['actual', 'Actual finish'], ['status', 'Status'], ['health', 'Health']],
    def: ['ref', 'name', 'ws', 'finish', 'status', 'health'],
    rows: u => St().deliverables.map(d => ({ d, a: actOf(d.activityId) })).filter(x => x.a && canSeeItem(u, x.a)).map(({ d, a }) => ({ ref: d.ref, name: d.name, ws: wsName(d.ws), owner: orgName(d.owner), phase: d.phase, finish: a.finish, blFinish: blFinish(a) || '', actual: isDone(a) ? a.actualFinish : '', status: a.status, health: health(a, sdi()) }))
  },
  submissions: {
    label: 'Submissions and reviews', date: 'submitted', status: 'state',
    cols: [['deliverable', 'Deliverable'], ['ws', 'Workstream'], ['version', 'Version'], ['by', 'Submitted by'], ['submitted', 'Submitted'], ['state', 'State'], ['bdih', 'BDIH outcome'], ['bocra', 'BOCRA outcome'], ['due', 'Review due']],
    def: ['deliverable', 'ws', 'version', 'submitted', 'state', 'bdih', 'bocra'],
    rows: u => St().submissions.filter(s => canSeeItem(u, actOf(s.activityId))).map(s => { const rv = St().reviews.filter(r => r.submissionId === s.id), o = st => (rv.find(r => r.stage === st && r.outcome) || {}).outcome || ''; const open = rv.find(r => !r.decidedAt); return { deliverable: actOf(s.activityId).name, ws: wsName(s.ws), version: s.version, by: uname(s.by), submitted: D.dateOf(s.at), state: s.state, bdih: o('BDIH'), bocra: o('BOCRA'), due: open ? open.due : '' }; })
  },
  invoices: {
    label: 'Invoices', date: 'date', status: 'status', money: ['excl', 'vat', 'total'],
    cols: [['no', 'Invoice'], ['from', 'From'], ['ws', 'Workstream'], ['description', 'Description'], ['date', 'Date'], ['excl', 'Excl. VAT'], ['vat', 'VAT'], ['total', 'Total'], ['status', 'Status'], ['comment', 'Latest comment']],
    def: ['no', 'from', 'date', 'total', 'status'],
    rows: u => St().invoices.filter(x => can.seeInvoice(u, x)).map(x => ({ no: x.no, from: orgName(x.org), ws: wsName(x.ws), description: x.description, date: x.date, excl: x.amount, vat: x.vat, total: x.amount + x.vat, status: x.status, comment: x.comment }))
  },
  risks: {
    label: 'Risks', date: 'due', status: 'status',
    cols: [['title', 'Risk'], ['ws', 'Workstream'], ['likelihood', 'Likelihood'], ['impact', 'Impact'], ['score', 'Score'], ['owner', 'Owner'], ['mitigation', 'Mitigation'], ['due', 'Due'], ['status', 'Status']],
    def: ['title', 'ws', 'score', 'owner', 'due', 'status'],
    rows: u => St().risks.filter(r => canSeeItem(u, r)).map(r => ({ title: r.title, ws: wsName(r.ws), likelihood: r.likelihood, impact: r.impact, score: r.likelihood * r.impact, owner: uname(r.owner), mitigation: r.mitigation, due: r.due || '', status: r.status }))
  },
  issues: {
    label: 'Issues', date: 'target', status: 'status',
    cols: [['title', 'Issue'], ['ws', 'Workstream'], ['severity', 'Severity'], ['owner', 'Owner'], ['raised', 'Raised'], ['target', 'Target'], ['status', 'Status'], ['resolution', 'Resolution']],
    def: ['title', 'ws', 'severity', 'owner', 'target', 'status'],
    rows: u => St().issues.filter(r => canSeeItem(u, r)).map(r => ({ title: r.title, ws: wsName(r.ws), severity: r.severity, owner: uname(r.owner), raised: r.raised, target: r.target || '', status: r.status, resolution: r.resolution }))
  },
  weekly: {
    label: 'Weekly reports', date: 'week', status: 'status',
    cols: [['ws', 'Workstream'], ['week', 'Week ending'], ['status', 'Status'], ['by', 'Filed by'], ['completed', 'Work completed'], ['planned', 'Planned next'], ['issues', 'Issues']],
    def: ['ws', 'week', 'status', 'by'],
    rows: u => (isOversight(u) ? ['A', 'B'] : wsOf(u)).flatMap(ws => weeklyStatus(ws).map(w => ({ ws: wsName(ws), week: w.we, status: w.status, by: w.r ? uname(w.r.by) : '', completed: w.r ? w.r.completed : '', planned: w.r ? w.r.planned : '', issues: w.r ? w.r.issues : '' })))
  },
  documents: {
    label: 'Documents', date: 'uploaded', status: 'category',
    cols: [['title', 'Title'], ['category', 'Category'], ['ws', 'Workstream'], ['area', 'Area'], ['version', 'Version'], ['by', 'Uploaded by'], ['uploaded', 'Uploaded'], ['size', 'Size']],
    def: ['title', 'category', 'ws', 'version', 'uploaded'],
    rows: u => St().documents.filter(d => !d.deleted && canSeeItem(u, d)).map(d => { const v = d.versions[d.versions.length - 1]; return { title: d.title, category: d.category, ws: wsName(d.ws), area: d.entityType === 'bank' ? 'Document bank' : d.entityType, version: v.no, by: uname(v.by), uploaded: D.dateOf(v.at), size: bytes(v.size) }; })
  }
};

function runCustom(def, u) {
  const ds = DATASETS[def.ds];
  let rows = ds.rows(u);
  if (def.ws) rows = rows.filter(r => r.ws === wsName(def.ws));
  if (def.status) rows = rows.filter(r => String(r[ds.status]) === def.status);
  if (def.from) rows = rows.filter(r => r[ds.date] && r[ds.date] >= def.from);
  if (def.to) rows = rows.filter(r => r[ds.date] && r[ds.date] <= def.to);
  if (def.sort) rows.sort((a, b) => (a[def.sort] > b[def.sort] ? 1 : a[def.sort] < b[def.sort] ? -1 : 0) * (def.desc ? -1 : 1));
  return rows;
}

function customHTML(def, u, forExport) {
  const ds = DATASETS[def.ds], rows = runCustom(def, u);
  const cols = ds.cols.filter(c => def.cols.includes(c[0]));
  const fmt = (k, v) => (ds.money || []).includes(k) ? money(v) : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? D.nice(v) : esc(v);
  const tbl = rs => `<table class="${forExport ? '' : 'tbl'}"><thead><tr>${cols.map(c => `<th>${esc(c[1])}</th>`).join('')}</tr></thead><tbody>${rs.map(r => `<tr>${cols.map(c => `<td${(ds.money || []).includes(c[0]) ? ' style="text-align:right"' : ''}>${fmt(c[0], r[c[0]])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const total = rs => (ds.money || []).includes('total') ? ` Total ${money(rs.reduce((t, r) => t + r.total, 0))}.` : '';
  let body;
  if (def.group) {
    const groups = {};
    rows.forEach(r => { (groups[r[def.group]] = groups[r[def.group]] || []).push(r); });
    body = Object.keys(groups).sort().map(g => `<h3>${esc(g || 'None')} <span class="muted">(${groups[g].length})</span></h3><p class="small">${groups[g].length} row${groups[g].length === 1 ? '' : 's'}.${total(groups[g])}</p>${tbl(groups[g])}`).join('');
  } else body = tbl(rows);
  const scope = def.ws ? wsName(def.ws) : isOversight(u) ? 'All workstreams' : wsName(wsOf(u)[0]);
  return `<div class="rpt-head"><div class="rpt-brand">${bihLogo('rpt-logo')}</div><div><h1>${esc(def.title || ds.label + ' report')}</h1>
    <p>${esc(ds.label)}. ${esc(scope)}.${def.from || def.to ? ' ' + (def.from ? D.nice(def.from) : 'Start') + ' to ' + (def.to ? D.nice(def.to) : 'today') + '.' : ''} Generated ${D.stamp(D.now())} by ${esc(u.fullName)}.</p>
    <p><strong>${rows.length}</strong> row${rows.length === 1 ? '' : 's'}.${total(rows)}</p></div></div>${rows.length ? body : '<p><em>No rows match.</em></p>'}`;
}

const standardReports = VIEWS.reports;
VIEWS.reports = (p, q) => {
  const u = Ctx.u, S = St(), tab = q.tab || 'standard';
  const mine = S.reportDefs.filter(r => r.by === u.id || (r.shared && (isOversight(u) || r.by === u.id)));
  const head = `<div class="page-h"><div><h1>Reports</h1></div></div>
    ${tabs([['standard', 'Progress report', '#/reports?tab=standard'], ['custom', 'Report builder', '#/reports?tab=custom'], ['saved', `Saved reports (${mine.length})`, '#/reports?tab=saved']].concat(isOversight(u) ? [['downloads', 'Download log', '#/reports?tab=downloads']] : []), tab)}
    ${downloadBanner(u)}`;
  if (tab === 'downloads' && isOversight(u)) return head + downloadLogView(u, q);
  if (tab === 'standard') return head + standardReports(p, q).replace('<div class="page-h"><h1>Progress reports</h1></div>', '');
  if (tab === 'saved') return head + `<div class="card flush">${table(['Report', 'Data', 'Created by', 'Saved', 'Shared', ''], mine.map(r => tr([`<strong>${esc(r.name)}</strong>`, esc(DATASETS[r.def.ds].label), esc(uname(r.by)), D.stamp(r.at), r.shared ? 'Yes' : 'No', `<div class="btns"><a class="btn sm" href="#/reports?tab=custom&def=${r.id}">Open</a>${r.by === u.id ? `<button class="btn sm ghost danger" data-act="deleteReportDef" data-id="${r.id}">Delete</button>` : ''}</div>`])), 'No saved reports yet. Build one in the report builder and save it.')}</div>`;
  const saved = q.def && S.reportDefs.find(r => r.id === q.def);
  const def = Ctx.custom && (!saved || Ctx.custom._from === saved.id) ? Ctx.custom : saved ? Object.assign({ _from: saved.id }, saved.def) : { ds: q.ds || 'activities', cols: DATASETS[q.ds || 'activities'].def, title: '' };
  const ds = DATASETS[def.ds];
  const sample = ds.rows(u);
  const statuses = [...new Set(sample.map(r => String(r[ds.status])))].filter(Boolean).sort();
  return head + `<section class="card builder"><form data-form="customReport" class="fgrid">
    ${fld('Report title', inp('title', def.title, 'text', 'placeholder="For example: UASF late activities"'))}
    ${fld('Data', sel('ds', Object.entries(DATASETS).map(([k, v]) => [k, v.label]), def.ds, 'data-change="customDs"'))}
    <fieldset class="span2"><legend>Columns</legend><div class="cols">${ds.cols.map(([k, t]) => `<label class="chk"><input type="checkbox" name="col" value="${k}" ${def.cols.includes(k) ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</div></fieldset>
    ${isOversight(u) ? fld('Workstream', sel('ws', [['', 'All']].concat(wsOptions(u, true)), def.ws || '')) : ''}
    ${fld(ds.status === 'health' ? 'Health' : ds.status === 'category' ? 'Category' : 'Status', sel('status', [['', 'All']].concat(statuses), def.status || ''))}
    ${fld('From (' + (ds.cols.find(c => c[0] === ds.date) || [, 'date'])[1].toLowerCase() + ')', inp('from', def.from, 'date'))}${fld('To', inp('to', def.to, 'date'))}
    ${fld('Group by', sel('group', [['', 'No grouping']].concat(ds.cols.filter(c => !['no', 'name', 'title', 'description', 'comment', 'mitigation', 'resolution', 'completed', 'planned', 'issues', 'pct', 'slip', 'duration'].includes(c[0]))), def.group || ''))}
    ${fld('Sort by', sel('sort', [['', 'Default order']].concat(ds.cols), def.sort || ''))}
    <label class="chk"><input type="checkbox" name="desc" ${def.desc ? 'checked' : ''}> Descending</label>
    <div class="span2 btns"><button class="btn">Run report</button>${Ctx.custom ? `<button type="button" class="btn ghost" data-act="exportCustom" data-f="csv">Excel (CSV)</button><button type="button" class="btn ghost" data-act="exportCustom" data-f="word">Word</button><button type="button" class="btn ghost" data-act="exportCustom" data-f="pdf">PDF</button><button type="button" class="btn ghost" data-act="saveReportDef">Save report</button>` : ''}</div>
   </form></section>
   ${Ctx.custom && Ctx.custom.ds === def.ds ? `<article class="rpt paper">${customHTML(Ctx.custom, u)}</article>` : ''}`;
};
