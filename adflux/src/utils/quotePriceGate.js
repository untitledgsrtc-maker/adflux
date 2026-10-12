// src/utils/quotePriceGate.js
//
// Phase 360 (2026-10-13) — ONE client-side definition of the "price below
// Rs 600 per screen needs approval" rule (section 71).
//
// The DATABASE is the authority (supabase_phase360_quote_price_approval.sql:
// qpa_recheck_quote + qpa_status_gate). This file only mirrors the rule so the
// screens can explain it before the rep hits a database error.
//
// LOCKSTEP with the SQL:
//   PRICE_FLOOR  == public.qpa_price_floor()
//   lineKey()    == public.qpa_line_key(city_id, city_name, row id)
//   a NULL rate  == 0
//   coverage     == per LINE: an approved / grandfathered row covers a low line
//                   when it holds that line at a rate <= the line's current rate
//                   (approval.line_rates = {line_key: rate}).
//
// SCOPE: private LED quotes only (segment PRIVATE + media_type LED_OTHER).
// Other Media and Government use other units, so they are never gated.

export const PRICE_FLOOR = 600

// Statuses of a quote_price_approvals row that CLEAR a price.
const CLEARING = ['approved', 'grandfathered']

// A quote row with no segment / media_type means the column defaults
// (PRIVATE / LED_OTHER) — the wizard payload never sets them.
export function isPriceGatedQuote(q) {
  const seg = q?.segment ?? 'PRIVATE'
  const media = q?.media_type ?? 'LED_OTHER'
  return seg === 'PRIVATE' && media === 'LED_OTHER'
}

// The identity of a line. Accepts a saved quote_cities row, or a wizard entry
// ({ city: { id, name } , ... }). Never returns the same key for two different
// lines; a line with no city identity at all falls back to its row id, which
// never matches an old snapshot (so it is treated as uncovered = conservative).
export function lineKey(c) {
  const id = c?.city_id ?? c?.cityId ?? c?.city?.id ?? null
  if (id) return String(id)
  const nm = String(c?.city_name ?? c?.city?.name ?? '').trim().toLowerCase()
  if (nm) return nm
  return String(c?.id ?? '')
}

// A line's rate for the rule: NULL / missing counts as 0.
function rateOf(c) {
  const r = Number(c?.offered_rate)
  return Number.isFinite(r) ? r : 0
}

// {line_key: rate} for the lines under the floor. When a key repeats, the
// lowest rate wins (same as the SQL min() per key).
export function lowLines(cities) {
  const out = {}
  for (const c of cities || []) {
    const r = rateOf(c)
    if (r >= PRICE_FLOOR) continue
    const k = lineKey(c)
    if (out[k] === undefined || r < out[k]) out[k] = r
  }
  return out
}

// The low lines no approved / grandfathered row covers.
export function uncoveredLines(cities, approvals) {
  const low = lowLines(cities)
  const clearing = (approvals || []).filter((a) => CLEARING.includes(a?.status))
  const out = {}
  for (const [k, r] of Object.entries(low)) {
    const covered = clearing.some((a) => {
      const held = a?.line_rates?.[k]
      return held !== undefined && held !== null && Number(held) <= r
    })
    if (!covered) out[k] = r
  }
  return out
}

function minOf(obj) {
  const v = Object.values(obj)
  return v.length ? Math.min(...v) : null
}

// Lowest per-screen monthly rate across ALL lines (null when there are none) -
// display only ("from Rs X").
export function minOfferedRate(cities) {
  let min = null
  for (const c of cities || []) {
    const r = rateOf(c)
    if (min === null || r < min) min = r
  }
  return min
}

// What state is this quote in?
//   clear     — not gated, or no line under the floor, or the viewer is admin
//   cleared   — under the floor but every low line is approved / grandfathered
//   pending   — waiting for an approver
//   blocked   — under the floor, not approved, nothing pending (rejected, or
//               flagged after the fact)
// The admin sending a quote IS the approval, so an admin is always 'clear'.
// minRate = the lowest UNCOVERED rate (what the approver is being asked about),
// falling back to the lowest rate when everything is covered.
export function quotePriceState({ quote, cities, approvals, role }) {
  const rows = approvals || []
  const low = lowLines(cities)
  const unc = uncoveredLines(cities, rows)
  const minRate = minOf(unc) ?? minOf(low)
  const base = { minRate, pending: null, rejected: null, lowCount: Object.keys(low).length }

  if (!isPriceGatedQuote(quote)) return { ...base, state: 'clear' }
  if (Object.keys(low).length === 0) return { ...base, state: 'clear' }
  if (role === 'admin') return { ...base, state: 'clear' }
  if (Object.keys(unc).length === 0) return { ...base, state: 'cleared' }

  const newestFirst = [...rows].sort(
    (a, b) => String(b?.created_at || '').localeCompare(String(a?.created_at || '')),
  )
  const pending = newestFirst.find((a) => a?.status === 'pending') || null
  const rejected = newestFirst.find((a) => a?.status === 'rejected') || null
  if (pending) return { ...base, pending, rejected: null, state: 'pending' }
  return { ...base, rejected, state: 'blocked' }
}

// Convenience for the wizard: does THIS save need an approver, given what is
// already approved for the quote (create mode: approvals = [])?
export function needsApproval({ cities, approvals, role }) {
  if (role === 'admin') return false
  return Object.keys(uncoveredLines(cities, approvals)).length > 0
}

// True when the app must hide / disable every "send this quote" control.
export function isSendLocked(stateObj) {
  return stateObj?.state === 'pending' || stateObj?.state === 'blocked'
}

export const PRICE_GATE_MESSAGE =
  `This quote has a price below Rs ${PRICE_FLOOR} per screen, so admin has to approve it before it can be sent.`
