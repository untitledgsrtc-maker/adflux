// src/utils/period.js
//
// Unified period model for dashboard filters. Before this module,
// AdminDashboardDesktop and SalesDashboardDesktop both stored the
// selected period as a plain "YYYY-MM" string and derived start/end
// dates on the fly inside load(). That worked for the month switcher
// but couldn't express custom date ranges without forking every
// calc site. This module standardizes the shape.
//
// Every period object has the SAME fields regardless of kind:
//   {
//     kind:      'month' | 'range',
//     startIso:  'YYYY-MM-DD',   // inclusive lower bound
//     endIso:    'YYYY-MM-DD',   // EXCLUSIVE upper bound (first day after)
//     label:     'Apr 2026' | 'Apr 10 – Apr 20, 2026',
//     monthKeys: ['YYYY-MM', ...]  // every YYYY-MM touched by the window
//   }
//
// Consumers use startIso/endIso for row-level filters (payments,
// quote timestamps) and monthKeys for looking up pre-aggregated
// monthly tables (monthly_sales_data). A custom range that spans
// two months will have two entries in monthKeys — callers should
// sum over them rather than picking one.

function pad2(n) { return String(n).padStart(2, '0') }

function isoDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function monthKey(year, month1Indexed) {
  return `${year}-${pad2(month1Indexed)}`
}

// Given inclusive start date and inclusive end date, produce the
// list of YYYY-MM keys the range crosses. Handles year rollovers.
function monthKeysBetween(startIsoInclusive, endIsoInclusive) {
  const [sy, sm] = startIsoInclusive.split('-').map(Number)
  const [ey, em] = endIsoInclusive.split('-').map(Number)
  const out = []
  let y = sy, m = sm
  while (y < ey || (y === ey && m <= em)) {
    out.push(monthKey(y, m))
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}

// Month period — a whole calendar month.
// y,m are 1-indexed ("2026-04" = monthPeriod(2026, 4)).
export function monthPeriod(y, m) {
  const start = new Date(y, m - 1, 1)
  const endExclusive = new Date(y, m, 1) // first of next month
  const label = start.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
  return {
    kind: 'month',
    startIso: isoDate(start),
    endIso: isoDate(endExclusive),
    label,
    monthKeys: [monthKey(y, m)],
  }
}

// Custom range period. Both inputs inclusive. endIso is adjusted
// internally to be exclusive (first day after end) so callers can
// do the same string compare `ts >= startIso && ts < endIso`.
export function rangePeriod(startIsoInclusive, endIsoInclusive) {
  // Defensive: swap if caller passed end before start.
  let sIso = startIsoInclusive
  let eIso = endIsoInclusive
  if (sIso > eIso) { const t = sIso; sIso = eIso; eIso = t }

  const [ey, em, ed] = eIso.split('-').map(Number)
  const endExclusive = new Date(ey, em - 1, ed + 1)
  const endExclusiveIso = isoDate(endExclusive)

  const sd = new Date(sIso + 'T00:00:00')
  const edDate = new Date(eIso + 'T00:00:00')

  // If range fits inside a single calendar month AND spans the whole
  // month, treat it as a month — lets reduce UI chrome and reuses
  // the same logic paths.
  const isFullMonth =
    sd.getDate() === 1 &&
    edDate.getDate() === new Date(sd.getFullYear(), sd.getMonth() + 1, 0).getDate() &&
    sd.getFullYear() === edDate.getFullYear() &&
    sd.getMonth() === edDate.getMonth()

  if (isFullMonth) {
    return monthPeriod(sd.getFullYear(), sd.getMonth() + 1)
  }

  const labelFmt = { day: 'numeric', month: 'short' }
  const sameYear = sd.getFullYear() === edDate.getFullYear()
  const label = sameYear
    ? `${sd.toLocaleDateString('en-IN', labelFmt)} – ${edDate.toLocaleDateString('en-IN', labelFmt)}, ${sd.getFullYear()}`
    : `${sd.toLocaleDateString('en-IN', labelFmt)}, ${sd.getFullYear()} – ${edDate.toLocaleDateString('en-IN', labelFmt)}, ${edDate.getFullYear()}`

  return {
    kind: 'range',
    startIso: sIso,
    endIso: endExclusiveIso,
    label,
    monthKeys: monthKeysBetween(sIso, eIso),
  }
}

export function thisMonth() {
  const d = new Date()
  return monthPeriod(d.getFullYear(), d.getMonth() + 1)
}

export function shiftMonth(period, delta) {
  // Only meaningful for month periods. For ranges, shift-month
  // falls back to shifting the month containing startIso, which
  // implicitly converts a custom range back to a month view —
  // expected UX: arrows always "jump" to a clean month.
  const [y, m] = period.startIso.split('-').map(Number)
  const next = new Date(y, m - 1 + delta, 1)
  return monthPeriod(next.getFullYear(), next.getMonth() + 1)
}

// Used to disable "next month" navigation past the current month.
export function isFutureMonth(period) {
  const now = thisMonth()
  return period.startIso > now.startIso
}

// Presets — all return period objects ready to drop into setPeriod.
export function presetToday() {
  const today = isoDate(new Date())
  return rangePeriod(today, today)
}

export function presetYesterday() {
  const d = new Date(); d.setDate(d.getDate() - 1)
  const iso = isoDate(d)
  return rangePeriod(iso, iso)
}

export function presetLastNDays(n) {
  const end = new Date()
  const start = new Date(); start.setDate(start.getDate() - (n - 1))
  return rangePeriod(isoDate(start), isoDate(end))
}

export function presetThisMonth() {
  return thisMonth()
}

export function presetLastMonth() {
  const d = new Date()
  // Step back one calendar month using Date normalization to handle
  // the Jan → Dec-of-prior-year wrap.
  const last = new Date(d.getFullYear(), d.getMonth() - 1, 1)
  return monthPeriod(last.getFullYear(), last.getMonth() + 1)
}

export function presetThisQuarter() {
  const d = new Date()
  const qStartMonth = Math.floor(d.getMonth() / 3) * 3 // 0,3,6,9
  const start = new Date(d.getFullYear(), qStartMonth, 1)
  const endInclusive = new Date(d.getFullYear(), qStartMonth + 3, 0) // last day of quarter
  return rangePeriod(isoDate(start), isoDate(endInclusive))
}
