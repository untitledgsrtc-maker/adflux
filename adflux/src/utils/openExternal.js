// src/utils/openExternal.js
//
// Phase 93.19 (26 May 2026) — Capacitor-aware launchers for external
// URL schemes (tel:, whatsapp:, mailto:).
//
// Phase 93.19.1 (26 May 2026) — STATIC import of @capacitor/app.
//
// Owner reported after 93.19 ship: "if i call lead out come not
// come. in web working so perfect." Root cause: dynamic
// `await import('@capacitor/app')` is a Vite code-split chunk. On
// live-update APK mode the chunk fetches from app.untitledad.in on
// first call, adding 100-2000ms latency. Two things go wrong:
//   1. The user-gesture context is lost across the await — Android
//      sometimes drops the OS intent if it doesn't fire promptly.
//   2. The PostCallOutcomeModal setTimeout(1500) timer races against
//      the chunk-load + insert chain; if the WebView backgrounds
//      before the modal state flip, the modal never opens.
//
// Static import: App is bound at module load. App.openUrl fires
// SYNCHRONOUSLY on the user gesture. No async dance.
//
// Web cost: @capacitor/app is ~2 kB gzipped. App.openUrl is gated
// behind isNative() so it never runs in a browser anyway — the
// import is dead-weight on web but trivially small.

import { App } from '@capacitor/app'

function isNative() {
  try {
    return !!window?.Capacitor?.isNativePlatform?.()
  } catch {
    return false
  }
}

/**
 * Launch the native dialer for a phone number.
 * Accepts any format; strips non-digits + ensures + prefix.
 *
 * @param {string} phone
 */
export function dialPhone(phone) {
  if (!phone) return
  const digits = String(phone).replace(/[^\d+]/g, '')
  const url = digits.startsWith('+') ? `tel:${digits}` : `tel:+${digits}`
  if (isNative()) {
    try {
      // Fire-and-forget. App.openUrl returns a Promise (we ignore it
      // — the OS intent dispatches immediately on the user gesture).
      App.openUrl({ url })
      return
    } catch (e) {
      console.warn('[openExternal] dialPhone Capacitor App.openUrl failed:', e?.message || e)
    }
  }
  // Web — Chrome / Safari intercepts tel: scheme + routes to dialer.
  window.location.href = url
}

/**
 * Launch an external URL (whatsapp://, mailto:, or any custom
 * scheme). On Capacitor native: native intent. On web: window.open
 * in a new tab so the current page state is preserved.
 *
 * @param {string} url
 */
export function openExternalUrl(url) {
  if (!url) return
  if (isNative()) {
    try {
      App.openUrl({ url })
      return
    } catch (e) {
      console.warn('[openExternal] openExternalUrl Capacitor App.openUrl failed:', e?.message || e)
    }
  }
  // Web — open in new context so current page state is preserved.
  // noopener+noreferrer mirrors the security posture of the original
  // call sites this helper replaces.
  window.open(url, '_blank', 'noopener,noreferrer')
}
