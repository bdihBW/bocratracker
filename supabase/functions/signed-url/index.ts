// Short-lived download links (FR-DOC-03, SRS 5.3). The caller's own JWT reads the document row, so
// RLS decides access; the daily download limit is checked and the download recorded; only then does
// the service role sign a 5 minute URL.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { admin, ANON, URL_, cors } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const { ok, h, json } = await cors(req, 'authorization, content-type, apikey, x-client-info');
  if (req.method === 'OPTIONS') return new Response(null, { status: ok ? 204 : 403, headers: h });
  if (!ok) return json({ error: 'Not allowed' }, 403);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const auth = req.headers.get('authorization') ?? '';
  const { document_id, version_no } = await req.json().catch(() => ({}));
  if (!/^[0-9a-f-]{36}$/.test(String(document_id)) || (version_no != null && !Number.isInteger(version_no))) return json({ error: 'Not found' }, 404);
  const user = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  let q = user.from('document_versions').select('storage_path, file_name, version_no, document_id').eq('document_id', document_id);
  q = version_no ? q.eq('version_no', version_no) : q.order('version_no', { ascending: false }).limit(1);
  const { data: v } = await q.maybeSingle();
  // Same answer whether the file does not exist or the caller may not see it
  if (!v) return json({ error: 'Not found' }, 404);
  const { data: left, error: limitErr } = await user.rpc('record_download', { p_action: 'document.download', p_entity_type: 'document', p_entity_id: document_id, p_details: { version: v.version_no } });
  if (limitErr) return json({ error: limitErr.message }, 429);
  const { data, error } = await admin.storage.from('project-files').createSignedUrl(v.storage_path, 300, { download: v.file_name });
  if (error) return json({ error: 'Not found' }, 404);
  return json({ url: data.signedUrl, expires_in: 300, downloads_left_today: left });
});
