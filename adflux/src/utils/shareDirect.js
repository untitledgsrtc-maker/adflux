// src/utils/shareDirect.js
//
// Phase 162 — JS shim for the native ShareDirect plugin (Java in
// android/.../ShareDirect.java). Sends a quote PDF straight to Gmail or
// WhatsApp with the recipient pre-filled + the PDF attached as a real file
// + the app opened directly (no chooser). Native-only; on web (or an APK
// that predates the plugin) every call resolves { completed: false } so the
// caller cleanly falls back to its existing flow (mailto / Share.share /
// wa.me link). Never throws.

import { Capacitor, registerPlugin } from '@capacitor/core'

const ShareDirect = registerPlugin('ShareDirect')

/**
 * Open Gmail directly with the recipient + subject + body pre-filled and
 * the PDF attached. { completed: true } on success; { completed: false }
 * when Gmail isn't installed / not native — caller falls back to mailto.
 */
export async function shareEmailDirect({ to, subject, body, fileUri } = {}) {
  if (!Capacitor.isNativePlatform()) return { completed: false }
  try {
    const r = await ShareDirect.email({
      to: to || '', subject: subject || '', body: body || '', fileUri: fileUri || '',
    })
    return r || { completed: false }
  } catch (e) {
    console.warn('[shareDirect] email failed:', e?.message || e)
    return { completed: false }
  }
}

/**
 * Open WhatsApp directly into the given number's chat with the PDF attached
 * + the caption text. `phone` = digits incl. country code, no '+'. Returns
 * { completed: false } when WhatsApp isn't installed / not native — caller
 * falls back to Share.share / wa.me.
 */
export async function shareWhatsAppDirect({ phone, text, fileUri } = {}) {
  if (!Capacitor.isNativePlatform()) return { completed: false }
  try {
    const r = await ShareDirect.whatsapp({
      phone: phone || '', text: text || '', fileUri: fileUri || '',
    })
    return r || { completed: false }
  } catch (e) {
    console.warn('[shareDirect] whatsapp failed:', e?.message || e)
    return { completed: false }
  }
}
