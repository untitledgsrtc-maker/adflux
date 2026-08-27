// src/utils/opsHours.js — the ONE operating-hours + fault rule (§249 F4, 27 Aug 2026).
// Owner rule: GSRTC LED screens run 07:00–21:00 IST. A screen is FAULTY when its
// actual state ≠ its expected state:
//   on-hours (07:00–21:00): should be ON  → offline = fault (fix it)
//   off-hours (21:00–07:00): should be OFF → offline = normal; STILL ON = timer fault
// Used by the exec fault list + counts. The §243 auto-engine + uptime% must adopt
// the SAME rule (separate follow-ups) or they alarm at 9 PM / read uptime as ~58%.

export const OPS_OPEN_HOUR = 7    // 07:00 IST — screens on
export const OPS_CLOSE_HOUR = 21  // 21:00 IST — screens off

// current hour (0–23) in IST
export function istHour() {
  try {
    const s = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(new Date())
    return parseInt(s, 10) % 24
  } catch { return new Date().getHours() }
}
export function istClock() {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
  } catch { return '' }
}
export function isOnHours(hour = istHour()) { return hour >= OPS_OPEN_HOUR && hour < OPS_CLOSE_HOUR }

// The screen status that IS a fault right now: 'offline' on-hours, 'online' off-hours (timer).
export function faultStatus(onHours = isOnHours()) { return onHours ? 'offline' : 'online' }
// Fault kind for a screen given its status + the window; null = not a fault.
export function screenFaultKind(status, onHours = isOnHours()) {
  if (onHours) return status === 'offline' ? 'down' : null
  return status === 'online' ? 'timer' : null
}

// outage age in HOURS from last_response_at (null → very old); only meaningful for a 'down' fault.
export function faultAgeHours(lastResponseAt) {
  if (!lastResponseAt) return 9999
  const h = (Date.now() - new Date(lastResponseAt).getTime()) / 3600000
  return Number.isFinite(h) && h >= 0 ? h : 0
}
// short age label
export function ageLabel(hours, lang = 'gu') {
  if (hours == null || hours >= 9990) return lang === 'gu' ? 'ઘણા સમયથી' : 'a while'
  if (hours < 1) return `${Math.round(hours * 60)} ${lang === 'gu' ? 'મિનિટ' : 'min'}`
  if (hours < 48) return `${Math.round(hours)} ${lang === 'gu' ? 'કલાક' : 'h'}`
  return `${Math.round(hours / 24)} ${lang === 'gu' ? 'દિવસ' : 'd'}`
}
// severity 2 = high (down >2 days OR a big cluster), 1 = med (>6h), 0 = normal
export function severityOf(ageHours, clusterCount) {
  if ((ageHours ?? 0) >= 48 || (clusterCount || 0) >= 5) return 2
  if ((ageHours ?? 0) >= 6) return 1
  return 0
}
