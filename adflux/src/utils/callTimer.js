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
// How it works: when the rep taps Call, markCallStart(leadId) arms a
// one-shot visibilitychange listener. Tapping a tel: link backgrounds
// the WebView (visibilitychange -> 'hidden'); when the rep returns from
// the call the WebView goes 'visible' again and we record seconds-away
// ~= call duration. PostCallOutcomeModal.handleSave reads it via
// getCallElapsed(leadId) and hands it to fetchAndPatchCallDuration as
// fallbackSeconds, which only uses it when the device read found
// nothing AND it lands in [5, 1800]s (under 5s = misdial, over 30 min =
// app left open / distraction).
//
// Best-effort and side-effect-free if it never fires: on plain desktop
// web the dialer doesn't background the tab, so visibilitychange never
// cycles, elapsed stays null, getCallElapsed returns null, and the
// behaviour is exactly as before this phase. Keyed by leadId so
// sequential calls never cross-contaminate.

const PRUNE_MS = 30 * 60_000 // entries older than 30 min are abandoned

// leadId(string) -> { tapAt:number, elapsed:number|null, cleanup:fn|null }
const pending = new Map()

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

  const entry = { tapAt: now, elapsed: null, cleanup: null }
  let wentHidden = false

  const onVis = () => {
    if (document.visibilityState === 'hidden') {
      wentHidden = true
      return
    }
    // Back to visible. Only count it as a call if we actually left the
    // app (the dialer backgrounded us) — a foreground flicker doesn't.
    if (wentHidden && entry.elapsed === null) {
      entry.elapsed = Math.round((Date.now() - entry.tapAt) / 1000)
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
