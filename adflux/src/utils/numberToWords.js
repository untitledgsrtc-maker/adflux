// src/utils/numberToWords.js
//
// Phase 15 — INR amount-to-words for Other Media quote PDF.
// Indian numbering: thousand / lakh / crore (not million / billion).
//
// 12,21,300  →  "Twelve Lakh Twenty-One Thousand Three Hundred Rupees Only"
// 5,10,000   →  "Five Lakh Ten Thousand Rupees Only"
// 99         →  "Ninety-Nine Rupees Only"

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen',
  'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
]
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function twoDigit(n) {
  if (n < 20) return ONES[n]
  const t = Math.floor(n / 10)
  const o = n % 10
  return o === 0 ? TENS[t] : `${TENS[t]}-${ONES[o]}`
}

function threeDigit(n) {
  const h = Math.floor(n / 100)
  const r = n % 100
  if (h === 0) return twoDigit(r)
  if (r === 0) return `${ONES[h]} Hundred`
  return `${ONES[h]} Hundred ${twoDigit(r)}`
}

export function rupeesToWords(amount) {
  const rupees = Math.floor(Math.abs(Number(amount) || 0))
  const paise  = Math.round((Math.abs(Number(amount) || 0) - rupees) * 100)

  if (rupees === 0 && paise === 0) return 'Zero Rupees Only'

  // Indian split: crore (10,000,000) · lakh (100,000) · thousand · hundred · tens.
  const crore    = Math.floor(rupees / 10000000)
  const lakh     = Math.floor((rupees % 10000000) / 100000)
  const thousand = Math.floor((rupees % 100000) / 1000)
  const rest     = rupees % 1000

  const parts = []
  if (crore)    parts.push(`${twoDigit(crore)} Crore`)
  if (lakh)     parts.push(`${twoDigit(lakh)} Lakh`)
  if (thousand) parts.push(`${twoDigit(thousand)} Thousand`)
  if (rest)     parts.push(threeDigit(rest))

  let out = parts.join(' ').trim() + ' Rupees'
  if (paise > 0) out += ` and ${twoDigit(paise)} Paise`
  out += ' Only'
  return out
}
