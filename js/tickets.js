'use strict';
/* Developer tickets: a Jira-style board per developer workstream. Each developer sees only its
   own board; BDIH and BOCRA see both. Loaded after app.js. */

// Board columns, types and priorities come from Administration, Lists ("Done" is fixed)
const ticketStatuses = () => lists().ticketStatuses || ['To do', 'In progress', 'In review', 'Blocked', 'Done'];
const ticketTypes = () => lists().ticketTypes || ['Story', 'Task', 'Bug', 'UAT defect', 'Support request'];
const ticketPriorities = () => lists().ticketPriorities || ['Highest', 'High', 'Medium', 'Low'];
const ticketPrefix = ws => (St().workstreams.find(w => w.id === ws) || {}).ticketPrefix || ({ A: 'BOC', B: 'UAS' }[ws] || ws);

const ticketWsList = u => (isOversight(u) ? ['A', 'B'] : (wsOf(u) || []).filter(w => w !== 'S'));
const canSeeTicket = (u, t) => !!t && canSee(u, t.ws, false);
const canEditTicket = (u, t) => canSeeTicket(u, t) && hasPerm(u, 'ticket.manage') && !RO();
const canRaiseTicket = (u, ws) => hasPerm(u, 'ticket.create') && canSee(u, ws, false) && ws !== 'S' && !RO();
const assignees = ws => St().users.filter(x => x.active && canSee(x, ws, false) && (hasRole(x, 'DEV_LEAD', 'DEV_MEMBER') ? (wsOf(x) || []).includes(ws) : x.org === 'BDIH' && !isViewer(x)));
const prioIcon = p => `<span class="prio prio-${slug(p)}" title="${esc(p)} priority" aria-label="${esc(p)} priority"></span>`;
const typeTag = t => `<span class="ttype tt-${slug(t)}">${esc(t)}</span>`;

NAV.splice(NAV.findIndex(n => n.r === 'submissions') + 1, 0, { r: 'tickets', t: 'Tickets' });

function ticketCard(t) {
  const a = t.activityId && actOf(t.activityId);
  const over = t.due && t.status !== 'Done' && t.due < D.today();
  return `<article class="tcard" draggable="${canEditTicket(Ctx.u, t)}" data-ticket="${t.id}" tabindex="0" data-act="ticketOpen" data-id="${t.id}">
    <p class="tc-title">${esc(t.title)}</p>
    ${t.labels.length ? `<p class="tc-labels">${t.labels.map(l => `<span>${esc(l)}</span>`).join('')}</p>` : ''}
    <footer>${typeTag(t.type)} ${prioIcon(t.priority)} <span class="tc-key">${esc(t.key)}</span>
     ${t.estimate ? `<span class="tc-est" title="Estimate">${t.estimate}</span>` : ''}${t.comments.length ? `<span class="tc-c" title="Comments">${t.comments.length} comment${t.comments.length === 1 ? '' : 's'}</span>` : ''}
     ${over ? '<span class="timer over">Overdue</span>' : ''}<span class="av sm" title="${esc(uname(t.assignee))}">${esc(initialsOf(t.assignee))}</span></footer>
    ${a ? `<p class="tc-act">${esc(a.name)}</p>` : ''}</article>`;
}
function initialsOf(id) { const u = userOf(id); return u ? u.fullName.split(' ').map(x => x[0]).join('').slice(0, 2) : '?'; }

function filterTickets(list, q, u) {
  if (q.assignee === 'me') list = list.filter(t => t.assignee === u.id);
  else if (q.assignee) list = list.filter(t => t.assignee === q.assignee);
  if (q.type) list = list.filter(t => t.type === q.type);
  if (q.prio) list = list.filter(t => t.priority === q.prio);
  if (q.q) { const s = q.q.toLowerCase(); list = list.filter(t => (t.key + ' ' + t.title + ' ' + t.description + ' ' + t.labels.join(' ')).toLowerCase().includes(s)); }
  return list;
}

