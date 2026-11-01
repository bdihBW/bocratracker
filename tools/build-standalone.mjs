// Packs the app and the database page into single HTML files that work on their own
// (CSS and JavaScript inlined, CSP pinned to the inline script's hash), and writes them to dist/.
// Run:  node tools/build-standalone.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });
const read = p => readFileSync(join(root, p), 'utf8');
const sha = s => "'sha256-" + createHash('sha256').update(s, 'utf8').digest('base64') + "'";

function pack(htmlFile, outName, title) {
  let html = read(htmlFile);
  // Inline stylesheets from this project (Google Fonts stay as links)
  html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (_, href) => `<style>\n${read(href)}\n</style>`);
  // Collect the project scripts in order and inline them as one block; keep the JSON data block as is
  const scripts = [];
  html = html.replace(/<script src="(js\/[^"]+)"><\/script>\n?/g, (_, src) => { scripts.push(`/* ${src} */\n` + read(src).replace('if(!e)throw new Error("Automatic publicPath is not supported in this browser")', 'if(!e)e=location.href')); return ''; });
  // Browsers turn CRLF into LF before hashing an inline script, so the hash must be taken over LF text
  // Point links at the standalone file names before hashing, so the hash matches what ships
  const relink = t => t.replace(/href="database\.html"/g, 'href="bdih-database.html"').replace(/href="index\.html"/g, 'href="bdih-tracker.html"');
  html = relink(html);
  // One inline script per source file, as in the normal build, so each keeps its own scope and order
  const blocks = scripts.map(s => '\n' + relink(s).replace(/\r\n?/g, '\n').replace(/<\/script/gi, '<\\/script') + '\n');
  // Function replacement: the inlined code contains $& and similar, which a string replacement would expand
  html = html.replace('</body>', () => blocks.map(b => `<script>${b}</script>\n`).join('') + '</body>');
  // Each inline script is allowed by its hash; nothing else inline can run
  html = html.replace(/script-src 'self'( https:\/\/challenges\.cloudflare\.com)?/, (m, cf) => `script-src 'self' ${blocks.map(sha).join(' ')}${cf || ''}`);
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
  writeFileSync(join(dist, outName), html);
  return Math.round(Buffer.byteLength(html) / 1024);
}

const a = pack('index.html', 'bdih-tracker.html', 'BDIH Project Tracker');
const b = pack('database.html', 'bdih-database.html', 'Database scripts | BDIH Project Tracker');
writeFileSync(join(dist, 'bdih_tracker.min.sql'), read('supabase/bdih_tracker.min.sql'));
writeFileSync(join(dist, 'plan.sql'), read('supabase/plan.sql'));
console.log(`dist/bdih-tracker.html ${a} KB, dist/bdih-database.html ${b} KB`);
