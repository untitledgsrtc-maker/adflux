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
// SAFETY (§28 / §45 / Phase 102.B):
//   • OUTGOING only — Android's duration for an outgoing call is TALK time
//     (0 if not answered), so a >=10s read is a genuine connect. Incoming/
//     missed durations can be ring time (102.B) → we never touch those.
//   • duration only — we do NOT flip outcome. The TC 50-target + the gate
//     count on duration_seconds, so filling it is enough; outcome semantics
//     stay frozen.
//   • no clobber — the patch re-asserts duration is still null/0, so it can
//     never overwrite a good value the modal-save path already wrote.
//   • best-effort, off the hot path — runs on resume + a 90s foreground
//     interval, never on the dial/save path. Web build is a no-op.

import { Capacitor, registerPlugin } from '@capacitor/core'
import { supabase } from '../lib/supabase'
import { findOutgoingCallSeconds } from './callLogReader'

const CallLogReader = registerPlugin('CallLogReader')

async function reconcileRecentCalls() {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return
    const sinceIso = new Date(Date.now() - 6 * 60 * 60_000).toISOString()  // last 6h
    const { data: rows } = await supabase
      .from('call_logs')
      .select('id, client_phone, call_at, duration_seconds, direction')
      .eq('user_id', user.id)
      .gte('call_at', sinceIso)
      .or('duration_seconds.is.null,duration_seconds.eq.0')
      .order('call_at', { ascending: false })
      .limit(30)
    for (const r of (rows || [])) {
      // OUTGOING only (or unlabelled tel-tap rows). Incoming/missed skipped.
      if (r.direction && r.direction !== 'outgoing') continue
      const phone = r.client_phone
      if (!phone) continue
      const tapMs = new Date(r.call_at).getTime()
      // Phase 185 — the OUTGOING call nearest this row's time (root fix). Was
      // lookupCall's newest-any → it re-pasted a later inbound call's duration
      // onto this outgoing row, recreating the cross-paste on every sweep.
      const dev = await findOutgoingCallSeconds(phone, tapMs)
      if (dev == null || dev < 10) continue   // confirmed real outgoing talk only
      const { error } = await supabase
        .from('call_logs')
        .update({ duration_seconds: dev })
        .eq('id', r.id)
        .or('duration_seconds.is.null,duration_seconds.eq.0')   // no clobber
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
  try { CallLogReader.addListener('appResumedCallSync', () => { reconcileRecentCalls() }) } catch {}
  // Backup: a slow foreground interval in case the native event is missed.
  // Pauses automatically while the WebView is backgrounded.
  setInterval(() => { reconcileRecentCalls() }, 90_000)
}

// Self-attach on import (mirrors callTimer.js). Native-only; web no-op.
initCallResumeSync()

export { reconcileRecentCalls }
