# Untitled Proposals — PDF API

Vercel serverless functions that render proposal/receipt/settlement PDFs.

## Endpoints

POST endpoints require `Authorization: Bearer <supabase-jwt>`.

| Endpoint | Method | Body | Returns |
| --- | --- | --- | --- |
| `/api/render-proposal` | POST | `{ proposal_id, copy_kind? }` | `application/pdf` |
| `/api/render-receipt` | POST | `{ receipt_id, copy_kind? }` | `application/pdf` |
| `/api/render-settlement` | POST | `{ proposal_id, copy_kind? }` | `application/pdf` |
| `/api/cron-expire-proposals` | GET (Vercel cron) | — | `{ ok, expired_count, started_at, finished_at }` |

## Scheduled jobs

`vercel.json` schedules `cron-expire-proposals` daily at **20:30 UTC = 02:00 IST next day**. It calls `public.expire_stale_proposals()` which flips SENT proposals with no activity for `expire_after_days` (default 120) to EXPIRED.

Authentication for the cron endpoint:
- If `CRON_SECRET` is set, the endpoint requires `Authorization: Bearer ${CRON_SECRET}` (Vercel sends this automatically when the env var is configured).
- If not set, the endpoint accepts only requests from the Vercel cron user-agent. Set `CRON_SECRET` in production.

The owner can also trigger expiry manually from the Admin page (calls the same `expire_stale_proposals()` RPC directly via Supabase) — useful for testing without waiting 24 h.

## How it works

1. Verify the caller's JWT against Supabase auth, then look up `users.role` to confirm they're active.
2. Fetch the proposal/receipt + relations using the **service role** key. Only snapshots are read — no joins to mutable master rows.
3. Pick the right template via `pdf-templates/render.js` dispatcher and render to HTML.
4. Hand HTML to Puppeteer (`@sparticuz/chromium` on Vercel, regular `puppeteer` locally with `RUN_LOCAL=1`). Wait for `document.fonts.ready` so the Gujarati webfont is loaded before the snapshot.
5. Stream PDF back. For proposals, also insert a `proposal_versions` row (best-effort — render still succeeds if the audit insert fails).

## Templates dependency (important)

The handlers import from `_templates/` (created by `scripts/sync-templates.mjs`), which copies `../pdf-templates/` into the deployable bundle. Do **not** import directly from `../../pdf-templates/` — Vercel won't include sibling folders in the deploy.

`_templates/` is .gitignored. The sync runs automatically before `vercel-build` (see `package.json` scripts).

## Local dev

```bash
cd pdf-api
cp .env.example .env
# fill in SUPABASE_URL / keys / brand
npm install
npm run sync-templates      # one-time, then re-run when templates change
RUN_LOCAL=1 vercel dev      # uses regular puppeteer instead of @sparticuz/chromium
```

## Deploy

```bash
cd pdf-api
npm run deploy             # = sync-templates + vercel --prod
# Then in Vercel dashboard, set env vars from .env (especially SERVICE_ROLE_KEY + CRON_SECRET)
```

## Notes

- The PDF size is ~150–250 KB per page. With one cold-start (~3 s) plus ~1 s render, expect ~4 s on first call after a deploy and ~1 s on warm calls.
- The `@sparticuz/chromium` binary is ~100 MB; Vercel's free tier allows 250 MB per function so this fits with room to spare.
- We deliberately do NOT cache PDFs — every call re-renders from current DB state. If volume becomes an issue, add Supabase Storage caching keyed on `(proposal_id, ref_no, version_no)`.
