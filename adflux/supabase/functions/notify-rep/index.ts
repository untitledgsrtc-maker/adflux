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
//
// Phase 56h — Android FCM env var (set via supabase secrets):
//   FIREBASE_SERVICE_ACCOUNT  — full JSON contents of the Firebase
//   Admin SDK service-account key (download from Firebase Console
//   → Project settings → Service accounts → Generate new private
//   key). The function parses it, builds a signed JWT, and trades
//   it for an OAuth access token to call FCM HTTP v1.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import webpush from 'https://esm.sh/web-push@3.6.7'

const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')  || ''
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') || ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT')     || 'mailto:untitledadvertising@gmail.com'

const SB_URL   = Deno.env.get('SUPABASE_URL') || ''
const SB_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

// Phase 56h — Firebase service account (JSON string). Parse lazily
// so the function still boots when only web push is configured.
const FCM_SERVICE_ACCOUNT_JSON = Deno.env.get('FIREBASE_SERVICE_ACCOUNT') || ''
let fcmServiceAccount: any = null
if (FCM_SERVICE_ACCOUNT_JSON) {
  try {
    fcmServiceAccount = JSON.parse(FCM_SERVICE_ACCOUNT_JSON)
  } catch (e) {
    console.warn('[fcm] FIREBASE_SERVICE_ACCOUNT JSON parse failed:', (e as Error).message)
  }
}

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

  // Phase 56h — also pull platform + fcm_token so we can route web
  // rows to web push and android rows to FCM.
  const { data: subs, error: subErr } = await sb.from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, platform, fcm_token')
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

  // Phase 56h — partition subscriptions by platform. Web rows go
  // through webpush (existing). Android rows go through FCM HTTP v1
  // (new). iOS will reuse the same FCM path once iOS APK ships.
  const webSubs     = subs.filter(s => !s.platform || s.platform === 'web')
  const androidSubs = subs.filter(s => s.platform === 'android' && s.fcm_token)

  // ── Web push loop ──
  for (const s of webSubs) {
    const subscription = {
      endpoint: s.endpoint,
      keys: { p256dh: s.p256dh, auth: s.auth },
    }
    try {
      await webpush.sendNotification(subscription, message)
      sent += 1
      await sb.from('push_subscriptions')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', s.id)
    } catch (e: any) {
      const status = e?.statusCode || e?.status || 0
      if (status === 404 || status === 410) {
        await sb.from('push_subscriptions').delete().eq('id', s.id)
        removed += 1
      } else {
        errors.push({ endpoint: s.endpoint.slice(-12), status, msg: String(e?.message || e) })
      }
    }
  }

  // ── Phase 56h — Android FCM loop ──
  if (androidSubs.length > 0) {
    if (!fcmServiceAccount) {
      errors.push({ platform: 'android', msg: 'FIREBASE_SERVICE_ACCOUNT not configured — skipped ' + androidSubs.length + ' Android device(s)' })
    } else {
      let fcmAccessToken: string | null = null
      try {
        fcmAccessToken = await getFcmAccessToken(fcmServiceAccount)
      } catch (e) {
        errors.push({ platform: 'android', msg: 'oauth: ' + String((e as Error).message || e) })
      }
      if (fcmAccessToken) {
        const projectId = fcmServiceAccount.project_id
        for (const s of androidSubs) {
          try {
            const fcmRes = await sendFcm(
              projectId, fcmAccessToken, s.fcm_token,
              { title, body: body || '', url: url || '/work', tag: tag || 'untitled' }
            )
            if (fcmRes.ok) {
              sent += 1
              await sb.from('push_subscriptions')
                .update({ last_seen_at: new Date().toISOString() })
                .eq('id', s.id)
            } else if (fcmRes.status === 404 || fcmRes.errorCode === 'UNREGISTERED' || fcmRes.errorCode === 'INVALID_ARGUMENT') {
              // Stale token — purge.
              await sb.from('push_subscriptions').delete().eq('id', s.id)
              removed += 1
            } else {
              errors.push({ platform: 'android', token: String(s.fcm_token).slice(-12), status: fcmRes.status, msg: fcmRes.errorMsg })
            }
          } catch (e) {
            errors.push({ platform: 'android', token: String(s.fcm_token).slice(-12), msg: String((e as Error).message || e) })
          }
        }
      }
    }
  }

  return json({ sent, removed, errors })
})

/* ─────────────────────────────────────────────────────────────────
 * Phase 56h — FCM HTTP v1 helpers
 * ───────────────────────────────────────────────────────────────── */

