// src/utils/nativePush.js
//
// Phase 56d — Firebase Cloud Messaging registration for the Capacitor
// Android wrapper.
//
// Owner directive (18 May 2026):
//   "App icon is the default Capacitor logo
//    No splash artwork yet
//    let's finish this then i will share apk"
//
// Web push (Phase 33R + 33W) uses VAPID-keyed subscription via the
// browser Service Worker. The Android wrapper can't subscribe that
// way — there's no Service Worker inside a Capacitor WebView. Instead
// we register with FCM and store the FCM device token in the same
// `push_subscriptions` table, distinguished by `platform='android'`.
//
// Web build: no-op (Capacitor.isNativePlatform() short-circuits).
// First-launch onboarding (Phase 56f) handles the OS-level
// POST_NOTIFICATIONS permission prompt; this util just registers
// the token once permission is already granted.
//
// Wiring on the server side is a separate sprint — the Supabase
// edge function that today blasts web push needs a branch for
// platform='android' rows that sends via the FCM HTTP v1 API.
// Until that ships, owner can send test pushes from Firebase
// Console → Cloud Messaging → New Notification with the test FCM
// token to verify end-to-end delivery on a specific device.

import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { supabase } from '../lib/supabase'

let registered = false   // module-level guard
let activeUser  = null

/**
 * Register the device for FCM, listen for the token, persist it to
 * Supabase against the current user. Idempotent + native-only.
 *
 * Call this AFTER NativeOnboarding completes (so POST_NOTIFICATIONS
 * permission is granted). Safe to call on every app start; the
 * `registered` guard prevents duplicate listener registration.
 */
export async function registerNativePush(userId) {
  if (!Capacitor.isNativePlatform()) return
  if (!userId) return
  // If we already registered for this user, no-op. If a different
  // user signs in on the same device, the listener still fires; the
  // saveToken call below upserts against the new userId.
  activeUser = userId
  if (registered) return

  // Register listeners BEFORE calling register() so the first
  // token event isn't missed.
  await PushNotifications.addListener('registration', async (token) => {
    try {
      await saveFcmToken(activeUser, token.value)
    } catch (e) {
      console.warn('[fcm] save token failed:', e?.message || e)
    }
  })

  await PushNotifications.addListener('registrationError', (err) => {
    console.warn('[fcm] registration error:', err?.error || err)
  })

  await PushNotifications.addListener('pushNotificationReceived', (notification) => {
    // Foreground notification — Android shows it as a system tray
    // entry by default. If we want an in-app banner instead, route
    // through pushToast here.
    console.info('[fcm] received:', notification?.title)
  })

  await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    // Rep tapped a push notification. action.notification.data may
    // carry a lead_id / route — could push history.push here once
    // server-side payload is finalised.
    console.info('[fcm] tapped:', action?.notification?.data)
  })

  // Permission check. Onboarding (Phase 56f) should have prompted
  // already; if the rep skipped, register() will throw — we swallow
  // and the rep can re-grant via Settings later.
  try {
    const perm = await PushNotifications.checkPermissions()
    if (perm?.receive !== 'granted') {
      console.info('[fcm] permission not granted yet; skip register')
      registered = true  // don't keep retrying every shell mount
      return
    }
    await PushNotifications.register()
    registered = true
  } catch (e) {
    console.warn('[fcm] register failed:', e?.message || e)
  }
}

/**
 * Persist the FCM token to push_subscriptions. Uses the existing
 * table with two new columns (platform + fcm_token) — see
 * supabase_phase56d_fcm_tokens.sql.
 *
 * `endpoint` is reused as a unique key by prefixing the token with
 * "fcm:" so the existing UNIQUE (endpoint) index doesn't collide
 * with web push subscription endpoints (https://...).
 */
async function saveFcmToken(userId, fcmToken) {
  if (!userId || !fcmToken) return
  const endpoint = `fcm:${fcmToken}`
  const payload = {
    user_id:    userId,
    endpoint,
    p256dh:     '',           // not used for FCM
    auth:       '',           // not used for FCM
    platform:   'android',
    fcm_token:  fcmToken,
    user_agent: 'capacitor-android',
    last_seen_at: new Date().toISOString(),
  }
  // ON CONFLICT (endpoint) DO UPDATE — same pattern as the web push
  // path uses. Re-installing the APK on the same device gets a new
  // FCM token + new row; the old row is garbage-collected when the
  // server-side send hits 410 / Unregistered.
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(payload, { onConflict: 'endpoint' })
  if (error) throw error
}

/**
 * Manual deregistration — used on sign-out to delete THIS device's
 * token so future pushes don't go to a shared phone where someone
 * else is now signed in.
 */
export async function deregisterNativePush() {
  if (!Capacitor.isNativePlatform()) return
  if (!activeUser) return
  // We don't have a clean way to recover the FCM token from the
  // plugin once registered, so we delete by user + platform. If a
  // shared device has both reps signed in alternately, each
  // sign-out clears that user's tokens cleanly.
  const user = activeUser
  activeUser = null
  registered = false
  try {
    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', user)
      .eq('platform', 'android')
  } catch (e) {
    console.warn('[fcm] deregister failed:', e?.message || e)
  }
}
