// src/utils/phone.js
//
// Phase 172.2 (Consolidation Stage 1) — ONE home for phone-number cleaning.
// Before this, `String(x).replace(/\D/g, '')` (and slight variants) was inlined
// in ~19 files. See DUPLICATION_AUDIT_2026-06-17.md Category B.
//
// These three functions are a SUPERSET of every inline variant found, chosen so
// that swapping an inline call for the helper is byte-identical for real phone
// strings. They are null-safe (`String(x ?? '')`), so they also never throw on
// null/undefined — the only behavioural difference vs the unguarded inline form,
// and a strict improvement.

// Digits only. cleanPhone(null) === cleanPhone(undefined) === ''.
export function cleanPhone(raw) {
  return String(raw ?? '').replace(/\D/g, '')
}

// Last 10 digits (India mobile). '' if fewer than 1 digit.
export function phoneLast10(raw) {
  return cleanPhone(raw).slice(-10)
}

// Indian WhatsApp jid: a bare 10-digit number → 91XXXXXXXXXX. Anything else
// (already country-coded, or non-10-digit) is returned as digits, unchanged.
export function phoneToWaJid(raw) {
  return cleanPhone(raw).replace(/^(\d{10})$/, '91$1')
}

// Strict jid: returns null for anything under 10 digits (an invalid number).
// Matches the local cleanPhone the WhatsApp send modals used to carry.
export function phoneToWaJidOrNull(raw) {
  const d = cleanPhone(raw)
  if (d.length < 10) return null
  return d.replace(/^(\d{10})$/, '91$1')
}

// Normalise a typed Indian number to the 10 digits we store/dial (Operations contacts, Phase 337).
// Accepts a leading 91 / 0 and STD landlines. Rejects anything that is not exactly 10 digits
// after stripping, and the obvious junk (all one digit). Mirrors the DB policy regex
// ^[0-9]{10}$ (the stored form), so a number that passes here always passes the exec insert policy.
export function normalizeIndianPhone(raw) {
  // Gujarati (U+0AE6-0AEF) and Devanagari (U+0966-096F) numerals -> ASCII first: the field team's
  // Gujarati keyboard can type them and cleanPhone() would otherwise strip them away.
  const ascii = String(raw ?? '').replace(/[\u0AE6-\u0AEF\u0966-\u096F]/g, ch => String(ch.charCodeAt(0) - (ch.charCodeAt(0) >= 0x0AE6 ? 0x0AE6 : 0x0966)))
  let d = cleanPhone(ascii)
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  if (!/^\d{10}$/.test(d) || d.startsWith('0')) return { ok: false, value: '' }
  if (/^(\d)\1{9}$/.test(d)) return { ok: false, value: '' }
  return { ok: true, value: d }
}
