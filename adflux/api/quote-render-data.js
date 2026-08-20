// api/quote-render-data.js — EDGE runtime (AI real-PDF · data endpoint).
// ─────────────────────────────────────────────────────────────────────────
// Token-gated JSON feed for the login-less /quote-print/:ref page. The
// headless-Chromium render service (a 2nd Vercel project) navigates a real
// browser to /quote-print/<ref>?t=<RENDER_SECRET>; that page fetches THIS
// endpoint (same origin) to get { quote, cities, company } and renders the
// EXACT QuotePDFHtml components, which the service then page.pdf()s into the
// real branded 3-page PDF (letterhead + AT-A-GLANCE + per-city photo page +
// thank-you page). The WhatsApp AI (api/wa/ai-reply.js) auto-sends that PDF.
//
// WHY EDGE: the app is AT the Vercel Hobby 12-serverless-Node-fn cap (§219);
// a Node fn here breaks every deploy. Edge fns don't count. This does no
// rendering — just a service-role read + a photo join — so no Node built-ins
// are needed.
//
// SHAPES: mirrors what the rep's client renderer builds — fetchCompanyForQuote
// (companies by segment) + enrichCitiesWithPhotos (cities.photo_url joined onto
// quote_cities.city_id). So the print page renders identically to a rep download.
//
// SECURITY: secret-gated (t == RENDER_SECRET, an env server-secret — the same
// trust model as api/quote/render.js §210). The print page is only ever loaded
// by the server-side headless browser, never a real user; a user hitting it
// without the secret gets 403 here → the page shows "unauthorized". Exposes only
// what the PDF itself prints. §4: PRIVATE quotes only (govt uses GovtProposalRenderer).
//
// Env: SUPABASE_URL (||VITE_) + SUPABASE_SERVICE_ROLE_KEY + RENDER_SECRET.
// ─────────────────────────────────────────────────────────────────────────

export const config = { runtime: 'edge' }

const SUPABASE_URL  = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY
const RENDER_SECRET = process.env.RENDER_SECRET

const j = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
})

const sb = (path, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', ...(init.headers || {}) },
})

export default async function handler(req) {
  if (!SUPABASE_URL || !SERVICE_KEY || !RENDER_SECRET) return j({ ok: false, error: 'not_configured' }, 503)

  const url = new URL(req.url)
  const ref = String(url.searchParams.get('ref') || '')
  const t   = String(url.searchParams.get('t') || '')

  if (t !== RENDER_SECRET) return j({ ok: false, error: 'forbidden' }, 403)
  // ref is interpolated into PostgREST filters — allow only the ref-format
  // charset (UA-2026-NNNN, UA/AUTO/2026-27/NNNN, etc). Rejects injection.
  if (!ref || !/^[A-Za-z0-9/_-]{4,40}$/.test(ref)) return j({ ok: false, error: 'bad_ref' }, 400)

  try {
    // ── the quote (select * — the renderer reads many columns) ──
    const quote = (await (await sb(`quotes?quote_number=eq.${encodeURIComponent(ref)}&select=*&limit=1`)).json())?.[0]
    if (!quote) return j({ ok: false, error: 'quote_not_found' }, 404)
    if (quote.segment === 'GOVERNMENT') return j({ ok: false, error: 'govt_not_supported' }, 400)

    // ── city lines (stable order) ──
    const cities = (await (await sb(`quote_cities?quote_id=eq.${quote.id}&select=*&order=id.asc`)).json()) || []

    // ── enrich with the master photo_url (mirrors enrichCitiesWithPhotos) ──
    const ids = [...new Set(cities.map(c => c.city_id).filter(Boolean))]
    let photoMap = {}
    if (ids.length) {
      const inList = ids.map(encodeURIComponent).join(',')
      const master = (await (await sb(`cities?id=in.(${inList})&select=id,photo_url`)).json())
      if (Array.isArray(master)) photoMap = Object.fromEntries(master.map(m => [m.id, m.photo_url]))
    }
    const enriched = cities.map(c => ({
      ...c,
      photo_url: c.photo_url || photoMap[c.city_id] || null,
    }))

    // ── §4 letterhead company by segment (select *) ──
    const seg = quote.segment === 'GOVERNMENT' ? 'GOVERNMENT' : 'PRIVATE'
    const company = (await (await sb(`companies?segment=eq.${seg}&is_active=eq.true&select=*&limit=1`)).json())?.[0] || null

    return j({ ok: true, quote, cities: enriched, company })
  } catch (e) {
    return j({ ok: false, error: 'data_error', detail: String(e?.message || e).slice(0, 200) }, 500)
  }
}
