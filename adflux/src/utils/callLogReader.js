// src/utils/callLogReader.js
//
// Phase 56c — JS shim for the custom CallLogReader Capacitor plugin
// (Java implementation in android/app/src/main/java/in/untitledad/app/CallLogPlugin.java).
//
// Owner directive (18 May 2026):
//   "Call log reader → auto-fill call_logs.duration_seconds"
//   "just match by phone+time, no SIM picker"
//
// Flow:
//   1. tel-tap fires → callAudit writes a `call_logs` row with
//      outcome='no_answer' (Phase 54 F2 default) and call_at=now.
//   2. PostCallOutcomeModal opens 1.5s later (Phase 43.1 chain).
//   3. Rep finishes the call + saves the modal.
//   4. On save, the modal calls `fetchAndPatchCallDuration(...)`.
//   5. This util asks the Android plugin for the most recent call
//      in the system call log matching (phone, since tel-tap).
//   6. If found, patches the call_logs row's duration_seconds via
//      Supabase.
//
// Web build: all calls are no-ops. Only fires inside the Android
// wrapper. Permission requested on first call (Capacitor handles
// the runtime prompt + remembers grant).
//
// Edge cases (returns null silently):
//   - Phone number doesn't match (number format drift) → CallLog
//     plugin returns found=false.
//   - Call placed but not connected (0s duration) → still writes 0,
//     which is correct: customer didn't pick up.
//   - User denies permission → plugin rejects → we swallow + log.

import { Capacitor, registerPlugin } from '@capacitor/core'
import { supabase } from '../lib/supabase'

const CallLogReader = registerPlugin('CallLogReader')

/**
 * Look up the Android CallLog for the most recent call to/from
 * `phone` since `sinceMs` (epoch-millis). Optional windowMinutes
 * defaults to 60.
 *
 * Returns one of:
 *   { found: true, durationSeconds: N, type, date, number }
 *   { found: false }
 *   null   — web build, missing inputs, or plugin error
 */
export async function lookupCall({ phone, sinceMs, windowMinutes = 60 }) {
  if (!Capacitor.isNativePlatform()) return null
  if (!phone || !sinceMs) return null
  try {
    const result = await CallLogReader.lookupCall({
      number:         phone,
      sinceTimestamp: sinceMs,
      windowMinutes,
    })
    return result || { found: false }
  } catch (e) {
    console.warn('[call-log] lookup failed:', e?.message || e)
    return null
  }
}

/**
 * Convenience wrapper that wires the lookup into a Supabase patch.
 * Patches:
 *   1. The most recent call_logs row for (user, lead) within the
 *      given window with the duration from Android CallLog.
 *   2. The lead_activities row (when activityId is supplied) so the
 *      lead-detail Activity Timeline renders the duration inline
 *      ("Call · 34 sec") — the UI already reads
 *      `lead_activities.duration_seconds` (LeadDetailV2.jsx:1254).
 *
 * Returns the patched duration (seconds) or null.
 * Designed to be called from PostCallOutcomeModal save handler;
 * fire-and-forget OK (no UI dependency).
 */
