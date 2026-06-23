// src/utils/downloadToCache.js
//
// Phase 177 — download a remote file (the company brochure URL) to the
// Capacitor cache and return a local file:// uri, so ShareDirect can ATTACH it
// (the native plugin needs a local path, not a URL — same need the govt PDF has
// via writeQuotePdfToCache). Native-only: returns null on web or on any failure,
// so the caller cleanly falls back to a plain mailto + link. Never throws.

import { Capacitor } from '@capacitor/core'

export async function downloadToCache(url, fileName) {
  if (!url || !Capacitor.isNativePlatform()) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()

    // ArrayBuffer → base64 (Filesystem.writeFile expects base64). Chunked to
    // avoid a call-stack blowup on String.fromCharCode for large files.
    const bytes = new Uint8Array(buf)
    let binary = ''
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
    }
    const base64 = btoa(binary)

    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    const name = fileName || 'brochure.pdf'
    await Filesystem.writeFile({
      path: name, data: base64, directory: Directory.Cache, recursive: true,
    })
    const uriRes = await Filesystem.getUri({ path: name, directory: Directory.Cache })
    return uriRes?.uri || null
  } catch (e) {
    console.warn('[downloadToCache] failed:', e?.message || e)
    return null
  }
}
