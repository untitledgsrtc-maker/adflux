// src/utils/settlement.js
//
// Pure helpers for "is this quote fully settled, and when?"
//
// Settlement = the moment a rep is *owed* incentive on a quote. Rule:
//   • An approved payment with is_final_payment = true exists, OR
//   • The cumulative approved payments first reach (or exceed) total_amount.
//
// The settle date is the payment_date of the payment that crossed the
// threshold (or of the explicit final, whichever comes first).
//
// Bucketing by settle date — not by quote.updated_at (won date) — is
// what makes the April-campaign-June-payment case behave correctly:
// the rep's incentive lands in June, the month they actually got paid.
//
// IMPORTANT: this file has NO Supabase calls and NO React. It takes a
// quote object + an array of approved payments and returns plain data.
// That keeps it cheap to use anywhere (dashboards, leaderboards, list
// rows, tooltips) and trivially testable.

/**
 * Compute settlement for a single quote.
 *
 * @param {Object} quote — must have id, total_amount
 * @param {Array}  approvedPayments — already filtered to approval_status='approved'
 *                                    for this quote (or contain quote_id and we'll filter).
 * @returns {Object|null}
 *   null if the quote is not settled.
 *   Otherwise {
 *     settledAt:   ISO date string of the clearing payment,
 *     settledMonth: 'YYYY-MM',
 *     paid:        sum of approved payments,
 *     reason:      'flagged-final' | 'sum-cleared',
 *   }
 */
export function getSettlement(quote, approvedPayments) {
  if (!quote || !quote.id) return null

  // Defensive: caller may have passed every approved payment in the system.
  const mine = (approvedPayments || []).filter(p => p.quote_id === quote.id)
  if (mine.length === 0) return null

  const total = Number(quote.total_amount) || 0
  const paid  = mine.reduce((s, p) => s + Number(p.amount_received || 0), 0)

  // Sort by payment_date asc (fall back to created_at) so we can find
  // the payment that first crossed the total.
  const sorted = [...mine].sort((a, b) => {
    const da = a.payment_date || a.created_at || ''
    const db = b.payment_date || b.created_at || ''
    return da.localeCompare(db)
  })

  // Case 1 — explicit is_final_payment flag wins. If multiple, take the earliest.
  const flaggedFinal = sorted.find(p => p.is_final_payment === true)
  if (flaggedFinal) {
    const date = flaggedFinal.payment_date || flaggedFinal.created_at
    return {
      settledAt:    date,
      settledMonth: monthKey(date),
      paid,
      reason:       'flagged-final',
    }
  }

  // Case 2 — auto-clear when cumulative payments first reach total.
  if (total > 0 && paid >= total) {
    let running = 0
    for (const p of sorted) {
      running += Number(p.amount_received || 0)
      if (running >= total) {
        const date = p.payment_date || p.created_at
        return {
          settledAt:    date,
          settledMonth: monthKey(date),
          paid,
          reason:       'sum-cleared',
        }
      }
    }
  }

  return null
}

/**
 * Build a Map<quoteId, settlement> for many quotes at once. Useful in
 * dashboards that already have an array of quotes and a flat array of
 * approved payments.
 */
export function buildSettlementMap(quotes, approvedPayments) {
  // Group payments by quote_id once.
  const byQuote = {}
  for (const p of approvedPayments || []) {
    if (!p.quote_id) continue
    if (!byQuote[p.quote_id]) byQuote[p.quote_id] = []
    byQuote[p.quote_id].push(p)
  }
  const out = new Map()
  for (const q of quotes || []) {
    const s = getSettlement(q, byQuote[q.id] || [])
    if (s) out.set(q.id, s)
  }
  return out
}

/** 'YYYY-MM-DD…' or Date → 'YYYY-MM' */
function monthKey(d) {
  if (!d) return ''
  const s = String(d)
  return s.slice(0, 7)
}

/**
 * Convenience: does this settledMonth fall inside the period window?
 * period.startIso / period.endIso are half-open ['start', 'end').
 */
export function isSettledInPeriod(settlement, period) {
  if (!settlement || !period) return false
  const at = settlement.settledAt
  if (!at) return false
  return at >= period.startIso && at < period.endIso
}
