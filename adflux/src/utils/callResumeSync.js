// src/utils/callResumeSync.js
//
// Phase 157 (16 Jun 2026) — fill in call durations the dialer suspension
// dropped.
//
// THE PROBLEM (confirmed live, §67): when a rep taps Call, the native
// dialer takes over and Android SUSPENDS the Capacitor WebView mid-call.
// The JS timers that were supposed to (a) open the outcome modal and
// (b) read + patch the call duration are paused/killed, so a real 36s
// call lands in call_logs with duration_seconds = NULL and the rep never
// sees the outcome popup. The JS `appStateChange` away-timer (callTimer.js)
// was meant to catch this but does NOT fire on the APK (capture_log shows
// bg_signal/timer null every time).
//
// THE FIX: the one signal Android GUARANTEES on return is the native
// MainActivity.onResume (Phase 157). It fires `appResumedCallSync` via the
// CallLogReader plugin. By then the call is over and the CallLog duration
// is FINAL. We re-read the device call log for any of today's recent
// OUTGOING calls still missing a duration and fill it in.
//
// Phase 229 (14 Jul 2026) — HEAL THE no_answer ROWS TOO. The sweep used to
// require the row already be outcome='connected'/'callback_requested' (Phase
// 218 gate). That EXCLUDED the single biggest cause of a blank "—": a rep who
// never saved the outcome modal (the dialer suspends the WebView → the modal
// never opens → outcome stays at the tel-tap default 'no_answer'). Those are
// exactly the rows that need a duration. The gate is now GONE — see the long
// comment on the reader below for why that's safe (Phase 185 reader can only
// ever write THIS outgoing call's real talk seconds). Widened the window to a
// full workday so an end-of-day reopen still heals the morning's calls.
//
// SAFETY (§28 / §45 / Phase 102.B):
//   • OUTGOING only — Android's duration for an outgoing call is TALK time
//     (0 if not answered → we skip it), so a read is genuine talk time.
//     Incoming/missed durations can be ring time (102.B) → we never touch those.
//   • duration only — we do NOT flip outcome. The TC 50-target + the gate
//     count on duration_seconds, so filling it is enough; outcome semantics
//     stay frozen.
//   • no clobber — the patch re-asserts duration is still null/0, so it can
//     never overwrite a good value the modal-save path already wrote.
//   • best-effort, off the hot path — runs on resume (+10s/+30s follow-ups,
//     Phase 312) + a 90s foreground interval, never on the dial/save path.
//     Web build is a no-op.

import { Capacitor, registerPlugin } from '@capacitor/core'
import { supabase } from '../lib/supabase'
import { findOutgoingCallSeconds } from './callLogReader'

const CallLogReader = registerPlugin('CallLogReader')

