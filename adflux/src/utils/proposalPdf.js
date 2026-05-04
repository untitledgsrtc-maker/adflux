// src/utils/proposalPdf.js
//
// Three responsibilities, all client-side:
//
//   1. uploadAttachment(file, quoteId, slug)
//      → uploads a user-picked file to the `quote-attachments` bucket,
//        returns the storage path. Path convention is enforced HERE so
//        the rest of the app doesn't need to know it.
//
//   2. generateLockedProposalPdf(domNode, quoteId)
//      → rasterizes the GovtProposalRenderer DOM via html2canvas, wraps
//        as a single-page (or multi-page) PDF via jsPDF, uploads to
//        Storage, returns the storage path. Run on Mark Sent so the
//        owner's "future-proof" requirement holds — once snapshotted,
//        editing the quote no longer changes what was sent.
//
//   3. buildCombinedPdf(parts)
//      → merges multiple PDFs (and images embedded as PDF pages) into
//        a single output Blob using pdf-lib. Used for the "Download
//        Combined PDF" button on the govt detail page.
//
// Design notes:
//   - Bucket is private (Phase 8 SQL). Anywhere we need to display or
//     download a file, we ask Supabase for a SHORT-LIVED signed URL —
//     the storage path stored in the DB is stable across renames /
//     access-control changes.
//   - html2canvas → jsPDF rasterizes the rendered HTML. This is the
//     ONLY safe path for Gujarati typography because we don't have to
//     re-implement font fallbacks in a PDF library — whatever the
//     browser renders is what ends up in the PDF.
//   - We deliberately don't try to make the proposal letter PDF
//     "selectable text" — govt bodies receive a hand-delivered printed
//     copy + (optionally) an emailed PDF. Text-selection is a non-goal.

import { supabase } from '../lib/supabase'

// Lazy-load the heavy libs so the rest of the app stays small. These
// only get fetched when the user actually clicks Mark Sent or Download
// Combined PDF, not on every page load.
async function loadHtml2Canvas() {
  const mod = await import('html2canvas')
  return mod.default || mod
}
async function loadJsPdf() {
  const mod = await import('jspdf')
  return mod.jsPDF || mod.default
}
async function loadPdfLib() {
  return await import('pdf-lib')
}

const BUCKET = 'quote-attachments'

// ─────────────────────────────────────────────────────────────────────
// 1. Path helpers
// ─────────────────────────────────────────────────────────────────────

// Slugify a label like "OC copy (acknowledgment receipt)" into something
// safe for a storage path: "oc-copy-acknowledgment-receipt".
export function slugifyLabel(label) {
  return String(label || 'attachment')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

// Infer a sensible extension from the file's MIME type, falling back
// to whatever the original filename had.
function inferExt(file) {
  const fromName = (file.name || '').match(/\.([a-z0-9]+)$/i)?.[1]
  if (fromName) return fromName.toLowerCase()
  const mt = (file.type || '').toLowerCase()
  if (mt === 'application/pdf') return 'pdf'
  if (mt === 'image/jpeg' || mt === 'image/jpg') return 'jpg'
  if (mt === 'image/png')  return 'png'
  if (mt === 'image/webp') return 'webp'
  return 'bin'
}

// Path = `<quote_id>/<display_order>-<slug>.<ext>`
// display_order is optional; when we don't have one (custom items, or
// the locked proposal letter), we use a numeric fallback or a fixed key.
function pathFor(quoteId, prefix, slug, ext) {
  return `${quoteId}/${prefix}-${slug}.${ext}`
}

// ─────────────────────────────────────────────────────────────────────
// 2. Upload helpers
// ─────────────────────────────────────────────────────────────────────

// Upload a user-picked File to `quote-attachments` and return the
// storage path. Caller stores the path on attachments_checklist[i].
//
// We `upsert: true` so re-uploading replaces the previous version
// without complaining about a path collision — the user's mental
// model is "this slot has my latest OC copy", not "I'm versioning
// my OC copies".
export async function uploadAttachment({ file, quoteId, displayOrder, label }) {
  if (!file) throw new Error('No file provided')
  if (!quoteId) throw new Error('No quoteId provided')

  const slug = slugifyLabel(label)
  const ext  = inferExt(file)
  const prefix = displayOrder != null ? String(displayOrder).padStart(2, '0') : 'cu'
  const path = pathFor(quoteId, prefix, slug, ext)

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      upsert: true,
      contentType: file.type || undefined,
      cacheControl: '3600',
    })

  if (error) throw error
  return { path }
}