VIEWS.tickets = (p, q) => {
  const u = Ctx.u, S = St(), wss = ticketWsList(u);
  if (!wss.length) return notFound();
  const ws = wss.includes(q.ws) ? q.ws : wss[0];
  const view = q.view || 'board';
  const all = S.tickets.filter(t => t.ws === ws && canSeeTicket(u, t));
  const list = filterTickets(all, q, u);
  const href = o => '#/tickets?' + qs(Object.assign({}, q, o));
  const open = all.filter(t => t.status !== 'Done');
  const cur = q.id && S.tickets.find(t => t.id === q.id && canSeeTicket(u, t));
  const head = `<div class="page-h"><div><h1>Tickets</h1></div>
   ${canRaiseTicket(u, ws) ? `<div class="actions"><button class="btn" data-act="ticketNew" data-ws="${ws}">Create ticket</button></div>` : ''}</div>
   ${wss.length > 1 ? `<div class="board-tabs">${wss.map(w => `<a href="${href({ ws: w, id: '' })}" class="${w === ws ? 'on' : ''}">${wsLogo(w, 'bt-logo')}<span>${esc(wsName(w))}<small>${S.tickets.filter(t => t.ws === w && t.status !== 'Done').length} open</small></span></a>`).join('')}</div>` : ''}
   <div class="tstats"><span><strong>${open.length}</strong> open</span><span><strong>${open.filter(t => t.type === 'Bug' || t.type === 'UAT defect').length}</strong> bugs and defects</span><span><strong class="${open.filter(t => t.status === 'Blocked').length ? 'bad' : ''}">${open.filter(t => t.status === 'Blocked').length}</strong> blocked</span><span><strong>${all.filter(t => t.status === 'Done').length}</strong> done</span><span><strong>${open.reduce((n, t) => n + (+t.estimate || 0), 0)}</strong> points remaining</span></div>
   <div class="filters">
    ${tabs([['board', 'Board', href({ view: 'board' })], ['list', 'List', href({ view: 'list' })]], view)}
    <label class="f inline"><span>Assignee</span>${sel('assignee', [['', 'Anyone'], ['me', 'Me']].concat(assignees(ws).map(x => [x.id, x.fullName])), q.assignee || '', 'data-change="qset" data-k="assignee"')}</label>
    <label class="f inline"><span>Type</span>${sel('type', [['', 'All']].concat(ticketTypes()), q.type || '', 'data-change="qset" data-k="type"')}</label>
    <label class="f inline"><span>Priority</span>${sel('prio', [['', 'All']].concat(ticketPriorities()), q.prio || '', 'data-change="qset" data-k="prio"')}</label>
    <label class="f inline grow"><span>Search</span><input type="search" value="${esc(q.q || '')}" data-change="qset" data-k="q" placeholder="Key, title or label"></label></div>`;
  let body;
  if (view === 'list') {
    const order = t => ticketPriorities().indexOf(t.priority);
    body = `<div class="card flush">${table(['Key', 'Summary', 'Type', 'Priority', 'Status', 'Assignee', 'Due', 'Updated'], list.slice().sort((a, b) => ticketStatuses().indexOf(a.status) - ticketStatuses().indexOf(b.status) || order(a) - order(b)).map(t => tr([
      `<a href="${href({ id: t.id })}">${esc(t.key)}</a>`, `<a href="${href({ id: t.id })}">${esc(t.title)}</a>`, typeTag(t.type), prioIcon(t.priority) + ' ' + esc(t.priority), stb(t.status), esc(uname(t.assignee)), t.due ? D.nice(t.due) : '', D.stamp(t.updated)])), 'No tickets match.')}</div>`;
  } else {
    body = `<div class="board" role="list">${ticketStatuses().map(s => {
      const col = list.filter(t => t.status === s).sort((a, b) => ticketPriorities().indexOf(a.priority) - ticketPriorities().indexOf(b.priority));
      return `<section class="bcol bcol-${slug(s)}" data-status="${s}" role="listitem" aria-label="${s}"><header><h2>${s}</h2><span>${col.length}</span></header><div class="bcol-body">${col.map(ticketCard).join('') || '<p class="bcol-empty">No tickets</p>'}</div></section>`;
    }).join('')}</div>`;
  }
  return head + body + (cur ? ticketDetail(cur, u) : '');
};

