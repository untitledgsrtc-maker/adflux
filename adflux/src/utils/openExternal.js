// src/utils/openExternal.js
//
// Phase 93.19 (26 May 2026) — Capacitor-aware launchers for external
// URL schemes (tel:, whatsapp:, mailto:).
//
// Owner reported: "in web if we call, outcome popup coming instantly,
// then we fill outcome [and] auto come WhatsApp. but in app it's not
// working." Root cause: WorkV2 + TelecallerV2 used the web pattern
// `window.location.href = 'tel:+...'` which on Capacitor APK webview
// tries to navigate the webview to a tel: URL — webview can't handle
// it, navigation fails, and the JS chain that opens the
// PostCallOutcomeModal 1.5s later silently breaks.
//
// Same trap for `window.open('whatsapp://...', '_blank')`.
//
// Capacitor's @capacitor/app plugin provides App.openUrl which
// dispatches a native intent. Native dialer / WhatsApp opens cleanly
// + webview is unaffected + JS execution continues so the modal
// timer fires on schedule.
//
// On web (mobile Chrome / desktop), fall back to the standard
// browser behaviour — Chrome intercepts tel: + whatsapp: at the OS
// level and routes them via system handlers.
//
// PostCallOutcomeModal chain (tel: → 1.5s → modal → save) per §28
// is preserved: dialPhone resolves fast on native (App.openUrl is a
// fire-and-forget intent that returns quickly) and synchronously on
// web (window.location.href). The setTimeout queued after the
// dialPhone call still fires on schedule.

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
 * @returns {Promise<void>}
 */
export async function dialPhone(phone) {
  if (!phone) return
  const digits = String(phone).replace(/[^\d+]/g, '')
  const url = digits.startsWith('+') ? `tel:${digits}` : `tel:+${digits}`
  if (isNative()) {
    try {
      const { App } = await import('@capacitor/app')
      await App.openUrl({ url })
      return
    } catch (e) {
      // Fall through to web fallback — worst-case browser default
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
 * @returns {Promise<void>}
 */
export async function openExternalUrl(url) {
  if (!url) return
  if (isNative()) {
    try {
      const { App } = await import('@capacitor/app')
      await App.openUrl({ url })
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
