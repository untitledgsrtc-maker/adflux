// src/utils/opsPay.js — the ONE ops uptime→variable-pay curve (§71).
//
// Extracted verbatim from the OpsTicketsV2 "Me" tab (§233/§247) so the
// exec's My Performance card and the ticket dashboard show the IDENTICAL
// number. Field-team pay = 70% base + 30% variable, the variable driven by
// screen uptime.
//
// INDICATIVE / display-only. The live pay (once uptime-pay p4 §234 is on)
// reads compute_monthly_salary; the EXACT curve is still owner-pending
// (§240 — align §230 + the p4 trigger + this). Do not treat as the payslip.
//
// Curve: SLA transform (uptime-90)/7×100, then >75 → full, <50 → zero, else
// proportional, × salary × 0.30.
export function estVariable(salary, uptimePct) {
  if (!salary || uptimePct == null) return 0
  const sla = Math.max(0, Math.min(100, (uptimePct - 90) / 7 * 100))
  const factor = sla > 75 ? 1 : sla < 50 ? 0 : sla / 100
  return Math.round(salary * 0.30 * factor)
}

// Owner-facing uptime milestones (raw %) — the plain 90/95/97 framing (§230).
export const UPTIME_FLOOR = 90    // variable unlocks
export const UPTIME_TARGET = 95   // team target
export const UPTIME_MAX = 97      // full variable

// Ring / status tone by raw uptime, per the owner's 90→97 rule.
export function uptimeTone(uptimePct) {
  if (uptimePct == null) return 'muted'
  if (uptimePct < UPTIME_FLOOR) return 'danger'
  if (uptimePct >= UPTIME_MAX) return 'success'
  return 'warning'
}
