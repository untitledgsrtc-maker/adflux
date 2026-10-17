// Phase 407 - quote duration in months OR days. `duration_days` NULL = whole months (the old model).
// When days are set, `duration_months` still holds the months rounded UP (min 1) so older readers keep working,
// and the stored campaign_total = rate x screens x days / 30.
export const DAYS_PER_MONTH = 30
export const monthsForDays = (days) => Math.max(1, Math.ceil((Number(days) || 0) / DAYS_PER_MONTH))
const d = (c) => { const n = Number(c?.duration_days); return Number.isFinite(n) && n > 0 ? Math.round(n) : null }
export const hasDays = (c) => d(c) !== null
// "15 Days" / "1 Day" / "3 Months" / "1 Month"
export function durationLabel(c) {
  const days = d(c)
  if (days) return `${days} Day${days === 1 ? '' : 's'}`
  const m = Number(c?.duration_months) || 1
  return `${m} Month${m === 1 ? '' : 's'}`
}
// "15d" / "3mo"
export function durationShort(c) {
  const days = d(c)
  return days ? `${days}d` : `${Number(c?.duration_months) || 1}mo`
}
// lower-case "15 days" / "3 months" for sentences
export const durationWords = (c) => durationLabel(c).toLowerCase()
// rate is per screen per MONTH
export function calcCampaignTotal(offeredRate, screens, months, days) {
  const r = Number(offeredRate) || 0
  const s = Math.max(1, Number(screens) || 1)
  const dd = d({ duration_days: days })
  if (dd) return Math.round(r * s * dd / DAYS_PER_MONTH)
  const m = Math.max(1, Math.min(12, Number(months) || 1))
  return Math.round(r * s * m)
}

// Quote-level label from all the city rows. Whole-month quotes keep the old behaviour (first row / quote months).
// If any row is in days and the rows differ, say so instead of showing only the first row.
export function quoteDurationLabel(cities, quoteMonths) {
  const rows = Array.isArray(cities) ? cities : []
  const first = { duration_days: rows[0]?.duration_days, duration_months: rows[0]?.duration_months || quoteMonths || 1 }
  if (!rows.some(hasDays)) return durationLabel({ duration_months: quoteMonths || rows[0]?.duration_months || 1 })
  const labels = new Set(rows.map((r) => durationLabel(r)))
  return labels.size > 1 ? 'Mixed durations' : durationLabel(first)
}
