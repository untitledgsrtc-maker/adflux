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
 * Patches the most recent call_logs row for (user, lead) within the
 * given window with the duration from Android CallLog. Returns the
 * patched duration (seconds) or null.
 *
 * Designed to be called from PostCallOutcomeModal save handler;
 * fire-and-forget OK (no UI dependency).
 */
export async function fetchAndPatchCallDuration({
  userId, leadId, phone, telTapMs,
}) {
  if (!Capacitor.isNativePlatform()) return null
  if (!userId || !leadId || !phone || !telTapMs) return null

  // Phase 56i — the Java plugin's `sinceTimestamp + windowMinutes`
  // window is FORWARD-looking. The call we want already ended before
  // the modal save fired, so we need to point the window 60 min
  // BACKWARD from now. Shift the lower bound back by one hour; the
  // plugin's default 60-min window then yields [now-60min, now]
  // which catches the just-finished call. Previous behaviour
  // (sinceMs = telTapMs = Date.now()) queried [now, now+60min] and
  // never matched anything — that's why duration_seconds stayed
  // NULL for every rep call.
  const lookbackMs = telTapMs - 60 * 60_000
  const result = await lookupCall({ phone, sinceMs: lookbackMs })
  if (!result || !result.found) return null

  const duration = Number(result.durationSeconds) || 0
  if (duration < 0) return null

  // Patch the matching call_logs row. Match by user + lead + recency
  // (cap at 60 min). The audit row was just inserted by callAudit
  // moments earlier so it'll be the freshest row.
  const cutoff = new Date(telTapMs - 60 * 60_000).toISOString()
  const { error } = await supabase
    .from('call_logs')
    .update({ duration_seconds: duration })
    .eq('user_id', userId)
    .eq('lead_id', leadId)
    .gte('call_at', cutoff)
    .order('call_at', { ascending: false })
    .limit(1)
  if (error) {
    console.warn('[call-log] patch failed:', error.message)
    return null
  }
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