// Get a short-lived signed URL for a stored file. Used wherever we
// need to display / download / link an attachment.
export async function getSignedUrl(path, expiresInSec = 600) {
  if (!path) return null
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSec)
  if (error) throw error
  return data?.signedUrl || null
}

// Download a stored file to ArrayBuffer (used by buildCombinedPdf).
export async function downloadAsArrayBuffer(path) {
  if (!path) throw new Error('No path provided')
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(path)
  if (error) throw error
  return await data.arrayBuffer()
}

// ─────────────────────────────────────────────────────────────────────
// 3. Locked proposal PDF generator (run on Mark Sent)
// ─────────────────────────────────────────────────────────────────────

// Rasterize the rendered Gujarati letter (passed in as a DOM node) and
// upload as a multi-page PDF. Returns { path, sizeBytes }.
//
// Why multi-page: at A4 height the letter often runs longer than one
// page. We split the canvas vertically into A4-sized slices and stamp
// each slice as its own page. Keeps the rendered look identical to the
// preview while keeping the output a real PDF (not a single tall image
// that prints awkwardly).
//
// CRITICAL: we force the captured DOM to A4 width (794px @ 96dpi)
// BEFORE rasterizing, otherwise html2canvas captures whatever width
// the dark-themed app is at (often 1100-1400px depending on viewport),
// and the resulting PDF looks landscape-stretched and "wrong-sided"
// when scaled to A4 portrait pages. Approach: clone the node into a
// hidden positioned-off-screen container with width = 794px, render
// from THERE, then discard the clone.
export async function generateLockedProposalPdf({ domNode, quoteId }) {
  if (!domNode) throw new Error('No DOM node provided')
  if (!quoteId) throw new Error('No quoteId provided')

  const html2canvas = await loadHtml2Canvas()
  const JsPDF       = await loadJsPdf()

  // ── Force A4 portrait proportions before rasterizing. ──
  // 794px = A4 width @ 96dpi. We clone the renderer DOM into an
  // off-screen wrapper sized to that width, let the layout engine
  // re-flow the content, then capture. Off-screen positioning means
  // the user never sees the clone flash onto their screen.
  const A4_WIDTH_PX = 794
  const wrapper = document.createElement('div')
  wrapper.style.position = 'fixed'
  wrapper.style.left     = '-100000px'
  wrapper.style.top      = '0'
  wrapper.style.width    = `${A4_WIDTH_PX}px`
  wrapper.style.background = '#ffffff'
  wrapper.style.padding  = '0'
  wrapper.style.zIndex   = '-1'
  wrapper.appendChild(domNode.cloneNode(true))
  document.body.appendChild(wrapper)

  let canvas
  try {
    canvas = await html2canvas(wrapper, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      width:       A4_WIDTH_PX,
      windowWidth: A4_WIDTH_PX,
      logging: false,
    })
  } finally {
    document.body.removeChild(wrapper)
  }

  const imgData = canvas.toDataURL('image/jpeg', 0.92)

  // A4 portrait: 210 x 297 mm. We compute the image's aspect-correct
  // height when scaled to fit page width, then slice if it overflows.
  const pageWidthMm  = 210
  const pageHeightMm = 297
  const pdf = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  const pxPerMm  = canvas.width / pageWidthMm
  const pageHpx  = Math.floor(pageHeightMm * pxPerMm)

  let remaining = canvas.height
  let yOffsetPx = 0
  let isFirstPage = true

  while (remaining > 0) {
    const sliceHpx = Math.min(pageHpx, remaining)
    // Phase 11d (rev7) — skip a trailing slice that's < 10% of a page
    // tall AND not the first page. Margin/border/line-height rounding
    // routinely produces a 5-50px overflow past the last "real" page,
    // which used to become a near-blank trailing page in the PDF. 10%
    // threshold catches all rounding artifacts; legit content needs
    // at least ~30% of a page, so this never drops real text.
    if (!isFirstPage && sliceHpx < pageHpx * 0.10) {
      break
    }
    if (!isFirstPage) pdf.addPage()
    isFirstPage = false

    // For the slice, draw the source canvas onto a temp canvas then
    // dump just that slice as JPEG. Avoids putting the whole image in
    // memory N times.
    const slice = document.createElement('canvas')
    slice.width  = canvas.width
    slice.height = sliceHpx
    slice.getContext('2d').drawImage(
      canvas,
      0, yOffsetPx, canvas.width, sliceHpx,
      0, 0,         canvas.width, sliceHpx,
    )
    const sliceData = slice.toDataURL('image/jpeg', 0.92)

    const sliceMm = sliceHpx / pxPerMm
    pdf.addImage(sliceData, 'JPEG', 0, 0, pageWidthMm, sliceMm, undefined, 'FAST')

    yOffsetPx += sliceHpx
    remaining -= sliceHpx
  }

  const blob = pdf.output('blob')
  const file = new File([blob], 'proposal-letter.pdf', { type: 'application/pdf' })

  // Storage path: `<quote_id>/00-proposal-letter.pdf` — prefix 00 sorts
  // it first if anyone lists by name. Distinct from the user-uploaded
  // checklist items which use 01..NN prefixes.
  const path = pathFor(quoteId, '00', 'proposal-letter', 'pdf')
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      upsert: true,
      contentType: 'application/pdf',
      cacheControl: '3600',
    })
  if (error) throw error

  return { path, sizeBytes: blob.size }
}

