// quote-render-service/api/render.js — Node runtime (2nd Vercel project).
// ─────────────────────────────────────────────────────────────────────────
// The ONLY function in this isolated project. Renders the app's login-less
// /quote-print/<ref> page in a REAL headless Chromium (crisp, native, vector
// text — the exact branded QuotePDFHtml design), page.pdf()s it into a
// multi-page A4 PDF, uploads it to Supabase quote-pdfs/<ref>.pdf (the same
// path the rep's uploadQuotePDFHtml uses, so the stable app.untitledad.in/pdf/
// <ref> link keeps working), and returns a short-lived signed URL for the
// WhatsApp AI to send as a document.
//
// WHY A SEPARATE PROJECT: Chromium needs a Node fn + ~1GB memory. The main app
// is AT the Vercel Hobby 12-serverless-fn cap (§219) — adding this there would
// break every app deploy. Its own project = its own 12-fn budget + isolated
// deploys; a slow cold-start here can never affect the live app.
//
// SECURITY: secret-gated (x-render-secret == RENDER_SECRET). The only caller is
// the app's api/wa/ai-reply.js (server-to-server). The print page it navigates
// to is itself token-gated (?t=RENDER_SECRET → /api/quote-render-data 403s
// without it), so the quote financials are never exposed to a real browser.
//
// Env (owner sets on THIS project): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// APP_BASE_URL (= https://app.untitledad.in), RENDER_SECRET (same value the
// app uses).
// ─────────────────────────────────────────────────────────────────────────

import chromium, { setupLambdaEnvironment } from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const SUPABASE_URL  = process.env.SUPABASE_URL
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY
const APP_BASE_URL  = (process.env.APP_BASE_URL || 'https://app.untitledad.in').replace(/\/+$/, '')
const RENDER_SECRET = process.env.RENDER_SECRET

const A4_W = '794px'
const A4_H = '1123px'

function send(res, status, obj) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(obj))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' })
  if (!SUPABASE_URL || !SERVICE_KEY || !RENDER_SECRET) return send(res, 503, { ok: false, error: 'not_configured' })
  if (String(req.headers['x-render-secret'] || '') !== RENDER_SECRET) return send(res, 403, { ok: false, error: 'forbidden' })

  // body may arrive parsed (Vercel) or as a stream — handle both.
  let body = req.body
  if (!body || typeof body === 'string') {
    try { body = JSON.parse(body || '{}') } catch { body = {} }
  }
  const ref = String(body?.ref || '')
  if (!ref || !/^[A-Za-z0-9/_-]{4,40}$/.test(ref)) return send(res, 400, { ok: false, error: 'bad_ref' })
  const safeRef = ref.replace(/[^A-Za-z0-9_-]/g, '_')

  let browser
  try {
    // Extract the bundled Chromium binary + its shared libs to /tmp.
    const execPath = await chromium.executablePath()
    // Vercel isn't detected as AWS Lambda, so @sparticuz/chromium's auto
    // env-setup is skipped → the child process can't find libnss3.so etc.
    // Call it explicitly to prepend the extracted lib dir to LD_LIBRARY_PATH.
    setupLambdaEnvironment(join(tmpdir(), 'al2023', 'lib'))
    browser = await puppeteer.launch({
      args: await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
      executablePath: execPath,
      headless: 'shell',
      defaultViewport: { width: 794, height: 1123, deviceScaleFactor: 2 },
    })
    const page = await browser.newPage()
    await page.emulateMediaType('screen')

    const printUrl = `${APP_BASE_URL}/quote-print/${encodeURIComponent(ref)}?t=${encodeURIComponent(RENDER_SECRET)}`
    await page.goto(printUrl, { waitUntil: 'networkidle0', timeout: 45000 })

    // wait for the print page's readiness handshake (data fetched + DOM built)
    await page.waitForFunction(
      () => ['1', 'error'].includes(document.documentElement.getAttribute('data-quote-ready')),
      { timeout: 25000 },
    )
    const ready = await page.evaluate(() => document.documentElement.getAttribute('data-quote-ready'))
    if (ready !== '1') { await browser.close(); return send(res, 502, { ok: false, error: 'quote_page_error' }) }

    // fonts + every image (letterhead bg, city photos, thank-you) fully loaded
    await page.evaluate(async () => {
      try { await (document.fonts && document.fonts.ready) } catch { /* ignore */ }
      const imgs = Array.from(document.images)
      await Promise.all(imgs.map((img) => (
        (img.complete && img.naturalWidth > 0)
          ? Promise.resolve()
          : new Promise((r) => {
              img.addEventListener('load', r, { once: true })
              img.addEventListener('error', r, { once: true })
              setTimeout(r, 5000)
            })
      )))
    })

    const pdf = await page.pdf({
      width: A4_W,
      height: A4_H,
      printBackground: true,
      preferCSSPageSize: false,
      pageRanges: '',
    })
    await browser.close()
    browser = null

    // ── upload (upsert) to quote-pdfs/<ref>.pdf (same path as the rep flow) ──
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/quote-pdfs/${safeRef}.pdf`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'content-type': 'application/pdf',
        'x-upsert': 'true',
        'cache-control': 'no-cache',
      },
      body: Buffer.from(pdf),
    })
    if (!up.ok) {
      const et = await up.text().catch(() => '')
      return send(res, 502, { ok: false, error: 'upload_failed', detail: et.slice(0, 200) })
    }

    // ── short-lived signed URL (Meta fetches the document immediately) ──
    const sg = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/quote-pdfs/${safeRef}.pdf`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ expiresIn: 600 }),
    })
    const sd = await sg.json().catch(() => ({}))
    if (!sg.ok || !sd?.signedURL) return send(res, 502, { ok: false, error: 'sign_failed' })

    return send(res, 200, { ok: true, ref, url: `${SUPABASE_URL}/storage/v1${sd.signedURL}`, filename: `${safeRef}.pdf` })
  } catch (e) {
    try { if (browser) await browser.close() } catch { /* ignore */ }
    return send(res, 500, { ok: false, error: 'render_error', detail: String(e?.message || e).slice(0, 200) })
  }
}
