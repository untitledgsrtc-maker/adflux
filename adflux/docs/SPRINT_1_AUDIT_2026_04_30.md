# Sprint 1 Audit — 30 April 2026

**Prepared for:** Brijesh Solanki (owner)
**Status:** Sprint 1 complete; Sprint 2 not yet started
**Read time:** 10 minutes

This is a plain-English health check of the codebase after Sprint 1. It tells you what works, what doesn't, and what to do before Sprint 2 starts. No SQL, no jargon. If you see a word you don't understand, ask.

---

## Executive summary (1 paragraph)

Sprint 1's six database changes are all applied correctly on staging Supabase. The new "segment + media" model is working at the database layer — Government quotes literally cannot be saved with the wrong media type, even if the app tried. **But the app doesn't use any of the new model yet.** Your existing wizard still creates quotes the old way — Private LED only, no choice. Five things must happen before Sprint 2 can begin building the new Government wizard, and they're listed at the end of this doc in the right order.

---

## 1. What Sprint 1 actually shipped

Six files added to the project root, all applied to staging Supabase. In plain language:

| What it does | Working? |
|---|---|
| Quotes can now be tagged Government or Private, and labeled with media type (Auto Hood, GSRTC LED, etc.) | ✅ |
| Users have a "segment access" tag — Private reps can't see Government quotes and vice versa | ✅ |
| 33 Gujarat districts and 20 GSRTC stations are loaded into staging, ready for Government quotes to pick from | ✅ |
| Auto Hood DAVP rate (₹825 per rickshaw) is loaded | ✅ |
| Government deals get reference numbers like `UA/AUTO/2026-27/0001` automatically; Private LED stays on `UA-2026-NNNN` | ✅ |
| Database refuses to let a Government quote be saved as anything other than Auto Hood or GSRTC LED — your business rule is now enforced at the deepest level | ✅ |
| Sales reps can only see/touch their own quotes that match their segment access | ✅ |

There was one mistake along the way (a security gap on payment policies) and it was fixed in migration #6. Final state is clean.

---

## 2. What's NOT working yet

The app's user interface has not caught up to the database. Three concrete things:

**The "Create Quote" button still creates Private LED only.** Your team currently can't make a Government quote through the app, even though the database is ready to accept one. The wizard never asks "Government or Private?" — it just defaults everything.

