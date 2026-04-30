# Gujarati PDF Render PoC

Goal: prove that Chromium's HarfBuzz shaper renders every conjunct that broke the previous docx-based pipeline, **before** we commit to building the full template set.

## Run it

```bash
cd pdf-poc
npm install            # downloads regular puppeteer (full Chromium ~170 MB) + @sparticuz/chromium
npm run render:local   # → out/poc-local.pdf
npm run render:vercel  # → out/poc-vercel.pdf  (production binary, runs slow on macOS)
```

Then open `out/poc-local.pdf` and **inspect Section 1**. The pass criteria:

- `ક્ષેત્રે` renders as a single connected ligature, not `ક્` + `ષ`
- `સ્વચ્છ` shows the chh conjunct correctly, no visible halant (the trailing dot under a consonant)
- `વ્યાજબી` — vya half-form is visible, no dotted-circle placeholder
- `ર્ડા` — reph (the small comma above ડ) sits correctly above the matra
- `સ્ક્રીન` — the triple-stack at the start renders as one cluster

If all five pass: the font + shaper stack is good. Move on to building the real templates.
If any fail: the font fallback is wrong — either Noto Sans Gujarati didn't load, or the OpenType GSUB tables got stripped somewhere.

### Platform note (read if `npm install` errors)

Puppeteer downloads a Chromium binary that matches your OS+CPU automatically:

| Your machine | What downloads | Status |
|---|---|---|
| macOS Apple Silicon (M1/M2/M3) | `mac-arm64/Chromium.app` | ✅ works |
| macOS Intel | `mac-x64/Chromium.app` | ✅ works |
| Linux x86_64 (Vercel runtime) | `linux64/chrome` | ✅ works |
| Linux ARM64 | not shipped by puppeteer | ❌ install system Chromium and set `PUPPETEER_EXECUTABLE_PATH` |

If you ever run this PoC on a Linux ARM64 box (e.g. a Raspberry Pi or AWS Graviton), `apt install chromium-browser` and set `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser` before running.

## Why both render scripts?

| Script | Binary | When to use |
|---|---|---|
| `render-local.mjs` | regular `puppeteer` (full local Chromium) | Day-to-day dev; fast; matches what you see in your browser |
| `render-vercel-test.mjs` | `puppeteer-core` + `@sparticuz/chromium` | Validates the production binary renders identically. If local is fine but Vercel isn't, this is where you'd catch it. |

The HTML and CSS are identical between them — both consume `test.html`.

## Production wiring (next step, not in this PoC)

The Vercel serverless function will:

1. Receive `{ proposalId }` from the React app (via the React-Query mutation).
2. Server-side fetch proposal + line items + signer + client snapshot from Supabase using the service role key (RLS bypass — this is server-only).
3. Render the appropriate template HTML (DAVP-AUTO / DAVP-GSRTC / AGENCY-AUTO / AGENCY-GSRTC).
4. Run through Puppeteer the same way `render-vercel-test.mjs` does.
5. Upload the PDF to Supabase Storage (private bucket, owner-readable via RLS).
6. Insert a `proposal_versions` row with the URL.
7. Return the signed URL to the client.

The handler skeleton lives at `../api/render-pdf.mjs` (next milestone).

## Cost / cold-start budget

- `@sparticuz/chromium` cold start on Vercel: ~1.5–2.5 s (browser launch).
- One-page PDF render after warm: ~400 ms.
- A 6-page proposal: ~1.5 s + cold start.
- Vercel Hobby tier: 10 s function timeout — well within budget.
- Bandwidth: each PDF ~150–400 KB; even 1000/mo proposals = <500 MB egress.

If cold-start hurts UX, we'll switch to keeping the function warm with a 4-min cron ping.

## Self-hosting fonts (do this before launch, not now)

Right now `test.html` pulls Noto Sans Gujarati from Google Fonts CDN. In production we self-host the woff2 files inside the function bundle so:

1. The render doesn't depend on Google's CDN being reachable.
2. Cold start is faster (no extra network round-trip).
3. The render is reproducible — Google can ship a new Noto version any day.

Drop the woff2 files in `pdf-templates/fonts/` and inline the `@font-face` declarations in each template.
