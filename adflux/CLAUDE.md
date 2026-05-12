# CLAUDE.md — Untitled OS / AdFlux Working Rules

This file is loaded at the start of every Claude session in this workspace. **Read it end-to-end before doing anything else.** It captures rules the owner has established across many sprints and that you cannot derive from `git log` or the code.

Owner is **Brijesh Solanki** (Untitled Advertising, Vadodara). UI-oriented, direct, non-technical, runs ~₹9 Cr/yr OOH advertising business. He pushes commits via GitHub Desktop, runs SQL by pasting into Supabase Studio, and tests every change personally.

Off-brand UI is a hard fail. Patch-chain "fix this one thing" work is a hard fail. Skipping the response format is a hard fail.

---

## 0 · Mandatory pre-work reading (in this exact order)

Before writing a single line of code or proposing a plan:

1. `UNTITLED_OS_MASTER_SPEC.md` — the 8-module OS vision + phase plan.
2. `UI_DESIGN_SYSTEM.md` — tokens, components, type scale, build checklist.
3. `src/styles/tokens.css` — **LIVE tokens. These win when they differ from the doc.**
4. `src/styles/v2.css` — `.v2`-scoped tokens used inside V2AppShell pages.
5. `AUDIT_2026_05_05.md` — current state of the codebase.
6. `PHASE1_DESIGN.md` — module-level plan for the active phase.
7. `_design_reference/Leads/Adflux Dashboard.html` — owner-approved visual reference. (Older `_design_reference/dashboard_mockup.html` no longer exists; canonical mockups now live under `_design_reference/Leads/`.)
8. The owner's auto-memory files at `~/Library/Application Support/Claude/local-agent-mode-sessions/.../memory/MEMORY.md`.

If a token in `UI_DESIGN_SYSTEM.md` disagrees with `tokens.css` / `v2.css`, **the CSS file wins** — flag the doc drift but follow the live token. (Example: doc says brand yellow `#facc15`; live token is `#FFE600`. Use `#FFE600`.)

---

## 1 · Mandatory response format (every non-trivial reply)

Six sections, in this order, every time:

1. **Audit Summary** — what is broken / what does the request actually require, in plain English.
2. **Dependency Map** — files / tables / RLS / external systems this touches.
3. **Proposed Solution** — the smallest change that meets the spec.
4. **Acceptance Criteria** — observable checks that prove it works.
5. **Files to Change/Create** — explicit list with one-line purpose each.
6. **Next Action for Owner** — what they need to do (run SQL, push, smoke test).

Trivial chatter (single-question replies, follow-ups inside an in-flight task) doesn't need all six sections — but anything that touches code or schema does.

---

## 2 · Tone & behavior (owner's standing preferences)

- **Never agree by default.** First instinct = stress-test the idea. Find the weakest point before validating anything.
- **No glazing.** Don't tell him something is "great", "smart", or "brilliant". If you agree, earn it with specifics.
- **Don't echo his framing back to him.** If he says "I think X is the move", don't open with "X is definitely the move". Open with what you'd push back on.
- **Be direct. First sentence = the answer.** If the answer is "no" or "this won't work", lead with that.
- **The more certain he sounds, the more pushback he expects.**
- **Skip warm-ups.** No "Great point", no "You're absolutely right", no filler affirmations.
- **Plain language, not developer jargon.** Owner test: "could a sales rep understand this without training?"
- **One sprint at a time.** No batching multiple modules in one ask.
- **Walk him click-by-click for any Mac / GitHub Desktop / Vercel / Supabase steps.**
- **Read intent, not literal text.** He writes in fast Indian-English / Gujarati phrasing. Don't correct his spelling.

---

## 3 · Module-not-patch directive (5 May 2026)

Owner's explicit rule: **build modules, don't patch.** Anti-pattern is the 75-task patch chain that produced inconsistent UX.

For any new feature:
1. Audit the current state of the affected module.
2. Cross-role test: does this work for admin, co_owner, sales, agency, telecaller?
3. Write acceptance criteria BEFORE writing code.
4. Ship one cohesive module-level change, not a stream of fixes.

---

## 4 · Two-company architecture (hard requirement)

| Segment | Company | GSTIN / Bank | Letterhead |
|---|---|---|---|
| GOVERNMENT | Untitled Advertising | from `companies` row where segment='GOVERNMENT' | Govt letterhead |
| PRIVATE | Untitled Adflux Pvt Ltd | from `companies` row where segment='PRIVATE' | Private letterhead |

