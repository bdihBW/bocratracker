// Username login (FR-AUTH-01, FR-AUTH-02, FR-AUTH-05, FR-AUTH-11)
// Resolves the username to the Supabase Auth account server-side, enforces lockout and the
// Cloudflare Turnstile check, and returns the session. The same generic message is returned for an
// unknown username, a wrong password and a lockout.
// Deploy with JWT verification off: the caller is not signed in yet.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { admin, ANON, URL_, cors } from '../_shared/cors.ts';

const GENERIC = 'The username or password is incorrect, or the account is temporarily locked.';
// Cloudflare Turnstile secret (supabase secrets set TURNSTILE_SECRET=...). When set, every sign-in must pass.
const TURNSTILE_SECRET = Deno.env.get('TURNSTILE_SECRET');

async function turnstileOk(token: unknown, ip: string) {
  if (!TURNSTILE_SECRET) return true;
  if (typeof token !== 'string' || token.length > 2048) return false;
  const body = new URLSearchParams({ secret: TURNSTILE_SECRET, response: token, remoteip: ip });
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  return j.success === true;
}

Deno.serve(async (req) => {
  const { ok, h, json } = await cors(req, 'content-type, apikey, x-client-info, authorization');
  if (req.method === 'OPTIONS') return new Response(null, { status: ok ? 204 : 403, headers: h });
  if (!ok) return json({ error: 'This address is not allowed to sign in.' }, 403);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const { error: limited } = await admin.rpc('login_rate_limit', { p_ip: ip });
  if (limited) return json({ error: 'Too many attempts. Wait a minute and try again.' }, 429);

  const { username, password, turnstile_token } = await req.json().catch(() => ({}));
  if (!(await turnstileOk(turnstile_token, ip))) return json({ error: 'The security check failed. Please try again.' }, 403);
  if (typeof username !== 'string' || typeof password !== 'string' || password.length > 200 || !/^[A-Za-z0-9._]{3,30}$/.test(username)) {
    return json({ error: GENERIC }, 401);
  }
  const { data: rows } = await admin.rpc('auth_lookup', { p_username: username.toLowerCase() });
  const acct = rows?.[0];
  if (!acct || !acct.active || (acct.locked_until && new Date(acct.locked_until).getTime() > Date.now())) {
    if (acct) await admin.rpc('record_login', { p_user: acct.user_id, p_success: false, p_ip: ip });
    return json({ error: GENERIC }, 401);
  }
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email: acct.email, password });
  if (error || !data.session) {
    await admin.rpc('record_login', { p_user: acct.user_id, p_success: false, p_ip: ip });
    return json({ error: GENERIC }, 401);
  }
  await admin.rpc('record_login', { p_user: acct.user_id, p_success: true, p_ip: ip });
  return json({ session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token }, must_change_password: acct.must_change_password });
});
