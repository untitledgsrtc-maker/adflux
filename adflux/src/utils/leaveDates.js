// src/utils/leaveDates.js
//
// Phase 121 (2026-06-06) — expand a leave start..end range into one
// date string (YYYY-MM-DD) per WORKING day.
//
// Rules:
//   • End blank, invalid, or <= start → SINGLE day (just the start).
//     This keeps the pre-Phase-121 behaviour for the common case.
//   • Sundays are SKIPPED — the one universal off-day. The salary RPC
//     (compute_monthly_salary) counts every approved leave row, so a
//     Sunday leave row would wrongly deduct pay for a non-work day.
//     (Holidays are a later refinement; Sunday is the safe default.)
//   • Capped at 60 calendar days so a date typo can't insert hundreds
//     of rows.
//   • Local-date math only — NEVER toISOString() (that shifts the date
//     across the UTC boundary; the §48 IST foot-gun). Build the string
//     from getFullYear/getMonth/getDate.
//
// Used by both the admin add-leave form (LeavesAdminV2) and the rep
// "Request leave" form (RepDayTools) so the range logic is identical.

export function buildLeaveDates(startISO, endISO) {
  const out = []
  if (!startISO) return out
  const start = new Date(startISO + 'T00:00:00')
  if (Number.isNaN(start.getTime())) return out

  let end = start
  if (endISO && endISO > startISO) {
    const e = new Date(endISO + 'T00:00:00')
    if (!Number.isNaN(e.getTime())) end = e
  }

  const MAX_DAYS = 60
  const d = new Date(start)
  let guard = 0
  while (d <= end && guard < MAX_DAYS) {
    guard++
    if (d.getDay() !== 0) {            // 0 = Sunday → skip
      const y   = d.getFullYear()
      const m   = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      out.push(`${y}-${m}-${day}`)
    }
    d.setDate(d.getDate() + 1)
  }
  return out
}
