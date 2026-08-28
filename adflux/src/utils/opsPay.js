// src/utils/opsPay.js — THE ONE ops uptime→variable-pay curve (§71, §258).
//
// The single source for the field-team indicative bonus. Every ops surface that
// shows an uptime bonus imports from here — OpsTicketsV2 "Me" tab, OpsUptimeCard
// (My Performance), OpsWorkV2, OpsAdminV2 — so they can never disagree (§260 folded
// the OpsWork/OpsAdmin local copies into this). Field-team pay = 70% base + 30%
// variable, the variable driven by screen uptime.
//
// INDICATIVE / display-only. The live pay (once uptime-pay p4 §234 is on) reads
// compute_monthly_salary. This MUST stay in lockstep with the p4 trigger
// (supabase_ops_p4_uptime_pay.sql v_floor 75 / v_ceiling 95) — change one, change both.
//
// CURVE (owner 2026-08-28, §258): SLA transform (uptime-75)/20×100, then the frozen
// monthly_score band >75 → full, <50 → zero, else proportional, × salary × 0.30.
// Effect: full bonus at ≥95% uptime, zero below ~85%, graded 85–90%.
export function estVariable(salary, uptimePct) {
  if (!salary || uptimePct == null) return 0
  const sla = Math.max(0, Math.min(100, (uptimePct - 75) / 20 * 100))
  const factor = sla > 75 ? 1 : sla < 50 ? 0 : sla / 100
  return Math.round(salary * 0.30 * factor)
}

// Owner-facing uptime milestones (raw %) — the 75/95 curve (§258): below 85 = zero
// bonus, 95 = full bonus. (TARGET == MAX here since owner's full line IS the target.)
export const UPTIME_FLOOR = 85    // below this → zero variable
export const UPTIME_TARGET = 95   // team target = full variable
export const UPTIME_MAX = 95      // full variable

// Ring / status tone by raw uptime, per the owner's 75/95 rule.
export function uptimeTone(uptimePct) {
  if (uptimePct == null) return 'muted'
  if (uptimePct < UPTIME_FLOOR) return 'danger'
  if (uptimePct >= UPTIME_MAX) return 'success'
  return 'warning'
}