async function reconcileRecentCalls() {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return
    const sinceIso = new Date(Date.now() - 14 * 60 * 60_000).toISOString()  // full workday (Phase 229)
    const { data: rows } = await supabase
      .from('call_logs')
      .select('id, client_phone, call_at, duration_seconds, direction, outcome')
      .eq('user_id', user.id)
      .gte('call_at', sinceIso)
      .or('duration_seconds.is.null,duration_seconds.eq.0')
      .order('call_at', { ascending: false })
      .limit(60)
    for (const r of (rows || [])) {
      // OUTGOING only (or unlabelled tel-tap rows). Incoming/missed skipped.
      if (r.direction && r.direction !== 'outgoing') continue
      // Phase 229 — the Phase 218 CONNECTED-only gate is REMOVED (this is the
      // fix for the blank "—" on real calls). It used to require outcome be
      // already 'connected'/'callback_requested', which skipped every row where
      // the rep never saved the modal (outcome stuck at the 'no_answer' default)
      // — the biggest slice of blank durations. It's safe to drop because the
      // §138 "231 wrong durations" bug it guarded against was the OLD reader
      // (lookupCall, direction-blind newest-any-call). The reader BELOW is
      // findOutgoingCallSeconds (Phase 185): it returns ONLY an OUTGOING device
      // call, matched to THIS row's phone (last-10), NEAREST this row's tap time
      // — so it can only ever write THIS call's real talk seconds, never a
      // neighbour's. The phone is ground truth even when the rep mis-marked the
      // outcome. (Duration display is separate from outcome — we still never
      // flip outcome; §28 semantics stay frozen.)
      const phone = r.client_phone
      if (!phone) continue
      const tapMs = new Date(r.call_at).getTime()
      // Phase 185 — the OUTGOING call nearest this row's time (root fix). Was
      // lookupCall's newest-any → it re-pasted a later inbound call's duration
      // onto this outgoing row, recreating the cross-paste on every sweep.
      const dev = await findOutgoingCallSeconds(phone, tapMs)
      // Phase 229 — write real talk time (>=1s). Android returns 0 for an
      // unanswered outgoing → skip it (stays blank, never counts toward the
      // >=10s target). We write short talks too (e.g. 6s shows "0:06", honest)
      // — the >=10s COUNT gate lives in compute_daily_score, not here, so a
      // sub-10s duration is honest display without inflating any count.
      if (dev == null || dev < 1) continue
      const { error } = await supabase
        .from('call_logs')
        .update({ duration_seconds: dev })
        .eq('id', r.id)
        .or('duration_seconds.is.null,duration_seconds.eq.0')   // no clobber — never overwrite a value the modal-save path already wrote (Phase 229: outcome gate dropped, this stays)
      // Phase 138 diagnostic — prove the resume sweep is landing.
      supabase.from('call_capture_log').insert([{
        user_id:             user.id,
        lead_id:             null,
        phone_last10:        String(phone).replace(/\D/g, '').slice(-10) || null,
        device_read_found:   true,
        device_read_seconds: dev,
        app_backgrounded:    null,
        bg_signal:           'resume_native',
        timer_seconds:       null,
        patch_path:          'resume_sweep',
        final_seconds:       dev,
        counted:             dev >= 10,
      }]).then(() => {}, () => {})
      if (error) console.warn('[call-resume] patch failed:', error.message)
    }
  } catch (e) {
    // best-effort — a reconcile failure must never affect the live app
    console.warn('[call-resume] sweep error:', e?.message || e)
  }
}

let started = false
function initCallResumeSync() {
  if (started || !Capacitor.isNativePlatform()) return
  started = true
  // Primary: native MainActivity.onResume → reliable on every foreground.
  // Phase 312 — fire reconcile IMMEDIATELY (heals older calls) AND again at +10s
  // and +30s. The immediate read fires the instant the rep returns from a call,
  // often BEFORE Android has finalized that call's duration (the device call-log
  // row exists with duration 0 until ~seconds after hangup) → the just-ended call
  // reads 0 and gets skipped. call_capture_log PROVED this: the early reads
  // (modal_save / auto60) get a real length only 28% of the time; this later
  // sweep 88%. The +10s / +30s passes run while the app is FOREGROUND (the rep is
  // logging the outcome / on the queue), so those timers fire reliably — catching
  // the just-ended call after it finalizes. This is exactly what high-volume
  // telecallers were missing: they stay in-app, so a single on-return sweep + the
  // 90s interval rarely landed AFTER finalization → 60-69% blank durations.
  // Idempotent: reconcile's no-clobber `.or(duration is null/0)` guard means an
  // already-healed row is never re-written, so 3 passes can't double-count.
  try {
    CallLogReader.addListener('appResumedCallSync', () => {
      reconcileRecentCalls()
      setTimeout(reconcileRecentCalls, 10_000)
      setTimeout(reconcileRecentCalls, 30_000)
    })
  } catch {}
  // Backup: a slow foreground interval in case the native event is missed.
  // Pauses automatically while the WebView is backgrounded.
  setInterval(() => { reconcileRecentCalls() }, 90_000)
}

// Self-attach on import (mirrors callTimer.js). Native-only; web no-op.
initCallResumeSync()

export { reconcileRecentCalls }
