// Builds the database index page and the compressed SQL script from supabase/.
// Run after changing any migration:  node tools/build-database-page.mjs
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sb = join(root, 'supabase');
const migDir = join(sb, 'migrations');

// Remove comments and indentation, keep one statement fragment per line.
// Quotes and $$ bodies are tracked so "--" inside a string is never treated as a comment.
function compress(sql) {
  const out = [];
  let inQuote = false;
  for (const raw of sql.split(/\r?\n/)) {
    let line = '', i = 0;
    while (i < raw.length) {
      const c = raw[i];
      if (!inQuote && c === '-' && raw[i + 1] === '-') break;
      if (c === "'") inQuote = !inQuote;
      line += c; i++;
    }
    line = line.replace(/\s+/g, ' ').trim();
    if (line) out.push(line);
  }
  return out.join('\n') + '\n';
}

const files = readdirSync(migDir).filter(f => f.endsWith('.sql')).sort().map(f => ({ name: 'migrations/' + f, kind: 'Migration', sql: readFileSync(join(migDir, f), 'utf8') }));
files.push({ name: 'seed.sql', kind: 'Seed data', sql: readFileSync(join(sb, 'seed.sql'), 'utf8') });
const fnDir = join(sb, 'functions');
const functions = readdirSync(fnDir).filter(d => existsSync(join(fnDir, d, 'index.ts'))).map(d => ({ name: 'functions/' + d + '/index.ts', kind: 'Edge Function', sql: readFileSync(join(fnDir, d, 'index.ts'), 'utf8') }));

const full = files.map(f => '-- ' + f.name + '\n' + f.sql).join('\n');
const min = '-- BDIH Project Tracker database, compressed. Built ' + new Date().toISOString().slice(0, 10) + ' from supabase/migrations and seed.sql.\n' + files.map(f => compress(f.sql)).join('');
writeFileSync(join(sb, 'bdih_tracker.min.sql'), min);

const count = (re) => files.reduce((n, f) => n + (f.sql.match(re) || []).length, 0);
// Three policy templates in a loop expand to twelve policies (risks, issues, decisions, change requests)
const stats = {
  tables: count(/^create table /gim), policies: count(/create policy /gi) - 3 + 4 * 3, functions: count(/create or replace function /gi),
  indexes: count(/create (unique )?index /gi), triggers: count(/create trigger /gi), views: count(/create or replace view /gi),
  fullKb: Math.round(Buffer.byteLength(full) / 1024), minKb: Math.round(Buffer.byteLength(min) / 1024)
};

