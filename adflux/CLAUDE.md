# CLAUDE — Project Context

This file is loaded at the start of every Claude session in this workspace. Read it first; it captures everything you can't derive from `git log` or the code itself.

---

## Who you're working with

**Brijesh Solanki** — owner of Untitled Advertising, Vadodara, Gujarat. Non-technical, runs a ~₹9 Cr/yr OOH advertising business with 14 staff. Writes in fast, broken English (Indian English + Gujarati phrasing). Don't correct his spelling. Read intent, not literal text.

He's the sole product decision-maker AND the sole tester. Every change ships through his approval, sprint by sprint.

## How he wants you to work

- **Push back. Don't agree by default.** First instinct: stress-test what he just said. Find the weakest point before validating anything.
- **No glazing.** Don't tell him something is "great" or "smart." If you agree, earn it with specifics.
- **Lead with what's wrong or missing.** If the answer is "no" or "this won't work," say that in the first sentence.
- **Be direct, no warm-up sentences.** No filler affirmations.
- **Plain language, not developer jargon.** This is the rule he explicitly called out — "build like you are owner and user of all module — easy to understand for user as well as owners." Every doc, UI label, error message must pass the "could a sales rep understand this without training" test.
- **Walk him click-by-click for any Mac / GitHub Desktop / Vercel / Supabase steps.** He commits via GitHub Desktop, not terminal.
- **One sprint at a time. Each sprint approved before the next starts.** No batching multiple modules in one ask.

## What's being built

**Untitled OS** — a consolidated app that absorbs two existing systems:

1. **AdFlux** — live in production (`main` branch → adflux-iota.vercel.app + original Supabase). ~50 quotes, 1 month old. Does Private LED quotes, payments with admin approval, rep incentives, mini-HR (offer letters), follow-ups, leaderboard, renewal tools, city catalog. **This is the host.**
2. **Untitled Proposals** — dev-only, no users, schema complete (separate Supabase project). Built originally for Government deals only. Has the 6-step proposal wizard, dual DAVP/Agency rate model, GSRTC stations + Auto districts masters, per-deal P&L, monthly admin expenses, TOTP-gated owner access. **Being stripped for parts and folded into AdFlux.**

End state: one app, one team experience, two segments (Government + Private).

## Architecture (locked decisions)

Full doc at `docs/UNTITLED_OS_v2_ARCHITECTURE.md`. Key invariants:

- **Two segments only:** `GOVERNMENT` and `PRIVATE`. Stored as `quotes.segment`.
- **Government locked to AUTO_HOOD + GSRTC_LED only.** No DAVP for hoardings, mall, cinema, digital, other media. Enforced at DB via CHECK constraint AND in `media_segment_validity` config table. **Owner decision 30 Apr 2026 — do not relax without his explicit re-approval.**
- **Two-axis data model:** `segment` (Government/Private) + `media_type` (LED_OTHER/AUTO_HOOD/GSRTC_LED/HOARDING/MALL/CINEMA/DIGITAL/OTHER). Independent fields. Every quote = one combination.
- **Three-layer access control:**
  1. Segment scope on `users.segment_access` — applies only to roles `sales` and `telecaller`. Everyone else = `ALL`.
  2. Operational data (creative jobs, attendance, leads) — segment-blind for non-sales roles.
  3. Financial data — gated by role. Sales: own only. Admin/Accounts: all revenue, no P&L. Owner: all + P&L.
- **Existing 5 sales reps** (Brahmbhatt, Sondarva, Dhara, Vishnu, Nikhil) → `segment_access = 'PRIVATE'`. New hires for Government = `'GOVERNMENT'`.
- **Existing 50 quotes' `UA-2026-NNNN` ref format is locked.** New formats apply to new quotes only:
  - `UA/AUTO/2026-27/NNNN` for AUTO_HOOD
  - `UA/GSRTC/2026-27/NNNN` for GSRTC_LED
  - `UA-2026-NNNN` for Private LED + supplementary media
