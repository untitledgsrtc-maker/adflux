// src/lib/quoteIntent.js
//
// Phase 93.30 (26 May 2026) — in-memory store for quote-wizard intent.
//
// WHY
//
// Owner reported on Capacitor APK: card Edit needs DOUBLE tap to
// prefill the wizard; detail-page Edit never prefills. Web works
// fine. Phase 93.28 already passes editingId via React Router state
// AND query string but Capacitor WebView swallows both on the first
// navigation (router state lost across history.pushState; query
// string race-condition on useSearchParams' first render).
//
// This module sidesteps the URL/router layer entirely. Producer
// (Edit / Renew button) calls setPendingEditOf(id) BEFORE navigate.
// Consumer (CreateQuoteV2) calls consumePendingEditOf() during
// render. Same JS context = guaranteed delivery regardless of
// router quirks.
//
// `consume*` returns the value and immediately clears it so a stale
// id can't leak into a later wizard mount (e.g. rep opens Edit,
// cancels, then opens "New Quote" — should NOT prefill the canceled
// edit).
//
// Cleared on consume. Cleared on document.visibilitychange to 'hidden'
// (app backgrounded) so a rep who taps Edit + then minimizes the
// app + opens a fresh wizard later doesn't get stale prefill.

let pendingEditOf = null
let pendingRenewalOf = null
let pendingTs = 0

// 5-minute hard expiry. Belt-and-suspenders in case visibilitychange
// doesn't fire (some Android WebViews).
const TTL_MS = 5 * 60 * 1000

function isExpired() {
  return pendingTs && (Date.now() - pendingTs) > TTL_MS
}

export function setPendingEditOf(id) {
  pendingEditOf = id || null
  pendingRenewalOf = null
  pendingTs = Date.now()
}

export function setPendingRenewalOf(id) {
  pendingRenewalOf = id || null
  pendingEditOf = null
  pendingTs = Date.now()
}

export function consumePendingEditOf() {
  if (isExpired()) {
    pendingEditOf = null
    pendingRenewalOf = null
    pendingTs = 0
    return null
  }
  const id = pendingEditOf
  pendingEditOf = null
  pendingTs = 0
  return id
}

export function consumePendingRenewalOf() {
  if (isExpired()) {
    pendingEditOf = null
    pendingRenewalOf = null
    pendingTs = 0
    return null
  }
  const id = pendingRenewalOf
  pendingRenewalOf = null
  pendingTs = 0
  return id
}

// Clear on backgrounding so stale intent doesn't leak into the next
// foreground session.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      pendingEditOf = null
      pendingRenewalOf = null
      pendingTs = 0
    }
  })
}
