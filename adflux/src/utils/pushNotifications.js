// src/utils/pushNotifications.js
//
// Phase 33R — push notification client helpers.
//
// Owner directives #2 / #3 / #15:
//   - Settings UI to opt in / out
//   - Push notification on every login
//   - Missed-task push notifications
//
// What this file does:
//   • registerServiceWorker()   — registers /sw.js (idempotent).
//   • requestPermission()       — prompts the user once for browser
//     notification permission.
//   • subscribeForPush(userId)  — gets a PushSubscription from the
//     browser, sends it to Supabase (public.push_subscriptions) so
//     server-side fan-out can target it.
//   • ensurePushOnLogin(userId) — single entry point called from
//     /work mount. Registers SW, asks permission if not already
//     decided, and subscribes. Silent if already set up.
//
// SERVER setup still required (owner action, NOT shipped here):
//   1. Generate a VAPID keypair:
//        npx web-push generate-vapid-keys
//   2. Add VITE_VAPID_PUBLIC_KEY to your .env (Vercel + local).
//   3. Add VAPID_PRIVATE_KEY + VAPID_SUBJECT to Supabase Edge
//      Function env vars.
//   4. Write an Edge Function (notify-rep.ts) that uses the
//      web-push library to send to a user's subscriptions when
//      missed-followup / new-lead / payment-received events fire.

import { supabase } from '../lib/supabase'

function urlBase64ToUint8Array(b64) {
  const padding = '='.repeat((4 - b64.length % 4) % 4)
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i)
  return out
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  } catch (e) {
    console.warn('SW register failed:', e)
    return null
  }
}

export async function requestPermission() {
  if (!('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied')  return 'denied'
  try {
    return await Notification.requestPermission()
  } catch (e) {
    return 'error'
  }
}

export async function subscribeForPush(userId) {
  if (!userId) return null
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null

  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!vapidPublicKey) {
    // Skip silently if VAPID isn't configured — owner needs to set
    // VITE_VAPID_PUBLIC_KEY in Vercel env before push works.
    return null
  }

  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()

  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      })
    } catch (e) {
      console.warn('Push subscribe failed:', e)
      return null
    }
  }

  // Upsert subscription into Supabase. ON CONFLICT endpoint keeps
  // one row per device.
  const json = sub.toJSON()
  await supabase.from('push_subscriptions').upsert({
    user_id: userId,
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh,
    auth:   json.keys?.auth,
    user_agent: navigator.userAgent,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' })

  return sub
}

// Single entry point for the rep's /work mount.
// Quiet on already-set-up, only prompts once.
export async function ensurePushOnLogin(userId) {
  if (!userId) return
  await registerServiceWorker()
  const perm = await requestPermission()
  if (perm !== 'granted') return
  await subscribeForPush(userId)
}

// Phase 33S — fire-and-forget helper to send a push to one rep.
// Wraps the notify-rep Edge Function. Returns the function response
// (or null on error). Safe to call from any client — RLS on the
// edge function checks the caller's auth.
export async function sendPushToRep({ userId, title, body, url, tag, requireInteraction }) {
  try {
    const { data, error } = await supabase.functions.invoke('notify-rep', {
      body: {
        user_id: userId,
        title,
        body,
        url,
        tag,
        require_interaction: requireInteraction,
      },
    })
    if (error) {
      console.warn('notify-rep failed:', error)
      return null
    }
    return data
  } catch (e) {
    console.warn('notify-rep threw:', e)
    return null
  }
}

export async function unsubscribeFromPush(userId) {
  if (!userId) return
  const reg = await navigator.serviceWorker?.ready
  const sub = await reg?.pushManager?.getSubscription()
  if (sub) {
    await supabase.from('push_subscriptions')
      .delete().eq('endpoint', sub.endpoint)
    await sub.unsubscribe()
  }
}
