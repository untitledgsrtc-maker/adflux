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
