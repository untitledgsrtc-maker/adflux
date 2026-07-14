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
import { getCaptureDebug } from './callTimer'

const CallLogReader = registerPlugin('CallLogReader')

// Phase 138 — DIAGNOSTIC ONLY (instrumentation, not a fix). One row per
// capture attempt into call_capture_log so a day of real data proves WHY
// ~46% of connected calls save 0s. Fire-and-forget; a logging failure
// never affects the actual patch. Remove once the permanent fix lands.
async function logCapture(row) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return
    // permission check runs HERE (inside the fire-and-forget), never on
    // the patch path — guardian P1 (a native round-trip must not delay
    // the duration write).
    const device_permission = Capacitor.isNativePlatform()
      ? await checkCallLogPermission()
      : 'web'
    await supabase.from('call_capture_log').insert([{ user_id: user.id, device_permission, ...row }])
  } catch { /* swallow — diagnostic must never break a save */ }
}

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
 * Phase 185 — ROOT fix for the duration cross-paste. The device read must
 * return the OUTGOING call to `phone` NEAREST `nearMs` — NOT "the newest call
 * to this number" (what lookupCall does). On two calls a minute apart (an
 * outgoing then an incoming), lookupCall returned the later INCOMING call's
 * duration and it got pasted onto the OUTGOING row (confirmed 11 live
 * cross-pastes: e.g. real outgoing 27s shown as the incoming 57s).
 *
 * Uses scanRecentCalls — returns { number, type, date, durationSeconds } per
 * call, the SAME plugin method the call-history poller already trusts — so this
 * is JS-only, NO APK rebuild. Matches the OUTGOING call by dialed-number
 * (last-10, the app-wide cleanPhone convention) + nearest-by-time (disambiguates
 * repeat dials). Phase 229.1 — brand-proof: prefers a row typed 'outgoing', but
 * falls back to an 'unknown'-typed row (a new phone brand's unrecognised outgoing
 * code) when no recognised outgoing row exists, so a new OEM can't blank the
 * duration (§92). Never matches incoming/missed. Returns seconds (>=0) or null.
 */
export async function findOutgoingCallSeconds(phone, nearMs, windowMs = 60 * 60_000) {
  if (!Capacitor.isNativePlatform() || !phone || !nearMs) return null
  const want = String(phone).replace(/\D/g, '').slice(-10)
  if (!want) return null
  let calls = []
  try {
    const res = await CallLogReader.scanRecentCalls({ sinceTimestamp: nearMs - windowMs, limit: 100 })
    calls = Array.isArray(res?.calls) ? res.calls : []
  } catch (e) {
    console.warn('[call-log] scan failed:', e?.message || e)
    return null
  }
  // Phase 229.1 — brand-proof the OUTGOING read (§92: stop trusting the OEM
  // TYPE integer). Two candidates, ONE pass:
  //   best        = nearest row typed 'outgoing' (2/100) — the recognized case,
  //                 identical to the pre-229.1 behaviour.
  //   bestUnknown = nearest row typed 'unknown' — a NEW phone brand whose
  //                 outgoing code typeLabel() doesn't recognise yet (the same
  //                 trap that broke incoming on Realme 100/101, §227.1). Since
  //                 the rep TAPPED to dial THIS number, a call-log row to this
  //                 number nearest the tap IS this call, whatever the OEM
  //                 labelled it. We fall back to it ONLY when no recognised
  //                 'outgoing' row exists, so recognised phones are byte-unchanged.
  // incoming/missed/rejected/voicemail/blocked are deliberately NEVER matched: a
  // caller can't be receiving a call from the number they just dialled, and those
  // types carry ring-time on some OEMs (§102.B). Both candidates are number-pinned
  // (last-10) to THIS lead + nearest-by-time (disambiguates repeat dials).
  let best = null
  let bestUnknown = null
  for (const c of calls) {
    if (String(c.number || '').replace(/\D/g, '').slice(-10) !== want) continue  // this lead's number only
    const type = (c.type || '').toLowerCase()
    const dt = Math.abs(Number(c.date) - nearMs)
    if (type === 'outgoing') {
      if (best === null || dt < best.dt) best = { dt, sec: Number(c.durationSeconds) }
    } else if (type === 'unknown') {
      if (bestUnknown === null || dt < bestUnknown.dt) bestUnknown = { dt, sec: Number(c.durationSeconds) }
    }
  }
  const pick = best || bestUnknown   // recognised outgoing wins; else the unknown-typed outgoing (new brand)
  if (!pick) return null
  return (Number.isFinite(pick.sec) && pick.sec >= 0) ? pick.sec : null
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
  let deviceFound = false, deviceSeconds = null   // Phase 138 diag
  if (Capacitor.isNativePlatform() && phone && telTapMs) {
    // Phase 185 — the OUTGOING call nearest the tap (root fix). Was lookupCall's
    // direction-blind "newest call to this number", which pasted a later
    // INCOMING call's seconds onto this outgoing row (the 27->57 cross-paste).
    const sec = await findOutgoingCallSeconds(phone, telTapMs)
    if (sec != null) { duration = sec; deviceSeconds = sec; deviceFound = true }
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

  // Phase 138 — log the full verdict of EVERY attempt (incl the 0s/null
  // misses, which are exactly what we need to diagnose). Fire-and-forget,
  // never blocks. Captures: did the device read find it, did the app
  // background (the suspected root), what each path returned.
  {
    const dbg = getCaptureDebug(leadId) || {}
    logCapture({   // fire-and-forget — permission check happens inside it
      lead_id:           leadId,
      phone_last10:      String(phone || '').replace(/\D/g, '').slice(-10) || null,
      device_read_found: deviceFound,
      device_read_seconds: deviceSeconds,
      app_backgrounded:  dbg.backgrounded ?? null,
      bg_signal:         dbg.bgSignal ?? null,
      timer_seconds:     (fallbackSeconds != null ? Math.round(Number(fallbackSeconds)) : (dbg.elapsed ?? null)),
      patch_path:        onlyIfMissing ? 'auto60' : 'modal_save',
      final_seconds:     duration,
      counted:           duration != null && duration >= 10,
    })
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
    .or('direction.eq.outgoing,direction.is.null')   // Phase 185 — never an inbound row
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
