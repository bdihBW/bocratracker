// Administrator user management (FR-ADM-01, FR-AUTH-04, FR-AUTH-06). Creating Auth users needs the
// service role, so it runs here after checking that the caller holds the users.manage permission.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { admin, ANON, URL_, cors } from '../_shared/cors.ts';

function tempPassword() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const b = crypto.getRandomValues(new Uint32Array(14));
  return Array.from(b, (n) => c[n % c.length]).join('') + '7';
}

Deno.serve(async (req) => {
  const { ok, h, json } = await cors(req, 'authorization, content-type, apikey, x-client-info');
  if (req.method === 'OPTIONS') return new Response(null, { status: ok ? 204 : 403, headers: h });
  if (!ok) return json({ error: 'Not allowed' }, 403);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const user = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get('authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: isAdmin } = await user.rpc('has_perm', { p: 'users.manage' });
  if (!isAdmin) return json({ error: 'Administrators only' }, 403);
  const body = await req.json().catch(() => ({}));

  if (body.action === 'create') {
    const { username, full_name, organisation_id, role, job_title, phone, email, delegated } = body;
    if (!/^[a-z0-9._]{3,30}$/.test(username ?? '')) return json({ error: 'Usernames are 3 to 30 letters, digits, dots or underscores.' }, 400);
    if (!full_name || String(full_name).length > 120 || (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) return json({ error: 'Check the name and email.' }, 400);
    const pw = tempPassword();
    // Users without an email get an internal address; Auth needs one, notifications skip it
    const authEmail = (email || `${username}@users.bdih.invalid`).toLowerCase();
    const { data, error } = await admin.auth.admin.createUser({ email: authEmail, password: pw, email_confirm: true });
    if (error) return json({ error: error.message }, 400);
    const { error: pe } = await admin.from('profiles').insert({ id: data.user.id, username, full_name, organisation_id, role, job_title, phone, email: email || null, delegated: !!delegated, must_change_password: true });
    if (pe) { await admin.auth.admin.deleteUser(data.user.id); return json({ error: pe.message }, 400); }
    return json({ user_id: data.user.id, temporary_password: pw });
  }
  if (body.action === 'reset_password') {
    if (!/^[0-9a-f-]{36}$/.test(String(body.user_id))) return json({ error: 'Unknown user' }, 400);
    const pw = tempPassword();
    const { error } = await admin.auth.admin.updateUserById(body.user_id, { password: pw });
    if (error) return json({ error: error.message }, 400);
    await admin.from('profiles').update({ must_change_password: true, locked_until: null, failed_logins: [] }).eq('id', body.user_id);
    await admin.from('password_reset_requests').update({ status: 'Done', handled_at: new Date().toISOString() }).eq('user_id', body.user_id).eq('status', 'Pending');
    return json({ temporary_password: pw });
  }
  return json({ error: 'Unknown action' }, 400);
});
