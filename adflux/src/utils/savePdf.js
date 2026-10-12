// src/utils/savePdf.js
//
// Phase 359 — ONE shared "hand this PDF to the person" helper (§71).
//
// Why: the old pattern (blob URL + <a download>.click(), then an immediate
// URL.revokeObjectURL) silently fails on exactly the devices reps use:
//   - Capacitor APK: the WebView has no DownloadListener for blob: URLs, so the
//     click does nothing (same finding as QuoteDetail Phase 95.10).
//   - iPhone Safari / home-screen app: blob downloads are unreliable and the
//     browser may navigate away from the app.
//   - Any browser: the click happens after awaits (RPC + PDF render), so the
//     user gesture is gone; revoking the URL right away can cancel the download.
//
// Order of attempts (first that works wins):
//   1. Native app (Capacitor): write to the app cache under pdfs/ (the only
//      folder file_paths.xml exposes) -> Share sheet with the real file.
//      Same proven path as QuoteDetail Phase 102.I.1.
//   2. Browser with file sharing (phones: Android Chrome, iOS 15+): the OS
//      share sheet (Save to Files / WhatsApp / Drive ...).
//   3. Plain download link, with a DELAYED revoke.
// If the browser refuses the share sheet because the tap is too old (iOS),
// we return { method: 'needs-tap' } and the caller keeps the built PDF so the
// next tap can finish synchronously with a fresh gesture. That second call
// passes { allowNeedsTap: false }, so it can never loop: it falls through to
// the plain download instead.
// Desktop browsers skip the share sheet (they download), so a dismissed OS
// dialog can never leave a desktop user with no file.
//
// Never uploads anything anywhere (a salary slip must not touch a bucket).
// Never throws for cancel; throws a readable Error for a real failure so the
// caller can show the reason instead of a silent no-op (Phase 236 rule).

function isNative() {
  try {
    return !!window?.Capacitor?.isNativePlatform?.()
  } catch {
    return false
  }
}

function isIOS() {
  try {
    const ua = navigator.userAgent || ''
    if (/iPad|iPhone|iPod/.test(ua)) return true
    // iPadOS 13+ reports as a Mac with touch.
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  } catch {
    return false
  }
}

// Touch-first device (phone / tablet)? Desktop browsers may also expose file
// sharing, but a share dialog is the wrong experience there - they download.
function isTouchDevice() {
  try {
    return !!window.matchMedia?.('(pointer: coarse)')?.matches || isIOS()
  } catch {
    return false
  }
}

// Safe file name: ASCII letters/digits/._- only, always ends in .pdf.
export function safePdfName(name, fallback = 'document') {
  const base = String(name || '')
    .replace(/\.pdf$/i, '')
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return (base || fallback) + '.pdf'
}

// Blob -> base64 (no data: prefix). FileReader avoids the call-stack blowup of
// String.fromCharCode.apply on big arrays.
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('could not read the PDF'))
    r.onload = () => {
      const s = String(r.result || '')
      const i = s.indexOf(',')
      resolve(i >= 0 ? s.slice(i + 1) : s)
    }
    r.readAsDataURL(blob)
  })
}

function anchorDownload(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Do NOT revoke at once: some browsers start the download after the click
  // returns, and an early revoke cancels it. 60s is plenty and costs nothing.
  setTimeout(() => { try { URL.revokeObjectURL(url) } catch { /* ignore */ } }, 60000)
}

/**
 * @param {Blob} blob
 * @param {string} fileName   any text; sanitised to a safe *.pdf name
 * @param {{ title?: string, allowNeedsTap?: boolean, cacheSweepPrefix?: string }} [opts]
 *   allowNeedsTap     default true; false = never return 'needs-tap' (download instead)
 *   cacheSweepPrefix  native only: delete OTHER old files in pdfs/ that start with
 *                     this prefix before writing (privacy: payslips must not pile up)
 * @returns {Promise<{ method: 'native-share'|'web-share'|'download'|'cancelled'|'needs-tap', fileName: string }>}
 */
export async function savePdfBlob(blob, fileName, opts = {}) {
  const name = safePdfName(fileName)
  const title = opts.title || name
  const allowNeedsTap = opts.allowNeedsTap !== false

  // 1 · Native app
  if (isNative()) {
    let step = 'read'
    try {
      const base64 = await blobToBase64(blob)
      step = 'filesystem'
      const [{ Filesystem, Directory }, { Share }] = await Promise.all([
        import('@capacitor/filesystem'),
        import('@capacitor/share'),
      ])
      const path = `pdfs/${name}`
      if (opts.cacheSweepPrefix) {
        // Best-effort: drop older files with the same prefix (never the one we
        // are about to write, never anything else).
        try {
          const { files } = await Filesystem.readdir({ path: 'pdfs', directory: Directory.Cache })
          for (const f of files || []) {
            const fn = typeof f === 'string' ? f : f?.name
            if (fn && fn.startsWith(opts.cacheSweepPrefix) && fn !== name) {
              try { await Filesystem.deleteFile({ path: `pdfs/${fn}`, directory: Directory.Cache }) } catch { /* ignore */ }
            }
          }
        } catch { /* first run: no pdfs/ folder yet */ }
      }
      await Filesystem.writeFile({ path, data: base64, directory: Directory.Cache, recursive: true })
      const uriRes = await Filesystem.getUri({ path, directory: Directory.Cache })
      step = 'share'
      await Share.share({
        title,
        text: title,
        files: [uriRes.uri],
        dialogTitle: 'Save or share',
      })
      return { method: 'native-share', fileName: name }
    } catch (e) {
      const msg = e?.message || String(e)
      // Only the share step can be a user cancel; a Filesystem failure that
      // happens to contain the word must still surface.
      if (step === 'share' && /cancel/i.test(msg)) return { method: 'cancelled', fileName: name }
      const err = new Error('[' + step + '] ' + msg)
      err.step = step
      throw err
    }
  }

  // 2 · Browser share sheet with the file (phones)
  try {
    if (isTouchDevice() && typeof File === 'function' && navigator.canShare && navigator.share) {
      const file = new File([blob], name, { type: 'application/pdf' })
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title })
          return { method: 'web-share', fileName: name }
        } catch (e) {
          if (e?.name === 'AbortError') return { method: 'cancelled', fileName: name }
          // Tap too old (needs a fresh gesture). On iOS a link download is
          // unreliable, so ask the caller to keep the PDF and re-run on tap.
          if (allowNeedsTap && e?.name === 'NotAllowedError' && isIOS()) return { method: 'needs-tap', fileName: name }
          // anything else: fall through to the plain download
        }
      }
    }
  } catch {
    /* share API unusable here — fall through */
  }

  // 3 · Plain download
  anchorDownload(blob, name)
  return { method: 'download', fileName: name }
}
