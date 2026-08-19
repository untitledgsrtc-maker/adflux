// api/quote/render.js — EDGE runtime (Phase 2 · AI standard-rate quote renderer).
// ─────────────────────────────────────────────────────────────────────────
// Renders a PRIVATE-LED quote to a real A4 PDF server-side and uploads it to
// quote-pdfs/<ref>.pdf, then returns a short-lived signed URL. The WhatsApp AI
// (api/wa/ai-reply.js) calls this after ai_build_quote() creates the quote, then
// sends the signed URL to the customer as a WhatsApp document. `/api/pdf/<ref>`
// only redirects to a STORED file (it never renders) — an AI-made quote has no
// stored PDF until this writes one.
//
// WHY EDGE + pdf-lib: the Vercel Hobby plan caps a deploy at 12 Node functions
// and we're AT the limit (§219) — a Node renderer would break every deploy AND
// force consolidating a live campaign endpoint. Edge fns don't count. pdf-lib is
// pure-JS (already a dep, v1.17), StandardFonts Helvetica needs no fontkit/wasm,
// and we use "Rs." (not the ₹ glyph, which WinAnsi can't encode) — so it renders
// on the Edge runtime with no Node built-ins and no consolidation.
//
// §4 two-company: the letterhead (name / GSTIN / bank) is read from the
// `companies` row where segment='PRIVATE'. NEVER hardcoded; if the row or a
// required field is missing we HARD-FAIL (no silent fallback).
//
// SECURITY: secret-gated (x-render-secret == AI_REPLY_SECRET — the only caller is
// ai-reply.js on the same deploy). Loads the quote by ref via the service key.
//
// Env: SUPABASE_URL (||VITE_) + SUPABASE_SERVICE_ROLE_KEY + AI_REPLY_SECRET.
// ─────────────────────────────────────────────────────────────────────────

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export const config = { runtime: 'edge' }

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const AI_SECRET    = process.env.AI_REPLY_SECRET

const j = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })

const sb = (path, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', ...(init.headers || {}) },
})

// ── INR amount → Indian words (inlined from src/utils/numberToWords.js, §18) ──
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
const two3 = (n) => (n < 20 ? ONES[n] : (n % 10 === 0 ? TENS[Math.floor(n / 10)] : `${TENS[Math.floor(n / 10)]}-${ONES[n % 10]}`))
const three3 = (n) => { const h = Math.floor(n / 100), r = n % 100; if (!h) return two3(r); return r ? `${ONES[h]} Hundred ${two3(r)}` : `${ONES[h]} Hundred` }
function rupeesToWords(amount) {
  const rupees = Math.floor(Math.abs(Number(amount) || 0))
  if (rupees === 0) return 'Zero Rupees Only'
  const crore = Math.floor(rupees / 10000000), lakh = Math.floor((rupees % 10000000) / 100000), thousand = Math.floor((rupees % 100000) / 1000), rest = rupees % 1000
  const parts = []
  if (crore) parts.push(`${two3(crore)} Crore`)
  if (lakh) parts.push(`${two3(lakh)} Lakh`)
  if (thousand) parts.push(`${two3(thousand)} Thousand`)
  if (rest) parts.push(three3(rest))
  return parts.join(' ').trim() + ' Rupees Only'
}

// Indian-grouped rupee string, prefixed "Rs. " (Helvetica has no ₹ glyph).
const inr = (n) => 'Rs. ' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })

