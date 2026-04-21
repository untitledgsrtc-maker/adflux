import { format, formatDistanceToNow, parseISO } from 'date-fns'

// ─── Currency ────────────────────────────────────────────────────

/**
 * Format number as Indian Rupee
 * e.g. 125000 → "₹1,25,000"
 */
export function formatCurrency(amount) {
  if (amount === null || amount === undefined) return '₹0'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount)
}

/**
 * Format as compact (lakhs/crores)
 * e.g. 1250000 → "₹12.5L"
 */
export function formatCompact(amount) {
  if (!amount) return '₹0'
  if (amount >= 1_00_00_000) return `₹${(amount / 1_00_00_000).toFixed(1)}Cr`
  if (amount >= 1_00_000) return `₹${(amount / 1_00_000).toFixed(1)}L`
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(0)}K`
  return `₹${amount}`
}

// ─── Dates ───────────────────────────────────────────────────────

/**
 * Today's date as 'YYYY-MM-DD' in the user's LOCAL timezone.
 * Why this exists: `new Date().toISOString().slice(0,10)` returns
 * UTC, not IST. Between 00:00 and 05:30 IST the UTC date is still
 * "yesterday", so every filter like `.gte('campaign_end_date', today)`
 * or `follow_up_date <= today` silently excluded today's rows for
 * users opening the app before dawn. Use this helper anywhere you're
 * comparing against a DB date column.
 */
export function todayISO() {
  const d = new Date()
  const y  = d.getFullYear()
  const m  = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/** Current month as 'YYYY-MM' in local timezone (see todayISO). */
export function thisMonthISO() {
  return todayISO().slice(0, 7)
}

/** Add N days to today in local time and return as 'YYYY-MM-DD'. */
export function addDaysISO(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const y  = d.getFullYear()
  const m  = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

export function formatDate(date) {
  if (!date) return '—'
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, 'dd MMM yyyy')
}

export function formatDateTime(date) {
  if (!date) return '—'
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, 'dd MMM yyyy, h:mm a')
}

export function formatRelative(date) {
  if (!date) return '—'
  const d = typeof date === 'string' ? parseISO(date) : date
  return formatDistanceToNow(d, { addSuffix: true })
}

export function formatMonthYear(monthYear) {
  if (!monthYear) return '—'
  const [year, month] = monthYear.split('-')
  const d = new Date(parseInt(year), parseInt(month) - 1, 1)
  return format(d, 'MMM yyyy')
}

export function toMonthYear(date) {
  const d = date ? (typeof date === 'string' ? parseISO(date) : date) : new Date()
  return format(d, 'yyyy-MM')
}

// ─── Numbers ─────────────────────────────────────────────────────

export function formatNumber(n) {
  if (!n) return '0'
  return new Intl.NumberFormat('en-IN').format(n)
}

export function formatPercent(n, decimals = 1) {
  if (!n) return '0%'
  return `${Number(n * 100).toFixed(decimals)}%`
}

// ─── Phone ───────────────────────────────────────────────────────

export function formatPhone(phone) {
  if (!phone) return ''
  // Strip non-digits
  const clean = phone.replace(/\D/g, '')
  if (clean.length === 10) return `+91 ${clean.slice(0,5)} ${clean.slice(5)}`
  return phone
}

// ─── Text ────────────────────────────────────────────────────────

export function truncate(str, len = 30) {
  if (!str) return ''
  return str.length > len ? str.slice(0, len) + '…' : str
}

export function initials(name) {
  if (!name) return '?'
  return name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase()
}