function ticketDetail(t, u) {
  const S = St(), ed = canEditTicket(u, t), a = t.activityId && actOf(t.activityId);
  const docs = S.documents.filter(d => !d.deleted && d.entityType === 'ticket' && d.entityId === t.id && canSeeItem(u, d));
  const acts = visActs(u).filter(x => x.ws === t.ws);
  const canTalk = canSeeTicket(u, t) && !RO();
  const hName = f => ({ status: 'Status', assignee: 'Assignee', priority: 'Priority', due: 'Due', type: 'Type', title: 'Summary', created: 'Created', activityId: 'Linked activity', estimate: 'Estimate', description: 'Description', labels: 'Labels' }[f] || f);
  const hVal = (f, v) => f === 'assignee' ? uname(v) : f === 'activityId' ? ((actOf(v) || {}).name || 'None') : v;
  return `<section class="card tdetail" id="ticket">
   <div class="ph"><div><p class="crumb">${wsTag(t.ws)} <span class="tc-key">${esc(t.key)}</span> ${typeTag(t.type)}</p><h2>${esc(t.title)}</h2></div><div class="btns">${can.admin(u) && !RO() ? `<button class="btn ghost sm danger" data-act="adminDeleteTicket" data-id="${t.id}">Delete</button>` : ''}<a class="btn ghost sm" href="#/tickets?ws=${t.ws}">Close</a></div></div>
   <div class="tgrid"><div>
    ${ed ? `<form data-form="ticketEdit" class="fgrid"><input type="hidden" name="id" value="${t.id}">
      ${fld('Summary', inp('title', t.title, 'text', 'required maxlength="200"'), 'span2')}
      ${fld('Description', ta('description', t.description, 'rows="5"'), 'span2')}
      ${fld('Labels (comma separated)', inp('labels', t.labels.join(', ')))}${fld('Estimate (points)', inp('estimate', t.estimate, 'number', 'min="0" max="100"'))}
      <div class="span2"><button class="btn sm">Save changes</button></div></form>` : `<h3>Description</h3><p>${esc(t.description) || '<span class="muted">No description.</span>'}</p>${t.labels.length ? `<p class="tc-labels">${t.labels.map(l => `<span>${esc(l)}</span>`).join('')}</p>` : ''}`}
    <h3>Attachments</h3>${docs.length ? `<ul class="alist">${docs.map(d => `<li><button class="link" data-act="download" data-id="${d.id}">${esc(d.title)}</button> <span class="muted">v${d.versions.length}</span></li>`).join('')}</ul>` : '<p class="empty">None.</p>'}
    ${canTalk && (ed || hasPerm(u, 'ticket.create')) ? `<button class="btn sm ghost" data-act="uploadModal" data-entity="ticket" data-eid="${t.id}" data-ws="${t.ws}">Attach file</button>` : ''}
    <h3>Comments</h3>${t.comments.map(c => `<div class="comment"><strong>${esc(uname(c.by))}</strong> <span class="muted">${D.stamp(c.at)}</span><p>${esc(c.body)}</p></div>`).join('') || '<p class="empty">No comments yet.</p>'}
    ${canTalk ? `<form data-form="ticketComment"><input type="hidden" name="id" value="${t.id}">${fld('Add a comment', ta('body', '', 'required'))}<button class="btn sm">Comment</button></form>` : ''}
   </div>
   <aside class="tside">
    ${ed ? `<form data-form="ticketFields">
      <input type="hidden" name="id" value="${t.id}">
      ${fld('Status', sel('status', ticketStatuses(), t.status))}${fld('Assignee', sel('assignee', assignees(t.ws).map(x => [x.id, x.fullName]), t.assignee))}
      ${fld('Priority', sel('priority', ticketPriorities(), t.priority))}${fld('Type', sel('type', ticketTypes(), t.type))}
      ${fld('Due date', inp('due', t.due, 'date'))}${fld('Linked activity', sel('activityId', [['', 'None']].concat(acts.map(x => [x.id, num(x) + '. ' + x.name])), t.activityId || ''))}
      <button class="btn sm block">Update</button></form>`
    : `<dl class="kv one"><dt>Status</dt><dd>${stb(t.status)}</dd><dt>Assignee</dt><dd>${esc(uname(t.assignee))}</dd><dt>Priority</dt><dd>${prioIcon(t.priority)} ${esc(t.priority)}</dd><dt>Due</dt><dd>${t.due ? D.nice(t.due) : 'None'}</dd><dt>Linked activity</dt><dd>${a ? actLink(a) : 'None'}</dd></dl>`}
    <dl class="kv one"><dt>Reporter</dt><dd>${esc(uname(t.reporter))} (${esc(orgName((userOf(t.reporter) || {}).org).split(' ')[0])})</dd><dt>Created</dt><dd>${D.stamp(t.created)}</dd><dt>Updated</dt><dd>${D.stamp(t.updated)}</dd>${a && ed ? `<dt>Activity</dt><dd>${actLink(a)}</dd>` : ''}</dl>
    <h3>History</h3><ol class="timeline">${t.history.slice().reverse().slice(0, 12).map(h => `<li><span class="muted">${D.stamp(h[0])}</span><br>${esc(uname(h[1]))} ${h[2] === 'created' ? 'created the ticket' : 'changed ' + esc(hName(h[2]).toLowerCase()) + (h[2] === 'description' ? '' : ' to <strong>' + esc(hVal(h[2], h[4])) + '</strong>')}</li>`).join('')}</ol>
   </aside></div></section>`;
}

