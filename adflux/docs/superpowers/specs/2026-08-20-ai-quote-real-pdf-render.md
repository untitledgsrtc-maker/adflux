# AI quote → real branded PDF (server-side Chromium render)

**Date:** 2026-08-20
**Goal:** When the WhatsApp AI auto-sends a quote (Phase 2 §210), the customer gets the
**exact 3-page branded PDF** the rep downloads from the app (`QuotePDFHtml`: logo,
AT-A-GLANCE cards, grade/slots columns, CPM, ₹, **photo page + thankyou page**, both-offices
footer) — NOT the current plain pdf-lib text render (`api/quote/render.js`).

## Why not just reuse the existing PDF system
The real PDF (`QuotePDFHtml.renderToPdfBlob`) renders via **html2canvas in a browser** on a
rep's device. The AI runs **server-side (Edge, no browser)** → can't run html2canvas. §210
built the plain pdf-lib renderer for exactly this. To get the real format server-side we
must run the real markup through a **headless Chromium** (`page.pdf()`), which reuses the
design 100% and is crisper than html2canvas (vector text, not raster).

## Owner decision (locked 2026-08-20)
- Approach: **instant AI-send + real format** via server-side Chromium.
- Host: **2nd Vercel project** (separate deploy — Chromium is a heavy Node process that would
  break the app's §219 12-serverless-fn cap and risk the live app's deploys). Owner deploys
  it; I write all code.

## Architecture — 5 pieces (reuse the exact `QuotePDFHtml` design)

### 1. `api/quote-render-data.js` — NEW **Edge** fn (free, no §219 cap)
`GET ?ref=<quote_number>&t=<RENDER_SECRET>` → validate secret (env, fail-closed) →
**service-role** raw-fetch (bypasses RLS) → returns `{ quote, cities, company }` JSON in the
same shapes `fetchCompanyForQuote` + `enrichCitiesWithPhotos` produce today (company by
`segment`: name/GSTIN/bank/offices/`letterhead_url`/`thank_you_url`; cities with
`photo_url` + `impressions_month`). Token-gated; same trust model as `AI_REPLY_SECRET` (§115)
— exposes only what the PDF itself shows. Edge → does NOT count toward the 12-Node cap.

### 2. Export from `QuotePDFHtml.jsx` (additive — zero behaviour change)
`export` the section components + helpers the print doc needs: `QuotePage`,
`QuotePDFHtmlDocument`, `CityPhotoPage`, `ThankYouPage`, `paginateCities`,
`enrichCitiesWithPhotos`, `A4_WIDTH_PX`, `A4_HEIGHT_PX`. The rep's `uploadQuotePDFHtml` /
`downloadQuotePDFHtml` html2canvas path is **untouched** (§44.10 money flow — parse-check
only, no logic change).

### 3. `/quote-print/:ref` route + `QuotePrintDoc.jsx` — NEW, login-less public route
Bare page (no `V2AppShell`, no `RequireAuth` — like `/led` / `/present`, §77): reads `ref` +
`t` from the URL → fetches `/api/quote-render-data` → renders the SAME sections as one A4
print document with real page-breaks:
```
letterheadOn ? paginateCities(cities).map(p => <div.a4page><QuotePage .../></div>)
             : <div.a4page><QuotePDFHtmlDocument .../></div>
cities.filter(photo_url).map(c => <div.a4page><CityPhotoPage city={c}/></div>)
thank_you_url && <div.a4page><ThankYouPage url=.../></div>
```
CSS: `@page{size:794px 1123px;margin:0}` + `.a4page{width:794px;height:1123px;overflow:hidden;
page-break-after:always}` — 794px = A4@96dpi, the same fixed width the components already
use. Chromium prints each section at exactly A4. Data-driven, no login, gated by `?t`.

### 4. `quote-render-service/` — NEW **2nd Vercel project** (owner deploys)
One Node fn `api/render.js`: `POST {ref}` + `x-render-secret` → `puppeteer-core` +
`@sparticuz/chromium` → `page.goto(APP_BASE_URL/quote-print/<ref>?t=RENDER_SECRET)` → wait
`document.fonts.ready` + all `<img>` loaded → `page.pdf({width:'794px',height:'1123px',
printBackground:true})` → upload to Supabase `quote-pdfs/<ref>.pdf` (service-role, upsert,
cacheControl 60 — same path/opts as `uploadQuotePDFHtml` §44.9 so the stable
`app.untitledad.in/pdf/<ref>` link keeps working) → return `{ url }`. Its own `package.json`,
`vercel.json`, envs. Isolated 12-fn budget → cannot affect the app's deploys.

### 5. Wire `api/wa/ai-reply.js` (Edge, LIVE on both AI numbers — additive, best-effort)
After `ai_build_quote` returns a `ref`: `POST QUOTE_RENDER_URL {ref}` with `x-render-secret`
→ on `{url}` send it as the WhatsApp document (replaces the `api/quote/render.js` pdf-lib call
for the AI path). **Fallback:** on any error/timeout (service down, cold-start slow) →
fall back to the existing pdf-lib render → the AI **never ghosts, never breaks** (§45/§46).
Whole block try/caught; the text reply always sends regardless.

## Env (owner sets)
- **Main app (Vercel):** `RENDER_SECRET` (for `/api/quote-render-data` + ai-reply to call the
  service), `QUOTE_RENDER_URL` (the 2nd project's `/api/render` URL).
- **2nd project (Vercel):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_BASE_URL`
  (= `https://app.untitledad.in`), `RENDER_SECRET` (same value).

## Zero-regression deploy order (§45)
1. Ship pieces 1-3 + 5 to the app (the AI keeps sending the **plain** pdf-lib PDF because
   `QUOTE_RENDER_URL` is unset → the fallback path fires; nothing changes for the customer).
2. Owner deploys the 2nd project (piece 4) + sets envs.
3. Owner sets `QUOTE_RENDER_URL` + `RENDER_SECRET` on the app → the AI starts sending the
   **real** PDF. Instant switch, reversible (unset `QUOTE_RENDER_URL` → back to pdf-lib).

## Frozen-surface notes
- `App.jsx` (§28 frozen): additive public route only (§10 specific-before-param, no shadow) →
  guardian PASS required.
- `QuotePDFHtml.jsx`: money flow (§44.10), not §28-frozen — additive exports only, no logic
  change; the rep html2canvas path byte-unchanged.
- `api/wa/ai-reply.js`: Edge, LIVE — additive best-effort call + fallback; text path preserved.

## Testing
- Print route renders standalone (open `/quote-print/<ref>?t=` in a browser → matches the
  507 KB download, all 3 pages).
- Render service returns a valid multi-page PDF for a real ref.
- AI end-to-end: message the number, get a quote → the WhatsApp document is the branded PDF;
  kill the service → the AI falls back to the plain PDF (never ghosts).

## Not in scope
- Changing the quote MATH (`ai_build_quote` §210 is correct — verified same numbers).
- Touching the rep's app download/share flow.
- The quotes/leads "won this month" filter fix (separate, parked on the owner's A/B/C call).
