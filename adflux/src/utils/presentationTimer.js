// Phase 181 — presentation stopwatch (in-app GSRTC deck).
// Manual Start → End. The active session lives in localStorage so the timer
// survives the rep backgrounding the app / the deck reloading. End computes
// elapsed and caps it (a forgotten-then-resumed timer can't log a huge value).
// App code, so Date.now() is fine (the no-Date.now rule is only for Workflow
// scripts).

const KEY = 'present_session_v1'
export const CAP_SECONDS = 60 * 60 // 60-minute auto-cap

export function getActive() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// Start (or resume, if a session for the same lead is already open).
export function startPresentation(leadId) {
  const existing = getActive()
  if (existing && existing.leadId === (leadId || null)) return existing
  const session = { leadId: leadId || null, startedAt: Date.now() }
  try {
    localStorage.setItem(KEY, JSON.stringify(session))
  } catch {
    /* private mode / quota — timer still runs off the in-memory return value */
  }
  return session
}

export function elapsedSeconds(session) {
  if (!session || !session.startedAt) return 0
  return Math.max(0, Math.floor((Date.now() - session.startedAt) / 1000))
}

export function clearPresentation() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