// ─────────────────────────────────────────────────────────────────────
// 4. Combined PDF merger (run on Download Combined PDF)
// ─────────────────────────────────────────────────────────────────────

// Build a single PDF from N inputs. Each input is either:
//   { kind: 'pdf',   data: ArrayBuffer }        — embed all pages
//   { kind: 'image', data: Uint8Array, mime }   — embed as one page
//
// Returns a Uint8Array of the combined PDF.
export async function buildCombinedPdf(inputs) {
  const { PDFDocument } = await loadPdfLib()
  const out = await PDFDocument.create()

  for (const input of inputs) {
    if (!input || !input.data) continue
    if (input.kind === 'pdf') {
      try {
        const src = await PDFDocument.load(input.data, { ignoreEncryption: true })
        const pages = await out.copyPages(src, src.getPageIndices())
        pages.forEach(p => out.addPage(p))
      } catch (e) {
        // A corrupt / encrypted PDF shouldn't blow up the whole merge —
        // skip it and continue. The UI will note which slots failed.
        console.warn('[buildCombinedPdf] failed to merge a PDF:', e.message)
        continue
      }
    } else if (input.kind === 'image') {
      try {
        const isPng  = (input.mime || '').toLowerCase().includes('png')
        const embed  = isPng ? await out.embedPng(input.data) : await out.embedJpg(input.data)
        // Letter-size page sized to fit the image proportions.
        const PAGE_W = 595, PAGE_H = 842 // A4 in points (72dpi)
        const ratio  = embed.width / embed.height
        const page   = out.addPage([PAGE_W, PAGE_H])
        let drawW = PAGE_W - 40   // 20pt margin each side
        let drawH = drawW / ratio
        if (drawH > PAGE_H - 40) {
          drawH = PAGE_H - 40
          drawW = drawH * ratio
        }
        page.drawImage(embed, {
          x: (PAGE_W - drawW) / 2,
          y: (PAGE_H - drawH) / 2,
          width:  drawW,
          height: drawH,
        })
      } catch (e) {
        console.warn('[buildCombinedPdf] failed to merge an image:', e.message)
        continue
      }
    }
  }

  return await out.save() // Uint8Array
}

// Convenience: trigger a browser download of a Uint8Array as a PDF.
export function downloadPdfBlob(uint8, filename = 'combined.pdf') {
  const blob = new Blob([uint8], { type: 'application/pdf' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 0)
}

// Helper used by the combined-PDF flow: given a stored file's path,
// download it and classify as pdf / image so buildCombinedPdf can
// handle it. Unknown types are skipped (returns null).
export async function fetchAsMergeInput(path) {
  if (!path) return null
  const buf = await downloadAsArrayBuffer(path)
  const ext = (path.split('.').pop() || '').toLowerCase()
  if (ext === 'pdf') return { kind: 'pdf', data: buf }
  if (ext === 'png') return { kind: 'image', data: new Uint8Array(buf), mime: 'image/png' }
  if (['jpg', 'jpeg'].includes(ext)) return { kind: 'image', data: new Uint8Array(buf), mime: 'image/jpeg' }
  // webp / bmp / etc. — pdf-lib can't embed these natively, skip.
  return null
}
