// src/utils/gujaratiNumber.js
//
// Helpers for rendering numbers and currency in Gujarati script for
// the Government proposal letters. The wizard collects numbers in
// English (much faster to type) but the rendered letter shows
// Gujarati digits to match how official Gujarat-government
// correspondence reads.
//
// We expose two helpers:
//
//   toGujaratiDigits(n)
//     Converts every Western digit in `n` (string or number) to its
//     Gujarati equivalent. Non-digit characters pass through.
//     1234 → "૧૨૩૪"
//
//   formatINRGujarati(n)
//     Formats a number as Indian-style currency with lakh/crore
//     comma grouping AND Gujarati digits, e.g.
//     11682000 → "૧,૧૬,૮૨,૦૦૦"
//
//   formatINREnglish(n)
//     Same lakh/crore grouping but with Western digits — useful when
//     a row needs to stay in English (e.g. internal review screens).

const EN_TO_GU = { '0':'૦','1':'૧','2':'૨','3':'૩','4':'૪','5':'૫','6':'૬','7':'૭','8':'૮','9':'૯' }

export function toGujaratiDigits(input) {
  if (input == null) return ''
  return String(input).replace(/[0-9]/g, d => EN_TO_GU[d] || d)
}

/* Indian comma grouping: 11682000 → "1,16,82,000".
   Format: last 3 digits, then groups of 2.
   Handles negative + decimal correctly. */
export function formatINREnglish(n) {
  const num = Number(n)
  if (!Number.isFinite(num)) return '0'
  const sign = num < 0 ? '-' : ''
  const [intPart, decPart] = Math.abs(num).toFixed(0).toString().split('.')
  if (intPart.length <= 3) return sign + intPart
  const lastThree = intPart.slice(-3)
  const rest = intPart.slice(0, -3)
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + lastThree
  return sign + grouped + (decPart ? '.' + decPart : '')
}

export function formatINRGujarati(n) {
  return toGujaratiDigits(formatINREnglish(n))
}

/* Format a date as "DD-MM-YYYY" in Gujarati digits, matching the
   format used at the top-right corner of your existing Gujarati
   letters (e.g. "૦૯-૦૪-૨૦૨૬"). Accepts ISO string or Date. */
export function formatDateGujarati(d) {
  if (!d) return ''
  const date = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(date.getTime())) return ''
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const yyyy = String(date.getFullYear())
  return toGujaratiDigits(`${dd}-${mm}-${yyyy}`)
}
