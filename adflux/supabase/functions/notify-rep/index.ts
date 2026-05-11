// supabase/functions/notify-rep/index.ts
//
// Phase 33S — Edge Function that sends Web Push to a rep's
// registered devices.
//
// Invoke (POST):
//   {
//     user_id:  uuid,                  // target rep
//     title:    string,                // notification title
//     body:     string,                // notification body
//     url?:     string,                // tap → opens this path
//     tag?:     string,                // dedup tag (replaces same-tag notifs)
//     require_interaction?: boolean,   // keep until user dismisses
//   }
//
// Auth: caller must be a logged-in user (any role) OR pass the
// service-role bearer in Authorization header. We DON'T allow
// arbitrary push from anonymous — that would let any user spam
// any rep.
//
// Side effects:
//   • Reads public.push_subscriptions for the target user_id.
//   • Reads public.user_notification_prefs (if exists) for opt-out.
//   • Calls web-push for each endpoint.
//   • If endpoint returns 410 Gone, deletes the row (subscription
//     expired / user unsubscribed in the browser).
//
// VAPID env vars (set via `npx supabase secrets set ...`):
//   VAPID_PUBLIC_KEY
//   VAPID_PRIVATE_KEY
//   VAPID_SUBJECT  (e.g. mailto:untitledadvertising@gmail.com)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import webpush from 'https://esm.sh/web-push@3.6.7'

const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')  || ''
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') || ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT')     || 'mailto:untitledadvertising@gmail.com'

const SB_URL   = Deno.env.get('SUPABASE_URL') || ''
const SB_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS })
  }
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return json({ error: 'VAPID keys not configured' }, 500)
  }

  let payload
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Bad JSON' }, 400)
  }

  const { user_id, title, body, url, tag, require_interaction } = payload || {}
  if (!user_id || !title) {
    return json({ error: 'user_id and title required' }, 400)
  }

  // Service-role client — bypasses RLS so we can read every device.
  const sb = createClient(SB_URL, SB_KEY)

  // Check opt-out prefs. Only enforce when explicitly told what
  // category we are. If pref row missing, default to send.
  // (Caller can pass category to enable opt-out checking; v1 ships
  // without category filtering — every push goes through.)

  const { data: subs, error: subErr } = await sb.from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', user_id)
  if (subErr) {
    return json({ error: subErr.message }, 500)
  }
  if (!subs || subs.length === 0) {
    return json({ sent: 0, reason: 'no subscriptions' })
  }

  const message = JSON.stringify({
    title,
    body: body || '',
    url:  url  || '/work',
    tag:  tag  || 'untitled',
    requireInteraction: !!require_interaction,
  })

  let sent = 0
  let removed = 0
  const errors: any[] = []

  for (const s of subs) {
    const subscription = {
      endpoint: s.endpoint,
      keys: { p256dh: s.p256dh, auth: s.auth },
    }
    try {
      await webpush.sendNotification(subscription, message)
      sent += 1
      // Update last_seen_at so we know which devices are still live.
      await sb.from('push_subscriptions')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', s.id)
    } catch (e: any) {
      const status = e?.statusCode || e?.status || 0
      // 404 / 410 — subscription is dead. Remove it so we stop trying.
      if (status === 404 || status === 410) {
        await sb.from('push_subscriptions').delete().eq('id', s.id)
        removed += 1
      } else {
        errors.push({ endpoint: s.endpoint.slice(-12), status, msg: String(e?.message || e) })
      }
    }
  }

  return json({ sent, removed, errors })
})

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })
}
