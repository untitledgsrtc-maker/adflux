// supabase/functions/ingest-gps/index.ts
//
// Phase 103.D.3 Step 2 — native background GPS ingest.
//
// The Android foreground LocationTrackingService POSTs each location
// fix here WHILE THE APP IS CLOSED. The JS/web layer is dead at that
// point, so it can't write via the normal supabase-js client — the
// native side has no Supabase session. This endpoint is how the ping
// reaches the server without one.
//
// Auth = the device's FCM token (already provisioned per-device in
// push_subscriptions, the same token used for push). We map the token
// to its user_id and insert with the service role. We NEVER trust a
// user_id from the request body — only the token→user mapping.
//
// POST body: { token: string, lat: number, lng: number, accuracy_m?: number }
//   token = the device's fcm_token (push_subscriptions.fcm_token)
//
// Returns: { ok: true } on insert (or { ok:true, dup:true } on a
//   same-second duplicate), else { ok:false, error } with a status code.
//
// Security model (audited Phase 103.D.3):
//   • The fcm_token is a per-device secret — same trust level as push.
//     An attacker would need a live rep's FCM token to write pings as
//     them, and can ONLY ever write for that one mapped user_id.
//   • source is pinned to 'interval' (the gps_pings CHECK allows
//     checkin/interval/checkout/manual). The 100m min-segment +
//     speed-cap + 600km/day filters in compute_daily_ta (Phase 68/98.D)
//     bound any abuse to noise.
//   • Service-role insert bypasses RLS BY DESIGN — the native client has
//     no session. The token lookup is the gate.
//   • Bad/garbage tokens cost one indexed push_subscriptions lookup then
//     401 — no write.
//
// Deploy (owner):
//   npx --yes supabase functions deploy ingest-gps --no-verify-jwt
//   (--no-verify-jwt so the native client doesn't need a Supabase JWT;
//    the fcm_token check IS the auth.)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SB_URL = Deno.env.get('SUPABASE_URL') || ''
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405)

  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'bad json' }, 400)
  }

  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  const lat = Number(body?.lat)
  const lng = Number(body?.lng)
  const acc = body?.accuracy_m != null && isFinite(Number(body.accuracy_m))
    ? Math.round(Number(body.accuracy_m))
    : null

  if (!token) return json({ ok: false, error: 'token required' }, 400)
  if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return json({ ok: false, error: 'bad coords' }, 400)
  }

  if (!SB_URL || !SB_KEY) return json({ ok: false, error: 'server not configured' }, 500)
  const sb = createClient(SB_URL, SB_KEY)

  // Map the device token → user. NEVER trust a user_id from the body.
  const { data: subs, error: subErr } = await sb
    .from('push_subscriptions')
    .select('user_id')
    .eq('fcm_token', token)
    // Freshest mapping wins if a token was ever reassigned across users
    // (no UNIQUE on fcm_token). Indexed by idx_push_subscriptions_fcm_token.
    .order('last_seen_at', { ascending: false })
    .limit(1)
  if (subErr) return json({ ok: false, error: subErr.message }, 500)
  const userId = subs?.[0]?.user_id
  if (!userId) return json({ ok: false, error: 'unknown device' }, 401)

  // Phase 103.D.8 — STOP SIGNAL (the "GPS keeps fetching after checkout"
  // fix). If the rep is already checked out for today (manual OR the 8 PM
  // auto-checkout cron), the native foreground service must stop. The JS
  // layer can't relay checkout when the app is fully closed, so the
  // server tells the device here: we DON'T insert the ping (no
  // post-checkout km inflating TA) and return stop:true. The native
  // LocationTrackingService reads that and calls stopSelf — no hardcoded
  // clock, works at ANY checkout time (her 10:02 PM case included).
  // work_sessions.work_date is the IST calendar day.
  const istToday = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)
  const { data: ses } = await sb
    .from('work_sessions')
    .select('check_out_at')
    .eq('user_id', userId)
    .eq('work_date', istToday)
    .maybeSingle()
  if (ses?.check_out_at) {
    return json({ ok: true, stop: true, reason: 'checked-out' })
  }

  const { error: insErr } = await sb.from('gps_pings').insert([{
    user_id: userId,
    lat: lat.toFixed(7),
    lng: lng.toFixed(7),
    accuracy_m: acc,
    source: 'interval',   // only allowed set: checkin/interval/checkout/manual
  }])
  if (insErr) {
    // Same-second (user_id, captured_at) duplicate — harmless, treat ok.
    if ((insErr as any).code === '23505') return json({ ok: true, dup: true })
    return json({ ok: false, error: insErr.message }, 500)
  }
  return json({ ok: true })
})