**Sales reps don't see segment labels yet.** A Private rep looking at the quotes list won't see "Private" or "Government" tags on rows. The database keeps them safe (a Private rep won't accidentally see a Government quote), but the UI gives no signal of what segment each quote belongs to.

**The current login doesn't read the new segment field.** The login still loads role only — so even if the field is filled, no part of the app reads it yet. Sprint 2 fixes this on day 1.

---

## 3. Untitled Proposals — what's salvageable

Confirmed by file inspection (the original audit was wrong about this). All four pieces below ARE in the repo at `Untitled/adflux/Untitled Proposals/`:

| Piece | Location | Sprint 2 plan |
|---|---|---|
| 6-step Government wizard | `app/src/pages/proposal-wizard/` — `Step1ClientMedia.jsx` through `Step6Review.jsx` plus `Stepper.jsx`, `WizardNav.jsx`, `QuickAddClientModal.jsx` | **Port these.** Strip out the `.up-*` styles, rebuild with AdFlux's existing tokens, point them at AdFlux's `quotes` table. |
| P&L pages | `app/src/pages/pnl/` — `PnLSummary`, `ProposalPnL`, `AdminExpenses`, `AccessLog`, `EnrollTotp`, `VerifyTotp` | **Port in Sprint 3.** Drop the TOTP-2FA gating (EnrollTotp + VerifyTotp don't come over). Owner-only via standard role check. |
| PDF generation | `pdf-api/api/` — 4 `.mjs` Vercel functions: `render-proposal`, `render-receipt`, `render-settlement`, `cron-expire-proposals` | **Re-point and redeploy.** Code is fine. Just change the environment variables to point at AdFlux's staging Supabase, then deploy. About 30 minutes of work, not a rebuild. |
| Gujarati font test harness | `pdf-poc/` | **Useful — keep.** Run it once before Sprint 2 starts to confirm Gujarati renders right in your environment. |

What we're NOT porting:

- The Untitled Proposals role model (owner / co_owner / admin / user). AdFlux uses (admin / sales) and we add `segment_access` for scope. Don't merge the role models.
- The separate `proposals` table. We extended `quotes` instead — single source of truth.
- The TOTP/2FA enrollment for P&L. Adds friction without proportional value at your team size.
- The 9-state proposal status enum. We're keeping AdFlux's 5-state one (draft, sent, negotiating, won, lost).

---

## 4. Documentation state

| File | Status | Action needed |
|---|---|---|
| `ARCHITECTURE.md` | Up to date through Sprint 0 (before consolidation). Doesn't cover segment/media yet. | Update at end of Phase 0 (after Sprint 5). |
| `docs/UNTITLED_OS_v2_ARCHITECTURE.md` | New, current. Source of truth for the merged system. | Keep current as decisions land. |
| `docs/UNTITLED_OS_ARCHITECTURE.md` | The 12-month module plan (M1-M8). Still useful for Phase 1+. | No change. |
| `PHASE2_NOTES.md` | Old AdFlux notes. Some "NOT IMPLEMENTED" items still relevant. | Review after Sprint 2; archive obsolete sections. |
| `DEPLOY_GUIDE.md` | Outdated — pre-dates Sprint 1 phase4 migrations. Anyone following it for a fresh setup will miss segment/media. | Update at end of Phase 0. |
| `Untitled Proposals/INSTALL.md`, `README.md` | Reference for what to port. Will be deleted with the folder at end of Phase 0. | No action. |
| `CLAUDE.md` (new) | Persistent context for future Claude sessions. | Keep updated as decisions land. |
| This audit | Snapshot of state on 30 Apr 2026. | Archived after Sprint 2 ships. |

---

## 5. Risks heading into Sprint 2

Five things to know about. Numbered by what to do first.

**Risk 1 — App can't create Government quotes yet.**
The wizard hardcodes Private LED. Until Sprint 2 ships the chooser screen + new Government wizard, your team has no way to use the new database capability. This is the entire point of Sprint 2.

**Risk 2 — No test users on staging.**
Sprint 2 needs at least 3 logins to test properly: 1 admin, 1 Private sales rep, 1 Government sales rep. Right now staging Supabase has the schema but no users. We must seed them before any wizard work can be tested.

**Risk 3 — PDF API points at the wrong database.**
The Vercel functions in `pdf-api/api/` were built for Untitled Proposals' standalone Supabase. Even after we port the wizard, clicking "Generate PDF" on a Government quote will hit the wrong server and return nothing. Quick fix: update environment variables and redeploy. About 30 minutes.

**Risk 4 — Existing dashboards don't filter by segment.**
The current admin dashboard mixes everything. Once Government quotes start arriving, the dashboard will show Government revenue mixed in with Private revenue, with no way to filter. Sprint 2 should add a segment filter at minimum on the quotes list. Full segment-aware dashboards are a later sprint.

**Risk 5 — TDS handling is missing.**
Government payments have Tax Deducted at Source. A ₹100K invoice nets ₹96K after 2% income TDS + 2% GST TDS. AdFlux's payment table has no TDS columns. Right now you can't accurately record what Government clients actually paid versus what they invoiced. **Not a Sprint 2 blocker** (we're focused on creating proposals, not collecting on them) — but blocks the moment the first Government deal is won. Sprint 4 fixes this.

---

## 6. What to do BEFORE Sprint 2 wizard work begins

In order:

**Step 1 — Seed test users on staging Supabase (15 minutes).**
You'll need an admin (you), a Private sales rep, and a Government sales rep. Claude can write the SQL; you copy-paste in the Supabase SQL editor like the migrations.

**Step 2 — Sign in to staging as each user. Confirm segment isolation works (15 minutes).**
Sign in as the Private rep — confirm you can't see Government data. Sign in as the Government rep — confirm you can't see Private. Sign in as admin — confirm you see everything. This validates Sprint 1's RLS without writing any new code.

**Step 3 — Re-point the PDF API at AdFlux staging (30 minutes).**
Open the pdf-api folder. Update `SUPABASE_URL` and `SUPABASE_ANON_KEY` env vars to your AdFlux staging project's values. Redeploy on Vercel. Test by generating a PDF for one of your existing Private LED quotes (after step 4 confirms you can copy them across, if needed).

**Step 4 — Add `getSegmentAccess()` to the login store (1 hour).**
Sprint 2's first code change. Wire the new `segment_access` field from the database into the app so components can read it. Without this, every Sprint 2 screen has to re-query the database.

**Step 5 — Run the Gujarati PDF test harness (15 minutes).**
The folder `Untitled Proposals/pdf-poc/` has a small standalone test that confirms Gujarati text renders correctly in the PDF pipeline. Run it once. If broken, fix before any Government wizard work — Government PDFs are bilingual.

After these 5 steps (~2.5 hours of hands-on work), Sprint 2 wizard porting can start.

---

## What "good" looks like at end of Sprint 2

You can:

1. Click "+ Create Quote" → see two big buttons "Government Proposal" / "Private LED Quote" → pick Government.
2. Walk through 6 steps choosing Auto Hood OR GSRTC LED, picking districts/stations, setting GST/discount, picking signer, reviewing.
3. Save as DRAFT → see the new ref number `UA/AUTO/2026-27/0001` (or `GSRTC`).
4. Click "Mark as Sent" → status flips to SENT.
5. Click "Generate PDF" → bilingual PDF appears, correctly rendered in Gujarati.
6. Sign in as a Private rep → cannot see this Government quote in any list.
7. Sign in as the Government rep who created it → sees their quote, no Private quotes visible.

If all 7 work end-to-end without manual database fixes, Sprint 2 is done.

---

*End of audit. Questions / pushback / corrections welcome.*
