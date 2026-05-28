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
// Phase 96.0 (2026-05-27) — LocalNotifications path. Used for two
// things: (a) on FCM receipt in foreground/background, immediately
// schedule a tray notification so it shows regardless of app state
// (FCM auto-display only fires when backgrounded with `notification`
// payload; data-only FCM never auto-displays); (b) AlarmManager-
// scheduled follow-up reminders via scheduleFollowUpAlarm.js (OEM-
// immune — bypasses FCM entirely for known-time events). Both paths
// use the same `untitled_default` channel so the rep sees one
// unified Untitled OS notifications preference in system settings.
import { LocalNotifications } from '@capacitor/local-notifications'
import { supabase } from '../lib/supabase'
import { pushToast } from '../components/v2/Toast'

let registered      = false   // module-level guard
let channelEnsured  = false   // notification channel idempotency guard
let localChannelEnsured = false   // Phase 96.0 — LocalNotifications channel guard
let localListenersBound = false   // Phase 96.0 — tap listener idempotency
let activeUser      = null

// Phase B1/F-407 (2026-05-28) — derive LocalNotification id from a
// stable key in the FCM payload so Xiaomi/MIUI's double-fire of
// `pushNotificationReceived` produces ONE tray entry (Android
// replaces by id). Falls back to random when no stable key.
//
// Partition: 1..1_999_999_999 (FCM-receipt). Follow-up alarms use
// 2_000_000_001..2_147_483_647 (see scheduleFollowUpAlarm.js).
// No overlap = no cross-namespace collision.
function fcmIdFromStableKey(s) {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0   // djb2 32-bit truncated
  }
  return ((h >>> 0) % 1_999_999_999) + 1
}

// Phase 56h.2 (19 May 2026) — high-importance channel ID. MUST match
// the AndroidManifest meta-data
// `com.google.firebase.messaging.default_notification_channel_id`
// AND the FCM payload `android.notification.channel_id` field in
// `supabase/functions/notify-rep/index.ts`. Changing the ID here
// without updating both other places will silently drop pushes
// back onto the auto-created low-importance "Miscellaneous" channel.
const CHANNEL_ID = 'untitled_default'

/**
 * Phase 56h.2 — create the notification channel before registering
 * for FCM. On Android 8+ every notification must belong to a
 * channel; if FCM payload's channel_id doesn't match an existing
 * channel, Android falls back to the auto-created "Miscellaneous"
 * channel (IMPORTANCE_DEFAULT — silent, no heads-up).
 *
 * Channel properties (importance: 5 = IMPORTANCE_HIGH):
 *   - heads-up banner over lock screen
 *   - default sound + vibration
 *   - shows in status bar
 *   - lights pulse (on devices with notification LED)
 *
 * The channel's user-visible properties (name, importance) are
 * locked at first creation — Android does NOT honor changes on
 * subsequent calls. To change them, increment the channel ID
 * (e.g. `untitled_default_v2`) and update BOTH the manifest
 * meta-data AND the FCM payload to match.
 */
async function ensureChannel() {
  if (channelEnsured) return
  if (!Capacitor.isNativePlatform()) return
  // PushNotifications.createChannel is Android-only; on iOS the
  // plugin throws "not implemented". Guard explicitly.
  if (Capacitor.getPlatform() !== 'android') {
    channelEnsured = true
    return
  }
  try {
    await PushNotifications.createChannel({
      id:          CHANNEL_ID,
      name:        'Untitled OS',
      description: 'Lead alerts, follow-up reminders, and smart tasks.',
      importance:  5,        // IMPORTANCE_HIGH
      visibility:  1,        // VISIBILITY_PUBLIC — show on lock screen
      sound:       'default',
      vibration:   true,
      lights:      true,
      lightColor:  '#FFE600',
    })
    channelEnsured = true
  } catch (e) {
    console.warn('[fcm] createChannel failed:', e?.message || e)
  }
}

/**
 * Phase 96.0 — mirror the FCM channel on the LocalNotifications side.
 * Both plugins live in the SAME `NotificationManager` system table on
 * Android — channel ids must match exactly. Calling createChannel
 * with the same id from both plugins is safe (Android dedupes by id;
 * the first creator wins for user-visible properties).
 *
 * Idempotent. Web no-op via Capacitor.isNativePlatform().
 */
async function ensureLocalChannel() {
  if (localChannelEnsured) return
  if (!Capacitor.isNativePlatform()) return
  if (Capacitor.getPlatform() !== 'android') {
    localChannelEnsured = true
    return
  }
  try {
    await LocalNotifications.createChannel({
      id:          CHANNEL_ID,
      name:        'Untitled OS',
      description: 'Lead alerts, follow-up reminders, and smart tasks.',
      importance:  5,        // IMPORTANCE_HIGH
      visibility:  1,        // VISIBILITY_PUBLIC
      sound:       'default',
      vibration:   true,
      lights:      true,
      lightColor:  '#FFE600',
    })
    localChannelEnsured = true
  } catch (e) {
    console.warn('[localnotif] createChannel failed:', e?.message || e)
  }
}

/**
 * Phase 96.0 — wire the tap handler for LocalNotifications. Tap on
 * AlarmManager-scheduled follow-up OR on FCM-receipt-routed local
 * notification both flow through this listener. Mirror nativePush
 * `pushNotificationActionPerformed` behaviour: extract `url` from
 * extra payload, hard-navigate via window.location (listener fires
 * outside the React tree).
 *
 * Also request explicit permission for LocalNotifications. On Android
 * 13+ POST_NOTIFICATIONS is a runtime permission; FCM register()
 * usually triggers the OS prompt already, but LocalNotifications
 * needs its own permission check for the scheduled-alarm path. Safe
 * to call multiple times (plugin returns current state if already
 * granted).
 */
