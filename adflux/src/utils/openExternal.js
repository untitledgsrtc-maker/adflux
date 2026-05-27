// src/utils/openExternal.js
//
// Phase 93.19 (26 May 2026) — Capacitor-aware launchers for external
// URL schemes (tel:, whatsapp:, mailto:).
//
// Phase 95.4 (27 May 2026) — SWITCHED FROM @capacitor/app to
// @capacitor/app-launcher. Codex audit caught it: @capacitor/app
// in Capacitor 8 has NO openUrl() method. That API lives on
// @capacitor/app-launcher (separate plugin). Phases 93.19 → 95.3
// silently no-op'd because App.openUrl is undefined; try/catch
// swallowed the TypeError and the fallback window.location.href=tel:
// then failed inside the Capacitor WebView. Net result: Call +
// WhatsApp buttons did nothing on APK even after manifest <queries>
// shipped.
//
// Reference:
//   • @capacitor/app v8 docs — exitApp / getInfo / getLaunchUrl /
//     getState / minimizeApp / lifecycle listeners. No openUrl.
//   • @capacitor/app-launcher v8 docs — openUrl({ url }) →
//     Promise<{ completed: boolean }>. completed=false when no
//     handler (manifest queries gap or no app installed).
//
// Static import keeps the user-gesture context sync per the
// Phase 93.19.1 reasoning. AppLauncher.openUrl returns a Promise
// (fire-and-forget — we don't await) but the underlying native
// intent dispatch happens before the Promise resolves, on the
// same call frame as the click.

import { AppLauncher } from '@capacitor/app-launcher'

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
      AppLauncher.openUrl({ url })
      return
    } catch (e) {
      console.warn('[openExternal] dialPhone Capacitor AppLauncher.openUrl failed:', e?.message || e)
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
      AppLauncher.openUrl({ url })
      return
    } catch (e) {
      console.warn('[openExternal] openExternalUrl Capacitor AppLauncher.openUrl failed:', e?.message || e)
    }
  }
  // Web — open in new context so current page state is preserved.
  // noopener+noreferrer mirrors the security posture of the original
  // call sites this helper replaces.
  window.open(url, '_blank', 'noopener,noreferrer')
}
