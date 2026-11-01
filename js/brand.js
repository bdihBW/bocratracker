'use strict';
/* Logos. Vector redraws of the Botswana Innovation Hub, BOCRA and UASF marks are used by default.
   To use the official artwork instead, save the files as assets/logos/bdih.png, bocra.png and
   uasf.png (PNG, SVG or JPG with the same base name); the app picks them up automatically. */

const LOGO_FILES = { bdih: null, bocra: null, uasf: null };

function probeLogos(done) {
  let pending = 0;
  Object.keys(LOGO_FILES).forEach(k => ['png', 'svg'].forEach(ext => {
    pending++;
    const img = new Image();
    img.onload = () => { if (!LOGO_FILES[k]) LOGO_FILES[k] = img.src; if (--pending === 0) done(); };
    img.onerror = () => { if (--pending === 0) done(); };
    img.src = 'assets/logos/' + k + '.' + ext;
  }));
}

function mixHex(a, b, t) {
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
const ARC_STOPS = [[0, '#a7a88f'], [0.16, '#c8c49b'], [0.27, '#f5d38a'], [0.35, '#f2b33d'], [0.44, '#e3892d'],
  [0.5, '#8f2a22'], [0.6, '#b8452a'], [0.7, '#e7a48c'], [0.84, '#d8785b'], [1, '#a5311f']];
function arcColor(t, ring) {
  let i = 0;
  while (i < ARC_STOPS.length - 2 && t > ARC_STOPS[i + 1][0]) i++;
  const [t0, c0] = ARC_STOPS[i], [t1, c1] = ARC_STOPS[i + 1];
  const c = mixHex(c0, c1, (t - t0) / (t1 - t0));
  return t > 0.55 && t < 0.9 ? mixHex(c, '#ffffff', ring * 0.08) : c;
}

// The fanned tile arc of the Botswana Innovation Hub mark
function bihArc(cx, cy) {
  const rings = [[30, 40], [43, 54], [57, 69], [72, 86]], N = 18, a0 = 250, a1 = 18;
  const pt = (r, deg) => { const a = deg * Math.PI / 180; return (cx + r * Math.cos(a)).toFixed(1) + ' ' + (cy - r * Math.sin(a)).toFixed(1); };
  let out = '';
  rings.forEach(([r1, r2], ri) => {
    for (let k = 0; k < N; k++) {
      if (ri === 0 && (k < 2 || k > 14)) continue;
      if (ri === 1 && k > 16) continue;
      const gap = 0.12;
      const A = a0 - (a0 - a1) * ((k + gap) / N), B = a0 - (a0 - a1) * ((k + 1 - gap) / N);
      out += `<path d="M${pt(r1 + 1, A)} L${pt(r2, A)} A${r2} ${r2} 0 0 1 ${pt(r2, B)} L${pt(r1 + 1, B)} A${r1 + 1} ${r1 + 1} 0 0 0 ${pt(r1 + 1, A)}Z" fill="${arcColor((k + 0.5) / N, ri)}"/>`;
    }
  });
  return out;
}

function bihLogo(cls) {
  if (LOGO_FILES.bdih) return `<img class="${cls || ''}" src="${LOGO_FILES.bdih}" alt="Botswana Innovation Hub">`;
  return `<svg class="${cls || ''}" viewBox="0 0 330 190" role="img" aria-label="Botswana Innovation Hub">${bihArc(98, 96)}
    <text x="78" y="138" font-family="'Google Sans Flex','Google Sans','Roboto',sans-serif" font-size="58" font-weight="500" fill="#6e1f23" letter-spacing="-1">B<tspan fill="#7d7a3a">o</tspan>tswana</text>
    <text x="80" y="170" font-family="'Google Sans Flex','Google Sans','Roboto',sans-serif" font-size="17.5" font-weight="700" fill="#2a2321" letter-spacing="7.2">INNOVATION HUB</text></svg>`;
}
function bihMark(cls) {
  return `<svg class="${cls || ''}" viewBox="8 6 180 180" aria-hidden="true">${bihArc(98, 96)}</svg>`;
}
function bocraLogo(cls) {
  if (LOGO_FILES.bocra) return `<img class="${cls || ''}" src="${LOGO_FILES.bocra}" alt="BOCRA">`;
  return `<svg class="${cls || ''}" viewBox="0 0 150 58" role="img" aria-label="BOCRA">
    <text x="2" y="34" font-family="'Google Sans Flex','Google Sans','Roboto',sans-serif" font-size="38" font-weight="600" fill="#8a8d91" letter-spacing="1">BOCRA</text>
    ${['#0f7f86', '#3d8b3a', '#8a1c2b', '#5b3a7c'].map((c, i) => `<circle cx="${30 + i * 19}" cy="49" r="5.6" fill="${c}"/>`).join('')}</svg>`;
}
function uasfLogo(cls) {
  if (LOGO_FILES.uasf) return `<img class="${cls || ''}" src="${LOGO_FILES.uasf}" alt="UASF">`;
  // Colour ribbons sweeping down and round under a grey wordmark, three dots above
  return `<svg class="${cls || ''}" viewBox="0 0 214 128" role="img" aria-label="UASF">
    <path d="M36 34 C12 60 14 102 64 118" stroke="#c4175c" stroke-width="10" fill="none" stroke-linecap="round"/>
    <path d="M52 42 C34 64 38 94 70 106" stroke="#f3c300" stroke-width="9" fill="none" stroke-linecap="round"/>
    <path d="M66 54 C56 72 60 88 82 95" stroke="#2f9d58" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path d="M78 68 C74 104 126 120 204 104" stroke="#1d86c6" stroke-width="8" fill="none" stroke-linecap="round"/>
    <ellipse cx="42" cy="23" rx="11" ry="8.5" fill="#c4175c" transform="rotate(-18 42 23)"/>
    <circle cx="62" cy="16" r="6" fill="#1d86c6"/><circle cx="75" cy="29" r="6" fill="#2f9d58"/>
    <circle cx="136" cy="44" r="3" fill="#29b6e8"/><circle cx="162" cy="44" r="3" fill="#222"/><circle cx="188" cy="44" r="3" fill="#29b6e8"/>
    <text x="86" y="93" font-family="'Google Sans Flex','Google Sans','Roboto',sans-serif" font-size="46" font-weight="700" fill="#6b6b6d" letter-spacing="1">UASF</text></svg>`;
}
function wsLogo(ws, cls) { return ws === 'A' ? bocraLogo(cls) : ws === 'B' ? uasfLogo(cls) : bihMark(cls); }