Rules:
- Every PDF / proposal / quote reads the company row by `segment`. **Never hardcode** company name, address, GSTIN, bank, or logo.
- **Hard-fail** (don't silently fall back) if the company row is missing required fields.
- `GovtProposalRenderer` asserts segment matches company row; do the same for any new renderer.
- Source of truth for legal details: `project_company_details.md` in memory.

Locked architecture decisions:
- **Two segments only:** `GOVERNMENT` and `PRIVATE`. Stored as `quotes.segment`.
- **Government locked to AUTO_HOOD + GSRTC_LED only.** No DAVP for hoardings, mall, cinema, digital, other media. Enforced at DB via CHECK + `media_segment_validity` config table. Owner decision 30 Apr 2026 — do not relax without explicit re-approval.
- **Two-axis data model:** `segment` (Govt/Private) + `media_type` (LED_OTHER/AUTO_HOOD/GSRTC_LED/HOARDING/MALL/CINEMA/DIGITAL/OTHER/OTHER_MEDIA). Independent fields. Every quote = one combination.
- **Indian Financial Year:** April 1 – March 31. `fy_for_date()` Postgres function returns "2026-27" format.
- **Ref formats are locked for existing 50 quotes (`UA-2026-NNNN`).** New formats apply to new quotes only:
  - `UA/AUTO/2026-27/NNNN` for AUTO_HOOD
  - `UA/GSRTC/2026-27/NNNN` for GSRTC_LED
  - `UA-2026-NNNN` for Private LED + supplementary media

---

## 5 · Live design tokens (from `src/styles/tokens.css`)

These are the **only** colors / fonts to use. Do not paste hex codes from old code.

```
/* Backgrounds */
--bg:           #0f172a
--surface:      #1e293b
--surface-2:    #334155
--surface-3:    #475569

/* Borders */
--border:       #334155
--border-strong:#475569

/* Text */
--text:         #f1f5f9
--text-muted:   #94a3b8
--text-subtle:  #64748b

/* Brand */
--accent:       #FFE600    ← brand yellow. NOT #facc15.
--accent-hover: #F0D800
--accent-fg:    #0f172a
--accent-soft:  rgba(255,230,0,0.14)

/* Status */
--success:       #10B981   --success-soft: rgba(16,185,129,0.12)
--warning:       #F59E0B   --warning-soft: rgba(245,158,11,0.12)
--danger:        #EF4444   --danger-soft:  rgba(239,68,68,0.12)
--blue:          #3B82F6   --blue-soft:    rgba(59,130,246,0.12)

/* Sidebar */
--sidebar-bg / --sidebar-text / --sidebar-active-bg / --sidebar-active-text

/* Layout */
--sidebar-width: 240px
--topbar-height: 60px
--mobile-nav-height: 62px

/* Radius */
--radius-sm: 6px   --radius: 10px   --radius-lg: 14px   --radius-xl: 20px

/* Fonts */
--font-sans:    DM Sans → Inter → system
--font-display: Space Grotesk (headings, big numbers)
--font-mono:    JetBrains Mono (IDs, currency figures, ages)
```

Inside `.v2`-scoped pages (`V2AppShell` children) use the `--v2-*` tokens from `src/styles/v2.css` (`--v2-yellow`, `--v2-ink-0/1/2`, `--v2-bg-0/1/2`, `--v2-line`, `--v2-display`).

If a fallback is needed in inline style: `var(--v2-yellow, #FFE600)` — never `#facc15`.

---

## 6 · UI build checklist (every screen, before declaring done)

From `UI_DESIGN_SYSTEM.md` §10:

1. CSS variables only — no hardcoded colors.
2. Renders in both Night and Day theme (where applicable).
3. Status badges use the chip + tint pattern (`--tint-*-bg` + `--tint-*-bd`).
4. Numbers Space Grotesk; IDs/ages JetBrains Mono; body DM Sans / Inter.
5. Border-radius matches the scale (6 / 8 / 9 / 12 / 14 / 16 / 999).
6. Hover states defined on every interactive element.
7. Empty state designed (not a blank box).
8. Loading state designed (skeleton or spinner).
9. Error state designed (red banner with retry).
10. Mobile breakpoint tested at 720px and 1100px.
11. Focus rings visible on tab navigation.
12. Lucide icons only, stroke 1.6, size 14 / 16 / 18 / 22.

Skipping any of these is the kind of thing the owner will catch and call out.

---

## 7 · Iconography

- `lucide-react` only. No emoji, no other icon libraries.
- Stroke width 1.6.
- Sizes: 14 (inline / chip prefix), 16 (sidebar nav, action row, topbar buttons), 18, 22 (display numbers).
- Color inherits from parent. Don't hardcode color on `<Icon>`.

---

## 8 · Database / RLS / migration patterns

- Every SQL file is **idempotent**: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `INSERT ... ON CONFLICT DO NOTHING`, `DROP POLICY IF EXISTS` then `CREATE POLICY`.
- Every migration ends with a `-- VERIFY:` block of expected counts / column lists.
- Filename: `supabase_phase{N}_{purpose}.sql`. Owner pastes into Supabase Studio manually.
- After schema changes: `NOTIFY pgrst, 'reload schema';` at end of file.
- RLS uses `public.get_my_role()` and `manager_id` chains. Don't bypass.
- Roles in use: `admin`, `co_owner`, `sales`, `agency`, `telecaller`. **No `owner` role** (DB constraint dropped it). Don't reintroduce.
- **Three-layer access control:**
  1. Segment scope on `users.segment_access` — applies only to roles `sales` and `telecaller`. Everyone else = `ALL`.
  2. Operational data (creative jobs, attendance, leads) — segment-blind for non-sales roles.
  3. Financial data — gated by role. Sales: own only. Admin/Accounts: all revenue, no P&L. Owner/Co-owner: all + P&L.
- Existing 5 sales reps (Brahmbhatt, Sondarva, Dhara, Vishnu, Nikhil) → `segment_access='PRIVATE'`. New govt hires = `'GOVERNMENT'`.
- Storage path convention: `_master/{segment}/{media_type}/{order}-{slug}.{ext}` for master attachments.
- Storage RLS: user must own the parent quote. Phase 11 lockdown.

---

## 9 · PDF rendering pattern

- 794 × 1123 px A4 viewport, render off-screen.
- `html2canvas` snapshot at scale 2 → `jsPDF` slice into A4 pages.
- PDFs are printed on white paper — use the **Day-theme palette** (`--text-1` ≈ `#0c1224`, `--text-2` ≈ `#4a5474`, `--border` ≈ `#e3e6ee`, `--surface-2` ≈ `#f8f9fc`) but keep brand yellow `#FFE600`.
- Tables: use explicit `<colgroup>` widths; don't let descriptions get squeezed. The Phase 15 cramping bug was caused by 11 columns sharing 738px without explicit widths.
- Always test slicer with 6+ line items to make sure rows aren't cut mid-row.
- Locked PDFs are snapshots — they don't re-render when company / template changes. Surface "stale lock" warnings (Phase 11 pattern).
- Govt PDFs use `GovtProposalRenderer` (HTML → browser-print → PDF). Private LED uses `QuotePDF` (`@react-pdf/renderer`). Other Media uses `OtherMediaQuotePDF` (html2canvas + jsPDF). `QuoteDetail.handleDownloadPDF` routes by `media_type`.

---

## 10 · Routing rules

- React Router v6. **Specific routes BEFORE parameterized.** `/leads/new` MUST come before `/leads/:id`. Failing to do this produced the `invalid input syntax for type uuid: 'new'` bug — owner felt that one personally.
- Don't add a route without verifying it doesn't shadow an existing one.
- Govt quotes route to `/proposal/:id`. Private quotes (LED + Other Media) route to `/quotes/:id`. `QuoteDetail` auto-redirects govt rows that landed on the old URL.

---

## 11 · Lead → Quote linkage

- `quotes.lead_id` column exists (Phase 14). All wizards (Auto Hood, GSRTC LED, Private LED, Other Media) must:
  1. Accept `prefill.lead_id` from `location.state`.
  2. Persist it on the inserted quote row.
  3. After insert, update the lead: `stage='QuoteSent'`, `quote_id={new}`.
- Don't break this contract when adding a new wizard.

---

## 12 · Forms / wizards / clients

- Every quote save calls `syncClientFromQuote(quote, 'create' | 'update')` so the Clients table stays in sync.
- Every quote save also fires the `lead_id` update if applicable.
- Govt quotes need phone fallback for client sync (Phase 11i fix — don't regress).
- Mobile-first: only `/work` page. Everything else is desktop-first but must scroll on mobile.
- The Other Media wizard reads media options from the `media_types` master table (Phase 15). Free-text fallback for one-offs. Tax fields auto-populate from the chosen master row; reps don't see HSN / CGST / SGST inputs.

---

## 13 · Phase plan (do not commit work that doesn't fit)

| Phase | Window | Content |
|---|---|---|
| Phase 0 | Apr–May 2026 | Consolidation: AdFlux + Untitled Proposals → one repo, one DB |
| Phase 1 | May 6–30 | M1 Sales/Lead + M7 Telecaller + M8 Cockpit + AI-1 daily brief + Smart Task Engine |
| Phase 1.5 | Jun 1–14 | AI Co-Pilot (NL Gujarati/English) + Individual Daily Scorecard |
| Phase 2 | Jun 15 – Jul 12 | M3 invoice + M4 campaigns + M6 reporting/renewal + Voice + Cash Forecaster + OCR + Gujarati drafter |
| Phase 3 | Jul 13 – Aug 9 | M2 Creative + M5 HR + Expense+GPS + Load Balancer |
| Phase 4 | Aug+ | GoGSTBill + Tally + sunset Cronberry + sunset Trackdek |

Total to "all 22 people on one screen": ~14 weeks. If a request doesn't fit one of the 8 modules or 8 productivity features, mark it Phase 4+ and don't build it inline.

---

## 14 · Push & deploy workflow

The sandbox **cannot push to GitHub** — no credentials. The only thing the sandbox can do is commit locally.

After every commit:
1. Tell the owner the commit SHA.
2. Tell the owner the exact command to run from his Mac terminal:
   ```
   cd ~/Documents/untitled-os2/Untitled/adflux
   git push origin untitled-os
   ```
3. Vercel auto-deploys from `untitled-os`. SQL files must be run by hand in Supabase Studio.
4. **Never claim a commit was pushed unless `git log origin/untitled-os` shows it.** Verify before reporting.

| Branch | Vercel | Supabase | Purpose |
|---|---|---|---|
| `main` | adflux-iota.vercel.app | Original AdFlux Supabase | Live production. Real money. Touch only for production fixes. |
| `untitled-os` | untitled-os-xxxx.vercel.app | New staging Supabase | All consolidation + new module work. |

Never merge `untitled-os` to `main` until a sprint is genuinely shippable. Production stays running while consolidation happens in parallel.

---

## 15 · Pre-commit verification (mandatory)

Before `git commit`:
1. Parse-check every modified `.jsx` file with esbuild:
   ```
   npx --yes esbuild --loader:.jsx=jsx --log-level=warning <file> >/dev/null
   ```
2. `git status` → confirm only intended files staged.
3. Commit message follows pattern: `Phase {N}{rev?}: {one-line summary}` with bullet body.

For non-trivial work, include a final verification step in the TodoList — fact-check, screenshot test, parse-check.

---

## 16 · Scope discipline

When fixing code, **don't auto-fix unrelated pre-existing violations** in the same file. Flag them, leave them for a separate commit. Example: if `MasterV2.jsx` has 14 hardcoded `#facc15` from old tabs and you're only touching MediaTypesTab, fix only your section. Tell the owner the rest is outside this batch's scope.

---

## 17 · Memory system rules

Auto-memory lives at `~/Library/Application Support/Claude/local-agent-mode-sessions/.../memory/`.

When to write:
- **user** memory: anything you learn about Brijesh's role, preferences, knowledge.
- **feedback** memory: corrections OR validated approaches. Always include `**Why:**` + `**How to apply:**` lines.
- **project** memory: ongoing initiatives. Convert relative dates to absolute dates.
- **reference** memory: pointers to external systems / files.

When NOT to write:
- Code conventions derivable from current files.
- Git history / who changed what.
- Anything already in this CLAUDE.md.
- Ephemeral task state (use TodoList instead).

Before recommending from memory, **verify the memory is still accurate** by reading the current file or running `git log`. Memory can go stale.

---

## 18 · GST / invoice formatting (India)

- Indian numbering: **lakh / crore**, never million / billion.
- 12,21,300 → "Twelve Lakh Twenty-One Thousand Three Hundred Rupees Only" (use `src/utils/numberToWords.js`).
- GST 18% = CGST 9% + SGST 9% split (intrastate). Default HSN/SAC for media: `998397`.
- "Total in Words" required on every invoice / quotation PDF.
- Bank details panel: Name / Branch / Acc Name / Acc Number / IFSC / MICR — read from `companies` row.

---

## 19 · Master configuration tabs

`MasterV2.jsx` is the central admin UI. Tabs: **Attachments, Companies, Signers, Media, Media Types** (Phase 15), **Documents**.

- Admin / co_owner only. Sales / agency / telecaller bounce to dashboard.
- Inline edit pattern: local state buffer → `onBlur` persist → status banner.
- Add-new pattern: form row at top, button on right, optimistic update on success.
- For new master tables: `name` + `display_order` + `is_active` flag + RLS (admin-all + read-all-authenticated).

---

## 20 · Common foot-guns (don't repeat)

- ❌ `#facc15` anywhere. Brand yellow is `#FFE600`.
- ❌ `var(--v2-yellow, #facc15)` — use `var(--v2-yellow, #FFE600)`.
- ❌ Defining `/leads/:id` before `/leads/new`.
- ❌ Building a new wizard without `lead_id` plumbing.
- ❌ Hardcoding company name / GSTIN / bank in a renderer.
- ❌ Calling `delete` on an active quote (Phase 11b blocks it).
- ❌ Backdated `payment_date` (blocked).
- ❌ Modifying a locked proposal PDF (regenerate, don't mutate).
- ❌ "Owner" role in any new code (use `admin` or `co_owner`).
- ❌ Reading `media_type` / `media_label` columns from `quote_cities` — the wizard saves the media name to `city_name`.
- ❌ Claiming `git push` succeeded from the sandbox. It can't push.
- ❌ Auto-fixing 50 unrelated style violations during a feature commit.
- ❌ Starting a response with "Great point" or "You're absolutely right".
- ❌ Wrapping company info in a fallback when the row is missing — hard-fail instead.
- ❌ Using emoji in any file (UI, code, commit messages) unless the owner asks.
- ❌ Mocking the database in tests (Phase 11 fix — use real Supabase).
- ❌ Persuasive tone or salesy copy in PDFs / UI labels. The voice is precise / quiet / grown-up.

---

## 21 · Tech stack at a glance

- **React 18 + Vite** + **React Router v6**
- **Zustand** for global state (`authStore`, `quotesStore`, etc.)
- **React Hook Form + Zod** for forms
- **Supabase** (Postgres + Auth + Realtime + RLS)
- **`@react-pdf/renderer`** for in-app PDFs (Private LED quotes)
- **`html2canvas` + `jsPDF`** for HTML-to-PDF (Govt proposals + Other Media)
- **Puppeteer + Chromium pdf-api** for server-side PDFs (Untitled Proposals legacy — handles Gujarati via `document.fonts.ready`). Being phased out.
- **`lucide-react`** for icons (only)
- **DM Sans + Space Grotesk + JetBrains Mono** fonts (Google Fonts, in `index.html`)
- **date-fns** for dates
- **Vercel** auto-deploy from `untitled-os` branch
- **Cronberry CSV import** (90d cutoff, regex Remarks parser) — sunset Phase 4
- **Supabase Edge Functions** for AI-1 brief, scorecard, copilot

---

## 22 · Status / what's already shipped

### Phase 0 — Consolidation (DONE)
- Sprint 1 (30 Apr): schema + masters (`supabase_phase4a-f`).
- Sprint 2 (1 May): Govt module front-end (Auto Hood + GSRTC LED wizards, master pages, proposal renderer).

### Phase 1 + 1.5 (DONE)
- Phase 12: users hierarchy + holidays + leads + activities + work_sessions + call_logs + RLS.
- /leads, /leads/:id, /work (mobile-first), /telecaller (24h SLA + auto-assignment), /cockpit (owner page + AI-1 daily WhatsApp brief).
- Cronberry CSV import with Remarks regex parser + 90d cutoff.
- Phase 1.5: AI Co-Pilot (Gujarati/English NL query) + Individual Daily Scorecard WhatsApp 7:30 PM.
- Edge Functions: copilot, daily-brief, scorecard.

### Phase 12 rev2 (DONE)
- Lead UX simplification + Other Media wizard (initial version).

### Phase 13 (DONE)
- `ai_runs` table + `run_select(text)` SECURITY INVOKER RPC for Co-Pilot.

### Phase 14 (DONE)
- `quotes.lead_id` column. All 4 wizards updated to persist + advance lead stage.

### Phase 15 (DONE — needs SQL run + push)
- `media_types` master table (8 seeds, admin CRUD via Master → Media Types).
- `quote_cities` gains `hsn_sac` / `cgst_pct` / `sgst_pct` / `cgst_amount` / `sgst_amount` columns.
- Other Media wizard reads dropdown from master, free-text fallback. Tax fields auto-populate.
- New `OtherMediaQuotePDF` renderer (ENIL Quotation #44 layout, A4, CGST+SGST split, Total in Words, bank details).
- `QuoteDetail` Download PDF routes `OTHER_MEDIA` to the new renderer.
- Phase 15 fix commit `890b96b`: brand `#FFE600`, colgroup widths fix description cramping, `city_name` plumbing fix.

### Pending (do not start without owner approval)
- Sprint 3: P&L module port, simplified.
- Sprint 4: receipts/TDS upgrade. Govt deals have TDS (2% income + 2% GST) — current `payments` table has no TDS columns; add when first Govt deal moves to PARTIAL_PAID.
- Sprint 5: cleanup, delete `Untitled Proposals/` folder.
- Govt invoice template (post-WON automation with PO + work-completion certificate + photos).

---

## 23 · Known gaps / things future-Claude must check

1. **TDS handling deferred.** AdFlux `payments` table has no TDS columns. Don't try to invoice Govt deals as if it does.
2. **Govt invoice template not built.** WON status flip currently requires manual invoice generation outside the app.
3. **Quote status enum is small** (`draft, sent, negotiating, won, lost`). PARTIAL_PAID / PAID are *derived* from payments. EXPIRED via cron later. Don't add to enum without owner sign-off.
4. **`available_rickshaw_count` was dropped from `auto_districts`** in Phase 5; replaced with `share_pct`. Don't bring it back.
5. **`Untitled Proposals/` folder is in the repo** but its `lib/fetchProposal.mjs` queries `proposals` / `proposal_line_items` tables that don't exist in AdFlux. Useless until Sprint 5 cleanup.
6. **MasterV2.jsx has ~14 pre-existing hardcoded `#facc15` / `#0a0e1a`** across old tabs (Attachments, Companies, Documents, Signers). Brand violation. Will be cleaned up in a dedicated commit when owner asks — don't sneak it into a feature commit.

---

## 24 · When in doubt

Stop. Re-read this file + `UNTITLED_OS_MASTER_SPEC.md` + `tokens.css`. Ask the owner one targeted question instead of guessing. He prefers a quick clarification over five rounds of rework.

---

## 25 · Updates

When you (future-Claude) learn something important about this project, **append to this file**. The auto-memory directory at `~/Library/...` is outside the connected workspace folders, so the Write tool can't reach it from this session. CLAUDE.md is the single source of truth that survives across sessions.

Format for additions: add a numbered section at the bottom, dated, with title `## {N} · {Title} ({YYYY-MM-DD})`. Don't rewrite history — append.

---

## 26 · Phase 34 — May 13 audit + Sprint A–D (2026-05-13)

Full-codebase audit completed 13 May 2026 and shipped as four sprints (12 commits) on branch `untitled-os`. Key results captured here so future sessions don't re-discover what's already fixed.

### Sprint A — bleed-stop (`3664169`, `5d82909`, `96c17b0`, `a638f84`, `2c73190`)

- New `src/components/v2/Toast.jsx` — zustand-backed toast with imperative API (`pushToast`, `toastError`, `toastSuccess`, `dismissToast`). `<ToastViewport />` mounted at V2AppShell root. Use this instead of `alert()` or per-page inline banners for any new error surface.
- New `src/components/v2/ConfirmDialog.jsx` — promise-based confirm dialog (`confirmDialog({ title, message, confirmLabel, cancelLabel, danger })` returns `Promise<boolean>`). `<ConfirmDialogViewport />` mounted alongside Toast. Use this instead of `confirm()` for destructive bulk operations.
- `LeadUploadV2.jsx` — aborts import when `lead_imports.insert` fails. Previously a failed audit row left `importId` undefined and the loop inserted 500 leads with `import_id = null`. Now hard-fails with a toast + early return.
- `useQuotes.js createQuote` — replaces silent fire-and-forget on `syncClientFromQuote` and the Phase 14 lead-stage advance with `toastError` on failure. Quote still saves; the rep just finds out when the dependent writes fail.
- Five unguarded DB writes now check `error`: `ChangeStageModal:152`, `ReassignModal:44+56`, `SalesDashboard.markDone`, `IncentivePayoutModal.remove`, `PhotoCapture` OCR update.
- `QuoteDetail.handleWhatsApp` — the empty inner catch on `downloadQuotePDF` was the worst silent failure in the app (WhatsApp opened claiming "PDF downloaded locally" when nothing was downloaded). Now tracks `downloadedLocally` flag and toasts on double-failure.
- `LeadsV2` bulk stage change + bulk delete — `confirm()` and `alert()` → `confirmDialog()` and `toastError()`.
- Brand fixes: `GovtProposalDetailV2.jsx:1677` `accentColor: '#facc15'` → `var(--v2-yellow, #FFE600)`; `FollowUpModal.jsx:130` `#81c784`/`#0a0e1a` → `var(--success)`/`var(--accent-fg)`.

**False alarms caught and skipped:** audit explorer claimed (i) Private LED wizard missing `lead_id` contract — actually compliant via `WizardShell.jsx:42` + `useQuotes.js:90-132`; (ii) LogMeetingModal unguarded inserts — actually guards both at 189–194 + 262–275; (iii) 404 handlers missing on `/quotes/:id` and `/leads/:id` — both already exist; (iv) `imHere` interval cleanup missing in LeadDetailV2 — `clearInterval` already returned at line 201. Run a quick re-read before trusting any explorer-agent finding.

### Sprint B — follow-up architecture (`feca0d4`, `89973eb`)

`supabase_phase34_followup_consolidation.sql` (idempotent, ~290 LOC). Fixes four structural bugs:

1. Dead `lead_set_handoff_sla()` trigger — was checking `'SalesReady'` (removed in Phase 30A). Re-pointed at the `New → Working` transition (the Phase 30A handoff semantics).
2. SLA was wall-clock UTC. New `public.next_business_moment(timestamptz)` helper rolls a timestamp to the next IST business day using the existing `is_off_day()` function + `holidays` table. `handoff_sla_due_at` now computed as `next_business_moment(sales_ready_at + 24h)`.
3. No auto-assignment. New `public.assign_lead_round_robin(p_segment text)` picks the active sales/telecaller/agency user (matching segment_access) with the fewest non-terminal leads. `trg_leads_auto_assign` BEFORE INSERT fills `assigned_to` when blank — wizard inserts that already set `assigned_to` are untouched.
4. Orphan `lead_activities.next_action_date`. New `trg_lead_activity_sync_followup` AFTER INSERT upserts the lead's open `follow_ups` row when an activity carries `next_action_date`.

Supersedes the SLA half of `supabase_phase33t_smart_task_fix.sql` (the smart-task RPC body in 33T stays — only the handoff-SLA function is overridden). Any future SLA / handoff work edits the Phase 34 file, **never** spawns a new sub-letter under 33.

### Sprint C — idempotency lockdown (`a54cb43`, `0873cc1`)

- `scripts/check-sql-schema.sh` extended with structure warnings (CLAUDE.md §8): CREATE TABLE / ADD COLUMN without IF NOT EXISTS, CREATE POLICY without DROP POLICY IF EXISTS, INSERT INTO without ON CONFLICT/NOT EXISTS (skipped when the file defines a PL/pgSQL function body), schema mutation without `NOTIFY pgrst`, missing `-- VERIFY` block. Soft warnings by default; `--strict` flag promotes to hard fail.
- `PHASE_33_INVENTORY.md` — one-page map of all 23 phase33 SQL files. Marks the 9 explicit hotfix files (39 % churn rate) and the Phase 34 supersession. Phase 33 documented, not squashed; Phase 11 also document-only.
- The audit-flagged "4 seed files missing ON CONFLICT" was a false grep finding — all four (`phase5`, `phase9`, `phase9b`, `phase11e`) use `WHERE NOT EXISTS` / `HAVING NOT EXISTS` patterns that are equally idempotent.

### Sprint D — dead code + dedup + brand sweep (`5b5e99a`, `09b8c44`, `0c972b2`)

- Deleted 12 dead V1 pages (1,468 LOC): `Cities`, `CreateQuote`, `Dashboard`, `FollowUps`, `HR`, `Incentives`, `MyOffer`, `MyPerformance`, `PendingApprovals`, `Quotes`, `RenewalTools`, `Team`. Routes all use V2 versions; no V1→V1 cross-imports existed.
- Kept V1: `Login.jsx`, `OfferForm.jsx`, `QuoteDetail.jsx`. The latter handles both V1 and V2 routes (auto-redirects govt rows to `/proposal/:id`).
- Single source of truth for status colors. Added `STATUS_COLOR_VARS` to `src/utils/constants.js`. `QuoteDetail`, `GovtProposalDetailV2`, `SalesDashboard` now import instead of redefining. `STATUS_COLORS` (CSS-class map) stays separate — different purpose.
- `WonPaymentModal` — 10 inline Material/Tailwind hex codes (`#81c784`, `#fbbf24`, `#ef9a9a`) → `var(--success)` / `var(--warning)` / `var(--danger)`. Subtle visual shift; brand-token traceability gained.
- **Not done this sprint:** CockpitWidgets has more hardcoded hexes following a chip-tint pattern that requires `--tint-*` tokens — `tokens.css` hasn't declared those yet, so that cleanup needs the token additions first. MasterV2's ~10 `#facc15` / `#0a0e1a` violations stay per §23 line 6 (owner wants them in their own dedicated commit when asked).
- `_phase-b-backup-2026-05-01/` (180 KB) not deleted; will only delete with explicit owner approval.

### Tooling additions you can now use

```js
// Toast — anywhere
import { pushToast, toastError, toastSuccess } from '../components/v2/Toast'
toastSuccess('Saved.')
toastError(error, 'Could not save lead.')

// Confirm — anywhere (returns Promise<boolean>)
import { confirmDialog } from '../components/v2/ConfirmDialog'
if (!(await confirmDialog({
  title: 'Delete leads?',
  message: `Delete ${n} leads permanently? This cannot be undone.`,
  confirmLabel: 'Delete',
  danger: true,
}))) return

// Single status color source
import { STATUS_COLOR_VARS } from '../utils/constants'
```

### What's left after Phase 34

1. `--tint-*` tokens in `tokens.css` + `v2.css`, then sweep CockpitWidgets and any other chip-tint sites.
2. MasterV2 brand cleanup (owner-scheduled commit).
3. ~~`_phase-b-backup-2026-05-01/` removal~~ — DONE Phase 34.5 follow-up (`rm -rf`, was untracked, 180 KB reclaimed).
4. Optional: squash Phase 4 (a–f) into one foundation file for fresh installs.
5. Sprint 3 of the original plan: P&L module port.
6. Sprint 4: receipts/TDS upgrade for govt deals.
7. Govt invoice template (post-WON automation).
8. Wire `numberToWords.js::rupeesToWords` into `QuotePDF` + `OtherMediaQuotePDF` — CLAUDE.md §18 mandates "Total in Words" on every PDF; helper exists, no call site. Real bug.
9. Split `src/utils/formatters.js` — code-review-graph flagged it as god-utility with 247 edges from `leads-handle` community (top coupling warning in arch overview). Deferred from Sprint D because risk:value bad without test coverage. Decompose into `formatters/currency.js` + `formatters/date.js` + `formatters/string.js` once tests exist or pair with a smoke-test session.

### Sprint F (2026-05-13) — sales-module gap closure

Closes 5 of 7 buildable items from the May 13 sales UX audit:

- **Item 9 — phone-first dedup in LogMeetingModal** (`4359922`). Debounced 600 ms phone lookup surfaces the match inline before the rep types company/contact.
- **Item 10 — soften auto-Lost on 3 attempts** (`4359922`, SQL `supabase_phase34b_soft_auto_lost.sql`). Trigger now sets `leads.auto_lost_suggested = true` instead of flipping `stage='Lost'`. LeadDetailV2 surfaces a banner with [Mark Lost] / [Dismiss] buttons. Dismiss calls new RPC `dismiss_auto_lost_suggestion(uuid)`.
- **Item 2 — "Coming up" preview card on /work** (`4359922`). New `UpcomingTasksCard.jsx` shows Tomorrow + Next 7 days follow-up counts.
- **Item 3 — "Copy from your last quote" button** (`4359922`). Private LED WizardShell pre-fills client + cities from rep's most recent non-Lost LED quote.
- **Item 8 — Incentive forecaster on QuoteDetail** (`4359922`). `IncentiveForecastCard.jsx` runs `calculateIncentive` twice (before / after closing this quote) and shows delta + slab-crossing chips.

#### Items NOT shipped this sprint + why

- **Item 1 — CallKit auto-log on hang-up.** Requires iOS native bridge. Current app is React + Vite + Vercel PWA — no Capacitor/Cordova wrapper. Estimated 2-3 weeks to set up a native iOS shell with CallKit observers. Track as separate effort.
- **Item 4 — Offline cache (PWA service worker for /work + /leads).** `public/sw.js` exists for push notifications only. Proper offline cache needs `vite-plugin-pwa` + Workbox + versioning strategy. Estimated 3-5 days including testing on real flaky network. Track as separate sprint; pair with a smoke-test session.
- **Item 5 — Map view + route optimizer on /work.** `leaflet` already in node_modules (used by `GpsTrackV2.jsx`). But `leads` table has no `lat`/`lng` columns and `cities` master has no coordinates, so plotting "where to go today" needs either (a) geocoding addresses via Nominatim/Google or (b) adding lat/lng to leads. Until that prerequisite lands, only "where you've been today" (gps_pings overlay) is buildable — half the feature. Track as Sprint G; decide geocoding strategy first.
- **Item 6 — Govt invoice template (post-WON automation).** Sprint 4 of the original plan. Needs TDS columns on `payments` (2% income + 2% GST) + a new renderer mirroring `OtherMediaQuotePDF` layout for govt segment. Don't sneak into Sprint F.

### Graph integration (added 2026-05-13)

`code-review-graph` MCP installed at workspace root. Use it instead of ad-hoc grep for any dead-code / refactor / impact-radius work — the AST graph catches what basename grep misses, but be aware it ALSO under-reports (e.g. flagged `rupeesToWords` as dead while CLAUDE.md §18 mandates it). Cross-check with grep before any deletion.

Useful invocations:
- `refactor_tool mode=dead_code file_pattern=Untitled/adflux/src` — full dead-symbol list.
- `query_graph pattern=callers_of target=<funcName>` — verify before deleting.
- `get_architecture_overview_tool` — community structure + coupling warnings.
- `get_impact_radius_tool` — blast-radius of a planned change.

Graph DB at `~/Documents/untitled-os2/.code-review-graph/` (gitignored). Rebuilt automatically via the PostToolUse hook in `~/Documents/untitled-os2/.claude/settings.json`.
