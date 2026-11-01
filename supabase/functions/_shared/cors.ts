// Shared CORS handling: only the web addresses listed in Settings (settings.app_origins) may call the
// functions. The list is read with the service role and cached for a minute.
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

export const URL_ = Deno.env.get('SUPABASE_URL')!;
export const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
export const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
export const admin: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false } });

let cache = { at: 0, list: [] as string[] };
async function allowedOrigins(): Promise<string[]> {
  if (Date.now() - cache.at > 60_000) {
    const { data } = await admin.rpc('allowed_origins');
    cache = { at: Date.now(), list: Array.isArray(data) ? data : [] };
  }
  return cache.list;
}

export async function cors(req: Request, headers: string) {
  const origin = req.headers.get('origin') ?? '';
  const ok = !!origin && (await allowedOrigins()).includes(origin);
  const h: Record<string, string> = { 'Vary': 'Origin', 'Access-Control-Allow-Headers': headers, 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (ok) h['Access-Control-Allow-Origin'] = origin;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...h, 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  return { ok, h, json };
}
