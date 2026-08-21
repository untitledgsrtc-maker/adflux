# quote-render-service

Headless-Chromium render service for the AdFlux AI real-PDF pipeline (Phase 326).

A **separate Vercel project** (isolated from the main app's 12-serverless-fn budget,
§219). One Node function, `api/render.js`:

`POST { ref }` + header `x-render-secret: <RENDER_SECRET>` →
puppeteer-core + @sparticuz/chromium opens `APP_BASE_URL/quote-print/<ref>?t=<RENDER_SECRET>`
in a real browser → `page.pdf()` → uploads the branded multi-page quote PDF to Supabase
`quote-pdfs/<ref>.pdf` → returns a 600s signed URL. The WhatsApp AI (`api/wa/ai-reply.js`)
sends that URL as the WhatsApp document.

## Deploy (Vercel)
- Import the `adflux` repo, **Root Directory** = `adflux/quote-render-service`.
- **Production branch** = `untitled-os` (Settings → Environments → Production).
- Framework preset: **Other**. Function: 1024 MB memory, 60 s max duration (`vercel.json`).

## Env (Production)
| Name | Value |
|---|---|
| `SUPABASE_URL` | the Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | the service_role secret (never the publishable key) |
| `APP_BASE_URL` | `https://app.untitledad.in` |
| `RENDER_SECRET` | shared secret; the SAME value on the main app's `RENDER_SECRET` |

On the main app project, set `QUOTE_RENDER_URL` = `<this project>/api/render` + the same
`RENDER_SECRET` to flip the AI onto the real PDF (unset → the pdf-lib fallback, zero-regression).