export async function fetchAndPatchCallDuration({
  userId, leadId, phone, telTapMs, activityId, onlyIfMissing = false,
  fallbackSeconds = null,
}) {
  if (!userId || !leadId) return null

  // 1. Device CallLog — PRIMARY source (native build + granted
  //    READ_CALL_LOG). Phase 56i — the Java plugin's
  //    `sinceTimestamp + windowMinutes` window is FORWARD-looking and
  //    the call already ended before the modal save fired, so point the
  //    window 60 min BACKWARD: lookbackMs = telTapMs - 1h yields
  //    [now-60min, now], catching the just-finished call. (The old
  //    sinceMs = Date.now() queried [now, now+60min] and never matched
  //    — that's why duration_seconds stayed NULL.)
  let duration = null
  if (Capacitor.isNativePlatform() && phone && telTapMs) {
    const lookbackMs = telTapMs - 60 * 60_000
    const result = await lookupCall({ phone, sinceMs: lookbackMs })
    if (result && result.found) {
      const d = Number(result.durationSeconds)
      if (Number.isFinite(d) && d >= 0) duration = d
    }
  }

  // 2. Phase 116 — in-app "time away from app" fallback (callTimer.js).
  //    Used ONLY when the device read produced nothing (web/PWA, no
  //    permission, plugin missing, or number-match miss). Device
  //    duration ALWAYS wins. Capped [5, 1800]s: under 5s = misdial,
  //    over 30 min = app left open / distraction.
  if (duration === null && fallbackSeconds != null) {
    const fb = Math.round(Number(fallbackSeconds))
    if (Number.isFinite(fb) && fb >= 5 && fb <= 1800) duration = fb
  }

  if (duration === null) return null // nothing reliable to write

  // Phase 56j — patch BOTH tables in parallel.
  //   • call_logs: audit row written by callAudit at tel-tap time.
  //   • lead_activities: the row the timeline renders. Without this
  //     patch the duration sits in call_logs only and the lead
  //     detail UI shows no duration even though we captured it.
  // Phase 66 (21 May 2026) — guardian P1 fix. The 60s auto-patch
  // timer (Phase 65) passes onlyIfMissing=true so we DON'T clobber a
  // duration that the modal-save path already wrote. Modal-save calls
  // pass onlyIfMissing=false (default) — it has the freshest read and
  // can overwrite freely. This eliminates the race between the timer
  // and the modal save.
  const cutoff = new Date((Number(telTapMs) || Date.now()) - 60 * 60_000).toISOString()
  // Phase 102.B (2026-05-29) — only patch duration onto rows that
  // already represent a real conversation. PostCallOutcomeModal flips
  // the row's outcome to 'connected' / 'callback_requested' right
  // before this helper runs; if the rep skipped the modal (or picked
  // a non-connected outcome that we don't yet map), the audit row
  // stays at outcome='no_answer' and Android's `duration` is ring
  // time, not talk time. Writing ring time over a no_answer row makes
  // it look connected on LeadCallHistory + inflates WorkV2 qualified
  // count. The `.in('outcome', [...])` filter suppresses that write.
  const callLogsQuery = supabase
    .from('call_logs')
    .update({ duration_seconds: duration })
    .eq('user_id', userId)
    .eq('lead_id', leadId)
    .gte('call_at', cutoff)
    .in('outcome', ['connected', 'callback_requested'])
    .order('call_at', { ascending: false })
    .limit(1)
  const callLogsPromise = onlyIfMissing
    ? callLogsQuery.is('duration_seconds', null)
    : callLogsQuery

  const activityPromise = activityId
    ? (onlyIfMissing
        ? supabase
            .from('lead_activities')
            .update({ duration_seconds: duration })
            .eq('id', activityId)
            .is('duration_seconds', null)
        : supabase
            .from('lead_activities')
            .update({ duration_seconds: duration })
            .eq('id', activityId))
    : Promise.resolve({ error: null })

  const [{ error: clErr }, { error: aErr }] = await Promise.all([
    callLogsPromise,
    activityPromise,
  ])
  if (clErr) console.warn('[call-log] call_logs patch failed:', clErr.message)
  if (aErr)  console.warn('[call-log] lead_activities patch failed:', aErr.message)
  if (clErr && aErr) return null
  return duration
}

/**
 * Diagnostic — check whether READ_CALL_LOG is granted without
 * triggering a prompt. Returns 'granted' | 'denied' | 'prompt'
 * | 'unsupported' (web).
 */
export async function checkCallLogPermission() {
  if (!Capacitor.isNativePlatform()) return 'unsupported'
  try {
    const state = await CallLogReader.checkPermissions()
    // Capacitor permissions API returns { callLog: 'granted' | 'denied' | 'prompt' }
    return state?.callLog || 'prompt'
  } catch (e) {
    console.warn('[call-log] permission check failed:', e?.message || e)
    return 'prompt'
  }
}

/**
 * Explicitly request READ_CALL_LOG. Use in a first-launch onboarding
 * flow so the prompt fires before any actual tel-tap call.
 */
export async function requestCallLogPermission() {
  if (!Capacitor.isNativePlatform()) return 'unsupported'
  try {
    const state = await CallLogReader.requestPermissions()
    return state?.callLog || 'prompt'
  } catch (e) {
    console.warn('[call-log] permission request failed:', e?.message || e)
    return 'denied'
  }
}
