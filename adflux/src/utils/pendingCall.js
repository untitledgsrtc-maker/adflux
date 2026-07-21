// src/utils/pendingCall.js
//
// Phase 250 — survive the app being KILLED during a call.
//
// THE BUG THIS ENDS (§92-class: one symptom, three causes, this is the third):
// tapping Call launches the dialer, and only AFTER that does the code write
// call_logs, write lead_activities, and arm a 1.5s timer to open the outcome
// modal. The dialer takes the foreground, so the app is backgrounded and Android
// is free to kill it. When it does, the timer, the lead and the modal state die
// with it — the rep comes back to a cold start and the outcome is never
// captured. Worse, the follow-up is never created, so the customer is never
// contacted again.
//
// Two earlier fixes addressed the SAME SYMPTOM from other causes and cannot help
// here: Phase 113.8 rescues a 23505 dedupe collision (there is no error here —
// the app is simply gone), and Phase 237's pending-outcomes card needs the
// lead_activities row to exist (it may never have been sent).
//
// WHY localStorage AND WHY BEFORE THE DIAL: dialPhone() must run synchronously
// inside the click handler or the OS/browser blocks the tel: navigation, so we
// cannot await a network write first. localStorage.setItem IS synchronous and
// lands before the dialer takes over — it is the only write we can guarantee.
//
// Read on the next app start: if a recent call is pending, the outcome modal is
// reopened for that lead. Deliberately NOT tied to any React state.

const KEY = 'ua_pending_call_v1'

// Long enough to survive a genuinely long call plus the rep taking a break;
// short enough that yesterday's forgotten call does not ambush them on Monday.
const MAX_AGE_MS = 6 * 60 * 60 * 1000

// Call SYNCHRONOUSLY, immediately before dialPhone(). Never await anything
// between this and the dial.
export function rememberPendingCall({ leadId, leadName, leadCompany, phone, userId, activityId = null }) {
  try {
    if (!leadId || !userId) return
    localStorage.setItem(KEY, JSON.stringify({
      leadId, leadName: leadName || '', leadCompany: leadCompany || '',
      phone: phone || '', userId, activityId, at: Date.now(),
    }))
  } catch { /* private mode / quota — the feature degrades, nothing breaks */ }
}

// The activity row id is only known AFTER the insert resolves, which may never
// happen. Recording it when it does lets the restored modal PATCH that row
// instead of inserting a second one.
export function attachPendingActivityId(activityId) {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw || !activityId) return
    const p = JSON.parse(raw)
    localStorage.setItem(KEY, JSON.stringify({ ...p, activityId }))
  } catch { /* ignore */ }
}

// Returns the pending call only if it is fresh AND belongs to the signed-in
// user — a shared or re-assigned device must never resurface someone else's call.
export function readPendingCall(userId) {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (!p?.leadId || !p?.userId) return null
    if (userId && p.userId !== userId) return null
    if (!p.at || Date.now() - p.at > MAX_AGE_MS) { clearPendingCall(); return null }
    return p
  } catch { return null }
}

export function clearPendingCall() {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}
