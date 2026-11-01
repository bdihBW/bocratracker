'use strict';
/* Database scripts page: renders the migrations, Edge Functions, compressed script and checklist. */
(function () {
  const data = JSON.parse(document.getElementById('db-data').textContent);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = s => document.querySelector(s);
  const slug = s => s.replace(/[^a-z0-9]+/gi, '-').toLowerCase();

  const s = data.stats;
  $('.db-stats').innerHTML = [['Tables', s.tables], ['Policies', s.policies], ['Functions', s.functions], ['Indexes', s.indexes], ['Triggers', s.triggers], ['Views', s.views]]
    .map(([l, v]) => `<div><strong>${v}</strong><span>${l}</span></div>`).join('');
  $('#sizes').textContent = `All migrations: ${s.fullKb} KB. Compressed script: ${s.minKb} KB (comments and indentation removed; it runs exactly the same).`;

  const groups = {};
  data.checklist.forEach(([g, t, st]) => { (groups[g] = groups[g] || []).push([t, st]); });
  $('#checklist').innerHTML = Object.entries(groups).map(([g, items]) => `<h3>${esc(g)}</h3><ul class="check">${items.map(([t, st]) =>
    `<li class="${st}"><span class="mark">${st === 'done' ? 'Done' : 'Configure'}</span>${esc(t)}</li>`).join('')}</ul>`).join('');

  // Light highlighting: comments, keywords and strings, applied to escaped text
  const KW = /\b(create|or|replace|table|function|policy|trigger|index|view|select|insert|update|delete|from|where|and|not|null|returns|language|security|definer|begin|end|if|then|else|elsif|return|declare|on|for|to|using|with|check|primary|key|references|default|alter|grant|revoke|execute|perform|raise|exception|unique|exists|join|left|as|in|is|values|set|into|loop|case|when)\b/gi;
  function highlight(text, ts) {
    return text.split('\n').map(line => {
      const ci = ts ? line.indexOf('//') : line.indexOf('--');
      const code = ci >= 0 ? line.slice(0, ci) : line, com = ci >= 0 ? line.slice(ci) : '';
      let h = esc(code).replace(/('[^']*')/g, '<span class="s">$1</span>');
      if (!ts) h = h.replace(KW, m => `<span class="k">${m}</span>`);
      return h + (com ? `<span class="c">${esc(com)}</span>` : '');
    }).join('\n');
  }

  function renderFiles(q) {
    const term = (q || '').toLowerCase();
    const list = data.files.filter(f => !term || f.text.toLowerCase().includes(term) || f.name.toLowerCase().includes(term));
    $('#toc').innerHTML = list.map(f => `<a href="#${slug(f.name)}"><span>${esc(f.name.split('/').pop())}</span><em>${esc(f.kind)}</em></a>`).join('') || '<p class="muted">No matches.</p>';
    $('#files').innerHTML = list.map(f => {
      const hits = term ? f.text.toLowerCase().split(term).length - 1 : 0;
      return `<details class="file" id="${slug(f.name)}" ${term ? 'open' : ''}><summary><strong>${esc(f.name)}</strong> <span class="muted">${f.kind}, ${f.lines} lines${hits ? ', ' + hits + ' matches' : ''}</span>
        <span class="btns"><button class="btn sm ghost" data-copy="${esc(f.name)}">Copy</button><button class="btn sm ghost" data-dl="${esc(f.name)}">Download</button></span></summary>
        <pre><code>${highlight(f.text, f.name.endsWith('.ts'))}</code></pre></details>`;
    }).join('');
    if (term) document.querySelectorAll('#files pre code').forEach(c => { c.innerHTML = c.innerHTML.replace(new RegExp('(' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![^<]*>)', 'gi'), '<mark>$1</mark>'); });
  }
  renderFiles('');
  $('#find').addEventListener('input', e => renderFiles(e.target.value));

  const textFor = k => k === 'min' ? data.min : k === 'all' ? data.files.filter(f => f.kind !== 'Edge Function').map(f => '-- ' + f.name + '\n' + f.text).join('\n') : (data.files.find(f => f.name === k) || {}).text || '';
  const nameFor = k => k === 'min' ? 'bdih_tracker.min.sql' : k === 'all' ? 'bdih_tracker.full.sql' : k.split('/').slice(-2).join('_');
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-copy],[data-dl]');
    if (!b) return;
    e.preventDefault();
    if (b.dataset.copy) {
      navigator.clipboard.writeText(textFor(b.dataset.copy)).then(() => { const t = b.textContent; b.textContent = 'Copied'; setTimeout(() => { b.textContent = t; }, 1500); });
    } else {
      const url = URL.createObjectURL(new Blob([textFor(b.dataset.dl)], { type: 'text/plain' }));
      const a = document.createElement('a'); a.href = url; a.download = nameFor(b.dataset.dl); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    }
  });
})();