/* ---------- Ticket actions ---------- */

function touchTicket(t, field, oldV, newV) {
  t.history.push([D.now(), Sess.userId, field, oldV ?? '', newV ?? '']);
  t.updated = D.now();
  audit('ticket.' + (field === 'created' ? 'create' : 'update'), 'ticket', t.key, field === 'created' ? null : { [field]: oldV }, field === 'created' ? { title: t.title } : { [field]: newV });
}
function ticketNotify(t, msg, extra) {
  notify([t.assignee, t.reporter].concat(extra || []).filter(id => id !== Sess.userId), 'Ticket', t.key + ': ' + msg, { ws: t.ws, visibleToDevs: false, link: '#/tickets?ws=' + t.ws + '&id=' + t.id });
}

ACT.ticketOpen = el => { const t = St().tickets.find(x => x.id === el.dataset.id); if (t) go('tickets', Object.assign({}, parseHash().query, { ws: t.ws, id: t.id })); };
document.addEventListener('keydown', e => { const c = e.target.closest && e.target.closest('.tcard'); if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ACT.ticketOpen(c); } });

ACT.ticketNew = el => {
  const u = me(), ws = el.dataset.ws;
  if (!canRaiseTicket(u, ws)) return toast('You cannot raise tickets on this board.', 'err');
  const acts = visActs(u).filter(x => x.ws === ws);
  modal('Create ticket: ' + wsName(ws), `<form data-form="ticketNew" class="fgrid"><input type="hidden" name="ws" value="${ws}">
   ${fld('Type', sel('type', ticketTypes(), u.org === 'BOCRA' ? 'UAT defect' : 'Task'))}${fld('Priority', sel('priority', ticketPriorities(), 'Medium'))}
   ${fld('Summary', inp('title', '', 'text', 'required maxlength="200"'), 'span2')}
   ${fld('Description', ta('description', '', 'rows="5"'), 'span2')}
   ${fld('Assignee', sel('assignee', assignees(ws).map(x => [x.id, x.fullName]), (devLeads(ws)[0] || '')))}${fld('Due date', inp('due', '', 'date'))}
   ${fld('Linked activity', sel('activityId', [['', 'None']].concat(acts.map(x => [x.id, num(x) + '. ' + x.name]))))}${fld('Labels (comma separated)', inp('labels', ''))}
   <div class="span2"><button class="btn">Create</button></div></form>`, true);
};
FORM.ticketNew = fd => {
  const u = me(), S = St(), ws = fd.get('ws');
  if (!canRaiseTicket(u, ws)) return toast('Not allowed.', 'err');
  const n = S.tickets.filter(t => t.ws === ws).length + 1;
  const assignee = fd.get('assignee');
  if (!assignees(ws).some(x => x.id === assignee)) return toast('Choose an assignee who works on this board.', 'err');
  const t = { id: uid('t'), key: ticketPrefix(ws) + '-' + n, ws, type: fd.get('type'), title: String(fd.get('title')).trim(), description: String(fd.get('description') || '').trim(),
    priority: fd.get('priority'), status: 'To do', assignee, reporter: u.id, activityId: fd.get('activityId') || null,
    labels: String(fd.get('labels') || '').split(',').map(s => s.trim()).filter(Boolean), due: fd.get('due') || null, estimate: null,
    created: D.now(), updated: D.now(), comments: [], history: [] };
  if (!t.title) return toast('Give the ticket a summary.', 'err');
  S.tickets.push(t);
  touchTicket(t, 'created', '', 'To do');
  ticketNotify(t, 'assigned to you: ' + t.title);
  closeModal();
  go('tickets', { ws, id: t.id });
  commit(t.key + ' created.');
};
FORM.ticketFields = fd => {
  const u = me(), t = St().tickets.find(x => x.id === fd.get('id'));
  if (!canEditTicket(u, t)) return toast('You cannot change this ticket.', 'err');
  const changes = [];
  ['status', 'assignee', 'priority', 'type', 'due', 'activityId'].forEach(k => {
    const v = fd.get(k) || null;
    if (String(t[k] ?? '') !== String(v ?? '')) changes.push([k, t[k], v]);
  });
  const as = changes.find(c => c[0] === 'assignee');
  if (as && !assignees(t.ws).some(x => x.id === as[2])) return toast('Choose an assignee who works on this board.', 'err');
  if (!changes.length) return toast('No changes.');
  changes.forEach(([k, o, v]) => { t[k] = v; touchTicket(t, k, o, v); });
  ticketNotify(t, changes.map(([k, , v]) => (k === 'assignee' ? 'assigned to ' + uname(v) : k + ' ' + (v || 'cleared'))).join(', '));
  commit(t.key + ' updated.');
};
FORM.ticketEdit = fd => {
  const u = me(), t = St().tickets.find(x => x.id === fd.get('id'));
  if (!canEditTicket(u, t)) return toast('You cannot change this ticket.', 'err');
  const v = { title: String(fd.get('title')).trim(), description: String(fd.get('description') || '').trim(), labels: String(fd.get('labels') || '').split(',').map(s => s.trim()).filter(Boolean), estimate: fd.get('estimate') === '' ? null : Math.max(0, +fd.get('estimate')) };
  if (!v.title) return toast('Give the ticket a summary.', 'err');
  Object.keys(v).forEach(k => { if (JSON.stringify(t[k]) !== JSON.stringify(v[k])) { const o = t[k]; t[k] = v[k]; touchTicket(t, k, Array.isArray(o) ? o.join(', ') : o, Array.isArray(v[k]) ? v[k].join(', ') : v[k]); } });
  commit('Saved.');
};
FORM.ticketComment = fd => {
  const u = me(), t = St().tickets.find(x => x.id === fd.get('id')), body = String(fd.get('body') || '').trim();
  if (!canSeeTicket(u, t) || !body) return;
  t.comments.push({ by: u.id, at: D.now(), body });
  t.updated = D.now();
  audit('ticket.comment', 'ticket', t.key, null, { body: body.slice(0, 200) });
  ticketNotify(t, uname(u.id) + ' commented');
  commit('Comment added.');
};