- **Indian Financial Year:** April 1 – March 31. `fy_for_date()` Postgres function returns "2026-27" format.
- **Sales Lead role + manager_id + telecaller role: deferred** until actually needed (Phase 2). Don't add yet.
- **P&L from Untitled Proposals: ported but stripped of TOTP/audit/owner-only gating.** Admin role check only.
- **UX choice: option (b)** — chooser screen routes to two parallel wizards (Government / Private). Existing AdFlux Private LED wizard stays untouched; ported Untitled Proposals wizard handles Government.

## Design system — non-negotiable

All new UI inherits AdFlux's existing tokens. Owner explicitly said "make sure all UI must be in this theme/font/color only — don't build different of anything which look unprofessional."

- **Fonts:** Space Grotesk (display), DM Sans (body). No new fonts.
- **Theme:** Dark — near-black background, slightly lighter cards, rounded corners.
- **Primary CTA:** Yellow/gold buttons.
- **Hero/banner:** Teal-cyan gradient (e.g., dashboard revenue card).
- **Status colors:** Blue (Sent), Orange (Negotiating), Green (Won), Red (Lost).
- **Sidebar:** Dark with yellow highlight on active item.
- **Avatars:** Colored letter circles per user.

**When porting Untitled Proposals UI** (uses `.up-*` CSS prefix): drop those styles entirely, rebuild components with AdFlux's existing tokens/classes. Never invent a new accent color. If a new pattern is needed (e.g., file upload), match the look of the closest existing AdFlux component.

## Tech stack

React 18 + Vite + React Router v6, Zustand store, React Hook Form + Zod, Supabase (Postgres + Auth + Realtime + RLS), `@react-pdf/renderer` for in-app PDFs (existing AdFlux), Puppeteer + Chromium pdf-api for server-side PDFs (Untitled Proposals — handles Gujarati text via `document.fonts.ready`), date-fns, Lucide icons, Vercel deployment.

## Branch & environment strategy

| Branch | Vercel | Supabase | Purpose |
|---|---|---|---|
| `main` | adflux-iota.vercel.app | Original AdFlux Supabase | Live production. Real money. Touch only for production fixes. |
| `untitled-os` | untitled-os-xxxx.vercel.app | New staging Supabase | All consolidation work. Has full AdFlux schema migrated, Sprint 1 phase4* migrations applied, no real data yet. Owner's sandbox. |

**Never merge `untitled-os` to `main` until a sprint is genuinely shippable.** Production stays running while consolidation happens in parallel.

## File layout

```
adflux/                                      ← merged repo, single deployment
├── ARCHITECTURE.md                          (existing AdFlux structural doc)
├── PHASE2_NOTES.md                          (existing)
├── DEPLOY_GUIDE.md                          (existing — outdated; needs phase4 update)
├── CLAUDE.md                                ← THIS FILE
├── docs/
│   ├── UNTITLED_OS_v2_ARCHITECTURE.md       (post-consolidation blueprint)
│   ├── UNTITLED_OS_ARCHITECTURE.md          (v1 — retained for module specs M1-M8)
│   └── SPRINT_1_AUDIT_2026_04_30.md         (audit findings, corrected)
├── supabase_*.sql                           (10 original AdFlux migrations + 6 new phase4* from Sprint 1)
├── src/                                     (AdFlux frontend — React + Vite)
│   ├── pages/v2/                            (current v2 pages)
│   ├── components/                          (existing component tree)
│   ├── store/                               (Zustand stores)
│   └── ...
├── pdf-api/                                 (existing — quote PDF generation; @react-pdf/renderer)
└── Untitled Proposals/                      ← stripped for parts; deletion is final cleanup of Phase 0
    ├── 001-007*.sql                         (root-level — older reference copy of the migrations)
    ├── db/
    ├── app/src/pages/                       (the wizard + P&L pages we're porting)
    │   ├── proposal-wizard/                 ← Step1ClientMedia.jsx ... Step6Review.jsx + Stepper, WizardNav
    │   ├── pnl/                             ← PnLSummary, ProposalPnL, AdminExpenses, AccessLog, EnrollTotp, VerifyTotp
    │   ├── ProposalNew.jsx, ProposalsList.jsx, ProposalDetail.jsx
    │   └── Login, Dashboard, Clients, Masters, Payments, Admin, NotFound
    ├── pdf-api/api/                         ← render-proposal.mjs, render-receipt.mjs, render-settlement.mjs, cron-expire-proposals.mjs
    ├── pdf-poc/                             ← local Gujarati font test harness
    └── pdf-templates/                       ← HTML/CSS templates consumed by pdf-api
```