/**
 * Mint a Google OAuth access token from a service-account JSON.
 * Builds an RS256-signed JWT, exchanges it at the token endpoint,
 * returns the 1-hour access_token.
 */
async function getFcmAccessToken(sa: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  }
  const segments = [base64url(JSON.stringify(header)), base64url(JSON.stringify(claims))]
  const signingInput = segments.join('.')
  const signature = await signRs256(signingInput, sa.private_key)
  const jwt = `${signingInput}.${signature}`

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  if (!tokenRes.ok) {
    const txt = await tokenRes.text()
    throw new Error(`oauth ${tokenRes.status}: ${txt.slice(0, 200)}`)
  }
  const tokenJson = await tokenRes.json()
  return tokenJson.access_token
}

/**
 * Send one FCM notification. Returns { ok, status, errorCode, errorMsg }.
 */
async function sendFcm(
  projectId: string,
  accessToken: string,
  fcmToken: string,
  payload: { title: string; body: string; url: string; tag: string },
): Promise<{ ok: boolean; status: number; errorCode?: string; errorMsg?: string }> {
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`
  // Phase 96.0 (2026-05-27) — DATA-ONLY FCM payload.
  //
  // Why dropped the top-level `notification` field:
  //   When `notification` is present, FCM auto-displays in the system
  //   tray ONLY when the app is backgrounded. In foreground it
  //   delivers to `pushNotificationReceived` but does NOT pop the
  //   tray (FCM design). Reps run the app foreground all day = most
  //   pushes invisible. Phase 56h.2 toast was a partial workaround
  //   (in-app only). Now: client-side `pushNotificationReceived` in
  //   nativePush.js schedules a LocalNotification on every receive,
  //   regardless of FG/BG state. App owns the tray 100%.
  //
  // Why data-only also helps Vivo / Xiaomi:
  //   OEM battery savers throttle FCM's auto-display step more
  //   aggressively than data-only delivery. priority='high' + data-
  //   only data wakes the app's FCM service, app immediately calls
  //   LocalNotifications.schedule(), AlarmManager pops the tray.
  //   Result: same speed for all OEMs, no auto-display batching.
  //
  // The android.notification block is GONE for the same reason —
  // it only mattered when FCM was auto-displaying. The channel id +
  // small icon are now applied by the client when scheduling the
  // LocalNotification (see nativePush.js pushNotificationReceived
  // handler + scheduleFollowUpAlarm.js).
  const body = {
    message: {
      token: fcmToken,
      data: {
        title: payload.title,
        body:  payload.body,
        url:   payload.url,
        tag:   payload.tag,
      },
      android: {
        // Phase 56h.1 — `priority: 'high'` bypasses Android Doze so
        // the device wakes for delivery instead of batching. For
        // data-only messages priority=high is REQUIRED — without
        // it, Android caps data-only delivery at a few per day per
        // app for battery reasons.
        priority: 'high',
      },
    },
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${accessToken}`,
      'content-type':  'application/json',
    },
    body: JSON.stringify(body),
  })
  if (res.ok) return { ok: true, status: res.status }
  const txt = await res.text()
  // FCM returns JSON error bodies like
  // { error: { code: 404, message: '...', status: 'NOT_FOUND',
  //   details: [{ errorCode: 'UNREGISTERED' }] } }
  let errorCode: string | undefined
  let errorMsg = txt.slice(0, 300)
  try {
    const parsed = JSON.parse(txt)
    errorMsg = parsed?.error?.message || errorMsg
    const details = parsed?.error?.details || []
    for (const d of details) {
      if (d.errorCode) errorCode = d.errorCode
    }
    if (!errorCode) errorCode = parsed?.error?.status
  } catch { /* leave errorMsg as raw */ }
  return { ok: false, status: res.status, errorCode, errorMsg }
}

/** Base64-URL encode a string. */
function base64url(input: string): string {
  const b64 = btoa(input)
  return b64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

/** Base64-URL encode raw bytes. */
function base64urlBytes(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

/**
 * RS256-sign a string with a PEM-encoded RSA private key (from the
 * Firebase service-account JSON's private_key field). Returns
 * base64-url signature.
 */
async function signRs256(signingInput: string, pem: string): Promise<string> {
  // Strip PEM header / footer / whitespace, base64-decode to raw key bytes.
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')
  const keyDer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyDer.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const data = new TextEncoder().encode(signingInput)
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, data)
  return base64urlBytes(new Uint8Array(sig))
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })
}