async function ensureLocalListeners() {
  if (localListenersBound) return
  if (!Capacitor.isNativePlatform()) return

  try {
    const perm = await LocalNotifications.checkPermissions()
    if (perm?.display !== 'granted') {
      await LocalNotifications.requestPermissions()
    }
  } catch (e) {
    console.warn('[localnotif] permission check failed:', e?.message || e)
  }

  try {
    await LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
      try {
        const data = action?.notification?.extra || {}
        const path = data.url
        if (path && typeof path === 'string' && path.startsWith('/')) {
          // Same pattern as PushNotifications tap path — listener
          // fires outside React tree, use window.location.
          window.location.assign(path)
        }
      } catch (e) {
        console.warn('[localnotif] tap navigation failed:', e?.message || e)
      }
    })
    localListenersBound = true
  } catch (e) {
    console.warn('[localnotif] addListener failed:', e?.message || e)
  }
}

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

  // Phase 56h.2 — ensure the high-importance channel exists BEFORE
  // register() fires. Without this channel, FCM falls back to the
  // auto-created "Miscellaneous" channel which is IMPORTANCE_DEFAULT
  // (no heads-up, no sound on Android 8+). Idempotent — Android
  // ignores duplicate createChannel calls.
  await ensureChannel()

  // Phase 96.0 — mirror the channel + bind tap listener for the
  // LocalNotifications path (foreground FCM-receipt + AlarmManager-
  // scheduled follow-ups). Both safe to call repeatedly.
  await ensureLocalChannel()
  await ensureLocalListeners()

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
    // Phase 56h.2 — when the app is in the foreground, Android does
    // NOT auto-display the FCM notification (by design — the app
    // gets a chance to handle it). Previously this handler was just
    // a console.info, so reps saw nothing when a push arrived while
    // the app was open. Now we surface an in-app toast with the
    // same title + body so the rep gets feedback either way.
    //
    // Phase 96.0 — toast is in-app only. To pop the SYSTEM TRAY too
    // (which is what reps actually want), schedule a LocalNotification
    // immediately on receipt. Works for both data-only and notification
    // FCM payloads. With Phase 96.0 Edge Function switched to data-
    // only, this is the ONLY path that creates the tray entry — FCM
    // never auto-displays for data-only.
    //
    // FCM v1 data-only places fields under `notification.data`. FCM
    // v1 notification messages also put title/body at the top level.
    // Read from both with data winning when both exist (data-only is
    // the canonical post-96.0 shape).
    const data  = notification?.data || {}
    const title = data.title || notification?.title || 'Untitled OS'
    const body  = data.body  || notification?.body  || ''
    const url   = data.url   || '/'
    const tag   = data.tag   || 'untitled'

    // In-app toast (foreground feedback). Keep as-is — owner uses it
    // to confirm the app is alive even when system tray is suppressed.
    const msg = body ? `${title} — ${body}` : title
    try {
      pushToast(msg, 'info')
    } catch (e) {
      console.warn('[fcm] toast failed:', e?.message || e)
    }

    // Phase 96.0 — fire-and-forget local schedule so the tray pops.
    // Phase B1/F-407 — derive id from stable key so OEM double-fire
    // (Xiaomi/MIUI, Vivo FunTouch) produces ONE tray entry instead
    // of two duplicate notifications. Stable-key chain:
    //   data.tag           — always set by current SQL triggers
    //                        (Phase 34Z.55 task-<id> / fu-<id>,
    //                         Phase 34Z.61 morning push, Phase 76
    //                         GPS off, etc.)
    //   data.follow_up_id  — future-proofing if Edge Function adds
    //   data.lead_id       — future-proofing
    //   data.notification_id — future-proofing
    //   data.url           — semantic fallback (could collide if
    //                        same URL pushed twice on purpose, but
    //                        rare)
    //   random fallback    — if no stable key, behave like Phase 96.0
    const stableKey =
      data.tag ||
      data.follow_up_id ||
      data.lead_id ||
      data.notification_id ||
      data.url ||
      null
    const notifId = stableKey
      ? fcmIdFromStableKey(String(stableKey))
      : (Math.floor(Math.random() * 1_999_999_999) + 1)
    try {
      LocalNotifications.schedule({
        notifications: [{
          id: notifId,
          title,
          body,
          channelId: CHANNEL_ID,
          smallIcon: 'ic_stat_notification',
          extra: { url, tag },
          // No `schedule:` → fires immediately. AlarmManager bypass.
        }],
      }).catch((e) => console.warn('[localnotif] foreground schedule failed:', e?.message || e))
    } catch (e) {
      console.warn('[localnotif] foreground schedule threw:', e?.message || e)
    }
  })

  await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    // Rep tapped a push notification. action.notification.data may
    // carry a lead_id / route — could push history.push here once
    // server-side payload is finalised.
    try {
      const data = action?.notification?.data || {}
      const path = data.url
      if (path && typeof path === 'string' && path.startsWith('/')) {
        // Use full-page navigation rather than React Router push
        // because this listener fires outside the React tree.
        // The HashRouter / BrowserRouter picks the path up on next
        // mount. window.location is safe for the Capacitor WebView.
        window.location.assign(path)
      }
    } catch (e) {
      console.warn('[fcm] tap navigation failed:', e?.message || e)
    }
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