## Sprint progress

**Phase 0 — Consolidation (in progress):**

- ✅ Sprint 1 (schema + masters) — DONE 30 Apr 2026
  - 6 migration files applied to staging Supabase (`supabase_phase4a` through `supabase_phase4f`)
  - Adds segment + media_type + rate_type to quotes, segment_access to users, master tables (33 districts, 20 stations, rate master, 16-row validity matrix), media-aware ref-number generator, 3-layer RLS
- ⏭ Sprint 2 (Government wizard port) — NEXT
  - Port `proposal-wizard/Step1ClientMedia` → `Step6Review` from Untitled Proposals into AdFlux's quote flow
  - Drop `.up-*` styles, rebuild with AdFlux tokens
  - Add chooser screen at "+ Create Quote" (Government / Private)
  - Wire the wizard to AdFlux's quotes table (NOT the standalone proposals table)
  - Add `getSegmentAccess()` to authStore
  - Lock Government dropdown to AUTO_HOOD + GSRTC_LED only (already DB-enforced; UI must enforce too)
- ⏭ Sprint 3 (P&L module port, simplified) — TBD
- ⏭ Sprint 4 (receipts/TDS upgrade) — TBD
- ⏭ Sprint 5 (cleanup, delete `Untitled Proposals/` folder) — TBD

**Phase 1+ (months 3-12):** Per `docs/UNTITLED_OS_ARCHITECTURE.md` v1 — M1 sales activity, M2 creative briefs, M3 invoice automation, M8 cockpit, etc. Do not start until Phase 0 ships.

## Known gaps / things future-Claude must check

1. **Frontend doesn't read `segment_access` yet.** `authStore.fetchProfile` selects `*` so the field is in memory, but no `getSegmentAccess()` getter exists. Wire this in Sprint 2 before any segment-aware UI lands.
2. **Wizard hardcodes Private × LED_OTHER.** `WizardShell` / `Step1Client` create quotes with default segment/media. Government quotes can't be created from UI yet, even though DB supports it.
3. **PDF API points at the wrong Supabase.** `pdf-api/` Vercel functions read `SUPABASE_URL` env var that points to Untitled Proposals' standalone project. Repoint at AdFlux staging before testing PDF rendering of Government quotes.
4. **No seed users on staging Supabase yet.** Need 1 admin (segment_access='ALL') + at least 1 sales rep with PRIVATE + 1 with GOVERNMENT before Sprint 2 wizard can be tested. Owner needs to seed manually OR ask Claude to write a seed SQL.
5. **Quote vs proposal data model — single decision pending.** Sprint 1 chose to extend `quotes` table (not create separate `proposals` table). Confirmed in architecture v2 doc but not yet in any migration comment. Future Claude: if you see references to a separate `proposals` table being needed, push back — single-table is the locked decision.
6. **Quote status enum is AdFlux's small one** (`draft, sent, negotiating, won, lost`). Untitled Proposals had a richer one (`DRAFT, SENT, APPROVED, WON, PARTIAL_PAID, PAID, LOST, EXPIRED, CLOSED`). Decision: keep AdFlux's small enum for now. PARTIAL_PAID/PAID are *derived* from payments table, not stored. EXPIRED is added later via cron job (deferred).
7. **TDS (Tax Deducted at Source) handling** — Government deals have TDS deducted from payment. AdFlux's `payments` table has no TDS columns. Untitled Proposals' `proposal_receipts` does. Sprint 4 adds TDS columns to AdFlux `payments` (NOT a separate receipts table) — single source of truth.

## Where memory writes don't work

The system memory directory at `~/Library/Application Support/Claude/.../memory/` is outside this session's connected folders. The Write tool can't reach it (won't help to retry). This file (`CLAUDE.md`) is the workaround — persists in the project, future sessions read it.

If you (future-Claude) learn something important about this project, append to this file. Don't try to write to `~/Library/...`.