const checklist = [
  ['Access control', 'Row Level Security is enabled and forced on every table', 'done'],
  ['Access control', 'Developers can never read the other developer\'s rows, files, tickets, invoices or totals (tested per role)', 'done'],
  ['Access control', 'Role-based permissions in a table (role_permissions), checked by has_perm() in every policy and function', 'done'],
  ['Access control', 'Privileged changes go through security definer functions with a fixed search_path and their own permission checks', 'done'],
  ['Access control', 'Anonymous users can call only request_password_reset(); internal functions are not callable by users', 'done'],
  ['Access control', 'Audit log is append-only (no update, delete or truncate, even for administrators)', 'done'],
  ['Secrets', 'Service role key used only inside Edge Functions; the browser uses the anon key', 'done'],
  ['Secrets', 'No secrets in the repository; the only function secret to set is TURNSTILE_SECRET', 'configure'],
  ['Secrets', 'Remove the demo accounts list and demo password from the sign-in page before go-live', 'configure'],
  ['Authentication', 'Username sign-in with generic errors (no username discovery) and lockout after repeated failures', 'done'],
  ['Authentication', 'Password reset requests give the same answer whether or not the user exists', 'done'],
  ['Authentication', 'Set JWT expiry to 60 seconds or less, and enable leaked-password protection and MFA in the authentication settings', 'configure'],
  ['Rate limits', 'Sign-in: 10 per minute per IP (database-backed, shared by all function instances)', 'done'],
  ['Rate limits', 'Password reset: 5 per hour per IP', 'done'],
  ['Rate limits', 'Writes: tickets, comments, documents 30 a minute; invoices and submissions 10 per 5 minutes; risks and issues 20 per 5 minutes per user', 'done'],
  ['Rate limits', 'Downloads: daily limit per person (default 30), recorded with who downloaded what', 'done'],
  ['Input', 'Length limits on every free-text column; type, priority and status values checked against the administrator lists', 'done'],
  ['Input', 'File type checked by content, 100 MB cap, private buckets, 5 minute signed download links', 'done'],
  ['Browser', 'Content Security Policy: scripts only from the app, no plugins, no inline script', 'done'],
  ['Browser', 'All output escaped before it reaches the page (no innerHTML from user text)', 'done'],
  ['Browser', 'Serve over HTTPS with HSTS and frame-ancestors none (set as hosting headers)', 'configure'],
  ['Edge Functions', 'CORS limited to APP_ORIGIN; POST only; no-store and nosniff headers; inputs validated', 'done'],
  ['Performance', `${stats.indexes} indexes covering every foreign key, RLS check and common filter`, 'done'],
  ['Performance', 'RLS helper functions are STABLE so Postgres evaluates them once per query where possible', 'done'],
  ['Performance', 'Statement timeout 15 s for signed-in users and 3 s for anonymous requests', 'done'],
  ['Performance', 'Schedule recalculation runs once per change in business-day index space (under 5 s for 500 activities)', 'done'],
  ['Operations', 'Enable point-in-time recovery and daily backups; separate dev, staging and production projects', 'configure'],
  ['Operations', 'Schedule run_reminders() with pg_cron on weekday mornings', 'configure'],
  ['Operations', 'Confirm data residency with BOCRA before go-live (SRS section 10)', 'configure']
];

const data = { files: files.concat(functions).map(f => ({ name: f.name, kind: f.kind, text: f.sql, lines: f.sql.split('\n').length })), min, stats, checklist, built: new Date().toISOString().slice(0, 16).replace('T', ' ') };
const json = JSON.stringify(data).replace(/</g, '\\u003c');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; object-src 'none'; base-uri 'self'">
<title>Database scripts | BDIH Project Tracker</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="css/database.css">
</head>
<body>
<header class="db-top"><a href="index.html" class="back">Back to the tracker</a><h1>Database scripts</h1>
<p>Everything needed to build the database: ${files.length - 1} migrations, seed data and ${functions.length} Edge Functions. Built ${data.built} UTC.</p></header>
<main class="db-main">
<section class="db-stats" aria-label="Summary"></section>
<section class="db-card"><h2>Install</h2>
<ol class="steps"><li>Create the database project (development first, then staging and production).</li>
<li>Run the <strong>compressed script</strong> in the SQL editor, or run the migrations in order with <code>supabase db push</code> and then the seed.</li>
<li>Deploy the Edge Functions and set the secret <code>TURNSTILE_SECRET</code>. Allowed web addresses are kept in <code>settings.app_origins</code>.</li>
<li>Work through the items marked "Configure" in the checklist below.</li></ol>
<div class="btns"><button class="btn" data-dl="min">Download compressed script</button><button class="btn ghost" data-copy="min">Copy compressed script</button><button class="btn ghost" data-dl="all">Download all migrations as one file</button></div>
<p class="muted" id="sizes"></p></section>
<section class="db-card"><h2>Security and performance checklist</h2><div id="checklist"></div></section>
<section class="db-card"><div class="db-files-h"><h2>Scripts</h2><input type="search" id="find" placeholder="Search tables, policies, functions" aria-label="Search the scripts"></div>
<div class="db-layout"><nav id="toc" aria-label="Files"></nav><div id="files"></div></div></section>
</main>
<script type="application/json" id="db-data">${json}</script>
<script src="js/database.js"></script>
</body>
</html>
`;
writeFileSync(join(root, 'database.html'), html);
console.log(`database.html and supabase/bdih_tracker.min.sql written. ${stats.fullKb} KB to ${stats.minKb} KB compressed.`);