export default async function handler(req) {
  if (req.method !== 'POST') return j({ ok: false, error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY || !AI_SECRET) return j({ ok: false, error: 'not_configured' }, 503)
  if (String(req.headers.get('x-render-secret') || '') !== AI_SECRET) return j({ ok: false, error: 'forbidden' }, 403)

  let body
  try { body = await req.json() } catch { return j({ ok: false, error: 'bad_body' }, 400) }
  const ref = String(body?.ref || '')
  // ref is interpolated into a PostgREST filter + a storage path → allow only the
  // ref-format charset (UA-2026-NNNN etc). Rejects anything that could inject.
  if (!ref || !/^[A-Za-z0-9/_-]{4,40}$/.test(ref)) return j({ ok: false, error: 'bad_ref' }, 400)
  const safeRef = ref.replace(/[^A-Za-z0-9_-]/g, '_')

  try {
    // ── load the quote (must be an ai_quote / PRIVATE LED) + its city lines ──
    const quote = (await (await sb(`quotes?quote_number=eq.${encodeURIComponent(ref)}&select=id,quote_number,segment,client_name,client_company,client_phone,sales_person_name,duration_months,subtotal,gst_amount,total_amount,created_at&limit=1`)).json())?.[0]
    if (!quote) return j({ ok: false, error: 'quote_not_found' }, 404)
    if (quote.segment === 'GOVERNMENT') return j({ ok: false, error: 'govt_not_supported' }, 400)  // §4 — govt uses GovtProposalRenderer

    const cities = (await (await sb(`quote_cities?quote_id=eq.${quote.id}&select=city_name,screens,offered_rate,campaign_total,duration_months&order=campaign_total.desc`)).json()) || []
    if (!cities.length) return j({ ok: false, error: 'no_cities' }, 400)

    // ── §4 letterhead: the PRIVATE company row (hard-fail if missing) ──
    const co = (await (await sb(`companies?segment=eq.PRIVATE&is_active=eq.true&select=name,short_name,address_line,city,state,pincode,gstin,pan,phone,email,website,bank_name,bank_branch,bank_acc_name,bank_acc_number,bank_ifsc&limit=1`)).json())?.[0]
    // §4/§18 HARD-FAIL: a PRIVATE quotation PDF MUST carry name + GSTIN + bank
    // details — never silently ship a GSTIN-less / bank-less quote. Name the
    // missing field so Master → Companies can be fixed.
    if (!co || !co.name)                       return j({ ok: false, error: 'company_row_missing' }, 500)
    if (!co.gstin)                             return j({ ok: false, error: 'company_gstin_missing' }, 500)
    if (!co.bank_acc_number || !co.bank_ifsc)  return j({ ok: false, error: 'company_bank_missing' }, 500)

    const months = Number(quote.duration_months) || 1
    // Explicit null checks (not `|| fallback`): a legitimate 0 must survive.
    const subtotal = quote.subtotal != null ? Number(quote.subtotal) : cities.reduce((s, c) => s + (Number(c.campaign_total) || 0), 0)
    const gst = quote.gst_amount != null ? Number(quote.gst_amount) : Math.round(subtotal * 0.18)
    const total = quote.total_amount != null ? Number(quote.total_amount) : subtotal + gst

    // ── render (A4 portrait, day-theme palette §9, "Rs." labels) ──
    const doc = await PDFDocument.create()
    const page = doc.addPage([595.28, 841.89])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const bold = await doc.embedFont(StandardFonts.HelveticaBold)
    const navy = rgb(0.047, 0.071, 0.141)   // ~#0c1224
    const grey = rgb(0.29, 0.33, 0.45)       // ~#4a5474
    const line = rgb(0.89, 0.9, 0.93)        // ~#e3e6ee
    const yellow = rgb(1, 0.902, 0)          // #FFE600
    const soft = rgb(0.972, 0.976, 0.988)    // ~#f8f9fc

    const L = 40, R = 555.28, W = R - L
    // ASCII-only: pdf-lib StandardFonts encode WinAnsi and THROW on any char they
    // can't map (Gujarati/Devanagari/emoji in a WhatsApp client name, ₹, C1 controls).
    // Strip to printable ASCII so drawText can never throw — money uses "Rs." anyway.
    const safe = (t) => String(t == null ? '' : t).replace(/[^\x20-\x7E]/g, '').trim()
    const T = (t, x, y, s, f = font, c = navy) => { const str = safe(t); if (str) page.drawText(str, { x, y, size: s, font: f, color: c }) }
    const TR = (t, xr, y, s, f = font, c = navy) => { const str = safe(t); if (str) page.drawText(str, { x: xr - f.widthOfTextAtSize(str, s), y, size: s, font: f, color: c }) }
    const HR = (y, c = line, th = 1) => page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: th, color: c })

    let y = 802
    page.drawRectangle({ x: L, y: y - 2, width: 4, height: 34, color: yellow })   // brand accent
    T(co.name, L + 12, y + 16, 17, bold, navy)
    const addr = [co.address_line, [co.city, co.state, co.pincode].filter(Boolean).join(', ')].filter(Boolean).join('   |   ')
    T(addr, L + 12, y + 3, 8.5, font, grey)
    T([co.gstin && `GSTIN: ${co.gstin}`, co.phone && `Ph: ${co.phone}`, co.email].filter(Boolean).join('    '), L + 12, y - 9, 8.5, font, grey)

    y = 760; HR(y, yellow, 1.5)
    y -= 24
    T('QUOTATION', L, y, 15, bold, navy)
    const dt = new Date(quote.created_at || Date.now())
    const dstr = `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${dt.getUTCFullYear()}`
    TR(`Ref: ${quote.quote_number}`, R, y + 4, 10, bold, navy)
    TR(`Date: ${dstr}`, R, y - 9, 8.5, font, grey)

    y -= 34
    T('To', L, y, 8.5, bold, grey)
    // safe()-first so a fully non-ASCII (e.g. Gujarati) client name doesn't render blank.
    const clientName = safe(quote.client_name) || safe(quote.client_company) || 'Customer'
    T(clientName, L, y - 13, 11, bold, navy)
    T([quote.client_company && quote.client_company !== quote.client_name ? quote.client_company : null, quote.client_phone].filter(Boolean).join('   |   '), L, y - 26, 9, font, grey)

    // ── line-item table ──
    y -= 52
    const cX = L + 8, sX = 300, rX = 410, mX = 448, aX = R - 8   // right edges for numeric cols
    page.drawRectangle({ x: L, y: y - 4, width: W, height: 20, color: navy })
    T('City / Station (all screens)', cX, y + 2, 8.5, bold, rgb(1, 1, 1))
    TR('Screens', sX, y + 2, 8.5, bold, rgb(1, 1, 1))
    TR('Rate/screen/mo', rX, y + 2, 8.5, bold, rgb(1, 1, 1))
    TR('Mo.', mX, y + 2, 8.5, bold, rgb(1, 1, 1))
    TR('Amount', aX, y + 2, 8.5, bold, rgb(1, 1, 1))
    y -= 4
    let alt = false
    for (const c of cities) {
      y -= 20
      if (alt) page.drawRectangle({ x: L, y: y - 4, width: W, height: 20, color: soft })
      alt = !alt
      const cm = Number(c.duration_months) || months
      T(c.city_name || '—', cX, y + 2, 9.5, font, navy)
      TR(c.screens || 0, sX, y + 2, 9.5, font, navy)
      TR(inr(c.offered_rate), rX, y + 2, 9.5, font, navy)
      TR(cm, mX, y + 2, 9.5, font, navy)
      TR(inr(c.campaign_total), aX, y + 2, 9.5, bold, navy)
    }
    y -= 4; HR(y, line, 1)

    // ── totals (right block) ──
    const totLabelX = 400
    y -= 20; TR('Subtotal', totLabelX, y + 2, 9.5, font, grey); TR(inr(subtotal), aX, y + 2, 9.5, font, navy)
    y -= 16; TR('GST (18%)', totLabelX, y + 2, 9.5, font, grey); TR(inr(gst), aX, y + 2, 9.5, font, navy)
    y -= 8; page.drawRectangle({ x: totLabelX - 6, y: y - 18, width: aX - (totLabelX - 6), height: 22, color: yellow })
    y -= 6; TR('Total', totLabelX, y, 11, bold, navy); TR(inr(total), aX, y, 11, bold, navy)

    // ── total in words ──
    y -= 30
    T('Amount in words', L, y, 8.5, bold, grey)
    T(rupeesToWords(total), L, y - 13, 9.5, font, navy)

    // ── bank details ──
    if (co.bank_name || co.bank_acc_number) {
      y -= 40
      HR(y + 8, line, 1)
      T('Bank details', L, y, 8.5, bold, grey)
      const bl = [
        co.bank_acc_name && `A/c Name: ${co.bank_acc_name}`,
        co.bank_name && `Bank: ${co.bank_name}${co.bank_branch ? ` (${co.bank_branch})` : ''}`,
        co.bank_acc_number && `A/c No: ${co.bank_acc_number}`,
        co.bank_ifsc && `IFSC: ${co.bank_ifsc}`,
      ].filter(Boolean)
      bl.forEach((t, i) => T(t, L, y - 13 - i * 12, 8.5, font, navy))
    }

    // ── footer ──
    T('Standard quotation · GSRTC LED Network · valid 15 days · this is a system-generated estimate; taxes as applicable.', L, 42, 7.5, font, grey)
    if (co.website) T(co.website, L, 30, 7.5, font, grey)

    const bytes = await doc.save()

    // ── upload (upsert) to quote-pdfs/<ref>.pdf ──
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/quote-pdfs/${safeRef}.pdf`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/pdf', 'x-upsert': 'true', 'cache-control': 'no-cache' },
      body: bytes,
    })
    if (!up.ok) {
      const et = await up.text().catch(() => '')
      return j({ ok: false, error: 'upload_failed', detail: et.slice(0, 200) }, 502)
    }

    // ── short-lived signed URL (Meta fetches it immediately) ──
    const sg = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/quote-pdfs/${safeRef}.pdf`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ expiresIn: 600 }),
    })
    const sd = await sg.json().catch(() => ({}))
    if (!sg.ok || !sd?.signedURL) return j({ ok: false, error: 'sign_failed' }, 502)

    return j({ ok: true, ref: quote.quote_number, url: `${SUPABASE_URL}/storage/v1${sd.signedURL}`, filename: `${safeRef}.pdf` })
  } catch (e) {
    return j({ ok: false, error: 'render_error', detail: String(e?.message || e).slice(0, 200) }, 500)
  }
}
