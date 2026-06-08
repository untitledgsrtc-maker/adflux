// src/utils/callTimer.js
//
// Phase 116 (2026-06-05) — in-app "time away from app" call-duration
// fallback. Owner directive: the device CallLog duration is fetched
// first (callLogReader.fetchAndPatchCallDuration); THIS only fills the
// gap when that read returns nothing — web/PWA, no READ_CALL_LOG
// permission, plugin missing, or a number-match miss. On staging that
// was ~43% of CONNECTED calls saving a NULL duration, so they failed
// the >=10s call-count rule and reps fell short of the 50 target even
// though they genuinely connected (the Yash / Vishal Tea Center bug).
//
// Phase 126.2 (2026-06-08) — the timer was firing ONLY on the web
// `visibilitychange` event. On the Capacitor APK, opening the native
// dialer does NOT reliably fire that event, so `wentHidden` never
// flipped and the fallback captured nothing → a steady ~30% of connected
// calls (every day, team-wide) still saved NULL. Fix: ALSO listen to the
// Capacitor App `appStateChange` signal (fires reliably when the app
// backgrounds on the APK). One GLOBAL native listener attached at boot
// iterates every pending entry — whichever signal (web or native) fires
// first records the away-time; the `elapsed === null` guard makes it
// idempotent. Web behaviour is byte-identical (the native block is
// skipped when `Capacitor.isNativePlatform()` is false).
//
// How it works: when the rep taps Call, markCallStart(leadId) arms the
// listeners. Tapping a tel: link backgrounds the app; when the rep
// returns from the call we record seconds-away ~= call duration.
// PostCallOutcomeModal.handleSave reads it via getCallElapsed(leadId) and
// hands it to fetchAndPatchCallDuration as fallbackSeconds, which only
// uses it when the device read found nothing AND it lands in [5, 1800]s
// (under 5s = misdial, over 30 min = app left open / distraction).
//
// Best-effort and side-effect-free if it never fires. Keyed by leadId so
// sequential calls never cross-contaminate.

import { Capacitor } from '@capacitor/core'

const PRUNE_MS = 30 * 60_000 // entries older than 30 min are abandoned

// leadId(string) -> { tapAt:number, elapsed:number|null, wentHidden:bool, cleanup:fn|null }
const pending = new Map()

// Record the away-time for an entry on return-to-foreground (once).
function recordReturn(entry) {
  if (entry.wentHidden && entry.elapsed === null) {
    entry.elapsed = Math.round((Date.now() - entry.tapAt) / 1000)
  }
}

// ── Native path: ONE global app-state listener attached at boot ──
// On the APK the dialer hand-off backgrounds the app -> appStateChange
// fires reliably (the web visibilitychange does not). Attached once so
// there is no per-call addListener latency racing the dialer.
if (typeof window !== 'undefined' && Capacitor?.isNativePlatform?.()) {
  import('@capacitor/app')
    .then(({ App }) => {
      App.addListener('appStateChange', ({ isActive }) => {
        for (const entry of pending.values()) {
          if (!isActive) entry.wentHidden = true
          else recordReturn(entry)
        }
      })
    })
    .catch(() => { /* @capacitor/app missing -> web visibilitychange still works */ })
}

export function markCallStart(leadId) {
  if (!leadId || typeof document === 'undefined') return
  const key = String(leadId)
  const now = Date.now()

  // Prune stale entries so the map can't grow unbounded if a rep
  // abandons modals without saving.
  for (const [k, v] of pending) {
    if (now - v.tapAt > PRUNE_MS) {
      try { v.cleanup && v.cleanup() } catch { /* noop */ }
      pending.delete(k)
    }
  }

  // Drop any prior entry for this lead (a re-tap before saving).
  const prev = pending.get(key)
  if (prev) { try { prev.cleanup && prev.cleanup() } catch { /* noop */ } }

  const entry = { tapAt: now, elapsed: null, wentHidden: false, cleanup: null }

  // Web path: visibilitychange (works on PWA / desktop; unreliable on APK,
  // which the global native listener above covers).
  const onVis = () => {
    if (document.visibilityState === 'hidden') {
      entry.wentHidden = true
      return
    }
    // Back to visible. Only count it if we actually left the app (a
    // foreground flicker doesn't).
    if (entry.wentHidden && entry.elapsed === null) {
      recordReturn(entry)
      entry.cleanup && entry.cleanup()
    }
  }

  const timer = setTimeout(() => { entry.cleanup && entry.cleanup() }, PRUNE_MS)
  entry.cleanup = () => {
    document.removeEventListener('visibilitychange', onVis)
    clearTimeout(timer)
  }

  document.addEventListener('visibilitychange', onVis)
  pending.set(key, entry)
}

export function getCallElapsed(leadId) {
  if (!leadId) return null
  const key = String(leadId)
  const entry = pending.get(key)
  if (!entry) return null
  pending.delete(key)
  try { entry.cleanup && entry.cleanup() } catch { /* noop */ }
  return entry.elapsed // seconds, or null if the app never backgrounded
}