// Drag a card to another column to change status
document.addEventListener('dragstart', e => { const c = e.target.closest && e.target.closest('.tcard'); if (c) { e.dataTransfer.setData('text/plain', c.dataset.ticket); c.classList.add('dragging'); } });
document.addEventListener('dragend', e => { const c = e.target.closest && e.target.closest('.tcard'); if (c) c.classList.remove('dragging'); document.querySelectorAll('.bcol.over').forEach(x => x.classList.remove('over')); });
document.addEventListener('dragover', e => { const col = e.target.closest && e.target.closest('.bcol'); if (col) { e.preventDefault(); document.querySelectorAll('.bcol.over').forEach(x => x !== col && x.classList.remove('over')); col.classList.add('over'); } });
document.addEventListener('drop', e => {
  const col = e.target.closest && e.target.closest('.bcol');
  if (!col) return;
  e.preventDefault();
  const t = St().tickets.find(x => x.id === e.dataTransfer.getData('text/plain'));
  if (!t || t.status === col.dataset.status) return;
  if (!canEditTicket(me(), t)) return toast('You cannot move tickets on this board.', 'err');
  const o = t.status;
  t.status = col.dataset.status;
  touchTicket(t, 'status', o, t.status);
  ticketNotify(t, 'moved to ' + t.status);
  commit(t.key + ' moved to ' + t.status + '.');
});

// Ticket data for the report builder
DATASETS.tickets = {
  label: 'Developer tickets', date: 'created', status: 'status',
  cols: [['key', 'Key'], ['title', 'Summary'], ['ws', 'Workstream'], ['type', 'Type'], ['priority', 'Priority'], ['status', 'Status'], ['assignee', 'Assignee'], ['reporter', 'Reporter'], ['created', 'Created'], ['due', 'Due'], ['estimate', 'Estimate']],
  def: ['key', 'title', 'ws', 'type', 'priority', 'status', 'assignee'],
  rows: u => St().tickets.filter(t => canSeeTicket(u, t)).map(t => ({ key: t.key, title: t.title, ws: wsName(t.ws), type: t.type, priority: t.priority, status: t.status, assignee: uname(t.assignee), reporter: uname(t.reporter), created: D.dateOf(t.created), due: t.due || '', estimate: t.estimate ?? '' }))
};

render();
