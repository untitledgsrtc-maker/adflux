// src/utils/shareQuoteWhatsApp.js
//
// Phase 239 — ONE shared "share a quote to WhatsApp" cascade, called by BOTH
// the post-create screen (Step4Send) AND the quote detail page (QuoteDetail).
//
// Before this, the attach logic lived only in QuoteDetail.handleWhatsApp, so the
// post-create "Send via WhatsApp" button (Step4Send) only ever sent a wa.me
// LINK — never the PDF file (owner report 16 Jul: "direct quotation share goes
// as link format"). That divergence is the §69/§71 "fix applied in one place,
// not the parallel place" disease. This helper is the single definition; change
// the share behavior HERE and both surfaces move together.
//
// Behavior (identical to the old QuoteDetail.handleWhatsApp):
//   • APK (native): render the PDF to cache → ShareDirect.whatsapp (attach the
//     file straight to the client's chat) → generic Share.share sheet fallback.
//     On any failure, surface the reason (onStatus) and fall through to a link.
//   • Web / fallback: upload the PDF → wa.me deep link with the branded link in
//     the message (a browser can't attach a file to WhatsApp).
//
// The caller supplies `onStatus` to surface feedback its own way (toast/banner)
// and reads the returned { method } to log the touch.

import { cleanPhone } from './phone'
import { buildWhatsAppMessage, openWhatsApp, shortenUrl } from './whatsapp'
import { shareWhatsAppDirect } from './shareDirect'
import {
  downloadQuotePDFHtml as downloadQuotePDF,
  uploadQuotePDFHtml   as uploadQuotePDF,
} from '../components/quotes/QuotePDFHtml'

// Render the quote PDF, upload it, fetch it back, and write it to the app cache
// as a FileProvider-exposed file:// URI for the native share. Every step is
// tagged so a failure names EXACTLY where it died (Phase 236). Throws on any
// failure → the caller falls back to the link flow.
async function writeQuotePdfToCache(quote, cities) {
  let step = 'upload'
  try {
    const url = await uploadQuotePDF(quote, cities)
    if (!url) throw new Error('upload returned no URL')

    step = 'fetch'
    const res = await fetch(url)
    if (!res.ok) throw new Error('HTTP ' + res.status)

    step = 'read'
    const blob = await res.blob()
    const buf = await blob.arrayBuffer()
    if (!buf || buf.byteLength === 0) throw new Error('PDF body is 0 bytes (opaque/blocked fetch)')
    const bytes = new Uint8Array(buf)
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize))
    }
    const base64 = btoa(binary)

    step = 'filesystem'
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    const safeRef = String(quote.quote_number || quote.ref_number || quote.id || 'quote')
      .replace(/[^A-Za-z0-9_-]/g, '_')
    const fileName = `pdfs/quote-${safeRef}.pdf`
    await Filesystem.writeFile({
      path: fileName, data: base64, directory: Directory.Cache, recursive: true,
    })
    const uriRes = await Filesystem.getUri({ path: fileName, directory: Directory.Cache })
    return uriRes.uri
  } catch (e) {
    const err = new Error('[' + step + '] ' + (e?.message || String(e)))
    err.step = step
    throw err
  }
}

/**
 * Share a quote to WhatsApp — attach the PDF on the APK, link on web.
 * @returns { method: 'attach'|'link'|'cancelled', pdfUrl?, message?, ref }
 * onStatus({ type, message, error? }) surfaces feedback (attach_failed /
 * upload_failed / download_failed / downloaded_local).
 */
export async function shareQuoteViaWhatsApp(quote, cities, { onStatus } = {}) {
  const ref = quote?.quote_number || quote?.ref_number || ''
  const isNative = typeof window !== 'undefined' && window?.Capacitor?.isNativePlatform?.()

  if (isNative) {
    try {
      const uri = await writeQuotePdfToCache(quote, cities)
      const caption = buildWhatsAppMessage(quote, cities, {})
      const digits = cleanPhone(quote.client_phone)
      // ShareDirect: open the CLIENT's WhatsApp chat directly with the PDF
      // attached (Phase 162). Falls back to the generic sheet if WhatsApp
      // isn't installed / older APK.
      const direct = await shareWhatsAppDirect({
        phone:   digits.length === 10 ? `91${digits}` : digits,
        text:    caption,
        fileUri: uri,
      })
      if (direct.completed) return { method: 'attach', ref }

      const { Share } = await import('@capacitor/share')
      await Share.share({
        title:       `Quote ${ref}`.trim(),
        text:        caption,
        files:       [uri],
        dialogTitle: 'Send proposal',
      })
      return { method: 'attach', ref }
    } catch (shareErr) {
      const msg = shareErr?.message || String(shareErr)
      if (/cancel/i.test(msg)) return { method: 'cancelled', ref }
      console.warn('[shareQuoteViaWhatsApp] native attach failed, link fallback:', msg)
      onStatus?.({ type: 'attach_failed', message: 'PDF could not attach — sending a link instead. Reason: ' + msg })
      // fall through to the wa.me link flow
    }
  }

  // Web / fallback: upload the PDF so the message carries a public link (a
  // browser cannot attach a file to WhatsApp).
  let pdfUrl = null
  try {
    pdfUrl = await uploadQuotePDF(quote, cities)
  } catch (e) {
    console.warn('[shareQuoteViaWhatsApp] PDF upload failed:', e)
    onStatus?.({ type: 'upload_failed', error: e, message: 'PDF upload failed: ' + (e?.message || 'unknown') })
    let downloadedLocally = false
    try { await downloadQuotePDF(quote, cities); downloadedLocally = true }
    catch (dlErr) {
      onStatus?.({ type: 'download_failed', error: dlErr, message: 'PDF upload AND local download failed: ' + (dlErr?.message || 'unknown') + '. WhatsApp will open without an attachment.' })
    }
    if (downloadedLocally) onStatus?.({ type: 'downloaded_local', message: 'PDF upload failed — downloaded locally. Please attach it in WhatsApp.' })
  }

  // Phase 95.3 — keep the branded app.untitledad.in/pdf link (don't re-shorten
  // it into an is.gd blob); only shorten a raw Supabase storage URL.
  if (pdfUrl && !/^https?:\/\/[^/]*untitledad\.in\/pdf\//.test(pdfUrl)) {
    try { pdfUrl = await shortenUrl(pdfUrl) } catch { /* fall back to the full URL */ }
  }

  const message = buildWhatsAppMessage(quote, cities, { pdfUrl })
  openWhatsApp(quote.client_phone, message)
  return { method: 'link', pdfUrl, message, ref }
}
