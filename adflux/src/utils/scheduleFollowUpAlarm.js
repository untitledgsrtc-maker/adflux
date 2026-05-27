// src/utils/scheduleFollowUpAlarm.js
//
// Phase 96.0 (2026-05-27) — universal, OEM-immune follow-up reminders.
//
// Why this exists:
//   Vivo / Xiaomi / Realme / Oppo FunTouch / MIUI / ColorOS / OxygenOS
//   throttle background FCM service even with `priority: high`. Result:
//   server enqueues 282 pushes today, FCM accepts, device pops 2 per
//   week. Foreground app suppresses tray entirely (FCM design).
//
//   This bypasses FCM for known-time events. When the rep saves a
//   follow-up at "tomorrow 4 pm", we schedule a LocalNotification on
//   the device. Android AlarmManager fires at the exact second the
//   rep picked — survives process death, OEM kills, network outage,
//   battery saver, app force-stop. Tap navigates same as FCM tap.
//
// FCM stays in the loop for real-time events (GPS-off nag, new lead
// assigned, manager push). Both paths schedule the same channel id
// (`untitled_default`) so the user experience is identical.
//
// Web build: no-op via Capacitor.isNativePlatform() guard.

import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'

// Phase 96.0 — keep LocalNotifications channel id aligned with the
// FCM channel in nativePush.js + supabase/functions/notify-rep/index.ts.
// Single channel = unified user-visible "Untitled OS" preference in
// Settings → Apps → Untitled OS → Notifications. Otherwise reps would
// see two channels and have to toggle both.
const CHANNEL_ID = 'untitled_default'

// Stable id-from-uuid. LocalNotifications.schedule expects a 32-bit
// signed int. We hash the follow-up uuid into a deterministic
// positive int in the upper half of the range so we don't collide
// with FCM-receipt randoms (which use the full 31-bit range).
//
// Range partition:
//   FCM-receipt randoms   → 1 .. 2_000_000_000  (set in nativePush.js)
//   Follow-up alarms      → 2_000_000_001 .. 2_147_483_647  (here)
//
// 32-bit signed max = 2_147_483_647. The follow-up range gives us
// ~147 million ids, more than enough for the lifetime of any rep's
// queue. Hash collisions inside that range are vanishingly small but
// would just mean the new schedule replaces the old — desired
// behaviour anyway.
function alarmIdFromUuid(uuid) {
  if (!uuid || typeof uuid !== 'string') return 2_000_000_001
  let h = 5381
  for (let i = 0; i < uuid.length; i++) {
    h = ((h << 5) + h + uuid.charCodeAt(i)) | 0  // djb2, 32-bit truncated
  }
  // Map signed -2^31..2^31-1 into positive 2_000_000_001..2_147_483_647.
  const positive = (h >>> 0) % 147_483_647
  return 2_000_000_001 + positive
}

/**
 * Schedule an Android AlarmManager-backed LocalNotification for this
 * follow-up. Replaces any existing schedule for the same follow-up id
 * (cancel-then-schedule). Past-dated follow-ups are skipped.
 *
 * @param {object} fu — follow-up row. Required: id, lead_id,
 *   follow_up_date (YYYY-MM-DD). Optional: lead_name, follow_up_time
 *   (HH:MM or HH:MM:SS), note.
 */
export async function scheduleFollowUpAlarm(fu) {
  if (!Capacitor.isNativePlatform()) return
  if (!fu || !fu.id || !fu.follow_up_date) return

  // Parse date + optional time into a single Date in the device's
  // local zone. Reps are in IST; device clock matches. follow_up_time
  // arrives as 'HH:MM' or 'HH:MM:SS' (Postgres `time`).
  let target
  try {
    const [y, m, d] = String(fu.follow_up_date).split('-').map(Number)
    let hh = 9, mm = 30  // sensible default if no time set
    if (fu.follow_up_time) {
      const parts = String(fu.follow_up_time).split(':')
      hh = Number(parts[0]) || 0
      mm = Number(parts[1]) || 0
    }
    target = new Date(y, (m || 1) - 1, d || 1, hh, mm, 0, 0)
  } catch (e) {
    console.warn('[localnotif] bad follow_up_date/time:', fu.follow_up_date, fu.follow_up_time)
    return
  }
  if (!(target instanceof Date) || isNaN(target.getTime())) return
  if (target.getTime() <= Date.now()) return  // past = no schedule

  const id = alarmIdFromUuid(fu.id)
  const leadName = fu.lead_name || fu.lead?.name || 'Lead'
  const noteBody = fu.note?.trim() || 'Follow-up due'

  try {
    // Cancel any existing schedule for this id. Idempotent.
    await LocalNotifications.cancel({ notifications: [{ id }] })
  } catch (e) {
    // First-call cancel of an absent id is a no-op on most platforms;
    // some throw. Swallow.
  }

  try {
    await LocalNotifications.schedule({
      notifications: [{
        id,
        title: `Follow-up · ${leadName}`,
        body: noteBody,
        schedule: { at: target, allowWhileIdle: true },
        channelId: CHANNEL_ID,
        smallIcon: 'ic_stat_notification',
        extra: {
          url: `/leads/${fu.lead_id}`,
          followup_id: fu.id,
        },
      }],
    })
  } catch (e) {
    console.warn('[localnotif] schedule failed:', e?.message || e)
  }
}

/**
 * Cancel a scheduled alarm. Safe to call when nothing is scheduled.
 *
 * @param {string} followUpId — the follow_ups.id uuid.
 */
export async function cancelFollowUpAlarm(followUpId) {
  if (!Capacitor.isNativePlatform()) return
  if (!followUpId) return
  const id = alarmIdFromUuid(followUpId)
  try {
    await LocalNotifications.cancel({ notifications: [{ id }] })
  } catch (e) {
    // No-op on absent. Silent.
  }
}

/**
 * Backfill helper: schedule alarms for a batch of follow-ups in one
 * call. Used by V2AppShell on cold-start to cover follow-ups created
 * before this APK was installed OR re-create alarms wiped by an OS
 * update.
 */
export async function scheduleManyFollowUpAlarms(followUps) {
  if (!Capacitor.isNativePlatform()) return
  if (!Array.isArray(followUps) || followUps.length === 0) return
  for (const fu of followUps) {
    // Sequential — LocalNotifications.schedule is cheap and parallel
    // calls can race the cancel-then-schedule pattern.
    // eslint-disable-next-line no-await-in-loop
    await scheduleFollowUpAlarm(fu)
  }
}
