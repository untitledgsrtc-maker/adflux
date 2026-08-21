// src/utils/istDate.js
//
// Phase 47.9 — single source of truth for IST-anchored date/time.
//
// Why this file exists:
//   Earlier helpers spread across PostCallOutcomeModal /
//   SalaryPayoutModal / IncentivePayoutModal / LeadsCollectedChart /
//   PeopleV2 / TelecallerV2 / SalaryAdminV2 used the formula
//   `(5.5 * 60 - now.getTimezoneOffset()) * 60_000`. That only
//   works when the device clock is set to UTC. On an iOS device
//   in IST, getTimezoneOffset = -330, so the formula adds 11 hours
//   instead of 5.5 — owner saw "Call back in 2h" at 18:21 IST
//   pre-fill date=May 19 + time=01:50 AM (wrong by 12 hours).
//
//   Intl.DateTimeFormat with `timeZone: 'Asia/Kolkata'` always
//   returns IST regardless of where the device clock is set. Safe
//   on every platform.

/** IST today as YYYY-MM-DD. */
export function istTodayISO() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const m = Object.fromEntries(parts.map(p => [p.type, p.value]))
  return `${m.year}-${m.month}-${m.day}`
}

/** IST current month as YYYY-MM (for month_year text columns). */
export function istCurrentMonthYM() {
  return istTodayISO().slice(0, 7)
}

/** IST current month as 'Mon YYYY' (e.g. 'May 2026') for UI labels. */
export function istCurrentMonthLabel() {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    month: 'short', year: 'numeric',
  }).format(new Date())
}

/**
 * IST {date, time} from now + N hours.
 *
 * Returns:
 *   date — YYYY-MM-DD (advances when hours push past midnight IST)
 *   time — HH:MM in 24-hour IST
 */
export function istNowPlusHoursDateTime(hours) {
  const future = new Date(Date.now() + hours * 60 * 60 * 1000)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(future)
  const m = Object.fromEntries(parts.map(p => [p.type, p.value]))
  // Some Intl impls return '24' for midnight; normalize to '00'.
  const hh = m.hour === '24' ? '00' : m.hour
  return {
    date: `${m.year}-${m.month}-${m.day}`,
    time: `${hh}:${m.minute}`,
  }
}

/**
 * The IST calendar day (YYYY-MM-DD) for any ISO / timestamp string.
 * Phase 311 — used to bucket a row's won_at / created_at by IST so client-side
 * date-range filters (LeadsV2) agree with the server-side IST filter on /quotes
 * (a bare date literal is parsed in the DB session tz = Asia/Kolkata). Raw
 * `iso.slice(0,10)` buckets by UTC and diverges at the 00:00–05:30 IST boundary.
 * Empty / invalid in → '' out (safe for string compare callers).
 */
export function istDayOf(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d)
  const m = Object.fromEntries(parts.map(p => [p.type, p.value]))
  return `${m.year}-${m.month}-${m.day}`
}

/** IST day + N days as YYYY-MM-DD. */
export function istTodayPlusDays(days) {
  const future = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(future)
  const m = Object.fromEntries(parts.map(p => [p.type, p.value]))
  return `${m.year}-${m.month}-${m.day}`
}
