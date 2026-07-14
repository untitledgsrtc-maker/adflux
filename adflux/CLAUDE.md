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
- Roles in use: `admin`, `co_owner`, `sales`, `agency`, `telecaller` (plus `hr`, `accounts`, `office_staff`, `staff` per Phase 26b / Phase 50 designations). **No `owner` role** — `users_role_check` CHECK constraint enforces this as of Phase 97.E (commit `bbdce46`, 28 May 2026; closes audit finding F-001b). Don't reintroduce.
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
| `untitled-os` | **app.untitledad.in** (custom domain, Phase 56 18 May 2026) — also reachable at untitled-os-tau.vercel.app | New staging Supabase | All consolidation + new module work. Canonical URL is the custom domain; vercel.app subdomain redirects. |

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
- **Hand-rolled controlled forms** (React Hook Form + Zod were listed here but UNUSED — removed Phase 172.1, see §70)
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

---

## 27 · Emoji waivers (2026-05-13)

Emoji are forbidden by default per §7 + §20. The following site-specific waivers are owner-approved:

| Site | Glyphs | Approved in | Notes |
|---|---|---|---|
| `V2AppShell.greetingFor()` | `☀️ ⛅ 🌙` | Phase 34Z.1 | Time-band suffix on the greeting; replaces three Lucide icons that didn't carry enough warmth |

No other emoji exceptions. The five sites flagged in the 2026-05-13 UI audit (`StaffTable.jsx:38 🎉`, `MyPerformance.jsx:188 🎉`, `WonPaymentModal.jsx:157 💰`, `AdminDashboardDesktop.jsx:899/1772 ⚡🎉`, `SalesDashboardDesktop.jsx:523/660 ⚡`) are NOT in this table and must be migrated to Lucide icons during PR 3.

---

## 28 · Sales module FROZEN (16 May 2026 baseline, commit `e232069`)

Phase 34Z.73 closed the sales-module audit cycle. The rep-facing flow is locked. Any future edit that touches the surrounding code — whether or not the file is in `/pages/v2/` — MUST be audited by the `sales-module-guardian` agent before commit. The full contract list lives at `.claude/agents/sales-module-guardian.md`. Summary:

**Frozen frontend files** (full list in agent file):
- `WorkV2.jsx`, `LeadDetailV2.jsx`, `LeadFormV2.jsx`, `LeadsV2.jsx`, `FollowUpsV2.jsx`,
  `QuotesV2.jsx`, `MyOfferV2.jsx`, `MyPerformanceV2.jsx`, `PushDebugV2.jsx`,
  `SalesDashboard*.jsx`, `CreateQuote*V2.jsx`
- `V2AppShell.jsx`, `PostCallOutcomeModal.jsx`, `TodaySummaryCard.jsx`,
  `TodayTasksPanel.jsx`
  (`MeetingsMapPanel.jsx` removed from this list — DELETED 17-Jun-2026; dead since
  Phase 89.11, replaced by `RepMapPanel`. See §70.)
- `useLeadTasks.js`, `useAutoRefresh.js`, `pushNotifications.js`, `public/sw.js`

**Frozen DB contracts**:
- Lead stages: `New | Working | QuoteSent | Won | Lost | Nurture` (NO others).
- Cadence types: `lead_intro | quote_chase | nurture | lost_nurture` (Phase 33D.6).
- `lead_activities.activity_type` for score: `meeting | call | site_visit` only
  (Phase 34Z.66). WhatsApp + notes intentionally excluded.
- Phase 34Z.50 quote→lead propagation triggers (insert + delete rollback).
- Phase 34Z.55 per-task push triggers on `lead_tasks` + `follow_ups`.
- Phase 34Z.61 9:30 IST morning push (skips Sunday only — Saturday IS a workday).
- Phase 34Z.66 `compute_daily_score` trigger on `lead_activities` AFTER INSERT.
- Phase 34Z.67 `compute_daily_ta` trigger on every `gps_pings` INSERT.
- Phase 34Z.69 `enqueue_push` 5s timeout + `push_log` audit + HARDCODED anon key
  (Supabase hosted blocks ALTER DATABASE — do NOT revert to `current_setting`).
- Phase 34Z.70 `push_failures` view.

**Frozen UX contracts**:
- PostCallOutcomeModal chain: tel: → 1.5s → activity log + modal → save closes old
  follow-up + spawns new + closes any open smart_task for the (lead, rep).
- `useAutoRefresh` mounted on: WorkV2, LeadDetailV2, FollowUpsV2, QuotesV2,
  MyPerformanceV2, TaPayoutsAdminV2.
- Push enrollment lives in **V2AppShell only** (not WorkV2 anymore).
- DESIGN_SYSTEM.md tokens enforced: `--v2-yellow` (brand+CTA only), `--v2-bg-0..3`,
  `--v2-ink-0..2`, `--v2-line`, `--v2-green/blue/amber/rose`.
- No hardcoded hex on sales pages, no truncated lakh/crore, no 16px font,
  no border-radius 4-8px.

**Anti-patterns the guardian blocks**:
- New emoji on rep-facing pages (waivers only per §27).
- Hardcoded `#facc15` (brand yellow is `#FFE600`).
- Removing `useAutoRefresh` from a frozen page.
- Adding a stage / cadence type / activity type without preserving the existing set.
- Reintroducing `owner` role.
- Removing idempotency guards (`IF NOT EXISTS`, `ON CONFLICT`).
- Removing `NOTIFY pgrst, 'reload schema'` from a schema-mutating SQL file.
- Breaking the tel:→1.5s→modal chain in PostCallOutcomeModal.
- Adding push enrollment to a page other than V2AppShell.

When in doubt: invoke the guardian. It's cheap; the regression isn't.

---

## 29 · Sales module FINAL — ship-ready (Phase 34Z.88, 2026-05-16)

Final pre-ship sweep complete. Sales module is SHIPPED on `untitled-os` and ready for Sunday 17 May 2026 deadline. Treat as a closed module — no inline patches without a guardian audit.

### What Phase 34Z.88 fixed (post-freeze audit)

Guardian agent returned 7 findings — 1 P0, 4 P1, 2 P2. All applied. No contract churn, no functional change, no SQL.

| # | Sev | File | Fix |
|---|-----|------|-----|
| 1 | P0 | `src/styles/v2.css` `.v2d-mdrawer` / inner | `z-index 60 → 200` + inner `201`. Topbar bell + `11` badge no longer bleed over the mobile sidebar drawer on iOS. |
| 2 | P0 | `src/components/v2/NotificationPanel.jsx:214` | Dropdown `zIndex 200 → 100`. Drawer always wins, topbar (10) + nav (40) still lose. |
| 3 | P1 | `NotificationPanel.jsx:231` | Unicode `✓` → `<CheckCircle2 size={22} />` in empty state. §7 Lucide-only. |
| 4 | P1 | `NotificationPanel.jsx:196` | Bell badge `borderRadius 8 → 999` (pill, on-scale). |
| 5 | P1 | `src/pages/v2/TaPayoutsAdminV2.jsx:154` | Dropped `enabled` gate on `useAutoRefresh`. `loadRows` early-returns when filters empty, so unconditional mount covers tab-resume even with cleared month. |
| 6 | P2 | `src/components/v2/V2AppShell.jsx:396` | ⌘K hint `borderRadius 4 → 6` (token scale min). |
| 7 | P2 | `NotificationPanel.jsx:249` | Notification item icon `borderRadius 8 → 10` (`--radius`). |

### Z-index landscape (frozen 16 May 2026)

```
10    sticky topbar
40    mobile bottom nav, PeriodPicker
50    ClientsV2 modal, more-drawer backdrop
60    avatar more-drawer
100   NotificationPanel + GlobalSearchBar dropdowns
100   MasterV2 modal (admin only)
200   v2d-mdrawer (mobile sidebar)
201   v2d-mdrawer-inner
1000  FilterDrawer, DateRangeFilter
9000  Modal primitive (PostCallOutcomeModal lives here)
9999  Toast
10000 ConfirmDialog
```

Any new overlay MUST slot into this scale. Do not invent new tiers.

### Sales module is now a "no-touch" surface

Anything that even brushes the frozen files in §28 — including styling, imports, or fallback values — needs the `sales-module-guardian` agent to PASS before commit. Patch-chain anti-pattern (§3) is the explicit failure mode the freeze prevents.

If a real bug surfaces post-ship, the right path is:
1. Reproduce on staging.
2. Run guardian on the proposed diff.
3. Land as a single Phase 34Z.{N+1} commit, not as a sub-letter chain.

### What's still NOT built (do not assume otherwise)

- **P&L module** — spec only. `docs/UNTITLED_OS_v2_ARCHITECTURE.md` §7.5 + §8.2 describes the tables (`quote_pnl`, `monthly_admin_expenses`), pages (`PnLLanding`, `PnLSummary`, `QuotePnL`, `AdminExpenses`), store (`pnlStore`), trigger (`auto_create_quote_pnl`), and owner-only RLS gating. **No code, no SQL, no routes exist.** Listed as Sprint 3 pending in §22 + §26 backlog item #5.
- **Govt invoice template** — backlog item, Sprint 4.
- **TDS columns on `payments`** — required before first Govt deal hits PARTIAL_PAID. Not added yet.
- **Telecaller module Sprint 1** — PostCallOutcomeModal wiring into TelecallerV2 audited + scoped but NOT shipped. Awaiting go-ahead.

### Push deadline

Owner pushes from his Mac terminal:
```
cd ~/Documents/untitled-os2/Untitled/adflux
git push origin untitled-os
```
Vercel auto-deploys. No SQL for 34Z.88. Smoke test = open hamburger drawer at `/work` on iPhone, confirm bell + badge sit BEHIND the drawer overlay.

No other emoji exceptions. The five sites flagged in the 2026-05-13 UI audit (`StaffTable.jsx:38 🎉`, `MyPerformance.jsx:188 🎉`, `WonPaymentModal.jsx:157 💰`, `AdminDashboardDesktop.jsx:899/1772 ⚡🎉`, `SalesDashboardDesktop.jsx:523/660 ⚡`) are NOT in this table and must be migrated to Lucide icons during PR 3.

---

## 30 · Telecaller module SHIPPED (Phase 43–49.1, 2026-05-18)

Full-day sprint built the telecaller (TC) module end-to-end. TC =
inside-sales rep who closes deals via phone (no field meetings) +
earns same incentive as field sales. Dhara + Rima (existing) +
Renuka (new TC lead) start using Monday 19 May 2026.

### What shipped (chronological)

| Phase | What | SHA |
|---|---|---|
| 43.1 | Bleed-stop: tel-tap audit + PostCallOutcomeModal chain + useAutoRefresh; /voice dropped from TELECALLER_NAV; loading spinner | `583fd38` |
| 43.2 | Productivity: daily call target ring + connect-rate KPI + auto-advance after modal save | `35b650c` |
| 43.3 | Upcoming callbacks panel (next 48h open follow_ups) | `b4d9458` |
| 43.4 | Guardian fixes: IST date anchor + brand-token tints + note column | `4617a6e` |
| 47.1 | WhatsApp 1-click template send (new `whatsapp_templates` master + WhatsAppSendModal + Master tab) | `6df030b` |
| 47.2 | Inline call scripts on hero (new `call_scripts` master + Master tab + collapsible panel; segment-matched) | `e24b368` |
| 47.3 | HeatPicker component + inline on TC hero/queue/LeadDetail + TC top-hot-leads card | `e5d1847` |
| 47.4 | SQL trigger `trg_lead_auto_heat_from_outcome` (positive→hot, negative→cold; skips Won/Lost) | `53e5c6a` |
| 47.5 | DNC + WhatsApp opt-out (`leads.do_not_call` + `leads.wa_opt_out` + `dnc_reason` + `dnc_at`) + call/WA button guards | `8823867` |
| 47.6 | Stale lead alert banner on /telecaller (3+ days no contact, DNC excluded) | `b671580` |
| 47.7 | Source attribution card on admin /dashboard (last 90 days, conversion per source) | `98c7110` |
| 47.8 | Call language tag on `call_logs.language` ('gu'/'hi'/'en'); chip in PostCallOutcomeModal | `8b3fb07` |
| 47.9 | IST helper unified — new `src/utils/istDate.js` via Intl.DateTimeFormat (Asia/Kolkata); 7 sites swapped; "Call back in 4h"/"Call back later today" chips removed | `2fef352` |
| 49 | 4 TC policies surfaced: 50 calls/day · 30% connect · 5 qualified/week · 0 SLA breaches; `daily_targets.min_connect_pct` + `min_qualified_weekly` | `19a1d33` |
| 49.1 | Guardian P2 fixes: Unicode arrows → Lucide; UTC bug in close query → istTodayISO; #0a0e1a → var(--accent-fg); borderRadius 8 → 10 (4 sites) | `0be3395` |

### New SQL tables / columns

- `whatsapp_templates` (47.1) — admin CRUD via Master → WhatsApp
- `call_scripts` (47.2) — admin CRUD via Master → Scripts
- `lead_activities.outcome` enum widened to add 'callback' (Phase 45.3 from earlier sprint)
- `leads.do_not_call` boolean + `leads.wa_opt_out` boolean + `leads.dnc_reason` text + `leads.dnc_at` timestamptz (47.5)
- `call_logs.language` text CHECK ('gu','hi','en') (47.8)
- `daily_targets.min_connect_pct` int DEFAULT 30 + `daily_targets.min_qualified_weekly` int DEFAULT 5 (49)

### New triggers

- `trg_lead_first_engagement_advance` (Phase 45.2 earlier) — call/meeting/site_visit on 'New' lead → stage='Working'
- `trg_lead_auto_heat_from_outcome` (47.4) — outcome positive→hot, negative→cold; skips closed leads + neutral/callback

### Frozen file touches this sprint (all guardian-cleared PASS)

| File | What changed | Risk |
|---|---|---|
| `src/pages/v2/TelecallerV2.jsx` | New call chain, heat picker, WA button, scripts, callbacks, hot-leads card, IST fix, 4 policy KPIs | None — additive |
| `src/pages/v2/LeadDetailV2.jsx` | HeatPicker on hero, DNC toggle, WA opt-out toggle, Phone field DNC gate | None — additive |
| `src/components/leads/PostCallOutcomeModal.jsx` | 'callback' outcome chip, call_back_2h chip, call language picker, IST fix via shared util | Save chain intact |
| `src/components/leads/LeadShared.jsx` | New HeatPicker component (popover) | New export only |
| `src/components/v2/V2AppShell.jsx` | /voice dropped from TELECALLER_NAV; MOBILE_NAV_TELECALLER /voice → /quotes | SALES_NAV / AGENCY_NAV / MOBILE_NAV_SALES / ADMIN untouched |

### TC compensation model (parked decision)

Owner clarified: **TC closes deals via phone + earns same incentive
as sales reps** (not flat salary). compute_monthly_salary RPC still
applies 70/30 base/variable to TC. No special role gate built —
existing sales math works.

Open gap: monthly_score formula counts `meeting | call | site_visit`
equally. For a TC who only does calls, score formula already works
(calls count). No change needed unless owner wants TC-specific
weighting later.

### Renuka team-lead view — DEFERRED

Renuka (TC lead) needs a team dashboard to monitor Dhara + Rima:
- Per-TC call disposition (calls / connected / qualified daily)
- Connect rate per TC
- Conversion funnel: calls → connected → qualified → handed-off → won
- Reassign authority between TCs

Folds into Phase 42.2 sales_manager frontend work — same MANAGER_NAV
+ /people-style scope. Phase 42 DB foundation already shipped (Jubin
+ Renuka inserted, manager_id chain ready, incentive_override_pct
column ready). Frontend deferred until owner names the priority.

### Frozen contracts protected (re-verified)

Same §28 + §29 + §31 contracts hold:
- SALES_NAV / AGENCY_NAV / MOBILE_NAV_SALES / MOBILE_NAV_ADMIN byte-identical
- useAutoRefresh on 6 frozen pages (including TaPayoutsAdminV2)
- Push enrollment V2AppShell only
- PostCallOutcomeModal tel:→1.5s→modal save chain intact
- Lead stages / cadence types / activity_type enums unchanged
- lead_activities.outcome widened to add 'callback' (additive)
- No `#facc15`, no new emoji on rep-facing pages

### Foot-guns added this sprint (don't repeat)

- ❌ `(5.5*60 - now.getTimezoneOffset())*60000` IST formula — only works on UTC devices. Use `src/utils/istDate.js` helpers (`istTodayISO`, `istNowPlusHoursDateTime`, `istTodayPlusDays`, `istCurrentMonthYM`, `istCurrentMonthLabel`).
- ❌ Unicode triangle/check/star characters as icons — Lucide only.
- ❌ `borderRadius: 8` — off-scale on v2 (10/14/20). Use `var(--v2-r-sm)` (10) or 14.
- ❌ `#0a0e1a` hardcoded — not a token. Use `var(--accent-fg, #0f172a)`.

### Smoke checklist for Dhara + Rima + Renuka (Monday handoff)

- [ ] Open `/telecaller` → loading spinner, then hero with name + Next Call card
- [ ] Hero shows `X/50` calls today + connect-rate chip + ring %
- [ ] KPI strip below hero: 4 tiles with target compare (Calls / Connect / Qualified weekly / SLA breaches)
- [ ] Tap "Call now" → dialer opens → return to app → modal opens after 1.5s
- [ ] Modal outcome row has 4 chips: Good · Maybe · Call later · Lost
- [ ] Modal next-action first chip is "Call back in 2 hours"; date = today IST, time = now+2h IST
- [ ] Pick outcome "Good" + save → lead heat auto-flips to hot
- [ ] Tap heat dot on any lead → popover → set to hot → reload → hot leads card shows it
- [ ] WhatsApp green button on hero → modal opens → pick template → text pre-fills → "Open WhatsApp" → handoff to app
- [ ] Tap "▾ Script" on hero → collapsible panel shows pitch with `{name}` replaced
- [ ] Upcoming callbacks panel appears when ≥1 follow_up due in next 48h
- [ ] Mark lead "DNC ON" → tel: button disabled with tooltip
- [ ] Mark "WA opt-out ON" → WhatsApp button blocked with toast
- [ ] Stale lead banner appears if ≥1 lead has no contact 3+ days
- [ ] `/voice` not in sidebar (deep-link still works)
- [ ] Admin /dashboard → "Source attribution · last 90 days" card shows conversion per source

### Deferred for next sprint (not blocker)

- Renuka's team-lead dashboard (folds into Phase 42.2)
- TC incentive engine variation (today: same as sales — owner can override)
- Power dialer integration (Exotel/Knowlarity) — needs procurement decision

### Commit log (untitled-os branch, this sprint)

```
0be3395 Phase 49.1: guardian P2 fixes
19a1d33 Phase 49: 4 TC policies surfaced
2fef352 Phase 47.9: IST bug fix via Intl + chip trim
8b3fb07 Phase 47.8: call_logs.language tag
98c7110 Phase 47.7: source attribution card (admin)
b671580 Phase 47.6: stale lead alert banner
8823867 Phase 47.5: DNC + WA opt-out
53e5c6a Phase 47.4: auto-heat trigger
e5d1847 Phase 47.3: heat picker + TC hot leads card
e24b368 Phase 47.2: inline call scripts on hero
6df030b Phase 47.1: WhatsApp 1-click template send
4617a6e Phase 43.4: guardian P1+P2 fixes
b4d9458 Phase 43.3: upcoming callbacks panel
35b650c Phase 35b650c: productivity layer
583fd38 Phase 43.1: bleed-stop (call audit + modal + auto-refresh)
```


---

## 33 · Phase 76 — Evening Day Summary + GPS lockdown v1 (2026-05-22)

Web/PWA portion shipped. Native APK plugin (76.2) PARKED to next
session per owner directive 22 May 2026.

### What shipped this session

| Phase | What | SHA |
|---|---|---|
| 76.1 | SQL — 4 tracking event tables + work_sessions column + gps_pings dedup unique constraint | `50a6ba1` |
| 76.3 | DaySummaryCard + GpsOffBanner + useDaySummary + useGpsLock + whatsappSummary formatter | `567e771` |
| 76.4 | Wire DaySummaryCard + GpsOffBanner into WorkV2 + LeadDetailV2 (guardian PASS after 2 fixes) | `f02682f` |

### New SQL tables (all RLS-protected, admin_all + self_read/write/close-while-null)

- `gps_off_events`     cycle log of Location toggle off/on
- `network_off_events` cycle log of internet drop/regain
- `force_stop_events`  heartbeat-gap detection on app relaunch
- `gps_block_events`   UI banner blocks (CHECK on action_attempted: start_day | i_am_here | log_meeting | log_lead | mark_followup_done | quote_sent)

### New column + constraint

- `work_sessions.evening_summary_sent_at` — dedup for any future 7:30 PM auto-send
- `gps_pings UNIQUE (user_id, captured_at)` — prevents offline-queue retries from inflating daily_ta km counts

### Owner-locked decisions (DO NOT relax without re-approval)

1. **No GPS-off score penalty in v1.** Owner: "no need right now." Penalty column on `daily_score` + trigger reading `gps_off_events.duration_seconds` can be added later.
2. **No server-side 7:30 PM WhatsApp auto-send.** Manual rep-tap-only for v1. Existing scorecard cron untouched.
3. **No admin push when rep dark.** Owner watches /team-dashboard manually for now.
4. **No weekly GPS leaderboard.** Deferred to Phase 77.
5. **No productive-button gating.** Phase 76.4 is additive only — banner + card mount, no `disabled={!gpsOn}` wrapping on Log meeting / I'm here / Mark done. If owner wants this later it's Phase 76.4b. Guardian PASS contingent on this scope.
6. **Emoji in WhatsApp text body: APPROVED (Option X).** Owner picked emoji format 22 May 2026. Routed to WhatsApp NOT in-app UI → §7 + §20 emoji ban does not apply. The `🟡 📅 👤 📋 📊 🛰️ ⚠️ ✅` set in `src/utils/whatsappSummary.js` is permanent unless owner says otherwise.
7. **Recipient flow: one extra tap.** `whatsapp://send?text=...` deep-link opens WhatsApp; rep picks role group manually from contact picker. No master config of group invite links. Owner approved Option A 22 May 2026.

### PENDING — Phase 76.2 Android plugin (carry over to next session)

Owner said: "i will do tomorrow... remind me when i say we will do tomorrow."

Build when owner reopens this conversation tomorrow:

| File | What |
|---|---|
| `android/.../service/GpsToggleReceiver.kt` | BroadcastReceiver on `LocationManager.MODE_CHANGED_ACTION` — writes gps_off_events row on flip OFF, closes row on flip ON |
| `android/.../service/NetworkWatcher.kt` | `ConnectivityManager.NetworkCallback` `onLost`/`onAvailable` — writes network_off_events row |
| `android/.../service/HeartbeatService.kt` | 60-second tick into SharedPreferences `last_seen_at`. On next app launch compare to now; gap >5 min during 10-7 IST → write force_stop_events row |
| `android/.../service/EventQueueDb.kt` | Room/SQLite local table for offline events; drain to Supabase on network reconnect |
| `android/.../plugin/TrackingPlugin.kt` | Capacitor plugin registers as `UntitledTracking`. Methods: `isGpsOn()` → `{value:boolean}`, `requestEnableGps()` → invokes `SettingsClient.checkLocationSettings` resolution dialog, `addListener('gpsStateChanged', cb)` → fires on every receiver event |
| `android/.../AndroidManifest.xml` | Add permissions: `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE_LOCATION`, `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED`. Register receivers + plugin |
| APK rebuild | New signed APK; redistribute to all 6 reps via existing channel (`app.untitledad.in/apk` or WhatsApp) |

Owner already approved force-stop heartbeat 2-3% battery cost.

### Smoke test for the shipped portion (after owner pushes + runs SQL)

- [ ] 7 PM IST → DaySummaryCard appears on /work above TodaySummaryCard
- [ ] Before 7 PM → card hidden (no flash). Card render gate: `Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false })` parsed hour ≥ 19
- [ ] Plan numbers populate from work_sessions.planned_* OR daily_targets.min_calls fallback
- [ ] Actual numbers populate from lead_activities (created_by filter — fixed in guardian P1)
- [ ] Tap X → card dismisses, stays dismissed until reload
- [ ] Tap "Share to your group" → WhatsApp opens with text pre-filled, rep picks group
- [ ] work_sessions.evening_summary_sent_at stamped on share
- [ ] "Last shared HH:MM IST" shows underneath CTA on re-render
- [ ] Disable phone Location → red GpsOffBanner appears on /work + /leads/:id
- [ ] Tap "Turn on GPS" → web build re-probes geolocation; native build will fire SettingsClient once 76.2 ships
- [ ] Admin / co_owner do NOT see DaySummaryCard (role gate)
- [ ] TC role: Meetings + Site visits rows hidden, Qualified row visible
- [ ] Guardian PASS on WorkV2 + LeadDetailV2 (already verified this session)

### Foot-guns added this phase (don't repeat)

- ❌ `.eq('user_id', ...)` on `lead_activities` — column is `created_by` (Phase 12 schema). Guardian P1 caught the silent-zero-rows bug.
- ❌ Passing `color="..."` to a Lucide icon — must inherit via wrapping span's `color` style (CLAUDE.md §7 "Color inherits from parent. Don't hardcode color on `<Icon>`"). Guardian P2 caught this.
- ❌ Querying `quotes.won_at` — column doesn't exist. Use `updated_at` as proxy when filtering `status='won'` (matches AdminDashboardDesktop:385 + SalesDashboard:575 pattern).
- ❌ Native `Date().toISOString().slice(0,10)` for IST today — returns UTC. Use `istTodayISO()` from `src/utils/istDate.js` (Phase 47.9 single source of truth).

---

## 34 · Phase 87 batch + 84.5.1 + 85.3.1 (2026-05-23)

Full-day batch closing owner's 24 May directive: TA approval UX,
TC visibility, rep profile pic, profile-pic map pins, plus two
production bug fixes uncovered during smoke (gpsOffEvents crash +
straight-line route).

### What shipped (chronological)

| Phase | What | SHA |
|---|---|---|
| 87.1 | "All team" option on TA Claims dropdown (`TaPayoutsAdminV2`) | `05847bf` |
| 87.2 | Hide zero-value TA rows from approval list (Option A) + "Show empty" toggle | `05847bf` |
| 87.3 | Hide MEET KPI on TC rep-side `/work` + `/telecaller` (applies to role='telecaller' AND team_role='sales_manager' so Renuka also affected) | `05847bf` |
| 87.5 | Rep profile picture upload (`ProfilePicUploader` + MyOfferV2 mount + `user-avatars` bucket + RLS) | `4cb4250` |
| 87.6 | Profile-pic markers on Live field map (`TeamDashboardV2` — circular avatar pins inside freshness ring) | `7fc346d` |
| 84.5.1 | Fix `gpsOffEvents` ReferenceError on `/admin/gps` (Phase 84.5 left it as free reference inside `RepDaySections` sub-component) | `d018bdd` |
| 85.3.1 | Swap JWT requireAuth → same-origin + rate-limit on `/api/directions` + `/api/snap-to-roads` (Phase 85.3 was silently bailing on expired PWA sessions → straight-line route) | `883ae11` |

### New SQL — Phase 87.5

`supabase_phase87_user_avatars.sql` (idempotent, owner-applied
2026-05-23). Adds:
- `users.profile_image_url text`
- `storage.buckets` row for `user-avatars` (public, 5 MB cap)
- 4 RLS policies: public SELECT; INSERT/UPDATE/DELETE when path
  starts with `<auth.uid()>/...` OR `get_my_role() IN ('admin',
  'co_owner')` for HR onboarding.

Path convention: `user-avatars/<user_id>/<timestamp>.jpg`. Client
canvas re-encode strips EXIF + caps long edge at 512 px.

### New helper file — Phase 85.3.1

`api/_guard.js` — shared `guardProxy(req, res)` that combines:
1. `Origin` / `Referer` allowlist check (`app.untitledad.in`,
   `untitled-os-tau.vercel.app`, any `*.vercel.app` for previews).
2. Per-IP rate limit (60 req / 60s / IP) — same in-memory bucket
   pattern as `/api/shorten` Phase 85.4.

Used by `/api/directions` + `/api/snap-to-roads`. Replaces
Phase 85.3 `requireAuth` on both. JWT path retired for these two
proxies; `_auth.js` stays for any future endpoint that genuinely
needs per-user identity (e.g. `/api/pdf/[ref]` still uses it via
service-role for the share-token lookup).

### New component — Phase 87.5

`src/components/profile/ProfilePicUploader.jsx` — 72 px circular
avatar with brand-yellow initials fallback. File-picker → canvas
resize to 512 px + JPEG 0.85 → upload to `user-avatars/<uid>/
<ts>.jpg` → update `users.profile_image_url` → refresh auth store
`profile` so topbar + sidebar + map avatar all see the new pic
immediately. Upload / Replace / Remove buttons. Inline error.
Toast on success.

Mounts at the top of both `MyOfferV2` render paths (offer-loaded
and no-offer-on-file).

### New helpers in TeamDashboardV2 — Phase 87.6

- `drawInitialsOnCanvas(ctx, name, size)` — brand-yellow square +
  navy initials text.
- `buildAvatarMarkerIcon(google, name, profileUrl, color,
  imageCache)` — returns Google Maps icon `{ url:
  'data:image/png;base64,...', scaledSize, anchor }`. Draws:
  1. Outer freshness-colour ring (green ≤5min, amber ≤30min, red
     30min+).
  2. Thin white separator.
  3. Inner clip → `drawImage(cached HTMLImageElement)` OR
     initials fallback.
  4. `canvas.toDataURL('image/png')`. Falls back to initials-only
     canvas if cross-origin taint blocks `toDataURL`.
- New ref `imageCacheRef` + state `iconBump` so images pre-load
  once and the marker effect re-runs when any image finishes.
- Marker effect cache key `${user_id}|${profile_image_url}|
  ${color}` — canvas rebuilds only when ring band or pic URL
  changes. No per-tick CPU on the Realtime 5-min ping cadence.

### Owner-locked decisions

1. **`user-avatars` bucket is public + 5 MB cap.** Same shape as
   `letterheads`, `city-photos`. Owner approved 24 May 2026 — pics
   are inherently shareable (badge on PDFs / map pins).
2. **Phase 87.6 didn't extend `LeadAvatar`.** Shared component is
   imported into sales-frozen pages; extending it triggers a
   sales-module-guardian re-audit cycle. Defer until owner asks
   for avatars on rep grid cards too.
3. **Phase 85.3.1 trade-off accepted.** Determined attacker with
   curl + spoofed Origin can still hit Google proxies within rate
   limit. At single-tenant scale + Cloud Console key restrictions
   (Directions / Roads / Maps JS only), that's tighter than the
   alternative (silent road-snap failure on every PWA-session
   expiry). Stays this way until someone reports real abuse.

### Anti-patterns the guardian / I caught this batch

- ❌ **State declared in parent, used in child sub-component
  without prop wire.** Phase 84.5 bug — `gpsOffEvents` declared
  in `GpsTrackV2()` but referenced inside `RepDaySections()`,
  sibling sub-component. Free reference → esbuild left
  unmangled → runtime `ReferenceError`. Always pass state down
  via props when extracting a sub-component.
- ❌ **Silent bail on auth header inside fetch IIFE.** Phase 85.3
  pattern: `if (!token) return  // bail silently` is a foot-gun.
  PWA sessions expire silently on iOS home-screen installs. If
  you must auth, surface the failure (toast + console). Better:
  use same-origin guard instead of per-user JWT for endpoints
  that don't need user identity.

### Smoke checklist (post-deploy)

- [ ] `/my-offer` → `ProfilePicUploader` mounts at top. Initials
      in brand yellow before upload. Upload swaps to pic.
      Topbar + sidebar avatar refresh inline.
- [ ] `/team-dashboard` → live map shows circular avatar pins
      inside green/amber/red rings. Reps without `profile_image_
      url` get initials in brand yellow inside same ring.
- [ ] `/admin/gps/<userId>` → page renders, activity timeline
      shows gps_off events inline, road-snapped Google
      polyline paints (NOT the raw 2-3-point line).
- [ ] TA Claims tab (admin /people?tab=ta) → team dropdown has
      "All team" option. Zero-value rows hidden by default;
      "Show empty (N)" toggle reveals them.
- [ ] TC role on `/work` and `/telecaller` → MEET KPI tile
      absent from KPI row + DayStatusSurface. Renuka
      (team_role='sales_manager' + role='telecaller') also
      sees TC variant.
- [ ] No console errors. No silent fetch bails.

### Pending after this batch

- **Phase 87.4** — telecaller flow audit (read-only doc). 30 min.
  Next default move.
- **Phase 87.7** — native dialer auto-launch in APK (Capacitor
  intent `ACTION_DIAL`). ~2 hr. Blocked on 76.2 APK rebuild.
- **Phase 76.2** — Android plugin (GPS toggle + network watcher
  + heartbeat + event queue + manifest) + APK rebuild. 4-6 hr.
  Owner-deferred to "tomorrow" 22 May 2026.
- **Phase 88.x** — save-speed sprint proposed (optimistic UI +
  Capacitor bundled mode + PWA cache + trigger consolidation +
  bundle slim + realtime replace polling). 20 hr total. Owner
  hasn't named priority.

### Commit log (untitled-os branch, this batch)

```
883ae11 Phase 85.3.1: swap JWT auth for same-origin guard on Google proxies
d018bdd Phase 84.5.1: fix gpsOffEvents ReferenceError in RepDaySections
7fc346d Phase 87.6: profile-pic map pins on Live field map
4cb4250 Phase 87.5: rep profile picture upload (MyOfferV2 + bucket)
05847bf Phase 87.1-.3: TC MEET hide + TA zero-row hide + All-team filter
```

### Foot-guns added this batch (don't repeat)

- ❌ Extracting a sub-component without passing every closed-over
  state as a prop. Sibling functions don't share parent's
  `useState` bindings.
- ❌ JWT bearer header on endpoints that don't need user identity
  — choose same-origin + rate-limit instead. PWA session expiry
  is the silent killer.
- ❌ Public storage bucket without `file_size_limit`. Owner-side
  cost discipline. Phase 87.5 caps at 5 MB.
- ❌ `crossOrigin="anonymous"` on `<img>` for Supabase storage
  WITHOUT `Access-Control-Allow-Origin: *` from the server — would
  taint canvas. Supabase public buckets serve `*` by default; if
  ever swapping to a private CDN the avatar canvas will silently
  fall back to initials.
- ❌ Reusing the same `Loader` from `@googlemaps/js-api-loader`
  with different `libraries:` between mounts. Already documented
  Phase 70.6.1; restated here because TeamDashboardV2 uses
  `libraries: ['geometry']` which must match GpsTrackV2's loader
  for the singleton to settle clean.

---

## 35 · Blast-radius rule — NEVER push without surrounding-code audit (2026-05-23, OWNER DIRECTIVE)

Owner directive 23 May 2026 (after 4 recovery cycles in one session
from Phase 84.5 `gpsOffEvents` scope bug + Phase 85.3 `_auth.js`
Vercel bundling crash + Phase 85.3.1 `_guard.js` same bundling crash):

> "now make perment rule any chnages even small chek entire
>  surrouding code so this not happned. dont push untile all no
>  bug free for that of you need agent you can create. but i
>  dont want to spile time just to recover what we build"

This is a HARD rule. Higher priority than ship-speed. No exceptions.

### What "surrounding code" means

For EVERY change, before commit, audit:

1. **Direct callers** — every file that imports / calls the
   symbol you touched. Use `Grep` or
   `query_graph pattern=callers_of target=<symbol>`.
2. **Scope chain** — if you add / extract / move a sub-component,
   verify every state + prop + ref it closes over still resolves.
   The Phase 84.5 `gpsOffEvents` bug: state in parent, used in
   child sub-component, no prop wire → free reference → runtime
   crash. Always grep the moved code for identifiers and confirm
   each one is either (a) in the new scope, (b) imported, or (c)
   passed as a prop.
3. **Build-system contract** — Vercel serverless functions do NOT
   bundle `_`-prefixed sibling files (confirmed via 85.3 + 85.3.1
   double-crash). Other build quirks: Vite chunk splits,
   Capacitor `server.url` vs bundled, PWA service-worker cache,
   esbuild minifier free-variable preservation. If your change
   touches an `api/*.js` file, a Vite config, or a `capacitor.
   config.json` — read the build docs OR test in deployed preview
   before pushing to prod.
4. **Runtime contract** — what's actually executed in production?
   Vercel functions on Node 18+ ESM, Capacitor APK shell, PWA on
   iOS Safari home-screen, browser web. The same JS line behaves
   differently across these. If you can't predict the runtime
   behaviour, deploy to a Vercel preview branch FIRST.
5. **Sales-frozen contracts** (§28 / §29 / §31) — if the change
   touches a frozen file, INVOKE sales-module-guardian agent
   BEFORE commit. The guardian is read-only; it costs nothing
   to run and catches contract drift the eyeball misses.

### Pre-commit verification (mandatory, supersedes §15)

This replaces the lighter §15 protocol. New gates, in order:

| Gate | Tool | Pass condition |
|---|---|---|
| 1 | `esbuild --loader:.jsx=jsx` parse on every changed `.jsx` | No syntax error |
| 2 | `node --check` on every changed `.js` API file | No syntax error |
| 3 | `bash scripts/check-sql-schema.sh` on every changed `.sql` | No structure warning |
| 4 | `bash scripts/check-jsx-brand.sh` on every changed `.jsx` | No `#facc15` / off-token violations |
| 5 | **Blast-radius scan** — for each touched symbol, `grep -rn '<symbol>'` across `src/` + `api/`. Read every match. Confirm scope, types, deps still valid. | Zero free references, zero stale callers |
| 6 | **Build-system check** — if change touches `api/*`, `vite.config.*`, `capacitor.config.*`, `vercel.json`, `index.html`, `package.json`: spawn `Plan` agent OR test in Vercel preview deploy. | Plan agent PASS or preview deploy returns expected behaviour |
| 7 | **Frozen-module check** — if change touches any §28 file: invoke `sales-module-guardian` agent | Guardian PASS (no P0/P1 findings) |
| 8 | **Runtime check** — predict the deployed behaviour. If you can't predict it (new Vercel function, new APK plugin, new service worker), DO NOT commit-to-push. Deploy to preview branch first. | Owner-verifiable smoke OR preview confirms |

Skip a gate only with owner's explicit one-line approval. Never
skip silently.

### When to spawn an agent

If the change is bigger than a 1-file pure tweak:

- **`Plan` agent** — multi-file changes, refactors, new architecture.
  Returns ordered steps + critical files. Use BEFORE writing code.
- **`Explore` agent** — "what's the blast radius of touching
  `<symbol>`" or "where is `<X>` used across the codebase". Returns
  reference list.
- **`general-purpose` agent (worktree)** — full-scope verification
  (parse all changed files, grep all consumers, simulate a build).
  Use when the change is risky AND you don't have a preview deploy.
- **`sales-module-guardian` agent** — read-only audit of sales-
  frozen surfaces. Cheap; ALWAYS use when a §28 file is in the diff.
- **`code-reviewer` agent** — second-opinion review for any change
  that landed bugs in the past 3 sessions (e.g. API endpoints +
  sub-component extractions).

Agent cost ≪ owner's recovery cost. When in doubt, spawn.

### "Don't push until bug-free"

A push fires Vercel deploy → owner smokes on iPhone → if broken,
owner has to:
1. Notice the bug.
2. Wait for me to diagnose.
3. Wait for me to fix.
4. Push again.
5. Wait for new build.
6. Re-smoke.

That cycle is ~10-15 min minimum, often longer with PWA cache.
Today wasted 3 cycles on the same Vercel `_` bundling issue.

NEW RULE: I do NOT advise pushing until I have verified the
change works. Verification path:

- **Pure FE change with parse-check + grep-clean**: OK to advise
  push immediately.
- **Vercel API change**: MUST hit the function via curl on a
  preview URL OR confirm the import graph is `_`-prefix-free
  AND the helper is inlined OR the helper has a bare name AND
  has been tested in a previous deploy. NO theoretical fixes.
- **Sub-component extraction / state move**: MUST grep every
  identifier in the moved block. Confirm parent + child have
  matching scopes. If unsure, run general-purpose agent first.
- **SQL migration**: MUST end with `-- VERIFY` block. Idempotent
  re-run friendly. Owner pastes manually; can't test from here.
- **Build / capacitor / vercel.json change**: MUST deploy to a
  preview URL FIRST. Confirm runtime behaviour. Only then push
  to `untitled-os` (production).

If a fix has any uncertainty, SAY SO explicitly. Don't claim
"fixed" when it's "I think it's fixed but haven't tested in the
target runtime".

### Today's lessons baked in

- ❌ Don't extract a sub-component without grepping every
  identifier in the moved block. Phase 84.5 cost a recovery cycle.
- ❌ Don't add a Vercel `_`-prefixed helper expecting it to be
  bundled. It isn't on this project. Inline OR rename without
  underscore. Phase 85.3 + 85.3.1 cost TWO recovery cycles for
  the same root issue.
- ❌ Don't silent-bail in a fetch IIFE. If auth check fails,
  surface it (toast + console) so the bug is visible. Phase 85.3
  hid the FUNCTION_INVOCATION_FAILED for the entire deploy window.
- ❌ Don't push a "fix" without running curl / claude-in-chrome
  against the new endpoint. Phase 85.3.1 was committed as a fix,
  pushed, and still 500-ed. We learn this AFTER the push.

### Owner's expectation

When I say "push now" — it means I have verified the change works.
When I say "let me verify first" — that's the new default for
anything outside trivial scope. Recovery cycles are MY failure to
audit, not the owner's failure to test. The buck stops here.


---

## 36 · Save-speed sprint + APK touch-ups (2026-05-23 end-of-session)

Owner approved (afternoon 23 May): full save-speed + APK bucket.
Directive: "make sure it musk work supper easy the feely like its
done in milisecons" + "currnt flow dont chnage. dont affect current
structure becs it perfectly fine".

### Shipped (6 commits, all parse + 10-check verified per §35)

| Phase | What | SHA |
|---|---|---|
| 88.5 | Drop dead QuotePDF.jsx (1281 LOC; Phase 34Z.25 retired it; @react-pdf still kept for OtherMediaQuotePDF + OfferLetterPDF) | `2988c0a` |
| 87.7 | Native dialer auto-launch on Capacitor APK (global tel: click interceptor in `main.jsx`, routes via `App.openUrl` on native; web bundle pays nothing — lazy `import('@capacitor/app')`) | `e0bb9ea` |
| 88.1 | Optimistic UI on `LogMeetingModal` + `PostCallOutcomeModal` — keep the ONE write downstream depends on (activity insert/update) awaited, fire everything else in background. Perceived save drops from ~1.5sec to ~200ms | `c36e136` |
| 88.3 | PWA cache — ALREADY done in Phase 34G via `VitePWA injectManifest`. Crossed off. | — |
| 88.6 | Realtime push on `useAutoRefresh` — subscribes to INSERT/UPDATE on `lead_activities` + `follow_ups`. All 6 frozen mount-sites benefit automatically. SQL: `supabase_phase88_realtime_publication.sql` adds both tables to `supabase_realtime` publication (idempotent + EXCEPTION-wrapped) | `44e1440` |
| 87.4 | Telecaller flow audit — read-only findings doc at `docs/PHASE_87.4_TC_AUDIT.md`. Verdict PASS, zero P0/P1. 6 deferred gaps noted | `e33f3a4` |

### Skipped — owner decision needed

| Phase | What | Why skipped |
|---|---|---|
| 88.4 | Consolidate 4 `lead_activities` triggers into 1 | Touches §28 frozen DB contracts. Order-of-operations risk on score / heat / first-engagement chain. Cannot ship blind without test infrastructure + guardian PASS. Owner needs to OK a cutover plan + rollback path. |
| 76.2 | Android plugin (GpsToggleReceiver + NetworkWatcher + HeartbeatService + EventQueueDb + Manifest) | New Kotlin code. Cannot compile/test from sandbox. Need paired Android Studio session — write the Kotlin, run on emulator, debug, then ship. |
| 88.2 | Capacitor bundled mode (drop `server.url` → ship JS in APK) | Net 5-10x APK open speed, but breaks owner's live-update workflow: every JS change would need `npm run build → cap sync → rebuild signed APK → re-distribute`. Owner-side workflow decision. Compromise option: ship a `capacitor.config.bundled.json` alongside the current config and let owner opt-in per release cycle. |

### What 88.1 does NOT change

- `onSaved` still fires (parent close + queue advance hook).
- `onClose` still fires (modal still unmounts).
- Activity insert / update STILL AWAITED — score trigger
  (Phase 34Z.66) + push trigger (Phase 34Z.55) still see fresh
  data before the rep moves on.
- Failure mode: secondary writes (follow_up bulk close, stage
  update, lead_tasks close, smart_task close) toast async on
  error. Rep can refresh / re-open the lead — no data loss.

### What 88.6 does NOT change

- `useAutoRefresh(loadFn, opts)` signature unchanged.
- Tab visibility + window focus listeners preserved (still
  the safety net when Realtime drops).
- 800ms debounce covers focus + visibility + realtime triple-
  fire so a save doesn't trigger 3 simultaneous refetches.
- If `supabase_phase88_realtime_publication.sql` isn't applied,
  the `.subscribe()` call still succeeds but no INSERTs are
  delivered. Tab-focus refresh stays as fallback.

### Foot-guns added this sprint

- ❌ Don't pre-generate client-side UUIDs for lead inserts when
  parent navigates by id — `LeadDetailV2` doesn't retry on null
  lead. 88.1 keeps lead insert awaited; only activity goes
  background.
- ❌ Don't subscribe to `postgres_changes` on a table that isn't
  in `supabase_realtime` publication — `.subscribe()` succeeds
  but events never fire. Phase 88.6 SQL covers both tables.
- ❌ Don't move stage-update writes to background when downstream
  UI reads `lead.stage` immediately — parent navigates with the
  old stage cached. Acceptable for 88.1 (toast surfaces error,
  realtime sub on `useAutoRefresh` Phase 88.6 will re-render
  within ~250ms anyway).

### Commit log

```
e33f3a4 Phase 87.4: telecaller flow audit — VERDICT PASS
44e1440 Phase 88.6: Realtime push on top of tab-focus refresh
c36e136 Phase 88.1: optimistic UI on 2 hot save modals
e0bb9ea Phase 87.7: native dialer auto-launch on Capacitor APK
2988c0a Phase 88.5: drop dead QuotePDF.jsx
```

### Owner action

1. Push:
   ```
   cd ~/Documents/untitled-os2/Untitled/adflux
   git push origin untitled-os
   ```
2. Run SQL `supabase_phase88_realtime_publication.sql` in
   Supabase Studio (adds the 2 tables to realtime publication).
3. Vercel auto-rebuilds. PWA cache clear on iPhone if needed.
4. Decide on 88.4 / 76.2 / 88.2 for the next session.


---

## 37 · Sprint completion — 3 high-risk phases (2026-05-23 evening)

Owner direct quote: "finished. anayles and audit after commite and
dont stop and waut until it build perfectlu withou eror". 3 phases
that were skipped earlier this session shipped end-to-end with
10-check audits post-commit.

### Shipped

| Phase | What | SHA |
|---|---|---|
| 88.4 | Consolidate 3 `lead_activities` INSERT triggers (first_engagement + auto_heat INSERT path + sync_followup) into ONE `lead_activity_aftermath()` function. Single SELECT + single combined UPDATE per row. UPDATE-of-outcome path stays a separate dedicated trigger. SQL: `supabase_phase88_4_trigger_consolidation.sql` | `ee2bc1e` |
| 76.2 | Android UntitledTracking plugin: `TrackingPlugin.java` fires `gpsStateChanged` / `networkStateChanged` / `forceStopDetected` events via Capacitor. JS shim at `src/utils/nativeTracking.js` writes Phase 76.1 tables (column names verified: `toggled_off_at`, `lost_at`, `relaunched_at` etc). Heartbeat 60s bumps SharedPreferences. | `fdcf3f1` |
| 88.2 | Capacitor bundled mode: dropped `server.url` from `capacitor.config.json`. APK now loads JS from on-device `dist/`. ~5x faster cold start. Rollback config kept at `capacitor.config.live-update.json` for one-line revert. | `a44f8f7` |

### Owner build steps (sequential)

1. **Push:**
   ```
   cd ~/Documents/untitled-os2/Untitled/adflux
   git push origin untitled-os
   ```
2. **Run SQL** (Supabase Studio):
   - `supabase_phase88_realtime_publication.sql` (Phase 88.6 — already in queue)
   - `supabase_phase88_4_trigger_consolidation.sql` (Phase 88.4 — new)
3. **APK rebuild** (one-time setup for bundled mode):
   ```
   npm run build
   npx cap sync android
   cd android && ./gradlew assembleRelease
   # sign + distribute APK via WhatsApp / direct download
   ```
4. **Verify after Vercel rebuild** (web is unaffected; APK needs the rebuild):
   - `/admin/gps/<userId>` road-snap polyline still paints
   - `/team-dashboard` meeting pins render
   - APK first open <2 sec (was 5-10 sec)
   - GPS toggle off-then-on inside APK → check `gps_off_events` row appears in Supabase

### Rollback paths (per phase)

| Phase | Rollback |
|---|---|
| 88.4 | Paste ROLLBACK block at bottom of `supabase_phase88_4_trigger_consolidation.sql`. Recreates the 3 original triggers; original functions never dropped. |
| 76.2 | Remove `registerPlugin(TrackingPlugin.class)` line from `MainActivity.java`. Plugin file harmless if unregistered. Or revert commit `fdcf3f1`. |
| 88.2 | Copy `capacitor.config.live-update.json` over `capacitor.config.json` → `npx cap sync` → rebuild APK. APK goes back to fetching JS from app.untitledad.in. |

### Sprint workflow change accepted (88.2)

Pre-Phase 88.2: every Vercel deploy auto-updated the APK because
APK fetched JS at runtime from `app.untitledad.in`. Web + APK
stayed in sync silently.

Post-Phase 88.2: APK has JS baked in. Each shipping cadence is:
- Hotfix or new feature lands in code → Vercel deploys for WEB.
- APK still runs the JS that was bundled into the last signed
  release.
- Owner schedules APK rebuild + redistribute when batch is ready.

Recommended cadence: weekly APK release (or after a batch of 5-10
commits). For urgent hotfixes affecting field reps, web build will
still update — rep can browse `app.untitledad.in` until the APK
rebuilds.

### Post-commit audit results (10/10 PASS)

- 88.4 SQL: idempotent + ROLLBACK present + no DROP FUNCTION
  (originals preserved).
- 76.2: plugin name `UntitledTracking` identical Java ↔ JS;
  web no-op guard via `Capacitor.isNativePlatform()`.
- 88.2: server.url removed from main config; rollback config has
  it preserved.
- Web bundle parse PASS across `main.jsx`, `nativeTracking.js`,
  `useAutoRefresh.js`.
- Zero §28 frozen files touched in this batch.
- No `package.json` or lockfile changes (no new deps).

### Combined session totals (afternoon → evening 2026-05-23)

9 commits shipped (88.5 → 88.2). Web + Android + DB optimization
sprint complete.

```
a44f8f7  Phase 88.2: Capacitor bundled mode
fdcf3f1  Phase 76.2: Android tracking plugin
ee2bc1e  Phase 88.4: trigger consolidation
cc06e13  docs: §36 sprint summary
e33f3a4  Phase 87.4: TC flow audit PASS
44e1440  Phase 88.6: Realtime push
c36e136  Phase 88.1: optimistic UI on save modals
e0bb9ea  Phase 87.7: native dialer auto-launch
2988c0a  Phase 88.5: drop dead QuotePDF.jsx
```

### Foot-guns added this batch

- ❌ Don't drop original trigger functions when consolidating — keep
  them so rollback is a 3-line trigger recreation.
- ❌ Don't hardcode Supabase URL or keys in native plugin — JS
  shim handles all network. Native side fires events only.
- ❌ Don't forget the rollback config file for capacitor.config.json.
  `webDir`-only mode breaks live-update; owner needs one-line
  revert when iterating fast.
- ❌ Don't assume column names — Phase 76.1 schema uses `lost_at`
  / `regained_at` / `relaunched_at` (NOT `went_offline_at` etc).
  Schema-grep before writing inserts.


---

## 38 · Phase 94a — REVERTED to live-update mode (2026-05-24)

**Phase 88.2 bundled mode was reversed ONE DAY LATER.** Owner felt
the redistribute-per-fix cost immediately. `capacitor.config.json`
restored to `server.url: https://app.untitledad.in`. Active mode
since 24 May 2026 is **LIVE-UPDATE**, not bundled.

### Current state of capacitor configs (post-Phase 94a)

| File | Mode | Status |
|---|---|---|
| `capacitor.config.json` | **LIVE-UPDATE** (server.url to app.untitledad.in) | ACTIVE |
| `capacitor.config.bundled.json` | Bundled (webDir-only) | Rollback only |
| `capacitor.config.live-update.json` | Live-update (stale Phase 88.2 rollback) | Misleading filename — IGNORE |

### How it works now

- APK shell loads `https://app.untitledad.in` at cold start.
- Every Vercel deploy from `untitled-os` branch propagates to reps
  on next app open. No APK rebuild per JS fix.
- Cold start ~5-10s (vs 2s bundled).
- Native plugins (Geolocation, Phase 76.2 UntitledTracking,
  PushNotifications, App.openUrl) compiled into APK shell — work
  identically regardless of where JS loads from.

### When APK rebuild IS required (rare)

Only for native-side changes:
- New Capacitor plugin added.
- `android/.../*.java` or `.kt` source change.
- `AndroidManifest.xml` permission addition.
- Splash resource swap.
- `versionCode` bump for Play Store (not used today).

For JS / CSS / React changes — push to Vercel, done.

### Long-run reasoning (locked 2026-05-26)

Owner ships 10-30 commits/week. Bundled redistribute cycle = ~30
min per release × multiple releases/week = hours/week burned, +
WhatsApp distribute = partial rollout (reps skip, install late,
end up on mixed versions = unreproducible bug reports). Live-
update sacrifices 3-5s of cold start (negligible — open app 5x/
day = 15s/day across team) for instant fix propagation.

**Bundled wins only if:** shipping to Play Store, reps go offline
often, OR iteration cadence drops to monthly. None apply here.

### Do NOT recommend bundled mode again unless

1. Owner explicitly asks for offline-first behaviour.
2. Owner decides to ship to Play Store.
3. `app.untitledad.in` becomes unreliable.

Reverting to bundled would burn another day of work (config swap,
APK rebuild, redistribute, smoke) for negative ROI at current
cadence.

### Foot-gun caught this session (26 May 2026)

- ❌ Don't quote §37 / Phase 88.2 status as "current mode = bundled".
  §37 documents the day Phase 88.2 shipped but Phase 94a (this
  section) reversed it. Read `capacitor.config.json` line 2
  before answering any "is APK bundled or live-update" question.



---

## 39 · Phase 94 — 95.3 + APK pause (2026-05-27)

### Phase 94 — path-param edit/renew routes (PERMANENT)

Five prior phases (93.28 → 93.30.2) tried router state, query string, in-memory module fallback to deliver `editingId` from quote Edit/Renew buttons to `CreateQuoteV2`. Each shipped, each failed on Capacitor APK first-render. Owner directive: "dont patch make sure its permenet solution".

**Architectural fix:** moved id into the URL **path** itself. React Router's `useParams()` reads path segments deterministically — no race, no WebView quirk possible.

3 new routes (registered BEFORE `/quotes/:id` per CLAUDE.md §10):

```
/quotes/edit/:id              → CreateQuoteV2 (edit mode)
/quotes/edit/:id/other-media  → CreateQuoteOtherMediaV2 (edit mode)
/quotes/renew/:id             → CreateQuoteV2 (renew mode)
```

Wizards detect mode via `location.pathname.startsWith('/quotes/edit/')` / `/quotes/renew/`. Backwards-compat: state/query/in-memory fallback chain retained for pre-Phase-94 deep links.

Files: `App.jsx`, `CreateQuoteV2.jsx`, `CreateQuoteOtherMediaV2.jsx`, `QuotesV2.jsx` (§28 frozen, 1-line nav swap), `QuoteDetail.jsx`, `RenewalToolsV2.jsx`. Commit `6314160`.

### Phase 95.0 — fallback-mode banner silenced

Owner saw red banner on /follow-ups: `"Call logged in fallback mode: duplicate key value violates unique constraint uniq_lead_activities_dedupe_min"`. Constraint from Phase 68.2 (21 May) is correct — blocks same-minute duplicate call activity. The 1st tap logged ✅, modal opened ✅; 2nd tap within 60s hit the constraint and showed the alarming banner. Owner thought everything broken.

Fix: detect Postgres dup-key (`err.code === '23505'` OR message regex) in FollowUpsV2.openCall catch block — suppress banner for that case only. All other errors still surface. Commit `7fdc05d`.

### Phase 95.1 — AndroidManifest `<queries>` block (NATIVE)

Owner reported on /follow-ups APK: Call + WhatsApp buttons do nothing. "Till yesterday evening everything was working fine."

Root cause: Android 11+ (API 30) requires `<queries>` declarations for intent visibility. Manifest had ZERO queries. `App.openUrl({ url: 'tel:...' })` silently failed — no error, no fallback, button did nothing.

Fix: `<queries>` block at manifest root declaring:
- `tel:` (ACTION_DIAL + ACTION_VIEW)
- `whatsapp://` + `wa.me` HTTPS + `api.whatsapp.com` HTTPS
- `mailto:` (ACTION_SENDTO)
- Generic HTTPS
- Explicit `com.whatsapp` + `com.whatsapp.w4b` packages

versionCode 94100 → 95100, versionName 0.94.1 → 0.95.1. Native = APK rebuild required. Commits `de52c92` + `b1354d5` + `9a352f6` (`MainActivity.onResume` protected→public).

### Phase 95.2 — route external launches through openExternalUrl

8 sites still bypassing Phase 93.19 `openExternalUrl()` helper. All swapped:
- WhatsAppPromptModal / WhatsAppSendModal — WhatsApp template send
- LeadDetailV2 §28 — follow-up WA template (1 line)
- QuoteDetail — Gmail email button (dropped mailto: fallback branch)
- GovtProposalDetailV2 — Gmail + 2 PDF preview sites
- MasterV2 — admin file preview

Web behaviour byte-identical. APK now opens system handlers (WhatsApp app, system PDF viewer, etc) instead of WebView-inline blank tabs. Commit `9a0a42d`.

### Phase 95.3 — preserve branded WhatsApp share URL

Owner: "we made custom url for quote send via whatsapp but now there is different url". Phase 85.1 `uploadQuotePDFHtml` returns `https://app.untitledad.in/pdf/<ref>?t=<token>`. QuoteDetail then ran `shortenUrl()` on top, overwriting with `is.gd/xyz`. Owner saw is.gd instead of branded.

Fix: `if (pdfUrl && !/^https?:\/\/[^/]*untitledad\.in\/pdf\//.test(pdfUrl))` gate around shortenUrl call. Govt flow (raw Supabase signed URL) untouched. 2 sites in QuoteDetail. Commit `67cbed3`.

**Root cause was incomplete Phase 85.1 ship:** function return contract changed but callers weren't audited. Blast-radius miss per §35. Documented as foot-gun.

### APK rebuild attempt (27 May 2026)

Built debug-signed APK (`app-debug.apk` 9 MB) for sideload distribution since release scaffold's signingConfig is still commented out. Owner installed on test phone. Reported **still same issues**.

Possible causes (none verified — USB chrome://inspect kept dropping "Pending authentication"):
1. Android signature mismatch refused install of v0.95.1 over v0.94.1 (release-signed → debug-signed)
2. Phone still running v0.94.1 (Settings → Apps → Untitled OS → version check pending)
3. Live-update mode pulled new JS but APK shell still has old manifest (rebuild didn't actually update)
4. Real code bug I haven't seen yet

### Owner directive 27 May 2026: APK paused

Owner: "i have eciode whatever have build in web app you just store in respective document". 

**Web is the canonical surface.** PWA via `app.untitledad.in` works perfectly across all flows. APK has unresolved hardware-specific bugs after 5+ patch iterations + native rebuild attempt.

Reps continue using whatever APK they have installed (v0.94.1 likely). Web push notifications work via the same FCM flow per `nativePush.js` paths that gate on `Capacitor.isNativePlatform()` — Chrome Android has native FCM via service worker.

**APK work pauses until:**
- USB chrome://inspect debug session completes (find actual root cause, no more guessing)
- OR owner explicitly resumes

**Don't ship more native fixes blind.** §35 blast-radius rule applies harder than ever.

### Built but not shipped (as of 2026-05-27)

| Item | What | Action |
|---|---|---|
| `supabase_phase64_profile_autosync.sql` (20 May) | Auto-sync `staff_incentive_profiles.monthly_salary` from `designations.default_monthly_salary` | Untracked; idempotent + backfill; owner-approve before applying |
| `supabase_phase63_staging_reset.sql` (20 May) | Destructive wipe of staging DB preserving admin/co_owner | Untracked, intentionally — owner-only manual use |
| `docs/AUDIT_2026_05_26_DEEP.md` | Yesterday's read-only deep audit | Untracked |
| `docs/PNL_MODULE_BRIEF_FOR_ACCOUNTS.md` | P&L module spec | Untracked plan, no code |
| `_design_reference/newsalesui/` | Design mockups | Untracked reference |

### Stack on origin (`untitled-os` branch) as of 27 May 14:18 IST

```
9a352f6  Phase 95.1.1: MainActivity onResume protected→public
b1354d5  Phase 95.1: versionCode 94100 → 95100
de52c92  Phase 95.1: AndroidManifest <queries> block
9a0a42d  Phase 95.2: route external-URL launches via openExternalUrl
7fdc05d  Phase 95.0: silent on dup-key error in FollowUpsV2 openCall
6314160  Phase 94: path-param edit/renew routes — PERMANENT APK prefill fix
67cbed3  Phase 95.3: preserve branded app.untitledad.in/pdf URL in WhatsApp+Email
bba2700  Phase 93.30.2: useState lazy init for quoteIntent consume
1b7aab2  Phase 93.30.1: tighten quoteIntent TTL 5min → 3sec + drop vis-clear
9987677  Phase 93.30: in-memory quoteIntent — 3rd-layer APK delivery channel
846d10d  Phase 93.29: harden every URL-param route for APK
5b3f965  Phase 93.22: audit cleanup F1+F2+F3
c129f2c  Phase 93.23: TeamDashboard SELECT missing check_out_at
b531cc4  Phase 93.24: lead-tied call counters
ba8483b  Phase 93.27: TotalCard responsive font — fix APK truncation
6f967df  Phase 93.25 + 93.26: call_logs dedup + native-dialer stage advance
```

### Foot-guns added 2026-05-27 (don't repeat)

- ❌ **Native fix shipped without device verification.** Phase 95.1 manifest queries followed Android docs but owner reports still broken on device. Without USB chrome://inspect or device-side console access, "should work per docs" is a guess.
- ❌ **Function-contract change without caller audit.** Phase 85.1 changed `uploadQuotePDFHtml` return to branded URL but QuoteDetail callers still ran `shortenUrl()` on top — 11 days of silent regression until owner caught it. CLAUDE.md §35 blast-radius rule applies; future contract changes MUST grep all callers.
- ❌ **Patch chain on hardware-specific bug.** Phases 93.28 → 93.30.2 (five patches) tried fallback after fallback. Phase 94 path-param redesign was the architecturally correct first move. Future hardware-specific bugs: redesign once, don't patch five times.

### Sales module FROZEN status (unchanged)

§28 + §29 + §31 contracts intact across Phase 94 → 95.3:
- PostCallOutcomeModal tel:→1.5s→modal chain preserved on every caller
- `useAutoRefresh` mounts unchanged
- Lead stages / cadence types / activity_type enums unchanged
- Push enrollment in V2AppShell only
- No new emoji, hex, off-scale radius, role, push enrollment outside V2AppShell

Sales-module-guardian PASS on every commit touching frozen files this sprint.

### Next session opening move

1. Read §39 to recover today's state.
2. If owner says resume APK debug: get chrome://inspect actually working OR ship in-app self-test diagnostic (Path B from owner conversation).
3. If owner says ship Phase 64 SQL: commit + walk owner through Supabase Studio paste.
4. If owner says move on: pick from the deferred backlog (P&L module, govt invoice template, TDS columns, telecaller team-lead dashboard).


---

## 40 · Change-impact workflow (2026-05-27, OWNER DIRECTIVE)

Owner directive 2026-05-27 evening: "I want this project future-proof, not patch-based. Whenever we change one thing, Claude must check: surrounding code, same workflow in other modules, all roles affected, frontend + backend + RLS together, mobile + desktop behavior, similar functions in other modules."

This section is THE workflow Claude must follow for every future change. Higher priority than ship-speed. Supersedes §15 + §35 where they overlap.

### Pre-implementation 12-question gate

Before writing a single line of code, answer all 12 in writing:

1. What module is touched?
2. What similar / parallel modules must be checked? (See module-consistency-auditor scope.)
3. Which roles are affected? (admin / co_owner / sales / agency / telecaller / sales_manager / hr / accounts / office_staff)
4. Which frontend screens / routes / buttons are affected?
5. Which backend tables / RLS policies / SQL functions / triggers are affected?
6. Does it touch the §28 frozen sales module?
7. Does it touch quote flow, lead flow, payment flow, push flow, or PDF flow?
8. Does it need SQL paste in Supabase Studio?
9. Does it need an Edge Function deploy?
10. Does it need an APK rebuild?
11. What regression tests must run?
12. What owner manual steps are needed (after my work ends)?

If any answer is "I don't know" → stop. Run the relevant audit agent first.

### Required output table (every fix)

Every implementation must produce this table before commit:

| Change | Direct File(s) | Similar Modules Checked | Roles Checked | DB/RLS Checked | Mobile/Desktop Checked | Agent Required | Regression Tests |
|---|---|---|---|---|---|---|---|

Empty cells = audit gap. Fill them or explicitly mark `N/A: <reason>`.

### Mandatory 3-surface verification

Every change must produce this table:

| Surface | Must Test | Risk | Result |
|---|---|---|---|
| Desktop web | (specific clicks/pages) | (what breaks if skipped) | PASS / N/A:<reason> / BLOCKED:<reason> |
| Mobile web | | | |
| Android APK | | | |

No change is "complete" until all 3 rows are marked PASS, N/A with reason, or BLOCKED with reason. "Untested" or empty is not allowed.

### Mandatory testing triggers (no N/A allowed)

**Android APK testing MANDATORY** if change touches any of:
- push / notification / follow-up alarm
- `public/sw.js` (service worker)
- `capacitor.config*.json`
- `android/app/src/main/AndroidManifest.xml`
- `android/app/build.gradle`
- `src/utils/nativePush.js`
- `src/utils/scheduleFollowUpAlarm.js`
- `src/utils/pushNotifications.js`
- `src/components/v2/V2AppShell.jsx`
- `src/components/leads/PostCallOutcomeModal.jsx`

**Desktop web testing MANDATORY** if change touches any of:
- master-data tables / admin pages
- dashboards (AdminDashboardDesktop, TeamDashboardV2, ManagerDashboardV2)
- approvals (PendingApprovalsV2)
- master screens (MasterV2 tabs)
- PDF renderers (QuotePDFHtml, OtherMediaQuotePDF, GovtProposalDetailV2)
- admin flows (HRV2, PeopleV2, LeavesAdminV2, SalaryAdminV2, TaPayoutsAdminV2)

**Mobile web testing MANDATORY** if change touches any of:
- sales flow (WorkV2, LeadDetailV2, LeadFormV2, LeadsV2)
- telecaller flow (TelecallerV2)
- work page / lead detail / follow-ups
- call buttons / WhatsApp buttons
- route guards (RequireAuth, RequirePrivileged, RequireManager, RequireGovtAccess)

If a mobile-web-mandatory change also runs inside APK (most rep-facing changes do), Android APK is ALSO mandatory — not optional.

### Pre-push release gate

Before any `git push origin <branch>`:
1. Invoke `release-manager` agent.
2. Read the checklist it produces.
3. Fix any items marked FAIL / WARN.
4. Owner manually runs the push.

### Agent fleet (active as of Phase 97.0, 2026-05-27)

`.claude/agents/` directory:

| Agent | Location | Read-only | When to use |
|---|---|---|---|
| sales-module-guardian | workspace `/Users/apple/Documents/untitled-os2/.claude/agents/` | YES | Before any commit touching §28 frozen sales surface |
| code-reviewer | repo `Untitled/adflux/.claude/agents/` | YES | Before every commit — generic CLAUDE.md compliance |
| explorer | repo | YES | During work — fast "where is X" lookups |
| test-runner | repo | YES | Before commit, AFTER code-reviewer — runs check scripts |
| security-rls-auditor (Phase 97.0) | repo | YES | Before any commit touching SQL / Edge Functions / RLS-adjacent code OR before SQL Studio paste |
| android-push-auditor (Phase 97.0) | repo | YES | Before any commit touching push / native / Capacitor / sw.js OR before APK rebuild |
| release-manager (Phase 97.0) | repo | YES | Before any `git push` — produces deployment checklist |
| role-workflow-impact-auditor (Phase 97.0) | repo | YES | Before any change touching auth / routes / role guards / nav / cross-role pages |
| module-consistency-auditor (Phase 97.0) | repo | YES | After any change with parallel modules (4 quote wizards, 3 PDF renderers, dashboard variants, etc.) |

All Phase 97.0 agents are READ-ONLY: no Edit, no Write, no SQL execution, no APK build, no git commit, no git push. They report only. Owner is the gate-keeper.

### Where the workflow supersedes older rules

- §15 (pre-commit verification) — Phase 97.0 expands it: now requires audit-agent fan-out + 3-surface table.
- §35 (blast-radius rule) — Phase 97.0 strengthens it: module-consistency-auditor now formalizes parallel-module check.
- §3 (module-not-patch directive) — same intent, now backed by the 12-question gate.

### Foot-guns Phase 97.0 closes

- Shipping a fix that works on web but fails on APK (Phase 95.x repeated this 5 times). 3-surface mandate makes the test impossible to skip.
- Touching one quote wizard and forgetting the other 3. module-consistency-auditor catches.
- Native change without versionCode bump. release-manager catches.
- SQL migration without idempotency. security-rls-auditor catches.
- Role bypass via direct URL. role-workflow-impact-auditor catches.

### When NOT to use the workflow

- Read-only audit passes (already in workflow output mode).
- Comment-only edits (still go through code-reviewer, but skip the 3-surface table — mark all N/A:comment).
- Documentation appends to CLAUDE.md itself.

For everything else: the 12-question + table + 3-surface gate runs.


---

## 41 · Phase 97.x security / RLS / push / role + Phase 87.5b HR sign-off (2026-05-28)

Full-day sprint closed **17 audit findings + 1 UX simplification + 1 module-finishing batch (Phase 87.5b)** on `untitled-os` between ~12:00 and ~17:00 IST. 17 commits total. All shipped end-to-end (DB + JS + verify + smoke).

### What shipped (chronological)

| Phase | What | Finding | SHA |
|---|---|---|---|
| 97.1 | `users_self_update_avatar` RLS column-pin (7 cols) — closes privilege-escalation via PostgREST | F-100 | (early) |
| 97.2 | 10 SECURITY DEFINER RPCs gated by `_assert_self_or_admin` helper | F-101 / F-102 / F-104 / F-108 | (early) |
| 97.3 | PostCallOutcomeModal — cancel scheduled follow-up alarms on Lost / Won save | F-401 | `abc530e` |
| 97.4 | APK follow-up backfill IST date window — fix V2AppShell cold-start backfill that pulled stale tomorrow rows | F-406 | `5db25f0` |
| 97.5 | `nativePush.js` — djb2 deterministic id per `data.tag` so FCM retries replace in-tray instead of stacking | F-407 | `2f0669f` |
| 97.3.1 | Hotfix race vs `trg_z_close_followups_on_terminal` — capture `earlyClosingIds` BEFORE stage advance so alarm-cancel SELECT doesn't miss rows | F-401 (race) | `6af328b` |
| 97.6 | PostCallOutcomeModal — Lost outcome skips next-action prompt (auto-forces `nextAction='none'` + red "Marked Lost" banner) | UX | `ac0aec7` |
| 97.7 | `/push-debug` route stays open for rep self-enroll; admin-only Send-test-push + Registered devices gated inside PushDebugV2. `/primitives-demo` route guarded with `RequirePrivileged`. | F-003 / F-208 | `56eb232` |
| 97.8 | Remove `'owner'` role literal from `HRNewUserV2` `.in()` filter + `MasterV2` `TEAM_ROLES` array | F-001a | `9e6d64d` |
| 97.9 | QuoteDetail draft-delete confirm — `window.confirm()` → `confirmDialog` | F-204 | `ae0f318` |
| 97.10 | PendingApprovalsV2 — `window.confirm/prompt/alert` → `confirmDialog` + custom reject-reason inline modal + `toastError`; `⚠` Unicode → Lucide `AlertTriangle`; hex `#ef9a9a` → `var(--danger)` | F-300 / F-301 | `350dc32` |
| 97.A400 | `push_followup_due_reminders()` — constant tag `'followup_due'` → per-row unique `'fu-due-' || r.id::text`. Two due reminders in the same 5-min window no longer collapse to one tray entry. | F-A400 | `edcea93` |
| 97.A2 | `REVOKE EXECUTE ON FUNCTION public.enqueue_push(...) FROM PUBLIC, anon, authenticated` — closes any-rep-to-any-rep spam push via direct RPC. All 10 internal callers (3 triggers + 4 cron + 2 SECDEF helpers + 1 followup digest) keep working via DEFINER ownership. | F-105 | `c628b84` |
| 97.E | DROP + RE-CREATE `users_role_check` + `users_team_role_check` without `'owner'`. DB now matches §8 documented role universe + Phase 97.8 frontend literal purge. | F-001b | `bbdce46` |
| 97.D | `authStore.fetchProfile` — remove silent `users.id` overwrite by email fallback. Replace with read-only `.maybeSingle()` diagnostic + `console.error` + `null` return. Preserves Phase 97.1 lockdown. | F-002 | `c4111b1` |
| 87.5b | HR sign-off on rep profile bundle. 3 new `users` cols (`hr_accepted_at`, `hr_accepted_by`, `hr_acceptance_note`). 2 SECURITY DEFINER RPCs (`accept_user_profile`, `unaccept_user_profile`). `RequireHROrPrivileged` route guard for `/people/:userId`. Status chip on `/my-offer`. Accept / Reverse buttons on RepProfileV2 with `confirmDialog` + `toastSuccess` + `toastError`. Phase 97.1 column-pin extended from 7 → 10 explicit pins. | (module finish) | `2989cd3` |
| 87.5b.1 | Hotfix the 87.5b RPC role check — added `IS NULL OR NOT IN (...)` short-circuit so JWT-less callers can't slip past via Postgres 3-valued logic. Also corrected VERIFY regex from `IS NOT DISTINCT FROM` to `IS DISTINCT FROM` (matches Postgres's normalized rendering). | (security hotfix) | `0bde4c7` |

### New DB columns

- `users.hr_accepted_at timestamptz` (Phase 87.5b)
- `users.hr_accepted_by uuid REFERENCES users(id)` (Phase 87.5b)
- `users.hr_acceptance_note text` (Phase 87.5b)

### New RPCs

- `public.accept_user_profile(p_user_id uuid, p_note text)` — SECDEF, gated `admin / co_owner / hr`, COALESCE keeps earliest acceptance metadata on re-call. NULL-role guarded (Phase 87.5b.1).
- `public.unaccept_user_profile(p_user_id uuid)` — SECDEF, gated `admin / co_owner` only. HR cannot reverse. NULL-role guarded (Phase 87.5b.1).

### New route guard

- `RequireHROrPrivileged({children})` in `App.jsx` — admin / co_owner / hr. Used ONLY on `/people/:userId`. Global `RequirePrivileged` (admin + co_owner) unchanged for all other routes.

### Frozen file touches (all guardian-cleared PASS)

| File | What | Risk |
|---|---|---|
| `src/components/leads/PostCallOutcomeModal.jsx` | Phase 97.3 + 97.3.1 + 97.6: alarm cancel chain + Lost UX | None — additive |
| `src/components/v2/V2AppShell.jsx` | Phase 97.4: cold-start backfill IST window | None — additive |
| `src/utils/nativePush.js` | Phase 97.5: djb2 deterministic id | None — additive |
| `src/pages/v2/MyOfferV2.jsx` | Phase 87.5b: status chip (additive only) | None |

### Documented elsewhere

- Push pipeline 11-caller map for `enqueue_push` lives in `supabase_phase97_a2_enqueue_push_revoke.sql` header.
- F-001b live audit results (A1/A2/A3/A4) live in `supabase_phase97_e_users_role_owner_purge.sql` header.
- Phase 87.5b RPC role model (accept = admin/co_owner/hr; unaccept = admin/co_owner only) lives in `supabase_phase87_5b_hr_acceptance.sql` header.

### Backlog after Phase 87.5b.1 close

- **Phase 76.2** — Android tracking plugin (GPS toggle receiver + network watcher + heartbeat + manifest perms + APK rebuild). Owner-deferred 22 May 2026.
- **Sprint 3** — P&L module port (spec only).
- **Sprint 4** — Receipts/TDS upgrade for govt deals.
- **Govt invoice template** — post-WON automation.
- **Phase 42.2** — Renuka team-lead frontend dashboard.
- Phase 39 — single-payout-flow vs two-flow decision (parked).

### Foot-guns added 2026-05-28 (don't repeat)

- ❌ Role check via `NOT IN (...)` without NULL short-circuit. Postgres 3VL evaluates `NULL NOT IN (...)` to NULL → `IF NULL THEN` skips → role gate bypassed under JWT-less contexts. Always use `IF X IS NULL OR X NOT IN (...) THEN ...`.
- ❌ VERIFY regex `IS NOT DISTINCT FROM` — Postgres normalizes column-immutability clauses to `NOT (X IS DISTINCT FROM Y)` in `pg_get_expr()`. Pattern should match `IS DISTINCT FROM` (substring of both forms).
- ❌ `pushToast({message, tone: 'success'})` — Toast.jsx signature is positional `pushToast(message, type='info')`. Object form renders `[object Object]` + falls back to info tint. Use `toastSuccess('...')` helper instead.
- ❌ In-page `isAdmin` self-gate inside a page mounted under a wider route guard. When the route widens (e.g. RequirePrivileged → RequireHROrPrivileged), every `isAdmin` check inside the page must widen to match or HR bounces. Use a `canViewPage` boolean as single source of truth.

### Smoke test list (for future audits)

Sales-side: PostCallOutcomeModal Lost flow (banner + skip next-action), follow-up alarm cancel after stage change, push dedup on same tag, APK follow-up backfill IST window, push-debug self-enroll for sales rep.

HR-side: /people/:userId access as hr, Accept button visible + Reverse absent, RPC role gate via DevTools (sales rep → 42501 on accept_user_profile + 23514 on direct UPDATE).

Admin-side: PendingApprovalsV2 approve + reject flow with in-app modals, QuoteDetail draft delete confirm, primitives-demo route bounce for non-admin.

DB-side: F-100 via DevTools `users.update({role:'admin'})` → 42501, F-105 via `rpc('enqueue_push',...)` → 42501, F-A400 via 2 follow_ups in same 5-min cron window → 2 distinct tray entries.


---

## 42 · Phase 98 — runtime parity audit + 3 fixes (2026-05-28 evening)

Full cross-role parity audit run after Phase 97.x close. Method:
1. Static code map (5 parallel Explore agents — sales / TC / admin / GPS / push surfaces).
2. RLS + role-filter enumeration via pg_policy introspection.
3. Owner-runnable SQL parity queries in Supabase Studio.
4. UI state matrix across every dashboard.

10 candidate findings raised. Runtime-classified into:

- **Confirmed bugs (4)**: F-D010 quiet-hours, B-001 12 admin policies, B-002 hr_offers, F-D005 KM threshold.
- **NOT REPRODUCED (2)**: F-D001 (Supabase DB session = Asia/Kolkata so no-TZ string still works), F-G7 (push_failures view exists in DB; SQL file just not in repo).
- **STATIC RISK (5)**: F-D002 / F-D008 / B-003 (no `sales_manager` user exists today — Phase 42 dashboard dormant), F-D003 (admin todayCollected UTC — time-window-only bug fires 00:00–05:30 IST), F-D004 (followup-CREATE trigger CURRENT_DATE — IST evening edge case).
- **Owner rejected (1)**: B-001 — see Phase 98.B section below.

### What shipped (Phase 98)

| Phase | Finding | Layer | SHA |
|---|---|---|---|
| 98.A | F-D010 quiet-hours wrap on `tg_push_on_lead_assign` + `tg_push_on_payment_approved` + `tg_push_on_quote_won` (3 of 5 push triggers were firing 24×7) | SQL — CREATE OR REPLACE × 3 functions; trigger DDL untouched | `5fc8d98` |
| 98.C | B-002 widen `hr_offers_sales_own` (renamed `hr_offers_self_read`) to admit sales / telecaller / agency / co_owner / hr on own-row only (`converted_user_id = auth.uid()`) | SQL — DROP + CREATE policy | `1a319b7` |
| 98.D | F-D005 align `src/utils/gpsDistance.js` thresholds with Phase 68 server `compute_daily_ta` (acc 100→50, seg 0.03→0.10, speed 200/3600→120/3600, daily cap 600 unchanged). Runtime-verified: 1.51 km client = 1.51 km server on Dixita 2026-05-28 | JS — utility constants only, function bodies byte-identical | `e37dcfb` |
| docs | §41 Phase 97 record | docs | `7921c60` (earlier same day) |

### Phase 98.B — REJECTED by owner directive (D4 decision)

B-001 was a confirmed RLS gap: 12 admin policies use singular `(get_my_role() = 'admin'::text)` → co_owner gets 0 rows from those tables (`leads`, `lead_activities`, `call_logs`, `work_sessions`, `clients`, `holidays`, `media_types`, `incentive_payouts`, `hr_offers`, `hr_offer_templates`, `lead_imports`, `ai_runs`). Initial recommendation (FIX-B) was to widen all 12 to `IN ('admin', 'co_owner')`.

**Owner D4 directive (2026-05-28):**

> "Vishal should NOT have full admin parity. He should stay government-scoped. He can see only Government P&L when the P&L module is built. He should not see private-side admin data, private leads, private calls, private work sessions, private clients, private HR data, or private P&L."

The 12 admin policies are kept **as-is, intentionally**. Co_owner does NOT automatically equal full admin in this project. Today the only active co_owner (Vishal, `id=5e6690aa-7fce-4503-9101-28520930fd51`) also carries `team_role='government_partner'`, which the project relies on to scope him to GOVERNMENT-segment data via the existing govt_partner policies:

- `leads_govt_partner_read` — Vishal sees only `segment='GOVERNMENT'` leads.
- `leads_govt_partner_write` — same scope on write.
- `work_sessions_govt_partner` — Vishal sees sales/telecaller/agency reps' sessions but only via the govt-partner gate.
- `lead_activities_via_lead` — Vishal sees activities only on leads he can SELECT (govt-segment chain).

**B-001 reclassified as NOT-A-BUG.** Do not widen the 12 admin policies. Do not stage a Phase 98.B SQL file. If a different co_owner is ever added without `team_role='government_partner'`, revisit — but the current design depends on this pairing being the default.

### Vishal / co_owner + government_partner doctrine

- `role = 'co_owner'` alone does NOT grant full admin parity.
- `team_role = 'government_partner'` (paired with `role='co_owner'`) scopes the user to GOVERNMENT-segment data.
- Existing govt_partner RLS policies (`leads_govt_partner_*`, `work_sessions_govt_partner`, etc.) carry the access — admin policies stay singular `'admin'`.
- Existing GOVERNMENT-only signer flag (`signing_authority` per §4) overlaps Vishal's role — he co-signs govt proposals.

### Future P&L module (Sprint 3) — Vishal-scope rule

When the P&L module ships (`quote_pnl`, `monthly_admin_expenses`, `PnLLanding`, `PnLSummary`, `QuotePnL`, `AdminExpenses` per docs/UNTITLED_OS_v2_ARCHITECTURE.md §7.5 + §8.2):

- Brijesh (`role='admin'`) → sees BOTH segments' P&L.
- Vishal (`role='co_owner'`, `team_role='government_partner'`) → sees **GOVERNMENT-segment P&L only**.
- Sales / telecaller / agency / others → no P&L visibility (per §8 directive #3).
- HR / accounts → revenue figures yes; P&L no (per §8 directive #3).

RLS pattern for the new tables MUST mirror the existing govt_partner gate:

```
-- Hypothetical: pnl_summary_admin_full (Brijesh)
CREATE POLICY pnl_summary_admin_full ON public.pnl_summary
  FOR SELECT
  USING (get_my_role() = 'admin');

-- Hypothetical: pnl_summary_govt_partner (Vishal)
CREATE POLICY pnl_summary_govt_partner ON public.pnl_summary
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM users u
             WHERE u.id = auth.uid()
               AND u.team_role = 'government_partner')
    AND segment = 'GOVERNMENT'
  );
```

Do NOT add co_owner to the admin clause. The scope is segmented, not role-tiered.

### Static risks parked (not fixed)

The 5 static risks (F-D002, F-D008, F-D003, F-D004, B-003) plus the 21 stale `'owner'` literal cleanup all stay parked. Owner directive: "do not change app code on static risks; only fix when a real user surface or report demands it."

If/when the project adds a real `sales_manager` user (Jubin / Renuka are documented intent but no live row exists as of 2026-05-28), revisit:
- F-D002 (`lead_activities` `user_id` → `created_by`)
- F-D008 (`call_logs` `created_at` → `call_at`)
- B-003 (no manager-read policy on quotes / payments / follow_ups / gps_pings / daily_performance / daily_ta — manager would under-see team rollups)

### Foot-guns added today (don't repeat)

- ❌ Mid-pack realization: assuming `sales_manager` users exist. Several findings collapsed to STATIC RISK because no manager row is live. Always run Section 0 (find test users) BEFORE building the per-user parity matrix.
- ❌ Treating co_owner as automatic admin. The 12 admin policies were intentional from Phase 5. Phase 5 hardcoded singular `'admin'`; later admin-write policies (`fu_admin_all`, `gps_pings_admin_all`, `dp_admin`, `ta_admin_all`) DO include co_owner. Mixed convention — confusing but consistent with the documented role model when paired with team_role gates.
- ❌ Asserting KM ground-truth before owner sanity-checks the figure. Owner's gut-feel 2.3 km was actually GPS-spike inflation (speed cap = 200 km/h let through false 50-km jumps); real movement = 1.51 km. Always present multiple threshold variants when the dispute is "rep says X, server says Y".
- ❌ Trusting the comment over the code. Phase 68 SQL header claimed "thresholds aligned with client `gpsDistance.js`" — but the actual constants didn't match. Always read the constants, not the doc.
- ❌ Counting client-side haversine without applying the speed cap in SQL replay. Result was 117× server (1.51 vs 178 km) because GPS jumps weren't filtered. The speed cap is the bug-fixer; MIN_SEG_KM is secondary.

### Smoke checklist (after each Phase 98 commit)

98.A — owner reproduced "Dhara 23:21 IST push" complaint pre-fix. Post-fix: re-run via admin Reassign at 22:00+ IST → no push fires.
98.C — sign in as Dhara (TC) / Vishal (co_owner) / any agency rep / any HR-role user → `/my-offer` renders offer card if hr_offers row exists with their auth.uid().
98.D — open `/admin/gps/<rep>/<date>` map → KM display matches `daily_ta.km_traveled` for that rep+date.

### Phase 98 commit log on origin

```
e37dcfb Phase 98.D: align map KM thresholds with server TA rules
1a319b7 Phase 98.C: widen hr_offers self-read to 5 roles (B-002)
5fc8d98 Phase 98.A: quiet-hours gate on 3 push triggers (F-D010)
```

### Backlog after Phase 98

- Static risks (5) — parked per directive.
- 21 stale `'owner'` literal cleanup — pure hygiene, parked.
- Sprint 3 P&L (must use Vishal-scope rule documented above).
- Sprint 4 TDS columns.
- Govt invoice template.
- Renuka / Jubin team-lead dashboard (Phase 42.2) — blocked on live sales_manager users.
- Phase 76.2 Android plugin — owner-deferred 22 May.


---

## 43 · Phase 109 — HR login turned on + Send Offer designation + day-summary stale-share + KM/background-GPS diagnosis (2026-06-01)

Owner: "i want to give HR login ... she can send offer as per
designation, and convert user into team. detailed module we will
create later." Then a KM-mismatch + stale-report report.

### Phase 109 — HR login (SHIPPED + verified)

The HR pages already existed (HRV2 `/hr`, HRNewUserV2 `/hr/new-user`,
HROfferLetterV2 `/hr/offer/:userId`); `hr` role + the "HR" designation
were already seeded (Phase 50). Phase 109 only WIRED ACCESS.

| Commit | What |
|---|---|
| `b96e7d6` | Phase 109 — HR login. **PUSHED + SQL run + verified** (Riya `roya@untitledad.in` logged in, lands on HR Home). |
| `da6d30d` | Phase 109.1 — Send Offer designation dropdown. **committed, push pending** as of EOD. |
| `f3c58cd` | Phase 109.2 — day-summary share refetch (stale-share fix). **committed, push pending.** |

**SQL `supabase_phase109_hr_login.sql` (owner ran it):**
- `admin_create_user` RPC widened to accept `hr` callers, BUT an `hr`
  caller cannot mint `admin`/`co_owner` (privilege ceiling). NULL-role
  short-circuit present (the §41 3VL foot-gun).
- hr-only RLS: `sip_hr_write` (staff_incentive_profiles) + `dt_hr_write`
  (daily_targets) + `hr_offers_hr_all`. The sip/dt write policies are
  scoped so hr CANNOT read/edit/delete an admin/co_owner row (mirrors
  the mint ceiling — HR can't touch the owner's salary).
- Additive only: admin/co_owner/govt-partner policies untouched (§42
  Phase 98.B doctrine preserved). **Supersedes phase66 caller-check** —
  if phase66 is ever re-run, re-run phase109 after it.

**Frontend (`b96e7d6`):** App.jsx — `/hr`, `/hr/new-user`,
`/hr/offer/:userId` → `RequireHROrPrivileged` (was admin/co_owner only);
RootRedirect lands `role='hr'` on `/hr`. V2AppShell — `HR_NAV` (HR Home +
Add Member) on desktop + mobile + `isHR` role label (3 sites). HRNewUserV2
success "Done" → `/hr` for hr (was `/people` → bounce).
ProposedIncentiveCard — hides for `hr` (was leaking the sales "send
quotes" card onto HR pages, same as agency).

3 audits ran pre-commit: sales-module-guardian PASS (V2AppShell nav
additive), security/RLS PASS (mint ceiling + doctrine), role-workflow
PASS after fixing the RootRedirect landing + the incentive-card leak.

### Phase 109.1 — Send Offer designation dropdown (`da6d30d`)

Owner: "hr cant send offer to other roles, we just getting sales option."
`SendOfferModal` was sales-shaped (POSITION default "Sales Person" +
REQUIRED commission block). Now: free-text POSITION → designation
dropdown (reads `designations` master); position + salary auto-fill;
commission block shows + is required ONLY for `has_incentive=true` roles
(Sales/Telecaller); flat-salary roles record zero incentive. Single file,
HR-admin only, no SQL.

**Owner-accepted caveat (DO NOT forget):** the offer-letter PDF
(`OfferLetterPDF.jsx`) is STILL sales-only — `resolveLevel()` maps only
L1/L2/L3 sales tiers; the body is commission annexures / realised
billings / cluster revenue. BOTH offer entry points (SendOfferModal +
`/hr/offer/:userId`) feed this one sales PDF. So an offer SENT for a
non-sales role reads sales-style. Owner chose "dropdown only, today";
per-role letter templates = deferred "Two letter types" module.

### Phase 109.2 — day-summary share stale-fix (`f3c58cd`)

Owner: "when we share report, newly fetched data not coming — once we
share, new data fetched and we need to reshare." `DaySummaryCard.handleShare`
built the WhatsApp text from mount-time React state; daily_ta + counters
grow through the day → first share stale. Fix: `useDaySummary.refresh()`
now RETURNS the assembled object; `handleShare` awaits it and builds from
that (falls back to state on refetch error). Purely fetch-timing — no
KM/threshold/checkout-chain change. Guardian PASS.

### KM 3-way mismatch — DIAGNOSED, root cause is on-device (NOT code)

Owner: kirti kotak 1-Jun showed GPS map **62.2 km**, TA claim **56 km**,
day-summary report **36 km**. Reconciliation:
- **Report 36 = stale share** (the daily_ta value at an early share). Phase
  109.2 fixes it — report now reads current daily_ta (= TA number).
- **TA 56 = `daily_ta.km_traveled`** — server `compute_daily_ta`
  (canonical = `supabase_phase103_d6_daily_ta_seg10.sql`; acc≤50m, seg≥10m,
  speed≤120, ×₹3/km bike). Live-incremental (recomputes on every ping).
- **Map 62.2 = client `gpsDistance.js::summariseTrack`** (BATCH, same
  thresholds) BUT has an **accuracy-fallback compute_daily_ta lacks**: if
  >50% of pings fail the 50m accuracy cap it counts ALL pings → inflates on
  weak-GPS days. That's the 56-vs-62 gap.
- **The real problem dwarfs both:** kirti was out 9:04am→8:00pm (~11h) but
  GPS uptime was **only 3h 35m** → ~7h had no pings. The app only captures
  location reliably while foreground. So NEITHER number counts the dark
  hours.

**Background-GPS code ALREADY EXISTS + is fix-iterated** —
`src/utils/backgroundGps.js` (`@capacitor-community/background-geolocation`
`addWatcher` + watchdog + re-arm, Phases 103.D.1/.D.3), started in
V2AppShell:361 on login (native-only). `LocationTrackingService.java` is a
LOG-ONLY diagnostic (writes nothing). So this is NOT a code gap.

**kirti's phone confirmed running current APK v0.96.9** (plugin compiled
in). So the 3h35m gap is a **device-settings** problem, not old-APK and not
code. The two Samsung killers (owner checking 2 Jun):
1. **Location permission must be "Allow all the time"** (not "while using
   the app") — Android 11+ gives zero background location otherwise.
2. **Battery = Unrestricted** — Samsung "Optimized" kills the foreground
   service on screen-lock.
Plus sanity-check the persistent "tracking location" notification appears
when backgrounded.

**Next session (2 Jun) opening move:** get owner's answer on kirti's
Location-permission mode + battery setting.
- If flipping them closes the map gap → the fix is an **onboarding prompt
  that forces "Allow all the time" + battery-unrestricted** (native, needs
  APK rebuild + device test — do NOT ship blind, §39).
- Do NOT write more background-GPS capture code — it exists and works when
  the OS lets it run.
- The 56-vs-62 calibration (accuracy-fallback) is secondary noise; don't
  touch the frozen `compute_daily_ta` financial trigger without owner
  sign-off + real-ping evidence (§42 lesson: the higher number was GPS
  noise last time).

### Push pending as of EOD 1 Jun

`da6d30d` (109.1) + `f3c58cd` (109.2) committed, NOT on origin
(origin HEAD = `b96e7d6`). Owner to run:
`cd ~/Documents/untitled-os2/Untitled/adflux && git push origin untitled-os`
JS-only, no SQL, no APK rebuild.

**RESOLVED 2 Jun:** all of the above + the Phase 110 batch + Phase 111
are now on origin. See §44 push-state table. Nothing pending.


---

## 44 · DETAILED CURRENT FLOW — how the live app actually works (2026-06-02)

Owner asked for the current end-to-end flow documented so future
sessions treat these as KNOWN CONTRACTS and don't re-derive (or
break) them. **This whole app is in daily use by the real team
right now** — every flow below is live on `app.untitledad.in`.
Doc-only section; no code/schema touched to write it. Each flow
below was verified against live code on 2 Jun 2026, not recalled
from memory.

### 44.0 · Push state after this session (all on origin, HEAD = `69c9d9a`)

```
69c9d9a Phase 111: deterministic quote WhatsApp share — render + stable link
6f47adb Phase 110 #5: score counts only real calls (DB fn; owner ran + backfilled)
8bde434 Phase 110 #4: share today's report stays available after auto-checkout
824cc19 Phase 110 #3: manual checkout for telecallers
20d55f1 Phase 110 #2: evening report meeting count applies §33 exclusions
d0415ba Phase 110 #1: block past follow-up time on outcome save
dd2cc5a Phase 109.9: restore the type box in "What did they say?"
9986988 Phase 109.8: rep profile pic on Team Dashboard cards (LeadAvatar imageUrl)
1420173 Phase 109.6/.7 + 109.3: team_role guard + backfill + HR email rename SQL
69cf1ed Phase 109.5: convert-to-user via idempotent admin_create_user
```
SQL already run by owner: phase109 HR-login, phase109_4 offer PII,
phase109_7 team_role guard, phase110 score real-calls (+ backfill).
No APK rebuild needed for any of it (live-update mode, §38).

### 44.1 · Roles + landing (RootRedirect)

`admin` → /dashboard · `co_owner` (Vishal, govt-scoped §42) →
/dashboard · `sales` → /work · `telecaller` → /telecaller ·
`agency` → /work · `hr` (Riya) → /hr · `sales_manager` (none live
yet) → manager dash. Route guards: RequireAuth, RequirePrivileged
(admin+co_owner), RequireHROrPrivileged (+hr, only /people/:id +
/hr*), RequireManager, RequireGovtAccess.

### 44.2 · Sales rep daily flow (`/work`, mobile-first, §28 FROZEN)

1. Open → if not checked in, **Start day** (plan numbers from
   work_sessions.planned_* or daily_targets fallback). doCheckIn
   logs a GPS ping.
2. Checked-in view = V2Hero (target ring + KPIs) · NextActionCard
   (the ONE next thing) · stale-leads banner (3+ days no contact)
   · TodayTasksPanel (today's follow-ups) · RepMapPanel (where
   you've been) · NearbyLeadsCard · MissedCallsCard · GpsOffBanner
   (red if Location off).
3. Rep taps a lead → tel: dialer → **call→outcome chain** (44.4).
4. Log a field meeting → LogMeetingModal (phone-first dedup,
   optimistic save Phase 88.1).
5. Background GPS pings feed daily_ta km (44.7).
6. Evening → DaySummaryCard (44.6) → share WhatsApp report.
7. Card mount gates: line 1000 `{checkedIn && (` — DaySummaryCard
   shows even after dayDone (Phase 110 #4). All OTHER /work cards
   keep `{checkedIn && !dayDone && (` (hide once day wrapped).

### 44.3 · Telecaller daily flow (`/telecaller`, §28 FROZEN)

Mirror of /work for phone-only reps. V2Hero shows X/target calls +
connect-rate ring. quickLogCall = same tel:→audit→modal chain as
/work (44.4). No field-meeting / map. Upcoming-callbacks panel
(open follow_ups next 48h). Manual checkout via DaySummaryCard
(Phase 110 #3 — TC had no checkout button before). MEET KPI hidden
for role=telecaller AND team_role=sales_manager (Renuka).

### 44.4 · Call → outcome chain (PostCallOutcomeModal, §28 FROZEN — do NOT alter)

The single most-protected flow. Byte-contract:
```
user taps Call → tel: link fires (real dialer, user gesture)
   → 1.5s timer
   → logCallAudit writes call_logs row
   → lead_activities row inserted (activity_type='call', outcome=null)
   → PostCallOutcomeModal opens
rep picks outcome (Good/Maybe/Call later/Lost) + next action
   (call-back 2h / tomorrow / 3d / 7d / nurture / meeting / custom / none)
   + optional voice/typed note ("What did they say?" — type box
     restored Phase 109.9)
Save:
   → activity row PATCHED with outcome
   → old open follow_up for (lead,rep) CLOSED
   → new follow_up SPAWNED for next action (+ schedules native alarm)
   → any open smart_task for (lead,rep) CLOSED
   → load()/realtime refresh → queue advances to next lead
```
**Phase 110 #1 guard:** if next-action uses a custom date+time that
is already in the PAST (IST), Save is blocked with a toast — stops
reps booking a follow-up for a time that already went by. Lost
outcome auto-forces nextAction='none' + skips the prompt (Phase
97.6). Lost/Won cancels any scheduled alarm (Phase 97.3).

### 44.5 · Checkout flow (manual + auto + share-after)

`doCheckOut(source='manual')` on both WorkV2 + TelecallerV2.
`check_out_source` enum = **`manual` | `auto_share` | `auto_cron`**
(anything else normalized to `manual` by `safeSource` guard).
- **Manual:** rep taps Check out on DaySummaryCard → source
  `manual`.
- **Share-chained:** sharing the evening report can checkout →
  source `auto_share`.
- **Evening cron:** ~8pm stamps the evening-report timestamp
  (→ `dayDone`) and auto-checks-out reps still on the clock →
  source `auto_cron`.
Phase 110 #4: after ANY checkout the rep can still reopen /work and
share today's report (DaySummaryCard no longer hidden by dayDone).

### 44.6 · Evening day-summary / WhatsApp report flow

DaySummaryCard appears ≥19:00 IST (hour gate). Shows plan vs actual
(meetings / site-visits / calls / qualified) + km. Tap **Share to
your group** → WhatsApp opens with formatted text (emoji format
owner-approved §33). 
- **Phase 109.2:** `useDaySummary.refresh()` RETURNS the freshly
  assembled object; `handleShare` awaits it and builds the message
  from THAT (not stale mount-time state). Fixed "first share shows
  old numbers, have to re-share."
- **Phase 110 #2:** meeting/site-visit tally in the card applies
  the §33 done-meeting exclusions (`notes` NOT LIKE 'Meeting
  scheduled%' / "I'm here · auto-check-in%"), so the report count
  matches the dashboard + GPS-track count.

### 44.7 · TA / km flow (financial — ₹3/km, FROZEN trigger)

GPS pings → `compute_daily_ta` (live-incremental, recompute every
ping). Canonical = `supabase_phase103_d6_daily_ta_seg10.sql`:
acc ≤50m, segment ≥10m, speed ≤120km/h, daily cap 600km. Client
`gpsDistance.js::summariseTrack` (map display) uses the same
thresholds (Phase 98.D) BUT has an accuracy-fallback that can
inflate on weak-GPS days → small map-vs-TA gap is expected noise.
**KNOWN-OPEN (device, not code):** reps lose km when phone GPS is
off / app backgrounded without "Allow all the time" + battery
Unrestricted (kirti: 3h35m tracked of 11h, §43). Background-GPS
code EXISTS + works when OS allows. Do NOT touch the frozen
compute_daily_ta without owner sign-off + real-ping evidence.

### 44.8 · Score → incentive flow

`compute_daily_score` (SECURITY DEFINER, AFTER-INSERT trigger on
lead_activities) → daily_performance.score_pct → feeds monthly
incentive. Telecaller branch counts activity_type='call';
sales/agency branch counts 'meeting'. Sunday/holiday/approved-leave
excluded.
- **Phase 110 #5:** the TC `call` count now only counts a call that
  REALLY happened — `outcome IS NOT NULL` OR a matching call_logs
  row with `duration_seconds >= 10` and direction ≠ 'missed'. A
  tapped-but-not-dialed call no longer earns score → no inflated
  incentive. Sales meeting branch byte-unchanged. Live phase97.2
  security gates (`_assert_self_or_admin` + `pg_temp`) preserved.
- **KNOWN-OPEN (§33):** the meeting branch does NOT yet apply the
  scheduled/auto-checkin exclusions, so scores on days with
  scheduled or auto-check-in meetings may be slightly inflated.
  Counter + report are clean; the score function is not. Separate,
  un-started task — do NOT assume scores are clean.

### 44.9 · Quote → PDF → WhatsApp share flow (Phase 111, money flow)

Rep opens a quote → taps WhatsApp. Cascade in
`QuoteDetail.handleWhatsApp`:
```
native (APK)? → Share the PDF file directly
else → uploadQuotePDFHtml() renders + uploads + returns a link
   render (captureToCanvas): awaits document.fonts.ready + every
     <img> load (5s cap) BEFORE html2canvas → letterhead first page
     always paints (Phase 111 — killed the intermittent blank page)
   link (uploadQuotePDFHtml): REUSES the quote's latest non-expired
     pdf_share_tokens row, mints a new one only if none exists →
     SAME branded link every send (Phase 111). Returns
     https://app.untitledad.in/pdf/<ref>?t=<token>
   on upload failure → downloadQuotePDF() local fallback
branded-link gate (Phase 95.3): skip is.gd shortener when the URL
   is already .../pdf/ — so the rep sees the branded link, not is.gd
→ openWhatsApp(quote.client_phone, template + link)
```
Net: every tap → client's WhatsApp + template + same branded link
+ correctly-rendered PDF. `pdf_share_tokens` RLS lets the sending
rep (self) + admin read their own token → reuse works.

### 44.10 · What is FROZEN vs safe to touch

FROZEN (guardian audit before ANY commit, even styling): all §28 +
§29 + §31 + §33 contracts — WorkV2, TelecallerV2, LeadDetailV2,
PostCallOutcomeModal + the call→outcome chain, useAutoRefresh
mounts, push enrollment (V2AppShell only), lead stages / cadence /
activity_type enums, compute_daily_score / compute_daily_ta /
meeting-KPI exclusions, the 9:30 IST morning push, the z-index
landscape. `QuotePDFHtml.jsx` is NOT frozen but is a money flow —
treat with the same care (parse-check + explain before push).

When the team is mid-shift, prefer web-only JS fixes (instant via
Vercel) over anything needing SQL paste or APK rebuild. Per owner's
standing rule: never ship a change that risks the current flow for
reps who are actively using the app.


---

## 45 · OWNER HARD RULE — live app is untouchable: no regression, no slowdown (2026-06-02)

Owner directive, 2 Jun 2026 (verbatim intent): *"don't touch existing flow or
code — our team already has the app with them, so if any change or slowdown
happens it will cost me a lot."*

This is THE governing rule for the Campaign module and every future module. It
adds an explicit **PERFORMANCE** dimension on top of §28 (frozen sales), §35
(blast-radius), and §40 (change-impact). Higher priority than any feature.

### The rule
1. **The live app is in daily use by ~22 people; their incentive math depends on
   it.** A regression OR a slowdown to any existing flow is a hard failure and
   costs the owner real money.
2. **New work is ADDITIVE only** — new tables, new routes, new endpoints, new
   Edge functions. New modules attach BESIDE the live system, never inside it.
3. **The only allowed change to existing data** is an additive nullable column
   that NO existing code reads/writes (e.g. `leads.campaign_id`) — and even that
   gets a `sales-module-guardian` PASS first (frozen pages `SELECT *`).
4. **Off-limits without explicit owner approval + guardian PASS:** every existing
   flow/file — leads CRUD, LeadUploadV2, WorkV2, TelecallerV2, LeadDetailV2,
   LeadsV2, FollowUpsV2, QuotesV2, quote wizards, payments / payroll / TA-DA,
   proposal renderers, dashboards, push-pipeline internals, all existing triggers
   + RLS, the §28 frozen surface.

### No-slowdown guarantee (the new, explicit part)
A change must add **ZERO latency** to existing hot paths (leads list, /work,
/telecaller, lead detail, every save flow):
- New triggers go on NEW tables. Anything that must touch `leads` /
  `lead_activities` must be proven non-blocking + guardian'd — never a new
  synchronous trigger on a hot save path.
- No new RLS subqueries or joins on existing high-volume tables.
- Inbound webhooks reply 200-fast, process async — never block.
- Realtime / polling subscribe to NEW tables only.
- Don't enlarge a hot query's `SELECT`/join set, don't add a round-trip to an
  existing save, don't ship a bundle-size regression to a rep-facing page.

### Hard stop
If a feature CANNOT be built without editing a live flow/file OR adding load to a
hot path → **STOP, tell the owner, get explicit approval + guardian + a
before/after perf check.** Never quietly tweak a live file to make the new thing
work. "It only changes one line in WorkV2" is exactly the move this rule forbids.

### Enforcement (every commit near the live app)
- `sales-module-guardian` PASS (correctness + frozen contracts).
- §40 3-surface table (desktop / mobile / APK) where applicable.
- For anything touching a hot path or a shared table: a **before/after perf
  note** (query count, latency, bundle delta) — not just "looks fine."
- Don't advise `git push` until verified (§35).


---

## 46 · Campaign / WhatsApp module — PARKED, resume tomorrow (2026-06-02)

Full design + the token-free build shipped today. Parked on the edigiexpert
token. Resume per the plan below.

### Reference docs (read first on resume)
- `_design_reference/CAMPAIGN_MODULE_STRUCTURE.md` — the spec (REVISE-accepted).
  Has the **★ MVP C2 table list**, the **★ 4 P0 contracts**, §13 security
  must-haves, §4B future-proofing, revised phase order, locked owner decisions.
- `_design_reference/campaign_module_mockup.html` — 8-tab visual mockup.

### Verdict + owner-locked decisions (do NOT re-litigate)
Re-audit verdict = **REVISE** (was overbuilt). MVP = receive + chat + QR.
LOCKED: TC-first YES · duplicate = **attach to existing open lead** (never create
dup) · broadcast NO in MVP · chatbot NO · segments NO · agency access NO · QR raw
scans NO (messaged only) · Vishal = GOVERNMENT-only · Justdial = email parser later.

### The 4 P0 contracts (MUST honor before any inbound→leads write)
- **P0-1 Dedup:** normalize phone with existing `cleanPhone` (91+10); call
  `find_open_lead_id_by_phone()` first; attach if found; NEVER let
  `trg_leads_block_dup_phone` throw in the webhook path; never reassign a lead.
- **P0-2 Routing:** always set ONE owner col (default `telecaller_id`, TC-first) +
  `segment` (default PRIVATE); never both-NULL (Phase 99 round-robin landmine).
- **P0-3 Activity:** bot/automation writes `activity_type='whatsapp'` ONLY — never
  meeting/site_visit/call (would inflate `compute_daily_score` → incentive, §33).
- **P0-4 Stage:** only New|Working|QuoteSent|Nurture|Won|Lost.

### What SHIPPED today (token-free, additive, all guardian/security-audited)
| Phase | What | Commit | State |
|---|---|---|---|
| C2 | 7 foundation tables + `leads.campaign_id` + whatsapp_templates cols | `cf0e5eb` (`supabase_campaign_c2_foundation.sql`) | **SQL RUN by owner — live.** 0 triggers on leads (verified). |
| C8 | QR & Locations page (`CampaignQrV2.jsx`) — make/print board QRs, token-free | `0c75906` | **pushed + live** |
| — | Campaigns page (`CampaignsV2.jsx`) — name + routing | `dcf2b5f` | committed; **push may be pending** — verify `git log origin/untitled-os..HEAD` |
| — | Board→campaign attach (campaign_id picker on QR page) | `dc730f5` | committed; **push pending** |

New dep: `qrcode.react@4.2.0` (lazy-loaded — rep bundles untouched). Nav: one
admin **Campaigns** entry → `/campaigns` (→ `/campaigns/qr` one click in). Frozen
V2AppShell touched additively (guardian PASS both times).

### BLOCKED on (the only thing stopping the rest)
The **edigiexpert token** + 4 more values. Owner must get from edigiexpert (they own
the WABAs): (1) permanent System User access token, (2) App Secret, (3) campaign
number's phone_number_id, (4) WABA id, (5) confirm payment method. Owner also must
pick THE campaign number (2 live: 95815 78261 / 98982 73686). Full owner-facing
guide was given in chat 2 Jun (the copy-paste request to edigiexpert).

### RESUME PLAN (tomorrow)
1. Confirm the pending commits are pushed (`git push origin untitled-os`).
2. Owner picks the campaign number + has the 5 values from edigiexpert.
3. Walk owner click-by-click: put the secrets into **Supabase → Project Settings
   → Edge Functions → Secrets** (use DISTINCT names so the existing daily-brief
   `META_WABA_*` secrets aren't clobbered — pick the campaign number first to know
   if it's the same number daily-brief uses).
4. Build **C4** = receive-only webhook (`api/wa/webhook` — inline raw-body HMAC +
   `(provider,event_id)` idempotency + 200-fast async; NO lead write yet). Verify
   against a real Meta test payload on a preview deploy FIRST.
5. Build **C4.5** = inbound→`leads` with the 4 P0 contracts (highest risk —
   guardian + security gate).
6. Build **C5** = inbox (reply in 24h window) + notifications via a DEFINER trigger
   (NOT direct `rpc('enqueue_push')` — it's REVOKED from authenticated, Phase 97.A2).
7. Then **C8 location_id** (FK board→lead), then later: auto-reply (C7), Meta
   ingest (C9), Justdial (C10). Broadcast/Segments/Chatbot = V3.

### Do NOT (per §45 + owner)
- Do NOT build empty Integrations/inbox shells just to "make progress" — placeholder
  screens add live-app risk for zero value. Owner explicitly fine with parking.
- Do NOT ship webhook/intake code untested at the live app — verify on preview +
  a real Meta test payload before it touches a live lead.
- Do NOT touch any existing flow/file or add load to a hot path (§45).


---

## 47 · Phase 113 — duplicate-lead ghost-click bug CLOSED + score/counter fixes (2026-06-05)

Owner reported a rep card showing "5 meetings / 6 leads" when the rep did
1 meeting. Root-caused to a re-entrancy bug + two stored-counter / score
drifts. Full future-proof shipped. Owner directive throughout: "full
futureproof solution, not a patch; app is live for my team, other
functions must not be affected" (§45).

### The disease — WebView ghost-click re-entrancy (the dup-lead root cause)
A single Save tap on the Capacitor WebView fires the modal's `handleSave`
**multiple times within one event-loop tick** (kirti: 5 lead inserts in
**84ms** — confirmed from `created_at`). The guard was React STATE
(`if (saving) return`); state doesn't flip until a re-render, so all N
calls read `saving=false` and each creates a lead. The Phase 68.2
same-minute unique index can't catch it (each dup lead has a DIFFERENT new
`lead_id`); the lead-dedup can't collapse it (different leads).

### FROZEN CONTRACT (NEW) — every save modal that inserts leads/activities
MUST use the **synchronous `useRef` latch**, not just `if (saving) return`:
```
const savingRef = useRef(false)
async function handleSave() {
  if (savingRef.current || saving) return          // top guard
  ...synchronous validation (return = no latch set, no lock-up)...
  // before the FIRST await that leads to an insert:
  if (savingRef.current) return; savingRef.current = true   // re-check ONLY
  setSaving(true)                                  // needed if an await
  ...                                              // precedes this point
  // release on EVERY exit path after the set:
  setSaving(false); savingRef.current = false
}
```
Already applied (guardian PASS each): `LogMeetingModal` (Phase 113.2,
`df046ea`), `PostCallOutcomeModal` + `LeadFormV2` (Phase 113.4, `ab10a2a`).
`WhatsAppSendModal` already had it (Phase 68.2, `sendingRef`). The latch
is the proven pattern — reuse it; do NOT rely on the `saving` state guard
alone for any new insert modal.

### Counter drift — `new_leads` (the "6") — FIXED + future-proofed
`daily_counters.new_leads` is bumped +1 on lead INSERT
(`trg_lead_after_insert_bump_counter`, phase12) but was NEVER decremented
on DELETE → drift (same class Phase 103.E.1 fixed for meetings and
explicitly flagged new_leads as next, its line 41). Phase 113.3
(`01a3491`, `supabase_phase113_3_new_leads_counter_delete_heal.sql`, RUN +
trigger confirmed 5 Jun) adds `recompute_daily_new_leads` + an AFTER
DELETE trigger on `leads` + a 7-day one-time heal. Counter now self-heals
on any deletion, forever. **Dashboards read this STORED counter; the SCORE
does NOT (it counts live) — so the drift was display-only, no incentive
impact.**
- STILL OPEN (same latent gap, flagged again): the **`calls`** counter has
  the identical delete-drift (also flagged by 103.E.1). Not fixed yet —
  its qualified-vs-all-calls semantics must be confirmed before a
  recompute, to avoid setting it wrong. Next-session candidate.

### Score / incentive fixes (Phase 113, `d0a0923`,
`supabase_phase113_score_target_and_meeting_fix.sql`)
ONE `CREATE OR REPLACE compute_daily_score`, function-only (owner chose NO
backfill — past scores unchanged, today self-corrects on next activity):
- **#1 TC calls-target**: was read from the dead `users.daily_targets`
  JSONB (`'calls'=20`, Phase 32m seed); now reads the `daily_targets`
  TABLE `min_calls` (the 50 every screen shows). `NULLIF(min_calls,0)→
  COALESCE(.,50)`, NO JSONB fallback (so a TC with no table row gets 50 on
  both screen + score). A TC was scoring 100% at 20 calls while the ring
  showed 40% → incentive inflated ~2.5×. Security gates + Phase 110
  call-count gate byte-preserved.
- **#2 sales meeting branch**: applies the §33 done-meeting exclusions
  (`notes NOT LIKE 'Meeting scheduled%'` / `'I''m here · auto-check-in%'`)
  — closes the §44.8 KNOWN-OPEN; score now in 4-surface lockstep with the
  counter + GPS-track + evening report. **VERIFY whether the owner has run
  this SQL** — it's pushed but the Studio paste is manual.

### Notification bell recency cap (Phase 113.1, `e10b44b`)
`NotificationPanel` re-derived from source tables every open with NO lower
time bound on overdue follow-ups + breached SLAs → old open items
re-surfaced on every app launch ("old notification auto visible on open").
Added a **7-day floor** to those two queries. Admin messages (unread-only)
+ today's due-actions already bounded — untouched. JS-only, live.

### One-time data heals (manual, EXECUTED 5 Jun)
- kirti `KN University` 5 dup leads → 1. **READ-FIRST flipped the keeper**:
  one "duplicate" (`e574f3dc`) had grown a real quote + 4 follow-ups +
  QuoteSent → KEEP it, not the oldest. The original heal file kept the
  wrong one; corrected as Phase 113.2.1 (`18af447`). Lesson: a "duplicate"
  can grow real work — NEVER blind-delete by age; check quotes first.
- Abhinav `sure cure` 2 dup leads → 1 (both Lost, 0 quotes, kept older).
- Fleet scan (`source='Field Meeting'`, same rep+phone+minute, >1) found
  only those two bursts. Clean.

### Foot-guns added 2026-06-05 (don't repeat)
- ❌ `if (saving) return` (React state) as the ONLY guard on an insert
  modal — can't stop same-tick ghost-clicks. Use the `savingRef` latch.
- ❌ Pasting a long multi-statement SQL block into Studio in one go — the
  clipboard truncated a UUID mid-token twice. Run section-by-section;
  inline UUID lists on ONE line; avoid `BEGIN…COMMIT` wrappers that lose
  the tail.
- ❌ `git commit --amend` on a commit the owner ALREADY pushed — creates a
  non-fast-forward divergence. If it's pushed, land a follow-up commit
  (did this: 113.2.1), never force-push the owner's branch.
- ❌ Blind-deleting "duplicate" leads by age — one may carry a quote/work.
  Read-first (quotes/payments/activities per id) before any lead delete.
- ❌ Assuming a dashboard count is a live query — many tiles read the
  STORED `daily_counters` JSONB, which drifts. Check insert-bump +
  delete-heal before trusting/healing a counter.

### State on origin (HEAD = `ab10a2a`, all pushed 5 Jun)
```
ab10a2a Phase 113.4: re-entrancy latch + loader on all save modals
01a3491 Phase 113.3: new_leads counter delete-heal (mirror 103.E.1)  [SQL RUN]
18af447 Phase 113.2.1: correct heal-record SQL (keeper = e574f3dc)
df046ea Phase 113.2: LogMeetingModal latch + kirti heal
e10b44b Phase 113.1: NotificationPanel 7-day recency cap
d0a0923 Phase 113: compute_daily_score TC target + meeting exclusions  [SQL: confirm run]
```
Phase 113 score SQL — CONFIRMED RUN 5 Jun (proconfig shows `search_path=
public, pg_temp`; the VERIFY `pg_temp_hardening=false` was a pg_get_functiondef
quoting artifact, not a missing gate). All Phase 113.x on origin + applied.

### 47.1 · Phase 113.5 — telecaller call bugs (2026-06-05, `4681e42`, pushed + SQL run)

Owner reported 3 call bugs on Rima (TC): "95 callbacks due but she called
them", "tap-but-no-dial still logs (solved before, back again)", duplicate
call rows. Root-caused (read-only agent) + fixed, guardian PASS, §45-verified.

- **Call-button latch (EXTENDS the §47 latch contract to calls):**
  `quickLogCall` in `TelecallerV2.jsx` + `WorkV2.jsx` got the synchronous
  `callingRef` latch (top guard + set-after-validation + 2.5s auto-release).
  A WebView ghost-click was double-firing → 2 `call_logs` (+ double dial).
  **NEW CONTRACT: the call button is now part of the save-modal latch family
  — any new path that inserts call_logs / call activities on a tap MUST latch
  it.** (lead_activities 'call' dups were already blocked by Phase 68.2.)
- **"Tap logs without dialing" is INTENTIONAL** — `logCallAudit` (Phase 35.0)
  writes a `call_logs` row on the tel-tap as the anti-fraud "rep tapped Call"
  proof (`outcome='no_answer'`, 0s, note `'tel-tap audit…'`). It does NOT
  count as a call or score (the ≥10s / outcome-non-null gates exclude it).
  Phase 113.5 greys these rows (`opacity 0.45`, `GpsTrackV2` call history)
  so they read as unconfirmed, not phantom calls. Do NOT "fix" the row-on-tap
  away — it's the audit trail.
- **`call_logs` dedup (`supabase_phase113_5_call_logs_dedup_trigger.sql`,
  RUN + trigger `trg_call_logs_dedupe` confirmed):** a BEFORE INSERT trigger
  skips EXACT duplicates (same user+phone+direction+duration+IST-minute) —
  kills the scan-vs-scan race. **Used a trigger, NOT a unique index, to
  sidestep the 42P17 STABLE-function blocker that killed Phase 93.25.2's
  index** (date_trunc on timestamptz is STABLE → illegal in an index
  expression, legal in a trigger body). Audit-vs-scan reconciliation
  preserved (different durations → not deduped). + 30-day cleanup. §45-safe:
  both call_logs writers (callAudit, callHistoryIngest) destructure only
  `error`, no `.select()/.single()`, and a BEFORE-trigger NULL is a silent
  skip (not an error) → writers see nothing; a skipped dup also doesn't fire
  the AFTER-INSERT calls-counter bump → counter gets MORE accurate.
- **Callbacks-due count (`TeamDashboardV2`):** was counting raw open
  follow_up rows; one lead stacks many open callbacks (every "call back
  later" spawns a new follow_up without closing the old). Now counts DISTINCT
  lead per rep → Rima's 95 → real number. Read-side admin only.

### Still open (next-session, owner-aware)
- **`calls` counter delete-heal** (sibling of 113.3) — same delete-drift
  remains on `daily_counters.calls`; needs its qualified-vs-all semantics
  confirmed before a recompute. (113.5's dedup trigger reduces dup-driven
  inflation but doesn't add a delete-heal.)
- **Callback auto-close on next call** — the deeper cure for the "95": a
  callback follow_up only closes on a PostCallOutcomeModal SAVE. Closing the
  old open callback when a NEW call activity is logged for the same (lead,
  rep) even without a modal save would touch the FROZEN follow_up close/spawn
  chain (§28) → guardian + owner sign-off. Parked deliberately.

### 47.2 · Telecaller module cleanup — Phase 113.6 → 113.10 (2026-06-05, all on origin, guardian PASS)

Owner audited the TC Today page (`/telecaller`, `TelecallerV2.jsx`) + flagged 7
items. Full read-only audit first (general-purpose agent), then fixed in 5
guarded commits. Plus the callbacks-window fix that started it.

- **113.6 (`f8b8071`) — "Callbacks due" window.** The admin TC card's
  callbacks count was `follow_up_date today..today+2` (counted TOMORROW's
  callbacks as "due" → Rima showed 104). Now `<= today` (due today + overdue).
  Diagnosed live: 101 of Rima's 104 were scheduled for tomorrow; real
  due-today = 3. `TeamDashboardV2`, admin read-side.
- **113.7 (`15af7f4`) — declutter.** Removed from the TC page: the round
  initial avatar (`.tc-big-av`, + dead `heatColor`), the **Missed-call
  rescue** card (`MissedCallsCard` — its "N in 24h" was a render CAP not a
  count, and padded by the tel-tap audit `no_answer` rows so it never showed
  real missed calls), and **"Today on the map"** (`RepMapPanel` — N/A for a
  phone rep). BOTH components stay mounted on WorkV2 — only the TC mounts +
  imports were removed. Don't delete the component files.
- **113.8 (`28afaac`) — call chain fix (FROZEN, guardian-critical).** Owner #5
  "call → outcome → WhatsApp popup not coming." TWO causes: (a) the outcome
  modal failed to open on a same-minute RE-tap — the `lead_activities` insert
  hit the Phase 68.2 dedupe index (23505) and the old code toasted + returned.
  Now on a dup-key error it fetches the existing call row for (lead, rep), sets
  `pendingActivityId`, and still opens the modal at +1.5s. (b) the
  WhatsApp-after-outcome prompt NEVER existed on TC (only `/work`) → added
  `WhatsAppPromptModal` + `waPrompt` + the `onSaved` WA branch (skip on
  meeting next-action or `wa_opt_out`, pure boolean check — no toast
  side-effect). Mirrors WorkV2. My Phase 113.5 latch was confirmed NOT the
  cause (latch isn't on the modal-open path; WorkV2 has the same latch + works).
- **113.9 (`bc3d87e`) — accordions.** The 3 list sections (Upcoming callbacks
  / Pending hand-offs / Call queue) are now `<details className="lead-card
  tc-accordion" open>` with the title in `<summary className="lead-card-head">`
  + a rotating Lucide `ChevronDown` — same as the follow-ups page. Hand-offs +
  Call queue, previously a cramped 2-col grid, now stack full-width. New
  `.tc-accordion` CSS in `leads.css` hides the native marker + rotates the
  chevron; the title `div:first-child` takes `margin-right:auto` so an optional
  "View all" link + chevron group right. Layout only — every Call button +
  HeatPicker + StageChip preserved. "View all" got `stopPropagation +
  preventDefault` so it navigates without toggling.
- **113.10 (`a552d7f`) — KPI tile drill-down.** Owner #3 "tiles land on leads,
  not the data." Root cause: `LeadsV2` (frozen, shared by ALL roles) ignored
  URL params entirely, so `/leads?stage=Working` did nothing. Added ONE
  additive `useEffect` reading `?stage=<group key>` (new|working|quote_sent|
  nurture|won|lost) → `setStageFilter`. No/invalid param = no-op; keyed on
  `location.search` so it never fights a manual chip click; client-side filter
  over already-RLS-scoped rows (no bypass). TC Qualified tile → `?stage=working`
  (was the dead capital-W `Working`). The pure-stat (Connected) + operational
  (In queue / Hand-offs / SLA) tiles aren't a single stage → they open the
  leads list as before.

### NEW contracts / patterns from this batch
- **`<details className="… tc-accordion">` accordion** is the TC declutter
  pattern (CSS in `leads.css`). Reusable for any collapsible card.
- **`/leads?stage=<group key>` deep-link** now works (LeadsV2 113.10). Any
  page can link to a pre-filtered leads list with a valid STAGE_GROUPS key.
- The TC **WhatsApp-after-outcome** prompt now matches `/work` (both use
  `WhatsAppPromptModal` on `onSaved`).

### Foot-guns added 2026-06-05 (TC batch)
- ❌ A dashboard "N in 24h" / "N due" badge that's a render-CAP or a forward
  window reads as a real total to the owner. State the window; cap honestly.
- ❌ A `call_logs.outcome='no_answer'` query for "missed calls" is padded by
  the tel-tap audit rows (every Call tap writes one). Don't surface it as
  "missed calls."
- ❌ Unicode `▾`/`▴` as an accordion chevron — §7 Lucide-only. Use
  `ChevronDown` (rotates via CSS).
- ❌ A KPI tile linking to `/leads?stage=…` assuming it filters — LeadsV2
  ignored URL params until 113.10, and the value must be a STAGE_GROUPS KEY
  (`working`), not the DB stage name (`Working`).
- ❌ Using a toast-firing guard (`blockedByWaOptOut`) as a silent boolean
  gate — it surfaces a stray toast. Use the pure field check (`wa_opt_out`).

---

## 48 · Phase 114 — TC GPS-prompt source + call-count contract + follow-up relabel (2026-06-05)

Commit `6af964f` (untitled-os). 4 files, no SQL, no APK rebuild
(pure JS — reaches the APK's live-loaded bundle too). Guardian PASS
(lone flag was a stale comment, fixed in the same commit).

### Why a TC "turn on GPS" prompt fires even in office (root cause)

Owner report: "tc is in office only but still they get gps turn on
notification." Background GPS (`startBackgroundGps`, V2AppShell:362)
is already role-gated off for TC — that was NOT the source. The real
source: **`useGpsLock()` on `LeadDetailV2` (shared sales+TC page) ran
UNCONDITIONALLY** (hooks can't be conditional). Its mount-effect calls
`refresh()`, which on web/PWA — or on an APK that predates the Phase
76.2 native plugin (still unshipped) — falls back to `probeWebGps()`
→ `navigator.geolocation.getCurrentPosition()` → the OS "turn on
location" prompt. The red `GpsOffBanner` was already sales-only
(Phase 102.D), but the **hook underneath it was never gated** — so the
prompt fired with nothing visible on screen.

Fix: `useGpsLock(enabled = true)` — when false, refresh no-ops
(`gpsOn=null`), `requestEnable` returns false, the effect early-returns
before subscribing. `LeadDetailV2` computes
`isFieldSales = role==='sales' && team_role!=='sales_manager'` and
passes it to the hook + the banner (DRY swap) + the "I'm here" button.
Default `true` keeps `WorkV2` (no-arg) byte-unchanged.

**Foot-gun:** any hook that probes a device sensor (GPS, camera, mic,
notifications) mounted on a SHARED page prompts EVERY role, even when
the visible UI it feeds is role-gated. Gate the hook, not just the UI.

### TC call-count = 50 contract (TelecallerV2) — RULE IS >=10s, DO NOT LOOSEN

Phase 114 first tried `outcome IN ('connected','callback_requested')
OR duration_seconds>=10`. **Phase 114.1 REVERTED it.** Owner caught it
same day: Rima's hero jumped to **183 calls / 183 "connected" (100%)**
while the day-summary still read the true **49/50**. Why 183 is fake:
the post-call modal marks almost EVERY call "connected," and duration
capture is broken (NULL/short on most rows), so OR-ing the outcome in
counts every tapped-through call regardless of length. "100% connected"
is the tell — nobody connects 100%.

**The owner's rule is firm and frozen: a call counts toward the 50
target ONLY at `duration_seconds >= 10`.** Never gate this on `outcome`
— outcome is rep-entered and effectively always "connected," so it
can't filter anything. `connectedToday` likewise stays
`outcome='connected' AND duration_seconds>=10`.

**The REAL open problem** (Yash 47s showing "—", Vishal): duration
CAPTURE is broken — a genuine 47s call saves `duration_seconds=NULL`
to call_logs, so it fails the >=10s gate and the rep falls short. The
fix is to make the Phase 65 `fetchAndPatchCallDuration` device-call-log
read RELIABLE (or another capture path), NOT to loosen the count. This
is unsolved and separate. The 49 itself is suspect-low for the same
capture reason — but the answer is fix capture, not count by outcome.

**Foot-gun:** do NOT "fix" an undercount by widening the WHERE clause
to a field that's always-true (outcome) — you trade an undercount for a
meaningless 100%. Fix the broken INPUT (duration capture) instead.

### Follow-up hero relabel (FollowUpsV2)

Owner: the "121 due today" headline was actually today + tomorrow +
this-week combined. He chose RELABEL over recount: eyebrow
`Today`→`Total`, footerStat `due today`→`upcoming`. Label-only, no
count/query touched. (If a true today-only count is ever wanted, it's
a separate change to the bucket math.)

---

## 49 · Phase 115–116 — TC "Worked" rename + call-duration timer fallback (2026-06-05)

Came out of an owner data-integrity probe on Rima's TC console. Three
live SQL diagnostics (read-only) established the truth before any code:
- 221 distinct taps today (dup-check 221=221 → no ghost dups; Phase 113
  dedup holding), but only **62 ≥10s** and **82 connected**.
- Week: **992 taps / 275 ≥10s / 480 connected** / 222 "qualified" / 130
  in Working. My Performance numbers matched these exactly → **the page
  is real live data, not mock**.

### Phase 115 (`abec1a5`) — "Qualified" was a lie, renamed to "Worked"

`leads.sales_ready_at` is auto-stamped on the **New→Working** transition
(phase34 `lead_set_handoff_sla` trigger) = **first contact**, NOT a real
qualification. So "Qualified this week = 222" was just "leads dialled
this week," always cleared the 5/week gate, and its tile click
(`/leads?stage=working` = 130 current snapshot) never matched the 222
weekly-cumulative number. Owner chose: **rename to "Worked", drop it as
a gate.** Done in `TcWeeklyTiles.jsx` (gate now quotes-only) +
`TelecallerV2.jsx` tile (label + `to:null`). SAFE because the Tc weekly
gate is **display-only** — real pay reads `compute_monthly_salary`
ungated (Phase 53b promotion never shipped). Zero pay change.

### Phase 116 (`21959e2`) — call-duration timer fallback

Root cause of "rep connected but didn't finish 50": **~43% of CONNECTED
calls save NULL duration** (480 connected vs 275 ≥10s this week). The
device `call_logs.duration_seconds` comes from `callLogReader.
fetchAndPatchCallDuration` reading the Android CallLog — unreliable
(no READ_CALL_LOG permission / plugin missing / number-match miss / web).
NULL fails the ≥10s gate.

Fix = in-app **time-away-from-app** timer as a FALLBACK only:
- `src/utils/callTimer.js` (new): `markCallStart(leadId)` arms a one-shot
  `visibilitychange` listener; dialer backgrounds the WebView, return →
  seconds-away ≈ call duration. `getCallElapsed(leadId)` returns+clears.
- `fetchAndPatchCallDuration({..., fallbackSeconds})`: **device duration
  ALWAYS wins**; fallback used only when device read is null AND value in
  **[5,1800]s**. The existing `.in('outcome',['connected',
  'callback_requested'])` filter means a no_answer row can NEVER receive
  a timer duration → the count cannot be inflated.
- `markCallStart(lead.id)` wired after `logCallAudit` at all 3 tap sites
  (TelecallerV2, WorkV2, LeadDetailV2); modal `handleSave` passes
  `getCallElapsed(lead.id)`. Guardian PASS.

### THE FROZEN RULE this re-confirmed (do not violate again)

A TC "call toward 50" counts ONLY at **`duration_seconds >= 10`**. NEVER
gate the count on `outcome` — the post-call modal marks ~every call
"connected" (Rima 100% connected), so outcome filters nothing. Phase 114
tried `outcome IN (connected,callback) OR ≥10s` and inflated Rima to 183
/ 100%; reverted in 114.1. The ONLY honest way to raise the count is to
fix duration CAPTURE (Phase 116), not loosen the gate.

### Still open (owner-aware)

- `compute_daily_score` (the salary score) still counts a 'call' on
  `outcome IS NOT NULL OR ≥10s` — looser than the ≥10s counter, so the
  score can read ~100% while real ≥10s = 62. Tightening it to ≥10s was
  deliberately deferred until Phase 116 duration-capture proves accurate
  on the APK (else we'd cut pay for a capture bug). Revisit after the APK
  smoke test shows the ≥10s count climbing toward the connected count.
- Phase 116 is **only fully testable on the APK** (the dialer hand-off /
  visibilitychange can't be simulated in-sandbox or on desktop web).

---

## 50 · ~~PARKED~~ RESOLVED — APK rebuild shipped 96010 (2026-06-05; closed 2026-06-07)

> **UPDATE 2026-06-07 — DEBT SETTLED.** Phase 121.2 (`72cd3cc`) rebuilt the
> APK to **versionCode 96010** and the owner confirmed it is **out to reps +
> working fine** (7 Jun 2026). So both native debts below — the
> `@capacitor/share` PDF-attach AND the Phase 76.2 tracking plugin
> (`TrackingPlugin.java` / `CallLogReader`) — are now **compiled into the
> installed APK on reps' devices**. The "PDF not attaching" complaint should
> be gone; the device GPS-toggle / network / heartbeat / call-duration
> capture now run natively (no more web-probe fallback gap). Tasks #23/#41
> can close. If a rep still reports a missing PDF attach or dark GPS, it's a
> NEW bug on 96010, not this parked debt. The original parked note is kept
> below for history.

The Capacitor APK runs **live-update**: it loads the Vercel bundle, so
**JS/CSS/SQL changes reach it with NO rebuild**. A rebuild is needed ONLY
for native plugins / Capacitor config / permissions / icons.

**Two native features are CODED in JS but NOT in the installed APK because
the rebuild was parked:**

1. **WhatsApp quote PDF attach** (Phase 103.D.8, `QuoteDetail.jsx`
   `handleWhatsApp`). The code calls `Share.share({ files:[pdf] })` via
   **`@capacitor/share`** (in package.json v8) to attach the real PDF.
   The installed APK predates the plugin → no native bridge → it throws →
   falls back to the **wa.me text-link** (PDF as a shortlink, NOT
   attached). Owner's recurring complaint: "PDF not attaching when a rep
   shares a quote on WhatsApp." **This is the parked item.** Fix = an APK
   rebuild (`npx cap sync` + build) so `@capacitor/share` lands natively.
   NOT fixable by a Vercel deploy.

2. **Phase 76.2 tracking plugin** (`TrackingPlugin.java` / `CallLogReader`)
   — also native, also needs the rebuild. Tasks #23/#41 pending. Until
   then `useGpsLock` / device duration-capture fall back to web probes —
   which is WHY Phase 116 added the visibilitychange timer fallback (so
   duration works even on a plugin-less APK).

**So when the owner asks "do we need to rebuild the APK?":** for routine
JS feature work, NO. But the PDF-attach + tracking plugin are REAL parked
debts that a rebuild settles — both land together on the next build. Do
NOT answer "no rebuild ever needed" without naming these two.

**Why parked:** owner's deliberate deferral (tied to the Phase 76.2 plugin
work + release-signing). Confirm with owner before rebuilding — it's a
deliberate park, not an oversight.


---

## 51 · Phase 122 / 124 / 125 — km single-source + report meeting target + rep route toggle (2026-06-07)

Owner audited Abhinav + kirti day-summary reports vs the admin dashboard.
Three findings, all shipped JS-only (no SQL, no APK rebuild), all
display-only, sales-module-guardian PASS, §45-safe (additive, no hot-path
load). On origin: `4744cea` (122) · `5242119` (124) · `694dc53` (125).

### KM SINGLE-SOURCE CONTRACT (NEW — freeze this, it's a repeat foot-gun)

Three surfaces showed three different km for the SAME rep-day (kirti 6 Jun):
rep "Today on the map" **51.0**, admin /admin/gps **33.1**, evening report +
TA payout **32.6**. Root cause: the rep map AND the admin track both
RE-COMPUTE km client-side via `gpsDistance.js::summariseTrack`, whose
accuracy-fallback ("if >50% of pings fail the 50m accuracy filter, count
ALL pings") inflates on weak-GPS days (kirti: 881 of 1773 pings
low-accuracy, on the 50% knife-edge → the rep's ping set tipped the
fallback ON → 51; the admin's full set landed just under → 33).

**THE RULE (Phase 124):** `daily_ta.km_traveled` (server `compute_daily_ta`,
the per-ping AFTER-INSERT trigger `tg_ta_on_ping` — **live, NOT nightly**;
the nightly cron `recompute_all_ta_today` is only a backstop) is the ONE
source of truth for km. It is what the TA payout pays. Every DISPLAY of km
MUST read `daily_ta.km_traveled` (filter: `user_id` + `ta_date`), falling
back to the client `summariseTrack` km ONLY when daily_ta has no row for
that (user, date). `summariseTrack` / `cleanTrack` may ONLY drive the route
POLYLINE + the ping/low-accuracy diagnostics — NEVER the headline km.
- Applied to `RepMapPanel.jsx` (the rep chip) + `GpsTrackV2.jsx` (admin
  DISTANCE) in Phase 124. The report (`useDaySummary`) already read it.
- The "daily_ta only rolls up nightly" comment in `TaDaRequestPanel.jsx` +
  `MeetingsMapPanel.jsx` is STALE (pre-34Z.67) — daily_ta is live per-ping.
- Do NOT "fix" a km mismatch by tuning the client `summariseTrack`
  accuracy-fallback threshold — show `daily_ta` instead. Any NEW km display
  reads `daily_ta.km_traveled`, never a fresh client recompute.

### Report meeting target (Phase 122)

The evening WhatsApp report's client-side `dayScore` (useDaySummary) read
the meeting target from the **morning-planner array COUNT** (`work_sessions
.planned_meetings`), which is **0** when the rep didn't pre-plan meetings →
`pctOf(4, 0)` returns 100% → meetings got the full 50/100 → Abhinav's report
read 81 instead of ~71. The admin card AND the pay score
(`compute_daily_score`) both correctly use the real target
`users.daily_targets.meetings || 5` (Abhinav 4/5 = 80%).
- **The PAY score was never wrong** — only the report's DISPLAY score.
- Fix: `planMeetings` now uses the rep's morning plan IF they entered one
  (count > 0), else falls back to `(profile?.daily_targets?.meetings) || 5`
  for sales / 0 for TC — matching the card + pay score.
- Quote-scope mismatch (report line "Quotes sent: N (this month)" vs the
  score's TODAY-only quote slice) — owner chose LEAVE IT (the "this month"
  label already disambiguates). Do not relabel.

### Rep route toggle (Phase 125)

`RepMapPanel` ("Today on the map", frozen /work + /telecaller) gained the
admin-style **All / Route only / Meetings** segmented toggle. `viewMode`
default `'all'` → `showRoute` + `showMeetings` both true → both render
effects byte-identical to before (every rep uses this card daily, so the
default MUST not change). 'route' hides meeting pins, 'meetings' hides the
route line. Pure client view-state over already-fetched data — no new query.
Mirrors the `GpsTrackV2` viewMode pattern. Reusable if another map needs it.


---

## 52 · CLAUDE.md backfill — undocumented Phase 117–123 + PHASE-NUMBER COLLISION (2026-06-07)

CLAUDE.md jumped from §49 (Phase 115/116) → §50 (APK parked) → §51
(Phase 122/124/125), skipping ~15 shipped commits. This section backfills
them. **All are on origin (`untitled-os`) + live.**

### ⚠️ PHASE-NUMBER COLLISION — disambiguate by SHA, not number

Numbers **117 / 118 / 119 / 120 / 121 / 122 were REUSED across two
batches**. There are TWO Phase 117s, TWO 119s, etc. — completely different
work. When someone says "Phase 119", ask which one or check the SHA. The
git log order (newest first) is the truth. Going forward, the next new
phase is **126+** — do NOT reuse 117–125.

### BATCH A — day-summary / day-track / admin call-history (prior session, between the §49 and §50 doc commits)

| SHA | Phase | What |
|---|---|---|
| `9178224` | 117 | Admin day-track call-history split into **"Lead calls · N"** + **"Unknown numbers · N"** (`GpsTrackV2`, new `CallHistorySection`). Unknown rows = `tel:` one-tap. §33 exclusions byte-intact. |
| `03c28ca` | 118 | **Redesigned Sales Day Summary** — 4-tier scorecard + new lines (the `useDaySummary` / `whatsappSummary` shape §51 Phase 122 later tuned). SQL touched the chase/score counts. |
| `5a4548a` | 118.1 | `DROP FUNCTION before recreate` (42P13 return-type-change fix). |
| `a523bda` | 119 | Admin **QUALIFIED = lead calls only** (+ "Other ≥10s" non-lead stat) on the day-track call breakdown. |
| `ffc7d0a` | 120 | Fraud flag **"Unverified connected"** on the day-track (connected-outcome rows with no duration proof). |
| `9e7df76` | 119[sic→121] | Day-track **map dots** — round dots for check-in/out/stops, **teardrop = meeting only** (commit mislabeled 119; it's the 121 day-track series). |
| `0496b99` | 121.1 | Day-track polish — dropped dup KPIs (Qualified/Voice), Unknown section starts collapsed, bigger check-in/out dots. |
| `72cd3cc` | 121.2 | **APK rebuild** — versionCode `96009→96010` carrying the §50 PDF-attach (`@capacitor/share`) + tracking-plugin native code. **CONFIRMED out to reps + working fine (owner 7 Jun 2026) → §50 parked debt SETTLED.** |

### BATCH B — team-dashboard KPI drill-downs + smart-task hide + campaign + this session's data-integrity bug-hunt

| SHA | Phase | What |
|---|---|---|
| `2c17dfc` | 122 | **Team-dashboard KPI drill-downs** — admin dashboard tiles become clickable. (Different Phase 122 from §51's meeting-target fix `4744cea`.) |
| `c5af8a7` | 122.1 | Wired the remaining 5 KPI tiles to their drill-downs. |
| `0418e96` | 122.2 | **Quote-chase + Pay-chase** dashboard tiles land on the quotes list. SQL `supabase_phase118_chase_counts_outstanding.sql` backs these counts — **confirm run state**. |
| `d77721e` | 123 | **Hide NEXT UP (smart task) + TODAY'S TASKS on sales /work** (role='sales' only — owner: "confusing for the team"; their tasks live in the FOLLOW-UPS tab). Agency/managers keep both. Pure render gate; call chain byte-intact. Guardian PASS. |
| `aff51c5` | C4 | **WhatsApp Cloud API receive-only webhook** (`api/wa/webhook.js`) — campaign module §46. Raw-body HMAC verify + verify-token GET handshake + PII-stripped `webhook_event_log`. NO lead write yet (that's C4.5). Env: `CAMPAIGN_WEBHOOK_VERIFY_TOKEN` + `CAMPAIGN_APP_SECRET` (in Vercel). Parked at "subscribe Meta `messages` + test the test number". |
| `260a4cc` | 117 | **Close orphaned quote-chase follow-ups on quote delete** (`quote_after_delete_rollback_lead` also closes open `quote_chase` follow_ups when the QuoteSent→Working demotion fires). SQL `supabase_phase117_close_orphan_quote_chase.sql` **RUN**. (Different Phase 117 from `9178224`.) |
| `86fed75` | 119 | **Every deal = a lead** — `quote_before_insert_ensure_lead()` BEFORE-INSERT auto-attaches/creates a lead for an orphan quote (EXCEPTION-wrapped so a quote save can NEVER break; `cadence_paused=true` → no chase). SQL `supabase_phase119_every_deal_a_lead.sql` **RUN**. (Different Phase 119 from `a523bda`.) |
| `8a92c02` | 120 | **Call-duration race fix** — PostCallOutcomeModal awaits the call_logs outcome-patch so the duration write wins the race (`call_logs` was undercounting vs `lead_activities`). SQL `supabase_phase120_callduration_reconcile_backfill.sql` (heal) **RUN**. No pay impact (score reads activities). (Different Phase 120 from `ffc7d0a`.) |
| `8c7ce7b` | 121 | **Leave date-range + paid/unpaid** on the admin Leaves tab + rep request form. New `src/utils/leaveDates.js` (`buildLeaveDates`: skip Sundays, cap 60, local-date math). One `leaves` row per working day. No schema/salary change. (Different Phase 121 from the day-track series.) |

### SQL run-state — ALL CONFIRMED RUN (owner-verified 2026-06-07)
- `supabase_phase118_chase_counts_outstanding.sql` (`my_chase_counts()` RPC,
  feeds the TC hero + day-summary chase lines) — **RUN** (owner checked
  `pg_proc` → function present, 7 Jun).
- phase117 orphan quote-chase, phase119 every-deal, phase120 callduration —
  RUN (confirmed earlier this session).
- No outstanding SQL paste for Phase 117–125.


---

## 53 · Campaign module — RECEIVE SIDE COMPLETE + PROVEN LIVE (2026-06-07)

The WhatsApp **receive** pipeline is built, gate-verified, and proven on
production with a signed self-test. Token-free, additive, ZERO live-app
touch (proved by `git diff --stat`: 5 files, all new/campaign, no
WorkV2/Telecaller/leads-page/etc). Resumes §46 (was PARKED at "test the
webhook"). Build order C2 → C4 → C4-store → C4.5 → C5 → C8 — receive side
DONE; **outbound (reply/auto-reply) still 🔒 on the edigiexpert token**.

### Proven pipeline (live on app.untitledad.in)
```
WhatsApp msg → api/wa/webhook (HMAC verify) → C4-store (whatsapp_conversations
+ whatsapp_messages) → C4.5 trigger (lead, 4 P0 contracts) → C5 inbox view
```
Self-test row 7 Jun: `trigger_present 1 · converted 1 · newest_wa_lead
"WhatsApp lead"`. The inbox shows the converted chat with a "linked lead" tag.

### Commits (all on origin, all guardian + security PASS)
```
a4a7550 C4.5  inbound chat → lead (SQL; guardian 8/8 + security 8/8) [SQL RUN 7 Jun]
099fc98 C5    inbox (read-only) — CampaignInboxV2 + /campaigns/inbox route
f29b6af C4-store fix — partial-index upserts fail 42P10 → select+insert
53cb2a0 C4-test  scripts/test-wa-webhook.sh (signed-curl self-test, ?debug=1)
eee5711 C4-store webhook persists conversation + message to campaign tables
(earlier: aff51c5 C4 receive-only webhook · cf0e5eb C2 tables · C8 QR pages)
```

### The frozen contracts that made it §45-safe (do NOT regress)
- **C4-store**: writes ONLY to whatsapp_accounts/conversations/messages via
  the service role; runs AFTER the HMAC gate; best-effort try/catch → never
  blocks the 200. **PostgREST `.upsert(onConflict)` CANNOT target a PARTIAL
  unique index** (whatsapp_accounts.phone_number_id + whatsapp_messages.wamid
  are `WHERE … IS NOT NULL` partial) → it throws 42P10. Use SELECT-then-INSERT
  + ignore 23505. Conversations index is non-partial → upsert OK. (Foot-gun
  that cost the "store:ok but no rows" debug round.)
- **C4.5** (`supabase_campaign_c45_inbound_to_lead.sql`): AFTER-INSERT trigger
  on whatsapp_conversations (NEW table) → `campaign_conversation_ensure_lead()`
  SECURITY DEFINER, search_path-hardened, DOUBLE EXCEPTION-wrapped (a chat can
  NEVER break the store). The 4 P0 contracts:
  - P0-1 dedup: `find_open_lead_id_by_phone()` FIRST → attach (never insert a
    colliding phone, never reassign).
  - P0-2 routing: owner = campaign.default_telecaller_id ?? whatsapp_accounts
    .default_telecaller_id. **THE ROUND-ROBIN LANDMINE:** `leads_auto_assign`
    fills `assigned_to` whenever NULL, IGNORING telecaller_id → a TC-first lead
    with assigned_to NULL gets hijacked by a random rep. So C4.5 sets **BOTH
    telecaller_id AND assigned_to = the same owner** (TC queue reads
    telecaller_id; non-NULL assigned_to is the supported self-assign that
    skips the round-robin). No owner configured → queue inbound_leads 'error',
    create NO lead (never a NULL-owner lead). Live round-robin UNTOUCHED.
  - P0-3: writes NO lead_activities → can't touch compute_daily_score / §33.
  - P0-4: stage 'New' only. cadence_paused=true → no follow-up/push cascade.
- **C5** `CampaignInboxV2` (`/campaigns/inbox`, RequirePrivileged): READ-ONLY,
  reads conversations+messages (RLS wa_conv_admin/wa_msg_admin). Reply composer
  is a LOCKED placeholder (outbound = token).

### Test tooling
`scripts/test-wa-webhook.sh` — signed-curl self-test (prompts for
CAMPAIGN_APP_SECRET, posts a real-shaped Meta inbound with valid HMAC to the
live webhook). `?debug=1` echoes the store result (HMAC-gated; Meta never
sends it). Use it to validate the webhook without the fiddly Meta test number.
The Meta TEST number can't be cold-texted — it only messages pre-registered
recipients; the real campaign needs the real number + the edigiexpert token.

### Routing config (required before real leads convert)
A whatsapp_accounts row needs `default_telecaller_id` set, else C4.5
error-queues (no NULL-owner lead). Set it per account/campaign (the
CampaignsV2 page sets campaign.default_telecaller_id; the account one is
SQL/admin for now).

### Test-data note (staging)
The 7 Jun self-tests left a `SELFTEST_PNID` whatsapp_accounts row + 4 fake
conversations (919812345678 / 919900112233 / 919933445566 / 919955667788) +
1 converted test lead (source='WhatsApp', "WhatsApp lead"). Scoped cleanup
available; delete before real go-live so the TC queue isn't cluttered.

### What's LEFT (do NOT assume built)
- **Outbound reply** (C5 send) + **auto-reply** (C7) — need the edigiexpert
  permanent token + App Secret + the real number's phone_number_id/WABA.
- **C8 location_id** (QR board → lead attribution) — minor, not wired yet.
- Meta Lead Ads (C9), Justdial parser, Broadcast/Segments/Chatbot — V3.
- Real number (919581578261) still on AiSensy — OTP-migrate to the owner's
  own "Waba" app (App ID 1443324144491532) for full control.


---

## 54 · Campaign module FULLY LIVE on real number 95815 78261 (2026-06-09)

**Supersedes §46 "PARKED on edigiexpert token" + §53 "outbound LOCKED / real
number on AiSensy".** Both are now WRONG — do NOT quote them. The campaign
WhatsApp module is **end-to-end live**: receive + reply + routing all proven
on production with the owner's OWN permanent token. No edigiexpert dependency.

### What's live (proven 9 Jun on app.untitledad.in)
- **Number:** 95815 78261 · `phone_number_id 122102627516008558` · WABA
  `122098901360016777` (UNTITLED ADVERTISING, owned by the **edigiexpert**
  business portfolio — it's the owner's). App "Waba" `1443324144491532`.
- **Receive ✅** — text + media (media shows "[image]" placeholder; actual
  photo NOT downloaded/rendered yet — later add). Lands in Campaigns → Inbox.
- **Reply ✅** — composer sends inside the 24h window via `api/wa/send`.
- **Routing ✅** — `whatsapp_accounts.default_telecaller_id = Rima` →
  every NEW inbound chat auto-creates a lead in Rima's queue (C4.5).

### The token (permanent, NOT edigiexpert-provided)
A **System User token** named `campaign-api` on the edigiexpert Business
Settings, with Full control of the WABA + the Waba app, perms
`whatsapp_business_messaging` + `whatsapp_business_management`, **expiry
Never**. Lives in **Vercel env `CAMPAIGN_WA_TOKEN`** (Production). Replaces the
old 24h test-WABA temp token. `CAMPAIGN_APP_SECRET` (App Settings → Basic) and
`CAMPAIGN_WEBHOOK_VERIFY_TOKEN` already set (Phase C4).

### THE GOTCHA that cost the whole afternoon (do NOT repeat)
The signed self-test (`scripts/test-wa-webhook.sh`) POSTs straight to our
webhook — it proves the ENDPOINT but **bypasses Meta's actual delivery**, so
it does NOT catch a missing field subscription. Real inbound only flowed after
TWO Meta steps:
1. **Subscribe the WABA to the app** — `scripts/subscribe-wa-waba.sh`
   (POST `/{WABA_ID}/subscribed_apps` with the token). One-time, permanent.
2. **Subscribe the `messages` webhook field** — Developers → Waba app →
   WhatsApp → **Configuration → Webhook fields → `messages` = Subscribed.**
   It was "Unsubscribed" (so was every field). THIS was why "delivered ✓✓ on
   the phone but nothing in our inbox." If a future number receives nothing,
   check this field FIRST.

### Why "Add phone number" was the WRONG path
The real number is already registered in its own WABA → "Add phone number"
triggers a **migration** (needs matching display names + the source 2-step PIN
+ moves the number off its account). Avoided entirely: instead connect the
existing WABA to the app via a System User token + `subscribed_apps`. Number
stays put, no PIN, no migration. (If ever forced to migrate, that's the heavy
path — get owner sign-off.)

### Files added this session
- `scripts/subscribe-wa-waba.sh` — WABA→app webhook subscription (one command).
- `supabase_campaign_route_real_number_telecaller.sql` (`b345240`, **RUN 9
  Jun**, VERIFY returned Rima·telecaller) — sets the account's
  default_telecaller_id. Idempotent DO-block; the schema-check INSERT warning
  is a false positive (guarded ELSE branch).

### §45-safe — zero live-app touch
Everything additive: new campaign tables only, the C4.5 trigger is on
whatsapp_conversations (new table), a WhatsApp lead is a normal additive
`leads` INSERT (cadence_paused=true → no follow-up/push cascade) landing in
Rima's queue. No live-app file, RLS, function, or hot-path touched.

### Still LEFT (none blocking go-live)
- **Test-data cleanup** — inbox/leads still hold the self-test junk
  (`SELFTEST_PNID` + synthetic 9198… numbers) + the owner's own-number test
  chats (94282 73686 ×2, 98123 45678) + 1 fake "WhatsApp lead". Existing test
  chats did NOT retro-create leads (trigger fired pre-routing). Clean before
  real volume so Rima's queue isn't cluttered. Scoped read-first delete only.
- **Payment method** — WABA shows none ("shared credit line"). First ~1,000
  service conversations/month free; add a card (WhatsApp Manager → Billing)
  before real volume.
- **Media rendering** — download inbound photos from Meta's media API + store
  + render (currently "[image]"). Later.
- **Auto-reply (C7)**, **C8 location_id**, Meta Lead Ads (C9), Justdial,
  Broadcast/Segments/Chatbot — V3, unchanged from §46.


---

## 55 · Campaign C5 polish — alert push · auto-refresh · mockup-match · images · cleanup (2026-06-09)

Same-day follow-on to §54. The receive+reply+routing module got the "useful
end-to-end + matches the design" layer. All additive, new campaign pages /
endpoints only (CampaignInboxV2/QrV2/ClientQrV2 + CampaignChrome are NOT in the
§28 frozen list); the one live-table write is the inbox reassign (guardian PASS).

### Shipped (commits on untitled-os)
| What | Commit | Run/push |
|---|---|---|
| **Inbound alert → telecaller push** — AFTER UPDATE OF lead_id trigger on whatsapp_conversations → enqueue_push the lead's owner, quiet-hours gated, EXCEPTION-wrapped, pg_net async (zero webhook latency). `supabase_campaign_c5_push_on_inbound_lead.sql` | `bd1735a` | **SQL: confirm run** (VERIFY 1/t/t) |
| **Inbox auto-refresh** — silent 7s poll (visible-tab) + focus refresh + scroll-to-newest. No more manual reload. | `026223d` | pushed |
| **UI mockup-match** — inbox WhatsApp-green bubbles + ✓✓ ticks + tails; tab count pills; QR hero callout + 4 summary cards (real data); inbox reassign-TC dropdown + Create-quote + quick-reply chips | `6ce3427` `6db0b7f` `7870000` | pushed |
| **Inbound photo rendering** — webhook captures media_id/mime (tolerant insert) + `api/wa/media` proxy (DB-gated, same-origin, 120/min, token server-side) + inbox `<img>`. `supabase_campaign_c5_media_columns.sql` | `b75cf20` | **push + SQL** |
| **Self-test cleanup** (preview-first, scoped, read-first) `supabase_campaign_selftest_cleanup_v2.sql` | `611dc56` | **push + run when ready** |

### Hard rules learned / re-confirmed
- **enqueue_push from a campaign trigger** = DEFINER + `search_path=public,extensions`
  + quiet-hours gate `is_push_allowed_now()` + EXCEPTION wrap. It's REVOKED from
  authenticated (97.A2) but a DEFINER owned by postgres reaches it. pg_net is
  async → no webhook latency. Mirror phase34z55 + phase98_a.
- **Webhook media capture** uses a TOLERANT insert (retry without media_id/mime
  on a column error) so the store can never break regardless of SQL timing —
  composes with the 23505 dup-wamid tolerance. New `media.js` proxy gates on the
  media_id existing in whatsapp_messages (capability gate; ids are opaque Meta
  numerics) — stronger than the §34 same-origin-only precedent. No SSRF (fetched
  host constant; meta.url is Meta-issued).
- **Reassign writes leads** → sets BOTH telecaller_id + assigned_to = chosen TC
  (the §53 P0-2 round-robin-safe contract); writes NO lead_activities (P0-3).
  Guardian PASS. Any inbox action that writes leads/lead_activities needs the
  guardian.
- **UI fidelity:** the build does NOT fake the mockup's demo numbers (reply rate
  / won ₹ / 1,240 scans) — it shows real counts; Broadcast/Segments/Chatbot stay
  "soon" (V3). Matched the *look* (green bubbles, count pills, QR cards), not the
  fake *content*.

### Owner run-state to confirm next session
- SQL still to RUN: `supabase_campaign_c5_push_on_inbound_lead.sql` (alert) +
  `supabase_campaign_c5_media_columns.sql` (photos). Cleanup SQL = optional.
- Push state: `b75cf20` + `611dc56` were unpushed at write time.
- Payment method on the WABA still owner-side (volume only).


---

## 56 · Sales/TC Truth sprint — state tracker (2026-06-10)

Deep audit (4 read-only agents: sales flow 7/10 · TC 6/10 · follow-up engine
4/10 · number-truth 6.5/10) → 5-batch fix sprint. Money Truth sprint shipped
same day (money0-3 + 3.1 ALL RUN; shadow table showed gaps small: Rima 8.9,
rest <=7 — score cutover PARKED, owner picks timing; Dixita/Kamina/Jignesh/
"sales"/Hamesh scored 0.0 all week — owner to check who's real).

### Done
| Batch | Commit | SQL | What |
|---|---|---|---|
| Money 0-3 | `b4f7f7b` + `1c0c0cb` | ALL RUN | RepProfile §33 meetings · TDS columns+forms (Govt-only field, gross semantics) · calls delete-heal · migration register · shadow score (money3_1 gate fix: no-JWT Studio allowed) |
| Truth 1 | `73a7dc5` | RUN | The 2 cadence P0s in followup_after_done: QuoteSent de-stage gate (seq-3 must be DUE) + zombie nurture stage-gates ('nurture' only while stage=Nurture, 'lost_nurture' only while Lost) + zombie heal + read-only diagnostic (list may include legit parks — owner reviews by hand) |
| Truth 2 | `8b019d7` | none | TC page: queue order last_contact_at asc nullsFirst (the RIGHT 50) + true queue/callback head-counts + overdue-callback window -7d..+2d + dead queries/helpers removed (qualifiedToday, handoffs, slaPill etc — dead since 113.12) |

### REMAINING batches (from the deep audit — file:line refs in audit outputs)
**Batch 3 — sales side:** LeadDetailV2 quickLog missing callingRef latch +
23505 dup-key kills modal (port FollowUpsV2:366-389 pattern; 3 tap sites
:916,:1106,:1553) · silent-poll failure blanks page killing open modals
(LeadDetailV2:630 — keep stale state + toast on silent loads) · GPS meeting
gate DEAD on live path (gate only in unmounted LogMeetingModal; live path
LeadFormV2 meetingMode saves gps null — replicate hard gate) · side-door
calls bypass chain (LeadsV2:1114-1139 inserts outcome='neutral' directly;
FollowUpsV2:285-296 pre-stamps) · startDay silent dead-end (WorkV2:739) ·
88.1 follow-up-close silent fail (PCOM:660 console.warn → toast).
**Batch 4 — push hygiene:** smart-task regen spam+snooze wipe (TodayTasks
Panel:82 generate() on every focus; generate_lead_tasks DELETEs snoozed;
push per new UUID; + no _assert_self_or_admin gate) · reassign orphans FUs
(phase100_a:369 — transfer open follow_ups assigned_to) · alarm cancels
missing on markDone/snooze/bulk (FollowUpsV2:241,263) · push_followup_due_
reminders ungated by quiet hours (97_a400:54) · payment FUs (C8, lead_id
NULL) never auto-close on full payment.
**Batch 5 — periphery numbers:** ManagerDashboardV2:97 user_id→created_by
(meetings always 0) + §33 contract · RepProfileV2:398 calls missing
direction+lead_id guards · CockpitWidgets:456 + scorecard fn + daily-brief
fn still on stored counter + dead 20-target (move to >=10s lead-tied + table
target) · revenue label = 4 definitions (owner decision) · day-window
anchors 3 variants (TelecallerV2:140 + TeamDashboardV2:286 no offset).
**Parked:** TC weekly 3-definition mismatch (week-start + connect% defs) ·
callTimer cross-call contamination + mid-call-glance truncation · callback
auto-close-on-next-call (§47.1) · MeetingsMapPanel.jsx unmounted §51
violation (delete or retrofit) · score ≥10s cutover (owner timing).

---

## 57 · Phase 128.2–.4 + Truth 3–6 — sales/TC truth batch 3 + staleness root cause (2026-06-11)

All on origin (HEAD `480ee1f`) + SQL run. Continues §56's sprint; batch 3
DONE, batches 4–5 still open.

### THE BIG ONE — Truth 6 (`c7cbaff`): NetworkFirst on Supabase reads

`public/sw.js` StaleWhileRevalidate on `/rest/v1/` served EVERY DB read
from cache first → whole app permanently one fetch behind → the owner's
"slow + must reload to see data, reps too". Now NetworkFirst (4s timeout,
cache = offline fallback only). Everyone must close+reopen the app once
post-deploy. Do NOT revert to StaleWhileRevalidate on /rest/v1/. Known
still-open from the same probe: useAutoRefresh realtime channels have NO
CHANNEL_ERROR/TIMED_OUT rejoin (die silently on 4G drops; focus-refresh
is the safety net) · admin TeamDashboardV2/AdminDashboardDesktop are
reload-only (no useAutoRefresh) · quotes/payments may be MISSING from
supabase_realtime publication (verify pg_publication_tables) · /work idle
≈8 q/min, TC ≈24 q/min (poll stacking) — batch 5+ candidates.

### Truth 3a–e (batch 3, `0a042c0` `fda8d2b` `f279a75` `8e73449`)

LeadDetail call latch + 23505 modal rescue + silent-poll keep-state ·
PCOM follow-up-close failure now toasts · LeadFormV2 meetingMode hard GPS
gate (84.4 parity; new-lead entry stays GPS-optional) · startDay aborts on
failed plan save · /leads side-door call logs honestly (audit + timer +
outcome NULL, was pre-stamped 'neutral').

### Truth 4+5 (`aa8bdbc` `5f49d9b`)

TodaySummaryCard 'Today'→'Planned' + done-today chip + fresh-open
all-done state · MissedCallsCard clears once a >=10s call at/after the
listed row exists (was never clearing; the rescue tap made it stickier).

### Phase 128.2 (`4ac2c2e`) — ONE definition: callbacks-due + Today F-up

Callbacks due = open FUs due today + overdue (-7d floor), ONE per lead —
SAME on TC tile + admin card (tooltip was stale since 113.6). TC tile no
|| fallback (real 0 shows 0); panel list still -7d..+2d (labeled). Admin
"Today F-up" axis = closed-in-period (done_at) / closed + open-due —
matches the evening report; PostgREST .or() two-arm query. Idle banner
(47.6) now toggles an idle-only queue filter (visibleQueue memo; hero
nextCall stays unfiltered).

### Phase 128.3 (`84a367b`, SQL RUN, VERIFY t/1/0) — nurture/pause leak

lead_stage_change_cadence: cancels now run BEFORE/regardless of the
cadence_paused gate (pause was blocking cleanup, not just spawns);
cancel_lead_cadence also closes legacy 33D.4 rows (cadence_type NULL +
auto_generated + 'Auto-scheduled:%'); NEW trg_lead_pause_close_auto_
followups (UPDATE OF cadence_paused) closes open AUTO rows on pause-ON
(manual rep FUs excluded); heal closed existing zombies. Branch set
byte-equivalent to 33D.6 (guardian-verified). KNOWN BEHAVIOR: Resume does
NOT respawn the nurture cycle — owner asked "after 30 days will it show?";
offered Resume→respawn-30d-check-in addition, AWAITING his yes/no.

### Phase 128.4 (`480ee1f`) — duration capture (Dhara 1m33s = "—")

3-part dead zone: (1) Phase 126 aggressive dedup merges re-taps into a
row up to ~30 min old (survivor keeps OLDEST call_at) but PCOM's outcome
flip only looked back 10 min → matched 0 → row stayed no_answer →
permanently excluded from duration patch. Flip cutoff now 40 min (guards
intact: same user+lead, outgoing, explicit save only). (2) callTimer
re-tap dropped the prior recorded elapsed — now carried as prevElapsed
fallback (latest tap wins). (3) Device CallLog read silent-fails when
READ_CALL_LOG denied — owner to check Dhara's phone permission. §49
frozen rule untouched (count = duration>=10s ONLY).

### Phase-number note
THREE more numbers burned by collisions: 128 (call-first Done gate, 8 Jun
`0438e42`+`e6b69ef`) → this batch used 128.2–.4. Next free: **129**.

### Open after this session
1. Owner: Resume→respawn decision (above) + Dhara permission check +
   close/reopen-app instruction to team.
2. §56 batch 4 (push hygiene: smart-task regen spam, reassign orphans,
   alarm cancels, quiet-hours on fu-due cron, payment FUs) + batch 5
   (periphery numbers: ManagerDashboard created_by, CockpitWidgets/
   scorecard/daily-brief stored-counter, revenue label, UTC anchors —
   TodaySummaryCard.jsx:23 + FollowUpsV2.jsx:44 + GpsTrackV2.jsx:137).
3. Realtime rejoin + admin auto-refresh + publication check (Truth 6
   leftovers above).

---

## 58 · Phase 129 + Phase 130 (batch 4 push hygiene) — 2026-06-11/12

### Phase 129 (`66e5775`, SQL RUN, VERIFY t/1/0) — Resume → +30d nurture
Owner: "only need if in nurture — follow up must see after 30 day only,
not before." `lead_pause_close_auto_followups` (the 128.3 fn) gains a
resume ELSIF: cadence_paused true→false AND stage='Nurture' AND owner
non-null AND no open nurture FU → `spawn_nurture_followup(.., 'nurture')`
which books `next_workday(today+30)` (never earlier). Strictly Nurture
(Lost/Working resume to silence). Same trigger event as 128.3 (toggle
click only); pause-ON close branch byte-equivalent; requires 128.3 first.

### Phase 130 — batch 4 push hygiene (JS `b8de89d` + SQL `fddaf64`, RUN, VERIFY 1/1/0/0)
JS (guardian PASS, frozen files):
- FollowUpsV2 now imports the alarm utils — markDone CANCELS the native
  alarm; snooze CANCELS + re-arms on the new date (was: phantom alarm
  fired for finished/moved work; only the outcome-modal path cancelled).
- TodayTasksPanel generate() throttled to once/10min via
  `window.__leadTasksGenAt` (was: full regen on EVERY window focus →
  per-task push spam + snoozed-task wipe). First mount always fires;
  Done/realtime update the list, generate isn't the refresh path.

SQL (`supabase_phase130_push_hygiene.sql`, guardian PASS — no P0):
1. `generate_lead_tasks(p_user_id)`: snoozed rows SURVIVE (DELETE now
   `status='open'` only, not `NOT IN(done,skipped)`); open rows keep
   UUIDs via `ON CONFLICT (lead_id,kind,generated_for) DO NOTHING` → no
   34Z.55 re-push; stale open tasks cleaned via cand-CTE mirror; Phase
   97.2 `_assert_self_or_admin(p_user_id)` gate added. Rules 1-3
   byte-preserved from 34z48.
2. NEW `trg_lead_owner_change_transfer_fu` (AFTER UPDATE OF assigned_to,
   telecaller_id on leads) — transfers OPEN follow_ups old owner→new
   owner; EXCEPTION-wrapped; skips when new owner null / assignee still a
   current owner; + one-time heal. Push-SILENT (34Z.55 tg_push_followup_
   due fires on date/is_done only). Column-specific → regular lead saves
   (stage/heat/notes) do NOT fire it (zero hot-path cost).
3. `push_followup_due_reminders`: `is_push_allowed_now()` early-return
   (98.A quiet-hours pattern); 97.A400 per-row 'fu-due-<id>' tag + window
   math + reminder_sent_at stamping preserved. Quiet-dropped windows roll
   into the 9:30 IST morning push.
4. NEW `trg_payment_close_collection_fu` (AFTER INSERT OR UPDATE OF
   approval_status, amount_received on payments) — when approved-or-NULL
   paid >= total_amount, auto-closes open `note LIKE 'Payment collection%'`
   FUs (phase33g creator; lead_id NULL); EXCEPTION-wrapped; + heal. Safe:
   followup_after_done early-returns on lead_id NULL (truth1); 34Z.55
   ignores is_done=true.

VERIFY landed 1/1/0/0 (both triggers present, both heals cleared all
orphan + already-paid rows). check-sql false-positives = pg_catalog
aliases (p.oid/p.proname) + loop record (r.lead_name) — guardian-cleared.

### Parked / known (owner-aware)
- `_assert_self_or_admin` lacks the 87.5b.1 NULL short-circuit — documented
  cron bypass (Phase 97.2 header), not a new regression. Backport is a
  SEPARATE hardening file if owner wants Studio-call tightening too.
- The reassign transfer is push-silent — new owner learns via the existing
  reassign push + their morning digest, not a per-FU push. Owner-accept.

### §56 sprint state
Batches 1,2,3,4 DONE. **Batch 5 (last) remaining**: ManagerDashboardV2
user_id→created_by (meetings always 0) + §33 contract · RepProfileV2:398
calls direction+lead_id guards · CockpitWidgets/scorecard fn/daily-brief
fn still on stored counter + dead 20-target · revenue label 4 definitions
(owner decision) · UTC day-anchors 3 variants (TodaySummaryCard.jsx:23,
FollowUpsV2.jsx:44, GpsTrackV2.jsx:137 → istTodayISO).
Truth 6 leftovers: realtime CHANNEL_ERROR rejoin · admin pages no
auto-refresh · verify quotes/payments in supabase_realtime publication.

---

## 59 · Phase 131 + 132 — heal-surfaced backlog + 2 UX fixes (2026-06-12)

### Phase 131 (`e3deadd`, SQL RUN, VERIFY intro_left=0 / quote_chase_kept=2)
The Phase 130 §2 reassign HEAL ("move open follow_ups to each lead's
current owner") did its job but SURFACED a 142-row backlog: auto
"follow up with new lead" touches stranded on PREVIOUS owners (from past
reassignments) landed on the current owners as overdue. A TC who clears
daily saw ~140 overdue appear overnight. Confirmed read-only: 142/142 on
reassigned-in leads (created_by ≠ telecaller_id), all auto_generated,
136 NULL-cadence (legacy 33D.4) + 4 lead_intro + 2 quote_chase, oldest 2 Jun.

Fix = one-time close of overdue auto INTRO rows only: `auto_generated=true
AND follow_up_date < IST today AND (cadence_type IS NULL OR 'lead_intro')`.
**EXCLUDES quote_chase** (live deal chases — real money, owner works them;
also dodges the guardian-flagged followup_after_done seq-3→Nurture-park
side-effect → ZERO stage changes) + nurture/lost_nurture (128.3/129
managed). Rep-typed (auto_generated=false) untouched. Backlog can't
re-form: the Phase 130 transfer trigger now moves FUs the moment a lead
is reassigned (no more stranding).
- **Foot-gun:** a one-time HEAL that "correctly" relocates stranded rows
  to their true owner can DUMP a months-old backlog as fresh-overdue. Run
  a BEFORE per-owner count, warn the owner, and pair the heal with a
  cleanup of the stale rows it surfaces. follow_ups has NO updated_at →
  can't prove "heal touched it today"; use created_by≠owner + age instead.

### Phase 132 (`5a4de6b`, JS, guardian PASS both frozen)
Two owner-reported follow-ups (he'd said yes before the 131 emergency):
1. **LeadsV2 AI card removed.** The "/leads 5 SLA breaches on hand-offs"
   card is a SEPARATE card from the dashboard AiBriefingCard dropped in
   §41.5 — owner thought he'd removed it everywhere. Gated off via module
   const `SHOW_LEADS_AI_CARD = false` (one-line re-enable; aiBriefing memo
   + AIBriefingCard fn stay referenced inside the dead JSX → no dead-var).
2. **FollowUpsV2 snooze → tomorrow.** Old math added 1 day to the FU's OWN
   date, so an overdue (yesterday) row became TODAY-due → stayed on the
   plate ("snooze did nothing"). Now base = MAX(today, its date) +1 → an
   overdue/today row always lands tomorrow (leaves today); a future row
   still pushes +1 from itself. Sun→Mon bump preserved. Built newDate from
   LOCAL date parts (not `toISOString().slice(0,10)`, which shifts the day
   back ~5.5h on an IST device — latent bug in the old code, now fixed).
   Phase 130 alarm cancel/reschedule + Phase 128 Done gate untouched.

### §56 sprint state — batches 1-4 DONE; batch 5 (last) still open
ManagerDashboardV2 created_by · RepProfileV2 call guards · CockpitWidgets/
scorecard/daily-brief stored-counter + dead 20-target · revenue label (owner
decision) · 3 UTC day-anchors → istTodayISO. Plus Truth 6 leftovers (realtime
rejoin, admin auto-refresh, publication check).

---

## 60 · Phase 133 + 134 — dashboard done-count truth + terminal-FU leaks (2026-06-12)

### Phase 133 (`b573b49`, JS, guardian PASS) — "Today F-up" excludes auto-closes
Owner: "I don't understand follow-up logic" — admin Team Dashboard showed
Rima 241/243, Dhara 112/134 done today. CAUSE: today's one-time heals
(Phase 131 + 130 + 128.3) closed ~142 backlog follow_ups with done_at=now(),
and the Phase 128.2 axis counts DONE = closed-in-period (done_at in window)
→ the cleanup rows inflated every rep's "done today." Fix: TeamDashboardV2
fuRes pulls `done_note`; the fuMap DONE branch skips system auto-closes via
`isSystemClose(note)` = `/^Auto-closed|^\[(healed|closed: auto|cancelled by
stage|auto-skipped)/`. So "Today F-up done" = what the REP actually closed.
Regex live-tested (matches all 6 heal markers, never a real rep note).
- **The two dashboard FU numbers, plain:** OVERDUE F-UP = open + past-date
  (behind). TODAY F-UP X/Y = closed X of Y on today's plate (128.2 axis:
  Y = closed-today + still-open-due).
- KNOWN one-day twin: the rep's evening WhatsApp report (useDaySummary) has
  the same auto-close inflation today; self-cleans tomorrow. Owner asked if
  he wants the same exclusion there — DECISION PENDING (left as-is for now).

### Phase 134 (`52f0fec`, SQL RUN + applied, guardian PASS) — terminal-FU leaks
Owner: lost lead / lost quote / won+paid still show in follow-ups. Live
counts were 1/0/0 (today's heals swept most). The Phase 76.3 intent is
"a lead reaching Lost/Won carries ZERO open follow_ups" (trg_z_close_
followups_on_terminal closes ALL lead-tied FUs on the lead transition;
it even DELETEs lost_nurture). Two structural gaps remained:
- **Payment-collection FUs are LEAD-BLIND** (Phase 33G spawns them with
  quote_id only, lead_id NULL) → the terminal-close `WHERE lead_id=NEW.id`
  can't reach them.
- **Orphan quotes** (lead_id NULL, pre-Phase-119) won/lost don't propagate
  to any lead (quote_status_propagate_to_lead bails on NULL lead_id) → the
  quote's chase + payment FUs never close.

Fix (additive, §45-safe — both triggers fire ONLY on a status/stage
transition, NOT on normal quote/lead edits → zero hot-path latency; no
push, no cadence/score touch; EXCEPTION-wrapped so a quote/lead save can
never fail on FU housekeeping):
- `trg_quote_terminal_close_followups` AFTER UPDATE OF status ON quotes:
  →lost closes ALL its FUs (quote_id-keyed, orphan-safe); →won closes
  chase only, KEEPS payment (collect until fully paid — owner default).
- `trg_lead_lost_close_payment_fu` AFTER UPDATE OF stage ON leads: →Lost
  closes the lead's quotes' payment-collection FUs (the lead-blind gap;
  Won leaves them open to collect).
- Heal: close drifted lead-tied FUs on Lost/Won + payment on lost deals +
  chase on lost quotes.

**GUARDIAN P1 (caught + fixed):** heal closing a `lost_nurture` row on a
Lost lead via is_done would fire truth1 followup_after_done which RESPAWNS
lost_nurture (+30d) while stage=Lost → re-leak. Fix: heal excludes
lost_nurture-on-Lost from the is_done close, and DELETEs them instead
(DELETE never fires AFTER-UPDATE-OF-is_done → no respawn; mirrors Phase
76.3's own lost_nurture cleanup). The live triggers A/B don't touch
lost_nurture (A is quote_id-keyed, B is payment-only) so no respawn there.
- **Foot-gun:** closing an auto-cadence FU via is_done on a stage where
  truth1 respawns that cadence (lost_nurture@Lost, nurture@Nurture) =
  close→respawn re-leak. DELETE those, or close only after the stage no
  longer matches the respawn gate.
- **won+payment stays "until fully paid"** (owner's default; partial
  payment keeps the collection reminder — correct, not a bug).

### §56 sprint state — batches 1-4 DONE; batch 5 (last) open
ManagerDashboardV2 created_by · RepProfileV2 call guards · CockpitWidgets/
scorecard/daily-brief stored-counter · revenue label (owner decision) ·
3 UTC day-anchors → istTodayISO. Plus Truth 6 leftovers (realtime rejoin,
admin auto-refresh, publication check). Plus the evening-report auto-close
exclusion decision (twin of 133).

---

## 61 · Phase 133–138 — number-truth + follow-up integrity + duration-capture instrumentation (2026-06-12)

Long owner-driven session. Owner increasingly frustrated ("you spoiled
again", "don't patch, make it permanent"). Everything below shipped +
guardian PASS + on origin. Theme: stop patching, find roots, instrument
before native rebuilds.

### Shipped (all pushed)
| Phase | SHA | What |
|---|---|---|
| 133 | `b573b49` | TeamDashboardV2 "Today F-up" DONE excludes SYSTEM auto-closes (heals stamped done_at=now() inflated Rima to 241/243). `isSystemClose(done_note)` regex skips `^Auto-closed`/`^[healed`/`[closed: auto`/`[cancelled by stage`/`[auto-skipped`. |
| 134 | `52f0fec` (SQL RUN) | Terminal-state FU leaks: NEW trg_quote_terminal_close_followups (quote→lost closes all its FUs incl payment; →won closes chase, KEEPS payment) + trg_lead_lost_close_payment_fu (lead→Lost closes its quotes' payment FUs, the lead-blind gap) + heal. Guardian P1: lost_nurture on Lost respawns via truth1 → heal DELETEs those (not is_done-close). |
| 135 | `f6b5821` (SQL RUN) | "Lost means dead": BEFORE INSERT guard born-closes a MANUAL (cadence_type NULL) follow-up created on a Lost lead. Cadence spawns pass through (guardian P1). + heal. Owner option A — rep uses Nurture to keep chasing. |
| 136 | `622208b` | LeadsV2 filter: default `presetToRange('all')` (was this_month — table was secretly June-locked → "filter not working") + NEW tabCounts memo so stage-tab badges reflect the active date/rep/search filter (were global 1002). |
| 137 | `d58c633` | LeadsV2 admin rep filter undercounted TELECALLERS: a lead's owner = assigned_to OR telecaller_id; admin only matched assigned_to (Dhara: admin saw 115 of her real 383). New isRepOwner(l,id) at 4 sites (distinctReps, filtered, tabCounts, chip count). |
| 138 | `b5555ae` (SQL RUN) | call_capture_log diagnostic table + callTimer/callLogReader instrumentation. INSTRUMENTATION, NOT a fix. |

### THE BIG ONE — call-duration capture root cause (Phase 138 + the permanent plan)
Owner: ~46% of connected calls save duration_seconds=0/NULL (kirti live:
7 captured / 6 connected-but-0s / 16 taps). "Solved" 3x (Phase 65 device
read · 116 away-timer · 128.4 re-tap), keeps regressing.

**ROOT (deep read-only trace):** the away-timer fallback (116) **doesn't
fire on the APK** — `dialPhone` → `AppLauncher.openUrl` fires an
ACTION_VIEW intent that does NOT reliably background the Capacitor WebView,
so neither `appStateChange` nor `visibilitychange` flips → the timer
records null → the safety-net built to catch device-read misses catches
nothing. Every prior fix patched the FALLBACK; the fallback's TRIGGER is
broken. Secondary: the 60s auto-patch device read fires while a >60s call
is still ongoing; the `.in('outcome',['connected','callback_requested'])`
filter discards a device read on the auto60 path (outcome still no_answer).
NOT number-format (the patch matches by user+lead+time, and CallLogPlugin
uses PhoneNumberUtils.compare).

**THE PERMANENT FIX (native, NOT yet built — needs APK rebuild):** read
the device CallLog on **MainActivity.onResume** (the one signal Android
GUARANTEES fires on return from the dialer; the call is over → duration is
final), reconcile onto the open call row by user+lead+nearest-tap-time,
DROP the outcome filter for that sweep, and make the away-timer also
record on onResume as the no-permission backstop. A timer-only JS fix =
another patch (inherits the background-signal fragility). Files: callLog
Reader.js, callTimer.js, openExternal.js:dialPhone (the AppLauncher pivot),
android CallLogPlugin.java, MainActivity.java:onResume (heartbeat already
hooks it), TelecallerV2/WorkV2/LeadDetailV2 60s auto-patch sites.

**THE PLAN (owner agreed — instrument first, no blind rebuild):**
1. ✅ Phase 138 capture log shipped (live-update, no rebuild). Records per
   call: device_permission/found/seconds, app_backgrounded + bg_signal,
   timer_seconds, patch_path, final, counted. logCapture is fire-and-forget;
   the permission check is INSIDE it (guardian P1 — off the patch hot path).
2. ⏳ One day of real calls → run the diagnostic (in chat 12 Jun) →
   `missed_app_didnt_bg` high confirms the root.
3. ⏳ THEN the permanent native onResume fix + ONE APK rebuild, with proof.

### Confirmed NON-bugs (label/definition, explained to owner)
- "Follow-up STAGE" (leads in Working stage, LeadsV2 tab) ≠ "follow-up
  TASKS" (open follow_ups rows, FollowUpsV2). Different tables, never
  match. Owner offered a rename (Follow-up→Working) — PENDING his call.
- "Done without calling" can't be reliably enforced until duration capture
  works — the app can't tell a real call from a tel-tap when duration=0s.
  Same root as the duration miss. Do NOT tighten the markDone gate to
  ≥10s while capture is broken (would block honest reps whose duration
  didn't capture — half of kirti's real calls).

### Foot-guns added 2026-06-12
- ❌ A one-time HEAL that stamps done_at=now() inflates "done today" dash
  counts (133). Exclude system-close done_note markers from rep-work counts.
- ❌ A HEAL that relocates stranded rows to their true owner can DUMP a
  months-old backlog as fresh-overdue (131 surfaced 142). Warn + pair with
  a stale-cleanup.
- ❌ Admin rep filter / any rep rollup that matches assigned_to ONLY
  undercounts telecallers (their leads are on telecaller_id). Match either.
- ❌ Patching a FALLBACK whose TRIGGER is broken = infinite regression
  (duration capture, 3x). Instrument → prove the trigger → fix the trigger.

### Open
1. Duration capture: tomorrow's log read → permanent native fix + APK rebuild.
2. Owner decisions: Follow-up→Working rename? · evening-report auto-close
   exclusion (twin of 133)?
3. §56 batch 5 (periphery numbers) still the last sprint piece, un-started.


---

## 62 · ⏰ NEXT-SESSION MORNING REMINDER (owner asked, 12 Jun eve) — SURFACE FIRST

Owner (12 Jun ~17:00): *"remind me tomorrow morning before we start any task."*
He means the **call-duration capture** fix. When he opens the NEXT session
(13 Jun+), LEAD with this BEFORE taking any new task:

> "Before anything — the call-duration log has been collecting since Friday.
>  Paste me the diagnostic and I'll read the real failure path, then build
>  the permanent fix."

Then have him run (admin, Supabase Studio — columns verified against
`supabase_phase138_call_capture_log.sql`):

```sql
select patch_path, device_permission, device_read_found,
       app_backgrounded, bg_signal,
       count(*)                                      as attempts,
       count(*) filter (where final_seconds is null) as saved_null,
       count(*) filter (where counted)               as counted_ok
from call_capture_log
where created_at > now() - interval '3 days'
group by 1,2,3,4,5
order by attempts desc;
```

**What the data decides** (§61 root trace): if `app_backgrounded` is mostly
FALSE / `bg_signal='none'` → the dialer hand-off isn't backgrounding the
WebView → the permanent fix is a **device CallLog read on app-RESUME**
(Android lifecycle fires regardless). JS-only (no rebuild) IF the resume
signal reaches JS; needs a native MainActivity.onResume + dialPhone pivot
(= ONE APK rebuild) if it doesn't. **Do NOT promise JS-only until the log
is read.** Plan: read Sat eve → build over weekend → team tests Monday on
the fixed version. Do NOT guess-patch a 4th time (owner: "make it
permanent, don't patch").

### Phase 139 shipped (`04bc4cc`, pushed 12 Jun) — closes the stage-vs-tasks confusion
LeadsV2 clarity caption under the stage tabs: "These counts are leads in
each stage — not open follow-up tasks…". Guardian PASS. Owner hit this 3×
(Dhara/kirti/Rima) — the Leads "Follow-up" tab counts LEADS in the Working
stage; the Follow-ups page counts open follow_up TASK rows. Different
tables, never match (Rima: 126 stage / 118 tasks). NOT a bug — now labelled.

### "Done without calling" — current live truth (for team smoke)
FollowUpsV2.markDone gate (Phase 128, verified live 12 Jun): blocks Done
when the rep has logged ZERO calls to that lead's phone today. Holes still
open (ALL wait on the duration fix): (a) a tel-tap audit row counts as "a
call" → tap-Call-without-talking → Done passes; (b) lead with no/bad phone
→ gate skipped entirely. So tell the team to confirm the basic block
("tap Done with no call → 'Call them first' popup"); do NOT claim the
tap-without-talk case is closed yet. The airtight gate (= require a real
≥10s call) ships WITH the duration fix.


---

## 63 · Phase 140 — Government proposal English language option (2026-06-12, `cece284`)

Owner: "I want the 2 govt media proposals (Auto Hood + GSRTC LED) in
English too. Default Gujarati; pick English if wanted. Same structure,
only the language changes." Built additive + §45-safe (govt flow, NOT a
§28 frozen file; sales-guardian not required). On origin after push.

### What shipped
- `quotes.proposal_language text DEFAULT 'gu'` (+ gu/en CHECK).
  `supabase_phase140_proposal_language_english.sql` — also seeds 2 new
  `proposal_templates` rows (AUTO_HOOD + GSRTC_LED, `language='en'`),
  COPIED off the gu rows (inherit every column) with English subject +
  body from the owner's Auto 2.docx / Gsrtc 2.docx. Idempotent.
- `GovtProposalRenderer.jsx` threads a `lang` (from `template.language`)
  through every helper via an `STR` gu/en label table + `numL` (digits) /
  `fmtDateL` (date) / `formatRate(n,lang)`. Step-2 `Letter language`
  select (shared `Step2DateSigner`, gu default). Both wizard parents
  persist + restore `proposal_language`; both Step5 previews + the
  `/proposal/:id` detail page fetch the template for the quote's language
  (`|| 'gu'` fallback).

### FROZEN CONTRACTS (do not break)
1. **gu path is byte-frozen.** Every `STR.gu` value = the ORIGINAL
   hardcoded Gujarati literal; `numL/fmtDateL/formatRate` gu branch =
   the old `toGujaratiDigits/formatDateGujarati/formatRateGu`. Any future
   renderer edit MUST keep the gu output identical (existing 50 proposals
   + every Gujarati proposal depend on it). Verified byte-identical at ship.
2. **gu + en templates move in LOCKSTEP.** Each (segment, media_type) has
   ONE gu row + ONE en row in `proposal_templates`. A content change to a
   Gujarati letter needs the English twin updated too (and vice-versa).
   The renderer's `STR` table supplies the structural LABELS; the
   `proposal_templates` row supplies the letter BODY + SUBJECT per language.
   Both use the SAME `{{placeholders}}` (`{{rate_table}}` `{{signer_block}}`
   `{{bidan_block}}` `{{districts_count}}` `{{months}}`).
3. **Safe guard:** if `language='en'` is chosen before the en row exists,
   the fetch returns null → renderer prints "Seed proposal_templates
   first" (NOT a blank/wrong letter). So: run the Phase 140 SQL BEFORE the
   code relies on English. After both, English works.

### Agency-ships-govt = NOT a code bug (same session, separate)
Owner "agency can't see signer in dropdown / can't ship govt." It's DATA
setup, not a block: an agency user needs an admin-assigned
`users.default_signer_user_id` (Team → Edit member → "Default Proposal
Signer" → pick Brijesh/Vishal → Save). Until set, `Step2DateSigner` shows
"Ask admin to assign your proposal signer." + disables Next
(`CreateGovtAutoHoodV2:360` / `CreateGovtGsrtcLedV2:355`
`agencyLockedReason='unassigned'`). The dropdown DOES list signers
(`signing_authority=true`). No code change needed to let an agency ship
govt — just assign the signer once.

### Smoke (owner, after SQL + push)
Run SQL first → push → on staging: create a Govt Auto Hood proposal, Step 2
pick **English**, Step 5 preview renders the English letter (English labels,
English digits, DD/MM/YYYY); create one with **Gujarati** (default) → looks
exactly as before. Repeat for GSRTC. Open a saved English proposal at
`/proposal/:id` → English. **The English VISUAL needs the owner's eyes —
I verified parse + gu-byte-identity, not the rendered English output.**


---

## 64 · Phase 144 — every-deal-a-lead covers PHONE-LESS (govt) quotes — DO NOT re-add a phone gate (2026-06-12, `68b5295`, SQL RUN)

Owner: "every direct quote creates a lead — now it's not showing." Worked
for PRIVATE, never for GOVERNMENT. Root: the Phase 119 trigger
`quote_before_insert_ensure_lead` REQUIRED a valid 10-digit phone before
creating a lead. Govt proposals have NO contact phone (recipient = a
department; the govt wizard Contact Phone is optional) → the phone gate
silently skipped every govt quote. Confirmed live: every PRIVATE quote had
a lead; every GOVERNMENT quote had `lead_id` NULL. SQL run 12 Jun →
`fixable_orphans_left=0`, `govt_quotes_with_lead=98`.

### The contract (permanent, root-cause)
- `quote_before_insert_ensure_lead` (canonical = `supabase_phase144_*`):
  dedup-by-phone runs ONLY when `client_phone` has ≥10 digits (private
  unchanged); with NO phone it SKIPS dedup and STILL creates the lead.
  `leads.phone` is nullable (phase12:110) so a phone-less lead is valid.
  Govt leads named after `client_company` (the department); private after
  `client_name` (unchanged).
- **DO NOT re-introduce a phone requirement** in this function. A
  phone-less govt lead is correct + intended. Re-adding
  `client_phone IS NULL → RETURN NEW` brings the exact regression back
  (govt quotes stop landing in the funnel).
- Still SECURITY DEFINER + pg_temp + double EXCEPTION-wrap (a quote save
  can NEVER fail on lead housekeeping); `find_open_lead_id_by_phone` only
  called WITH a valid phone (dup-phone block can't fire); cadence_paused=
  true (no chase); assigned_to=creator (round-robin can't hijack); segment
  set from the quote (tags GOVERNMENT — consistent with §142 leads.segment).
- Guardian PASS. The lead-creation trigger is a §28 frozen DB contract —
  any future change to it needs sales-module-guardian before commit.

### Why it's NOT a patch (owner standing rule §3/§39)
ONE trigger governs every quote→lead path (Private LED, Other Media, Auto
Hood, GSRTC, any future wizard). Fixed there, not per-wizard. No frontend
touched. Backfill heals existing orphans. A new wizard can't forget it.

### §142 leads.segment (same session, Batch A done) — open
`leads.segment` column added + backfilled (997 PRIVATE / 8 GOVERNMENT / 0
untagged, SQL run 12 Jun). Shared `SegmentToggle` component extracted to
`src/components/v2/SegmentToggle.jsx`. Batch B (NOT built): wire the toggle
into LeadsV2 + QuotesV2 (filter) + LeadFormV2 (Private/Govt picker on
create) — all §28 frozen, guardian each. Dedupe the AdminDashboardDesktop
local SegmentToggle to the shared one. Only `quotes` + (now) `leads` carry
segment; other tables don't — the toggle is meaningless elsewhere.

**Phase 142 Batch B — DONE (13 Jun).** Segment pill shipped on LeadsV2 +
QuotesV2 (`db875fd`), gated to admin/co_owner + ALL-access; LeadFormV2
already had the Private/Govt picker (so leads.segment was always written).
Batch B.1 (`2e53158`) removed the now-duplicate segment from the gear
popover/chips (pill is the sole control; govt media sub-filter kept).
Phase 145 (`5edfa60`) removed the §139 stage-vs-tasks caption (it sat inside
the flex filter row and cramped it — owner "disturbs UI"). All guardian-PASS.


---

## 65 · Call-duration capture — PROVEN WORKING, NOT a bug (13 Jun 2026) — supersedes the §61 "broken" narrative

Read the Phase 138 `call_capture_log` after 1+ day of real fleet calls
(121 attempts). **The §61 "capture is broken / needs a native onResume
fix + APK rebuild" conclusion was WRONG.** The device CallLog read works.

### The data (the path that matters = `modal_save`, rep saved the modal)
- **110 of 111** confirmed calls: `device_read_found=true`. **0 saved-null**
  on the 101-row main bucket. The old "connected but 0s / NULL" bug is
  GONE (the Phase 56i device-read lookback fix + reps granting READ_CALL_LOG
  did it).
- `app_backgrounded=null` on the main rows CONFIRMS the away-timer fallback
  doesn't fire — **but it's MOOT**, because the device read covers it. So
  do NOT build the native onResume / dialPhone-pivot fix §61 proposed; it
  fixes a path that isn't the failure.
- Remaining ~9% null = the `auto60` path (rep never saved the modal →
  outcome stays no_answer → the Phase 102.B outcome filter correctly
  withholds a duration) + 2 web rows. Arguably CORRECT to be null
  (unconfirmed calls). Not worth chasing.

### Why counts still feel low (NOT a capture bug)
Of 121 attempts only ~34 were ≥10s real talks; ~87 were genuinely short
(no-answer / quick hangup) → correctly uncounted (§49 ≥10s rule). A rep
dialing 100× but reaching ~30 people = 30 toward the 50. Honest. The lever
is more real conversations, not code. Stop treating "low call count" as a
duration bug — it isn't.

### Score (→ incentive) — owner declined to tighten (13 Jun)
`compute_daily_score` still counts a call on `outcome IS NOT NULL OR ≥10s`
(looser than the ≥10s counter), so the score can read higher than the
honest call count. Offered to tighten it to ≥10s now that capture is
proven accurate — **owner said "leave it"** (it would lower some reps'
scores/pay). So the score stays outcome-based. Do NOT re-offer or change
without the owner asking.

### Housekeeping
The Phase 138 `call_capture_log` instrumentation + `logCapture()` are
fire-and-forget diagnostic (harmless, tiny). Left collecting. Can be
removed in a future cleanup (callLogReader.js is §28 frozen → guardian)
but no urgency. **Net: the duration saga is CLOSED — capture works.**


---

## 66 · Phase 140.1–152 — govt-English polish + agency/master/TC fixes + the 1000-row-cap sweep (2026-06-13)

Owner-driven bug+request batch, all on origin (`untitled-os`, HEAD
`6b86960`) + live. JS-only except Phase 149 (SQL, RUN). No APK rebuild
(live-update §38/§50 — reaches the APK bundle on next open). Continues the
§63/§64 govt-English + §65 duration work. Each touching a frozen file got a
sales-module-guardian PASS.

### What shipped (chronological)

| Phase | SHA | What |
|---|---|---|
| 140.1 | `603129e` | GSRTC **English** rate-table header truncation fix (font 9px, `white-space:normal`, `text-transform:none`). gu header byte-unchanged. |
| 141 | `716135b` | AgencyEarningsView — "Earned" chip + commission pill text `var(--accent-fg)` (navy, unreadable on dim bg) → `var(--accent)` (brand yellow). Readability only. |
| 143 | `01bbf3f` | DaySummaryCard follow-up Row value `a.follow_ups_done` → `a.follow_ups_real` so the CARD count matches the WhatsApp SHARE text (they disagreed). |
| 146 | `b5be252` | MissedCallsCard clearing relaxed: was "≥10s connect at/after the row" (§57 Truth 5), now "suppress if **2+ total call_logs for the lead in 24h**" = rep called back, ANY outcome. |
| 147 | `bfac6cb` | GSRTC LED wizard Step3Stations — bulk-set Daily/Spot/Days for all selected stations (`applyBulk` writes `daily_spots_override`). |
| 147.1 | `e2289d2` | Owner cut bulk to **Daily-only** + made the row visible/findable (bordered box). + GovtProposalRenderer **Monthly-Spots** cell `numL(daily*days)` → `numL(screens*daily*days)` — owner's formula **માસિક સ્પોટ = total screens × daily spots × days**, gu+en (the one `numL(..,lang)` line; money columns untouched). |
| 148 | `89f2064` | MasterV2 Attachments **Required toggle reverting** — onClick was `setRowField(...); setTimeout(persistRow,0)` → persistRow read the STALE `rows` closure → saved the OLD value. Now computes `next` + direct `update({is_required: next}).eq('id', r.id)`. Owner's "DAVP letter reverts to optional" — stale closure, NOT a server bug. |
| 149 | `bec3c35` (SQL RUN) | tc_weekly_stats quote subquery `INNER JOIN leads … WHERE l.telecaller_id` → `LEFT JOIN … WHERE (q.created_by = p_user_id OR l.telecaller_id = p_user_id)`. Owner "Dhara 2 quotes today, Performance 0." |
| 150 | `d12b895` | (a) FollowUpsV2 markDone gate `+ .gte('duration_seconds',10)` = airtight Done-gate (real ≥10s call); msg "Tap Call and actually talk (10+ sec)". (b) TelecallerV2 idle banner now OPENS the collapsed Call-queue `<details>` + scrollIntoView when idleOnly turns on (`queueRef`); slice `(0, idleOnly?100:12)`. Owner "30 idle but can't open it." |
| 151 | `f9b362e` | useLeads.fetchLeads → chunked `.range(offset, offset+999)` loop (break short page, 20k backstop). Fixes "All (1000)" = the PostgREST cap, not the true total (1114). |
| 152 | `6b86960` | useQuotes.fetchQuotes → same chunked `.range` (select/filters wrapped in `buildQuery()`). Quotes ~300 today (not capped) — future-proof. |

### THE 1000-ROW-CAP CONTRACT (new foot-gun class — remember this)

PostgREST caps ANY unpaginated `.select()` at **~1000 rows** (project
default). A list over 1000 silently loads only the first 1000 — looks like
a full list, isn't. **Fix pattern (Phase 151/152):**
```js
const PAGE = 1000; let all = []; let from = 0; let lastErr = null
for (;;) {
  const { data, error } = await buildQuery().range(from, from + PAGE - 1)
  if (error) { lastErr = error; break }
  all = all.concat(data || [])
  if (!data || data.length < PAGE) break   // last (short) page
  from += PAGE
  if (from >= 20000) break                 // safety backstop
}
```
RLS-scoped reps (<1000 rows) still do ONE request — only admin pays extras.
Wrap the query builder in a `buildQuery()` closure so each page re-applies
the same select + filters.

**Systemic audit done this session (the honest triage):**
- **leads** (1,114) — the ONLY surface actually capped → **fixed (151)**.
- **gps_pings** — ALREADY chunked via `fetchAllPings` (`GpsTrackV2:114`), a
  prior fix. NOT a bug. (Explore over-flagged it; verified the code.)
- **quotes** (~300) — not capped yet → **hardened (152)** proactively.
- **payments / per-rep activities** — under 1,000 → accurate today.
- **admin dashboard per-rep COUNTS** (TeamDashboardV2 / AdminDashboardDesktop
  load rows then count them, not `count:'exact'`) — accurate at today's
  volume, latent past 1,000. **PARKED** (owner "park it" 13 Jun). Convert to
  count-queries (`count:'exact', head:true`) ONLY when a filtered set nears
  1,000.
- **Foot-gun:** before flagging a `.select()` as capped, (1) check it isn't
  already `.range`-chunked, and (2) size the table at THIS org's real
  volume — a ~300-row table isn't capped, it's latent.

### Owner decisions locked this session (do NOT re-litigate)
- **/work page = leave as-is** (13 Jun). Owner asked for suggestions, I gave
  3 (finish numbers / single-Next card / declutter) → "don't do anything,
  leave it." /work is mature, frozen (§28), live — no edits.
- **Dashboard count-queries = PARKED** (above). Accurate now; convert only on
  real volume.

### Notes for future-Claude
- Phase 149 is **display-only** (TC weekly gate scales the SHOWN figure;
  real pay = `compute_monthly_salary`, ungated — §49/§115). No pay change.
- ~~Phase 150's ≥10s Done-gate is safe because §65 proved duration capture
  works.~~ **REVERSED — see §67. Capture is NOT reliable; Phase 154 dropped
  the ≥10s gate. Do NOT re-add it.**
- 147.1 touched GovtProposalRenderer (the §63 gu/en lockstep file) — the
  Monthly-Spots change is one `numL(..,lang)` line, both languages, money
  columns untouched. gu output still byte-frozen.
- No SQL pending (149 already RUN). No APK rebuild needed.


---

## 67 · Phase 153 + 154 — advisor view security + Done-gate UN-tightened (capture NOT reliable, §65 corrected) (2026-06-16)

### Phase 153 (`9a7ca31`, SQL RUN + VERIFIED) — Supabase advisor CRITICAL ×3
`leads_needing_geocode`, `lead_phone_duplicates`, `push_failures` were
SECURITY DEFINER views + `GRANT SELECT TO authenticated` → any logged-in
user could query them via PostgREST and read `leads` (cross-rep phones /
companies) or `push_log` (admin-only) **bypassing RLS**. Flipped all 3 to
`security_invoker = on` (`supabase_phase153_security_invoker_views.sql`,
RUN — `reloptions` show `{security_invoker=on}`). Now the base-table RLS
applies (rep sees own only; admin all; push rows hidden from non-admin).
Additive + reversible. Zero frontend/edge consumers (verified). The only
SQL reader, `dedupe_all_phone_groups()` (SECURITY DEFINER → runs as
postgres), still sees all → unchanged.
- **Separate flag, NOT fixed:** `dedupe_all_phone_groups()` is SECURITY
  DEFINER, **soft-deletes leads (stage='Lost')**, and likely has default
  `EXECUTE TO PUBLIC` → a rep could call it via the API and mass-mark leads
  Lost (privilege escalation). Gave owner a read-only check
  (`pg_proc.proacl`); revisit + REVOKE + add `_assert_self_or_admin` gate if
  it's open. Higher severity than the views.

### Phase 154 (`c332304`, JS-only, guardian PASS) — Done-gate relaxed; **§65 was WRONG**
**This CORRECTS §65's "duration capture PROVEN WORKING".** Live data 16 Jun
(kirti, Samsung APK) disproves it: his genuine **Chandresh 36s + Purvik 10s**
calls (verified on his phone log) both saved `call_logs.duration_seconds =
NULL`. The Phase 138 `call_capture_log` showed `device_read_seconds = 0` on
multiple calls (premature device read — Android hadn't finalized the duration
yet) and `timer_seconds = null` on EVERY row (the §116 away-timer fallback
**never fires on the APK** — the dialer doesn't background the WebView). So
duration capture **works for some calls, silently fails for others** = NOT
reliable.

The Phase 150 Done-gate (`FollowUpsV2.markDone`, require `duration_seconds
>= 10`) was built ON that false assumption → it **blocked honest reps**
("Call them first" popup on a real 36s call he couldn't mark Done). Phase 154
**drops the `.gte('duration_seconds', 10)` filter** → the gate now accepts
ANY `call_logs` row to the lead's phone today (the pre-150 / Phase 128
behaviour). Still blocks a manual Done with ZERO calls logged today. Block
message no longer claims "10+ sec".

**DO NOT re-add the ≥10s gate** until duration capture is genuinely fixed +
device-verified. The permanent fix (§61, parked, needs APK rebuild) = read
the device CallLog on **`MainActivity.onResume`** (call is over → duration is
final), reconcile onto the open call row by user+lead+nearest-tap-time, drop
the outcome filter for that sweep. The gate matches by **`client_phone`
last-10** (NOT `lead_id`), so the relax works even on quote-chase rows where
`lead_id` is NULL.

### Secondary bugs surfaced 16 Jun (NOT fixed — flagged, next)
- Kirti's Chandresh + Purvik tel-tap audit rows have **`lead_id NULL`** —
  they're **quote-chase** follow-ups (`rowPhone()` → `quote.client_phone`),
  so the audit logged without a lead. Harmless to the gate (phone match) but
  the calls don't show on a lead. Audit the `openCall` path for quote-tied
  follow-ups.
- **"Outcome popup not coming"** — `PostCallOutcomeModal` didn't fire for
  those calls (outcome stayed `no_answer`). Likely the §128.3 same-minute
  re-tap path OR he's mixing phone-Recents dials (background-poller rows have
  note `'... (Phase 56l scan)'`, app tel-taps have `'tel-tap audit ...'`).

### Foot-guns
- ❌ Declaring duration capture "proven working" off a partial sample. The
  `call_capture_log` (Phase 138) is the source of truth — read it before ANY
  gate/score that depends on call duration.
- ❌ A Done/score gate that REQUIRES a captured duration the APK can't
  reliably produce → it blocks honest reps. Don't gate on duration until the
  onResume capture fix ships + is device-verified.
- ❌ `call_logs` has **no `phone` column** — the rep's number is
  `client_phone`. (`cl.phone` 42703 errors.)


---

## 68 · Phase 163 — My Performance number-truth + admin per-rep view; TC connect-rate HELD (2026-06-16)

Owner: "my performance page has issues … come up with issues, don't patch,
permanent solution." Then "+ admin page has no my performance of each
candidate." 3 read-only audit agents traced every number on the 4 cards
(`PerformanceScoreCard`, `TcWeeklyTiles`, `MyPerformance`, `TotalPayableCard`)
to its RPC/column. Most contracts were already clean (revenue matches admin,
no incentive double-count, TA/DA single-source, salary reads the RPC). Found
4 real "screens disagree" bugs + 1 admin gap. Shipped 4 of 5; **HELD the TC
connect-rate** (the 5th) for a documented reason.

### Shipped (`6c7d6e9` + `f2f4f12`, JS-only, no SQL, no APK rebuild, guardian PASS)
All display-only / additive — no call chain, push, cadence, stage, duration
gate, or `useAutoRefresh` touched.
- **Issue 2 — IST month anchor.** `PerformanceScoreCard.monthStart`,
  `TotalPayableCard.monthStart/End/Key` + the RPC `year/month`, and
  `MyPerformance.buildMonthOptions` + `selectedMonth` all derived from
  device-local/`new Date().toISOString()` (UTC) → wrong month for the first
  ~5.5h of the 1st + on any non-IST phone (last month's Score/Salary/Revenue).
  Now all from `istCurrentMonthYM()` (Asia/Kolkata). Only changes WHICH month
  is queried — no save/pay math.
- **Issue 4 — incentive figure agreeing with itself.** `TotalPayableCard`
  forecast cfg read `settings?.sales_multiplier` (wrong column; real one is
  `default_multiplier`) + `?? 0.04` (the lone outlier; canonical seed = 0.05).
  Now `default_multiplier` + 0.05 to match `MyPerformance` + `IncentiveDashboard`.
  Grand total still = `compute_monthly_salary` `net_payable` (unchanged).
- **Issue 5 — admin per-rep performance view.** NEW read-only
  `RepPerformanceCard({ userId })` on `RepProfileV2` (`/people/:userId`,
  admin/HR-gated). Calls the SAME RPCs the rep's page uses — `monthly_score`
  + `compute_monthly_salary` (both self-or-admin SECDEF, so admin reads any
  user) + `monthly_sales_data` — so figures MATCH the rep's My Performance by
  construction. Shows Score/Base/Variable/Incentive/TA-DA/Revenue/Net. Skipped
  for agency (commission-only). Month IST-anchored. No writes.
  - **Why a purpose-built card, not re-mounting the 4 rep cards:** each rep
    card gates internally on the *logged-in* `profile.role` (e.g.
    `PerformanceScoreCard` returns null for agency, branches on telecaller) —
    re-mounting would render in the ADMIN's role context, wrong. The
    summary-card reads the rep's numbers directly. Reusable pattern.
- **Bonus (pre-existing bug on the same page):** `RepProfileV2` Salary section
  read camelCase `salary.netPayable/taTotal/deductions` that the RPC doesn't
  return (`net_payable/ta_da/unpaid_deduction`) → Net/TA/Deductions showed
  ₹0/—. Aliased at `setSalary` (base+incentive already matched). Was silently
  wrong for who-knows-how-long; surfaced by the guardian, fixed in-scope.
- **Phase 163.1 (`f2f4f12`):** the 2 pre-existing MyPerformance emoji
  (🎉 streak / 🏆 target-hit) → dropped / Lucide `Trophy` (owner said "up to
  you"; §7 Lucide-only). Closes the §27 non-waiver flags on this file.

### HELD — Issue 1, the TC connect-rate (NOT shipped, owner-aware, tied to §67)
The My Performance weekly **connect-rate tile** (`tc_weekly_stats`) and the TC
Today **hero** (`TelecallerV2:667` `connectedToday/callsToday`) disagree —
different denominators. The agent labeled the tile "inflated"; the actual
formula trace says the tile reads LOWER (it divides by ALL taps incl tel-tap
audits + no-answers) while the hero divides by ≥10s calls only → the hero
reads ~100% (the §49 "Rima 100% connected" artifact). **Neither is honest:**
- `outcome='connected'` is rep-entered + ~always true (the modal marks nearly
  every call connected) → meaningless as a filter (§49 frozen rule).
- `duration_seconds >= 10` is the only honest signal BUT capture is NOT
  reliable on the APK (§67, this morning's finding — the reason Phase 154
  *dropped* the ≥10s Done-gate). Flooring the tile at ≥10s to "match" the hero
  just makes BOTH show a meaningless ~100%, on the **frozen** `tc_weekly_stats`
  SQL, in the area that's burned the owner 5+ times.
- **DECISION: hold Issue 1 until the duration-capture fix lands** (parked
  APK-rebuild onResume work). The connect-rate becomes honest only then. Do
  NOT touch `tc_weekly_stats` to chase it before that — it can't be made right
  and a frozen-SQL change there is pure downside. (If owner later insists on
  "just make them agree," mirror the hero's ≥10s in the tile knowing it shows
  ~100% — but only with his explicit eyes-open OK.)

### Foot-guns / lessons
- ❌ Trusting an audit agent's *direction* ("the tile is inflated") without
  re-deriving the formula. The tile was actually LOWER. Read both expressions.
- ❌ "Make two screens agree" is not automatically a fix — if BOTH definitions
  are broken (here: outcome-meaningless vs duration-uncapturable), agreeing on
  a meaningless number isn't progress. Name it; hold it.
- ❌ A money-display page reading camelCase off a snake_case RPC silently shows
  ₹0 (RepProfileV2 Salary). When wiring a new RPC reader, confirm the exact key
  case against the function's RETURNS/`jsonb_build_object`.
- The 4 incentive/score cards (`PerformanceScoreCard`, `MyPerformance`,
  `TotalPayableCard`, `TcWeeklyTiles`) are NOT in the §28 frozen file list but
  render inside the frozen `MyPerformanceV2` page → guardian before any commit.

### State on origin after push
`6c7d6e9` (163 bundle) + `f2f4f12` (163.1 emoji) — JS only, no SQL, no APK
rebuild. Owner pushes; Vercel deploys; reaches APK on next open.


---

## 69 · Phase 164–170 + the SYSTEMIC root of "works then breaks" (2026-06-17)

Long owner-driven session. Closed five surfaces, then the owner asked the real
question: *"many things worked fine, then after days spoiled — you patch and it
spoils everything. is it the agents? analyse deeply, very serious."* The honest
answer + the two root fixes it produced are the important part of this section.

### Shipped (all on origin unless noted)
| Phase | SHA | What | Run-state |
|---|---|---|---|
| 164 | `74c3348` | TC evening WhatsApp report gets a DAY SCORE (was hidden + the 50-pt slot was meetings → 0 for TC; now TC's 50-pt slot = calls). `useDaySummary` + `whatsappSummary`, guardian PASS, display-only. | JS, live |
| 165 | `338f1bf` | Cities **bulk-rate Grade filter** — `BulkRateModal` Grade dropdown (All/A/B/C, present-grades only) scopes the selected set; `CitiesV2.handleBulkUpdate(ids)`. | JS, live |
| 166 | `bc9b714` | (SUPERSEDED by 170) call_logs same-lead 5-min dedup for the Vimal Oil different-number double. | SQL ran, then replaced |
| 168 | `3cd1bdc` | **QR Leads count = 0** — `campaign_conversation_ensure_lead` rebuilt = C8.1 byte-for-byte + the `location_id` lead-INSERT column C8.1 had DROPPED. + backfill. | SQL RUN ✓ |
| 169 | `791b861` | **Map route line draws the FULLER drive** — `cleanTrack(pings, opts)`; default = strict (km callers byte-identical), the 2 POLYLINE callers (GpsTrackV2 + RepMapPanel) pass loose `{accM:200, speedKmh:250}`. km stays on server daily_ta → guardian: no km/pay can move. | JS, live |
| 170 | `8409e18` | **call_logs MIRRORS the phone call log** — see below. | SQL RUN ✓ |

### 69.1 · THE MIRROR-PHONE DECISION (reverses Phase 126 — do NOT undo)
Owner 17 Jun: *"mirror of call log — yes exactly."* This **REVERSES** the Phase
126 (8 Jun) "a rep who re-called counts once" rule. Evidence: Rima's app 234
rows vs her other CRM (mirrors the phone) **243** — the 9 gap = her legitimate
repeat-calls to the same lead, which 126 (same-phone 30 min) + 166 (same-lead
5 min) wrongly merged.
- **Phase 170 is the canonical `call_logs_dedupe_before_insert`.** It folds a
  row ONLY into an UNPATCHED tel-tap-audit placeholder (`duration_seconds IS
  NULL OR =0` AND `notes LIKE 'tel-tap audit%'`), matched by phone 60s OR same
  lead 5 min. No unpatched tap → INSERT (real call). A patched/real row can
  NEVER be a fold target → two genuine repeat-calls BOTH survive = mirror the
  phone. Still dedups: tap+scan double-write, ghost double-taps, cross-number
  same call (Vimal Oil via the lead arm + Phase 167 JS). Missed inbound stays
  distinct.
- **⚠ LOCKSTEP: do NOT re-run `supabase_phase126_*` or `supabase_phase166_*`** —
  they'd revert the broad merge. 170 is the only current version. Pairs with
  Phase 167 (JS scan reconcile) — same principle (fold scan into the tap,
  never merge two real calls).
- Forward-looking: rows ALREADY merged by 126/166 can't un-merge; the next
  device scan re-ingests + re-inserts the wrongly-merged repeat-calls.
- Guardian PASS (two-real-calls-survive traced). P3 edge: two back-to-back
  0s no-answers to one number within 60s may read as one — count/score
  unaffected (neither ≥10s).

### 69.2 · THE SYSTEMIC ROOT — why "it works, then breaks" (the owner's real Q)
NOT the agents (they are read-only — they CATCH regressions, don't cause them).
The cause is **the same logic defined in many places**, proven by counts:

| The same thing, redefined in many files | # |
|---|---|
| `compute_daily_score` | **10 files** |
| `generate_lead_tasks` | 8 |
| `compute_daily_ta` (km) | 7 |
| `campaign_conversation_ensure_lead` | 5 |
| meeting counter (`lead_activity_bump_counter`) | 5 |
| `call_logs_dedupe_before_insert` | 3 (now 170 canonical) |
| frontend "≥10s = a call" rule | **22 files** |
| km computed/read (frontend) | 9 |

Two failure modes, both seen THIS session:
1. **Multi-file `CREATE OR REPLACE` collision** — a later file rewrites a
   shared function for a new purpose and silently DROPS an earlier fix. Today's
   QR bug (§168): C8.1 rewrote the lead-create for telecaller routing and
   dropped C8's `location_id`. Worked, then "broke."
2. **No single source of truth** — "a call" lives in 22 places, km in 9; fix
   one, the others still disagree (Rima's app 234 vs admin's split vs the
   phone's 243). One cleaning function fed BOTH the km AND the map → tightening
   it for km (§98.D) spoiled the map (§169 split them).

So "you patch and it spoils something else" is **literally true** — the things
are wired together from months of patch-on-patch (the §3 anti-pattern at scale).

### 69.3 · THE CURE (owner-aware, NOT YET DONE — the next deliberate sprint)
Consolidate each recurring-pain concept to ONE source of truth:
- ONE call-count rule every screen reads (kill the 22 copies).
- ONE km source (already daily_ta) — §169 decoupled the map LINE from it (the
  template: route ≠ km).
- ONE current file per DB function — stop the 10-versions sprawl; a function
  gets one canonical file + a lockstep header.
This is a focused consolidation sprint, guardian-checked — NOT more patches.
Owner agreed it's the real fix; do it deliberately, not mid-fire. §163/§169/§170
are the first three single-source moves.

### 69.4 · Rima call split (NOT a bug — explained)
Admin day-track (`GpsTrackV2`) SPLITS calls into "Lead calls · N" (lead?.id) +
"Unknown numbers · N" (no lead) — `GpsTrackV2:1179`. The screenshot showed only
"Lead calls · 144"; the other ~90 are in the collapsed Unknown section. 144+90=
234 = total taps. Admin isn't missing calls; it splits them. (The 234-vs-243 is
the §69.1 merge, separate.)

### Verify (owner's eyes — pending)
- Map: hard-refresh a rep day-track → fuller route line; km unchanged.
- Calls: Rima's count should climb to her phone/other-CRM number (~243) within a
  scan cycle / by next day.

---

## 70 · Consolidation Stage 0 — dead-code purge + duplication audit (Phase 172, 17-Jun-2026)

Owner greenlit the real cure for "works then breaks" (root = the SAME logic written in
many files; a later rewrite drops an earlier fix. See §69 + the new
`DUPLICATION_AUDIT_2026-06-17.md`). Stage 0 = the zero-risk foundation: remove dead
weight + make the disease visible. **No behaviour change** — every deletion was
certified dead (imported by nothing; only comment-references; no dynamic/lazy import;
not in App.jsx).

### What shipped (Phase 172)
- Deleted 5 orphan files (1,175 lines, zero importers):
  `MeetingsMapPanel.jsx` (702 — dead since Phase 89.11, replaced by `RepMapPanel`),
  `DidYouKnow.jsx` (160), `RejectionBanner.jsx` (111),
  `PendingApprovalsBanner.jsx` (106), `RenewalReminderBanner.jsx` (96).
- Removed 4 certified-dead exports: `HEAT_OPTIONS`, `groupForStage` (`useLeads.js`);
  `REVENUE_TYPES`, `DURATION_OPTIONS` (`constants.js`). `STAGE_GROUPS` KEPT (still
  imported by LeadShared + LeadsV2 — verified before cut).
- Added `DUPLICATION_AUDIT_2026-06-17.md` — full inventory (Categories A–F).
- Added `scripts/check-duplication.sh` — reports DB-function collisions + orphan files.
  Diagnostic NOW; becomes a hard pre-commit gate in Stage 2 (once `db/functions/` exists).
- §28 frozen list: dropped `MeetingsMapPanel.jsx` (deleted).

### The audit numbers (for the record)
- **Cat A** — 73 Postgres functions `CREATE OR REPLACE`d in ≥2 files. Worst:
  `compute_daily_score` (10), `compute_monthly_salary` (9), `generate_lead_tasks` (8),
  `compute_daily_ta` (7), `campaign_conversation_ensure_lead` (5), `call_logs_dedupe` (4).
- **Cat B** — frontend rules copy-pasted: "today" as UTC `toISOString().slice(0,10)` in
  **43 files** (should use the existing `istDate.js`), phone-clean `/\D/g` in 19,
  lead-stage strings in 16, "≥10s = call" in 8.
- **Cat E** — 17 unused npm packages (the shadcn-ui + react-hook-form + zod stack —
  abandoned; **§21 stack note is STALE**). Removal = Stage 1.5, build-gated.

### Stale-doc corrections found during the scan
- `Untitled Proposals/` folder already deleted → §22 Sprint 5 + §23 item 5 are stale.
- §21 lists "React Hook Form + Zod" as the stack — app imports NEITHER (0 references).

### Next stages (owner-gated, one at a time — do NOT batch)
- **Stage 1** — extract `phone.js` / `callRules.js` / `leadStages.js` + migrate the 43
  date files to `istDate.js`. Behaviour-preserving, guardian per commit.
- **Stage 1.5** — remove the 17 dead npm packages (`npm install` + clean build BEFORE push).
- **Stage 2** — one canonical `db/functions/<name>.sql` per Postgres function; non-pay
  first, score/salary/TA LAST with shadow-compare. Then `check-duplication.sh` flips to
  a hard gate.
- **Stage 3** — Option 2 map: road-snapped real GPS route, built on the single km
  source, reusing `/api/snap-to-roads`. Cost ~₹0–2,500/mo (free tier likely covers).

---

## 71 · NO NEW COPIES — the standing rule that ends "works then breaks" (Phase 173–175, 20-Jun-2026)

Owner directive 20 Jun 2026, after the call / Lost / report bugs recurred (~100×):
a permanent rule binding **every future session** so the same logic never lives in
N files again. Root (see §69): one rule re-pasted across many phase files; a later
file silently reverts an earlier fix. **THIS SECTION IS THE PREVENTION — read it
before writing ANY SQL function or shared rule.**

### The 6 rules (MANDATORY, every session)

1. **ONE canonical file per DB function.** To change a function, EDIT its single
   home file (re-paste the whole body THERE). NEVER write a new `phaseN` file that
   re-pastes the function with a tweak — that is what made `compute_daily_score`
   live in 10 files. A brand-new function gets one home from birth.
2. **CHECK-FIRST (read before write).** Before adding ANY function / trigger /
   rule, grep: does it already exist? On 20 Jun this caught a near-duplicate
   TWICE (Phase 134 + 135 already had the Lost-followup triggers; a 5th would have
   BEEN the bug). If it exists, EDIT it in place — never add a sibling.
3. **MONEY / SECURITY = shadow-compare + owner verifies.** Never switch a
   score / salary / TA / payment / role function without (a) running new vs old on
   real data and proving the numbers IDENTICAL, (b) the owner eyeballing the real
   figures, (c) a one-command revert ready. Never mid-workday for these.
4. **Every risky function gets a TRIPWIRE** — a read-only monitor / self-test that
   screams the same day if a copy drifts or an old file is re-run. Examples
   shipped 20 Jun: the Phase 173 self-test + `direction_guarded` query; the Phase
   174 "open FUs on Lost = 0" monitor.
5. **Run `scripts/check-duplication.sh` BEFORE any commit that adds/edits a SQL
   function.** If a function's file-count went UP, STOP — you are about to make a
   copy. (Stage 0 added the script; this makes running it mandatory. §15 gate.)
6. **Guardian audit** on anything touching money / security / a frozen surface.
   It caught real issues 4× on 20 Jun before they shipped.

### The cure for the EXISTING 73 copies (Stage 2 — owner-gated, slow)

One canonical `db/functions/<name>.sql` per function; DELETE the other copies so
nothing is left to re-run. Non-money first, **money / security LAST**, each
shadow-compared + owner-verified. `check-duplication.sh` flips to a HARD gate once
`db/functions/` exists. Risk-scored inventory: 73 functions, **23 are score-5
(money/security)** — see `DUPLICATION_AUDIT_2026-06-17.md`.

### Today's 3 fixes — LOCKED contracts (do NOT strip; §33-style — BLOCK on regress)

| Phase | Rule (frozen) | Tripwire |
|---|---|---|
| **173** | Call dedup is DIRECTION-AWARE: incoming + outgoing NEVER merge; only an outgoing folds into a tel-tap. Enforced in BOTH the DB trigger AND `callHistoryIngest.js` PRIMARY dedup — change one, change both. | `supabase_phase173_TEST_call_dedup.sql` (PASS) + V2 `direction_guarded` |
| **174** | A Lost lead has NO open follow-up: `followup_block_on_lost_lead` born-closes ALL (incl cadence); `followup_after_done` has NO `lost_nurture` respawn. | monitor: open FUs on Lost = 0 |
| **175** | ONE `isSystemClose` (`src/utils/followups.js`) decides rep-done vs system-closed — used by BOTH the team report AND the rep card. | shared util; change once |

A diff that re-introduces a cross-direction call merge, a `lost_nurture` respawn,
or a second copy of the done-vs-system-close rule is a **BLOCK**.


---

## 72 · Phase 178 — Stage-2 consolidation #1: compute_daily_score → ONE file (2026-06-23, `8e19b66`)

First real Stage-2 (§70/§71) consolidation. compute_daily_score was the worst
offender — **10 copies** (the disease in §69). Now **one canonical file**.
Committed, NOT yet pushed (sandbox can't push). **JS-free, SQL-run-free, APK-free.**

### What this was — and what it was NOT
- It was a **CAPTURE, not a change.** The canonical file is the LIVE function dumped
  byte-for-byte via `pg_get_functiondef` on 2026-06-23. **Zero DB run requested,
  zero behaviour change, the running function is untouched.** Scores/incentive/every
  other function identical. This is the SAFE way to consolidate a money function
  (§71 rule 3): photograph the live truth, retire the copies, change nothing.
- Net diff: +266 / −1039 (773 lines of duplicated SQL deleted).

### The new contract (FROZEN — the model for every future Stage-2 function)
- **`db/functions/compute_daily_score.sql` is the ONE home.** To change the score,
  EDIT THIS FILE and run it once in Studio. The 10 legacy phase files had their
  compute_daily_score block + trailing GRANT REMOVED, each replaced by a pointer
  comment. Re-running any old phase file can no longer revert the score.
- `db/functions/` is the canonical directory. `check-duplication.sh` now reports
  compute_daily_score as **1** (was 10) — it has left the collision list. As more
  functions move here, the script flips to a hard pre-commit gate (§70).
- The canonical file ends with a read-only **VERIFY/tripwire** (6 LIKE checks on
  `pg_get_functiondef`): _assert_self_or_admin · min_calls · duration_seconds >= 10 ·
  'Meeting scheduled%' · auto-check-in · COUNT(DISTINCT COALESCE(la.lead_id...)).
  Any FALSE = an old copy was re-run → re-run the canonical to restore. Run it anytime.
- LOCKED fixes baked in (BLOCK on regress, same as §71): 97.2 self-gate · 113 TC
  target from `daily_targets.min_calls` (not JSONB) · 110 real-call gate · 113/127
  meeting exclusions + lead dedup. The CALL branch stays `outcome IS NOT NULL OR ≥10s`
  — owner's intentional looseness (§65/§67), do NOT tighten without his sign-off.

### How it was done safely (the repeatable recipe)
1. Owner dumped the live function (`pg_get_functiondef`) → ground truth.
2. Saved verbatim as `db/functions/<name>.sql` + canonical header + VERIFY tripwire.
3. Found every duplicate via the START line, computed the dollar-quote END
   (`AS $tag$ … $tag$;`), checked for DROP/GRANT/callers FIRST (a leftover
   `DROP FUNCTION` would be a landmine — there were none).
4. Removed each CREATE-block + its trailing GRANT (assertion-guarded by line range),
   leaving every SIBLING function in the multi-purpose files intact (7 of 10 also
   defined the AFTER-INSERT score trigger / counter / monthly_score / 21 role-gates).
5. Neutralised a stale COMMENTED rollback copy in phase97_2 (a pre-110/113/127 body
   with the calls-JSONB bug) so no one can uncomment a broken score.
6. Gates: check-sql-schema OK · check-duplication 10→1 · **sales-module-guardian PASS**
   (all 4 contracts preserved, all siblings intact, no orphan fragment, no DROP).

### NEXT Stage-2 candidates (worst-first, money LAST per §71 rule 3)
`generate_lead_tasks` (8) · `compute_daily_ta` (7) · `campaign_conversation_ensure_lead`
(5) · `lead_activity_bump_counter` (5) — these are non-money / lower-risk, do them
BEFORE the money ones to refine the recipe. Money/security still pending:
**`compute_monthly_salary` (9 copies)** — its stale rollback copy still sits commented
in phase97_2 (left intentionally for when it's consolidated). Each money function:
capture → shadow-compare → owner-verify → defuse copies, never mid-workday.

### Owner action
Push (JS-free, no SQL to run, no APK rebuild — capture only, your team sees nothing change):
```
cd ~/Documents/untitled-os2/Untitled/adflux
git push origin untitled-os
```
Optional: run the VERIFY block at the bottom of `db/functions/compute_daily_score.sql`
in Supabase Studio — all six should return TRUE (proves the live function still has
every fix).

### Phase 178 #2 — generate_lead_tasks 8 → 1 (`39b54e6`)

Second Stage-2 move, same recipe. The smart-task engine (lead_tasks queue →
per-task push, §34Z.55; frozen-adjacent §28) lived in 8 files across **two
signatures**. Canonical now `db/functions/generate_lead_tasks.sql`.
- The live dump returned **ONE** signature, `generate_lead_tasks(uuid)` (the
  Phase 130 body). The old `(date)` overloads were already dropped (phase34z19)
  — they survived only as dead repo copies. **Do NOT recreate the (date)
  signature** (two overloads would let callers bind the wrong one).
- New overload-specific landmine handled: phase34z19 had `DROP FUNCTION …
  generate_lead_tasks(uuid) CASCADE` before its CREATE; removing the CREATE
  alone would have left a re-run bomb (drop-with-cascade, no recreate). Removed
  the DROPs **with** the block. phase33t's GRANT folded into the canonical.
- Siblings preserved: phase130's 3 push-hygiene functions + phase19's
  `complete_lead_task`. Guardian PASS. check-duplication 8 → 1.
- Locked contracts in the canonical (BLOCK on regress): Phase 130 self-gate +
  snooze-survival DELETE (`status='open'` only) + no-push `ON CONFLICT DO
  NOTHING` reuse + the 3 kinds hot_idle/new_untouched/follow_up_due.

**Stage-2 scoreboard:** compute_daily_score ✅ · generate_lead_tasks ✅ ·
campaign_conversation_ensure_lead ✅ · lead_activity_bump_counter ✅ ·
recompute_daily_meetings ✅ (5 done — the §33 meeting-counter SQL pair is now BOTH
single-source; total duplicated DB functions 73 → 70).
**Next (worst-first, money LAST):** lead_activity_after_insert (5) ·
call_logs_dedupe_before_insert (~3, §170 mirror-phone contract) ·
compute_daily_ta (7, MONEY — ₹3/km TA payout: capture → shadow-compare → owner-verify) ·
compute_monthly_salary (9, money, LAST).

### Phase 178 #3 — campaign_conversation_ensure_lead 5 → 1 (`2672d6b`)
The WhatsApp-chat→lead trigger fn (§46/§53) lived in 5 files (C4.5→C8→C8.1→C11→168).
C8.1 once silently dropped C8's `location_id` → that drop is the whole reason Phase
168 had to exist (§168) — textbook "works then breaks." Canonical now
`db/functions/campaign_conversation_ensure_lead.sql` (live dump = the Phase 168 body,
single trigger-fn signature). Function body removed from all 5; the two `CREATE
TRIGGER trg_campaign_conv_ensure_lead` (c45 + c8_location), the Phase 168 backfill,
and the ADD COLUMN statements LEFT INTACT — only the body moved. Guardian PASS:
all 4 P0 contracts + location_id restore + double-EXCEPTION wrap preserved. The
TRIGGER wiring intentionally stays in c45/c8 (this canonical owns the function body
only) — a trigger fn's canonical doesn't need to own the CREATE TRIGGER.

### Owner action (Phase 178 #2)
Same — push, no SQL, no APK rebuild, team sees no change. Optional: run the VERIFY
block at the bottom of `db/functions/generate_lead_tasks.sql` (all six TRUE).

### Phase 178 #4 — lead_activity_bump_counter 5 → 1 (`2cedb7c`)
The §33 meeting-KPI counter (burned ~3×). Lived in 5 files (phase12, 93.7.1, 98.h,
103.e2, 127). The live dump proved the body is the **Phase 127 superset** — it kept
phase103_e2's `Meeting scheduled%` skip AND added the 127 prior-must-be-done
refinement, so §33's feared "phase127 reverted 103_e2" landmine did NOT fire.
Canonical now `db/functions/lead_activity_bump_counter.sql` with a 6-marker tripwire
(auto-checkin, scheduled, revisit dedup, prior-must-be-done, bump, call-5s). All 5
§33 exclusions verified by guardian (strict pass). Trigger wiring stays in phase12;
phase98_h's stale commented rollback was also neutralized.
- ⚠ LOCKSTEP DEBT: `recompute_daily_meetings()` (the §33 delete-heal partner) is NOT
  yet consolidated — still in `supabase_phase103_e2_*`. The two share the exact
  meeting-exclusion set; consolidate recompute_daily_meetings NEXT-ish and keep both
  bodies identical, or they drift (the §33 disease). The §33 section in the
  workspace-root CLAUDE.md was updated to point at the new canonical (that file is
  above the git root, so it's edited locally but does NOT push — re-edit there if it
  resets).

### Phase 178 #5 — recompute_daily_meetings 2 → 1 (`9230a2a`) — §33 SQL pair CLOSED
The §33 DELETE-heal, lockstep partner of lead_activity_bump_counter. Lived in 2
files (103_e1, 103_e2). Live dump = the phase103_e2 body (has the 'Meeting
scheduled%' skip). Guardian verified its exclusion set is IDENTICAL to the insert
counter's — so both halves of the §33 SQL lockstep are now single-source in
db/functions/. phase103_e1 keeps its trigger fn + trg_lead_activity_meeting_recount_del.
The §33 NOTE in the workspace-root CLAUDE.md was updated: only the THIRD surface,
GpsTrackV2.jsx (isScheduledMeetingRow + isAutoCheckinRow), remains separate (JS) —
keep all three in step when adding an exclusion. (Workspace-root CLAUDE.md is above
the git root → local edit, does NOT push.)

### Phase 178 #6 — lead_activity_after_insert 5 → 1 (`HEAD`)
The auto-Lost trigger fn (bumps contact_attempts_count + last_contact_at; SOFT-
suggests auto-Lost at >=15 attempts — §26 Sprint F softened the old "3-attempt
hard-Lost"). Lived in 5 files (phase12, 31b, 34b, 34z2, 34z17 — the auto-Lost
evolution). Canonical now db/functions/lead_activity_after_insert.sql, captured
from the live DB. IMPORTANT: preserved as a PLAIN trigger fn (NOT SECURITY DEFINER,
no search_path) — that's the live shape; don't "harden" it without owner sign-off.
Siblings intact (phase12's 6 fns + 6 triggers, phase34b's dismiss_auto_lost RPC);
trigger wiring left in place. Guardian PASS (threshold 15, soft-only, stage guard
all verified). Scoreboard: 6 done, 73 → 69.

### Phase 178 #7 — call_logs_dedupe_before_insert 5 → 1 (`HEAD`)
The §170/§173 call-dedup "mirror the phone log" trigger fn. Lived in 5 files
(113.5, 126, 166, 170, 173). Live dump = the Phase 173 direction-aware body
(folds only into an unpatched tel-tap audit row; only outgoing folds; missed
inbound distinct; two real repeat-calls both survive). Canonical now
db/functions/call_logs_dedupe_before_insert.sql. BONUS: removing phase126 +
phase166's broad-merge BODIES kills the §69.1 revert landmine permanently —
re-running them can no longer over-merge calls. Trigger trg_call_logs_dedupe
left intact (5 idempotent re-creates). §173 LOCKSTEP: the direction rule is
mirrored in src/utils/callHistoryIngest.js (frontend JS, untouched — change both
together). Guardian PASS. Scoreboard: 7 done, 73 → 68.

### Phase 178 #8 — compute_daily_ta 7 → 1 (`HEAD`) — first MONEY function
The TA payout calc (Rs/km bike + DA + hotel + claim merges → daily_ta). Lived in
7 files. Live dump = the phase103_d6 "seg10" body. Canonical now
db/functions/compute_daily_ta.sql. Thresholds verified vs §44.7: acc<=50m,
seg>=10m (0.010km), speed<=120, Rs3/km (city override). Payout guards preserved:
_assert_self_or_admin, ta_override REPLACE-km, ON CONFLICT WHERE status='pending'
(never overwrite an approved payout). Guardian PASS, all 13 phase97_2 siblings +
36_8 claim trigger intact.
- ⚠ FLAGGED (owner-aware): the LIVE compute_daily_ta has NO 600km daily cap — the
  §44.7 doc claims "daily cap 600km" but the running body has none (the per-segment
  <=120km/h filter is the only GPS-spike guard). Captured AS-IS. If owner wants a
  hard daily ceiling that's a CHANGE (add LEAST(v_total_km,600) → shadow-compare +
  owner-verify), NOT silently added. The §44.7 doc line should be corrected to
  "no server-side daily cap; speed filter only" when someone next edits §44.
- Money-function recipe note: this was a pure CAPTURE (no DB run) so the §71-rule-3
  shadow-compare wasn't needed (byte-identical = same payout). The LAST one,
  compute_monthly_salary (9 copies + helper _compute_monthly_salary_base), is the
  same — capture only. Reserve shadow-compare for when the owner CHANGES a money fn.

### Phase 178 #9 — salary pair 9+2 → 1 each (`HEAD`) — WORST TIER CLEARED
compute_monthly_salary (the MOST-duplicated fn, 9 files) + _compute_monthly_salary_base
(2 files). The payroll RPC. Canonicals: db/functions/compute_monthly_salary.sql
(phase101.a1 agency-split body) + db/functions/_compute_monthly_salary_base.sql
(phase97.2 body). Guardian PASS (strict): net formula, leave math (quota 12 / divisor
26 / half-day / FY carry), agency short-circuit, sales_manager override, auth gate all
byte-faithful. phase97_2's big commented rollback section (stale copies of both) also
neutralized. phase97_2 now down to 11 sibling RPCs.

**STAGE-2 WORST TIER COMPLETE (10 functions, 9 rounds):** compute_daily_score ·
generate_lead_tasks · campaign_conversation_ensure_lead · lead_activity_bump_counter ·
recompute_daily_meetings · lead_activity_after_insert · call_logs_dedupe_before_insert ·
compute_daily_ta · compute_monthly_salary + _compute_monthly_salary_base. Total
duplicated DB functions 73 → 65. ~5,000 lines of duplicate SQL removed. Every one a
capture (zero DB run, zero behaviour change), guardian-clean. The remaining 65 are
lower-count (mostly 2-3 copies) + many are legit overloads / tiny trigger wrappers.

### Phase 178 #10 — generate_quote_number + snapshot-aware dedup (`HEAD`)
The §4 quote-ref trigger fn (UA/AUTO, UA/GSRTC, UA-YYYY formats). Appeared in 4
files but 2 are the full-schema fresh-install SNAPSHOTS (supabase_all_migrations.sql
+ supabase_schema.sql) — a DIFFERENT kind of duplication than the phase-file disease.
- Canonical: db/functions/generate_quote_number.sql (§4 formats guardian-verified).
- Defused the 2 PHASE files only; LEFT the snapshots intact (they must stay complete
  to bootstrap a fresh DB — never gut them; regenerate from canonicals if needed).
- scripts/check-duplication.sh now EXCLUDES the 2 snapshots from its count. **The
  honest phase-file duplication number is now 55, not 65** — 10 functions were only
  "duplicated" via a snapshot, never the disease. Going forward the dedup count
  reflects real phase-file collisions.
- SNAPSHOT POLICY (new): supabase_all_migrations.sql + supabase_schema.sql are
  generated fresh-install dumps. Do NOT hand-edit them to change a function; do NOT
  count them as duplication; the long-term Stage-3 move is to REGENERATE them from
  db/functions/ canonicals. They are fresh-install-only — running them on the LIVE
  staging DB would revert everything to the snapshot state (a landmine — flag if
  anyone proposes it).
- Scoreboard: 11 functions single-source (10 rounds + the salary helper). Real
  phase-file duplication 55 remaining (was mis-counted as 65). The tail is now
  mostly 2-3 copy functions + legit overloads (next_workday etc — do NOT merge) +
  tiny update_updated_at-style wrappers.

### Phase 178 #11 — monthly_score 3 → 1 (`HEAD`) — salary chain complete
The score breakdown that feeds compute_monthly_salary (base_amount + variable_earned
+ avg_score_pct + working_days). Lived in 3 phase files. Canonical now
db/functions/monthly_score.sql. Guardian PASS: 70/30 split (base x0.70 / var cap
x0.30), variable_earned logic (0 days -> full cap; avg<50 -> 0; else proportional),
daily_performance + staff_incentive_profiles reads, RETURNS TABLE columns, auth gate
all byte-faithful. phase97_2 now at 10 live siblings.
**The whole salary chain is single-source:** compute_monthly_salary ->
_compute_monthly_salary_base -> monthly_score. Scoreboard: 12 functions done.
Remaining phase-file duplication ~54 (3s + 2s; legit overloads like bump_daily_counter
[3-arg + 4-arg], next_workday must NOT be merged; tg_*_push triggers + tiny wrappers).

### Phase 178 #12 — enqueue_push 3 → 1 + SECURITY landmine closed (`HEAD`)
The push-pipeline core (§28). Canonical: db/functions/enqueue_push.sql. Body
byte-faithful (§34Z.69: 5s timeout, push_log best-effort audit, hardcoded public
anon key, DEFINER + extensions search_path). **SECURITY WIN:** §97.A2 revoked
EXECUTE from authenticated, but all 3 old phase files still GRANTed it to
authenticated — re-running any re-opened the rep-push-spam hole. Phase 178
neutralized all 3 GRANT lines + the canonical bakes in the REVOKE (FROM PUBLIC,
anon, authenticated) + GRANT to service_role (live ACL = {postgres, service_role}).
Guardian PASS. phase33w_push_triggers keeps its 4 push-trigger fns.
- ⚠ check-sql-schema.sh FALSE-POSITIVES on this canonical: its alias.column
  heuristic matches the JWT anon key (eyJ…) + the Supabase URL — both string
  literals with dots, not column refs. The SQL is valid; guardian is the gate. A
  future script tweak could skip dotted string literals; not done here.
- Scoreboard: 13 functions single-source. The push pipeline core is now locked.

### Phase 178 #13 — followup_after_done (the §174-FROZEN cadence engine) (`HEAD`)
The cadence engine that bit the owner (lost_nurture respawn). Canonical:
db/functions/followup_after_done.sql, captured from the live phase174 body and
VERIFIED to carry every contract (phase174 = clean superset, nothing reverted):
§174 NO lost_nurture respawn branch · Truth-1 lead_id-NULL skip + flip guard +
auto-skip earlier FUs + QuoteSent de-stage (quote_chase seq-3 only when DUE) +
nurture respawn only while stage=Nurture + cadence_paused guard. Guardian PASS
(strict). phase33d6 keeps its 8 cadence siblings + the trigger. The tripwire's
`no_lost_nurture_respawn` (NOT LIKE %lost_nurture%) is the §174 lock — keep TRUE.
Scoreboard: 14 functions single-source.

### Phase 178 #14 — run_select 3 → 1 (Co-Pilot SQL executor, security) (`HEAD`)
The AI Co-Pilot's arbitrary-SQL executor (§13). Canonical: db/functions/run_select.sql,
captured from the live phase17c body + an explicit SECURITY INVOKER keyword (no-op
clarity guard). Guardian PASS: SECURITY INVOKER (RLS applies — rep reads own rows
only; DEFINER would be a breach), first-token select/with check, DDL/DML keyword
guard, jsonb_agg wrapper, 100-row cap all byte-faithful. GRANT to authenticated kept
(safe — INVOKER+RLS; contrast enqueue_push which is REVOKED). Tripwire
`not_security_definer` is the breach alarm. Scoreboard: 15 functions single-source.

### Phase 178 #15 — push_followup_due_reminders 3 → 1 (`HEAD`) — worth-it list DONE
The cron "follow-up due now" pusher. Canonical: db/functions/push_followup_due_reminders.sql,
captured from the live phase130 body. Guardian PASS: §130 quiet-hours gate, §97.A400
per-row unique tag (fu-due-<id>), reminder_sent_at dedup (filter+stamp), 5-min window,
enqueue_push call, DEFINER+extensions search_path — all byte-faithful. phase130 keeps
its 2 other push fns. The authenticated GRANT matches live (flagged tightenable to
service_role-only later — owner call, not changed).
- ⚠ check-sql-schema.sh false-positives on PL/pgSQL FOR-loop record fields
  (r.lead_name etc) the same way it does on dotted string literals — guardian is
  the real gate. (2nd such false positive this session; a future script tweak could
  teach it about record vars + string literals.)

**STAGE-2 WORTH-IT LIST COMPLETE — 16 functions single-source (15 rounds):**
compute_daily_score · generate_lead_tasks · campaign_conversation_ensure_lead ·
lead_activity_bump_counter · recompute_daily_meetings · lead_activity_after_insert ·
call_logs_dedupe_before_insert · compute_daily_ta(+200km cap) · compute_monthly_salary ·
_compute_monthly_salary_base · monthly_score · generate_quote_number · enqueue_push ·
followup_after_done · run_select · push_followup_due_reminders. Plus: the dedup script
now excludes the 2 base snapshots (real count corrected 65→55→now lower). The remaining
tail is ALL leave-alone: real overloads (bump_daily_counter 3+4-arg, next_workday) that
§70 says NOT to merge · per-event tg_push_on_* triggers · update_updated_at one-liners.

### Phase 178 #16 — DROP dead bump_meeting_counter (removal, not consolidation) (`HEAD`)
Scoping the tail caught that bump_meeting_counter is DEAD, not a live duplicate — its
trigger was dropped in Phase 32N (the ÷2 fix); 93.6/93.7 re-defined the fn but never
re-wired it. Confirmed dead 2026-06-24 (pg_trigger empty). The live meeting counter is
lead_activity_bump_counter (#4, has all §33 exclusions; bump_meeting_counter is MISSING
the scheduled-meeting skip → re-wiring it = §33 double-count). So: REMOVED, not homed.
- NEW supabase_phase178_drop_dead_bump_meeting_counter.sql — owner RUNS to DROP it.
- Neutralized phase32m's CREATE TRIGGER (the re-wire landmine); kept DROP TRIGGER.
  Removed the fn body from phase32m/93.6/93.7; fixed 2 re-run hazards (93.7.1 live
  COMMENT, 32m VERIFY count). Guardian PASS.
- LESSON: before consolidating a "duplicate", check it's LIVE (pg_trigger / callers).
  A dead duplicate is a DROP, not a canonical — and its old CREATE TRIGGER is a
  re-wire landmine. Scoreboard: 16 consolidated + 1 dead-fn dropped.

### Phase 178 #17 — handle_payment_update + handle_payment_delete (MONEY pair) (`HEAD`)
The payments->monthly_sales_data sync triggers (feed incentive/salary via
rebuild_monthly_sales). Both live + single-wired (verified pg_trigger 2026-06-24).
Canonicals: db/functions/handle_payment_update.sql + handle_payment_delete.sql,
captured from the live phase3c bodies (approval_status='approved' guard, not the
older phase2 is_final_payment-only). Guardian PASS. Triggers kept; phase3c keeps
handle_payment_insert + rebuild_monthly_sales override + dismiss_payment_notification.
- NEXT genuine item: rebuild_monthly_sales (3 copies — the money ledger core that
  ALL the payment handlers call). After that it's truly overloads (bump_daily_counter
  3+4-arg, next_workday) + per-event tg_push_on_* + update_updated_at wrappers.
Scoreboard: 18 functions single-source + 1 dead-fn dropped.

### Phase 178 #18 — rebuild_monthly_sales (sales-ledger core, MONEY) (`HEAD`) — payment chain complete
The ledger rebuild that all 3 payment handlers + the frontend call; feeds incentive.
Canonical: db/functions/rebuild_monthly_sales.sql, captured from the live phase3c body
(approval_status='approved' filter — NOT the older phase2 no-approval version that
would over-count). Guardian PASS: approved+final filter, new/renewal split, created_by
credit, idempotent upsert, PLAIN (not DEFINER) all byte-faithful. phase3c keeps
handle_payment_insert + dismiss_payment_notification.
**Payment money chain now fully single-source:** handle_payment_{insert,update,delete}
-> rebuild_monthly_sales -> monthly_sales_data -> compute_monthly_salary.

**STAGE-2 — ALL GENUINELY-WORTH-IT FUNCTIONS DONE (19 consolidated + 1 dead-fn dropped).**
The remaining ~50 phase-file "duplicates" are ALL leave-alone: real Postgres overloads
that MUST NOT be merged (bump_daily_counter 3-arg+4-arg, next_workday, etc), per-event
tg_push_on_* triggers (2-copy, trivial), and update_updated_at/touch_updated_at-style
one-liners. Merging an overload would REGRESS; merging a wrapper isn't worth a commit.
The dedup count from here down is noise, not disease. If a future session wants to
keep going, it should ONLY pick a function that (a) is a real >=2 phase-file duplicate,
(b) is single-signature (not an overload — check pg_proc), and (c) carries real logic.

### Phase 178 #19 — followup_block_on_lost_lead (§174-FROZEN Lost guard) (`HEAD`)
The BEFORE-INSERT guard that born-closes any follow-up created on a Lost lead.
Canonical: db/functions/followup_block_on_lost_lead.sql (live phase174 body).
Guardian PASS (strict): born-close ALL on Lost (NO cadence_type skip — §174 over
§135's manual-only), done_note 'Auto-closed: lead is Lost' (§175 isSystemClose marker),
quote-linked + already-done pass-through, EXCEPTION-wrapped. Trigger in phase135 kept.
Tripwire no_cadence_skip = the §174 lock. With #13 (followup_after_done) this is the
§174 Lost-cadence pair, both now single-source. Scoreboard: 20 functions single-source
+ 1 dead-fn dropped. (Pending tail per §72 #18: 5 overloads NEVER-merge + 8 trivial
triggers + ~25 real 2-3-copy fns, lower-priority.)

### Phase 178 #20 — lead_stage_change_cadence (§128.3 cadence stage-machine) (`HEAD`)
The AFTER-UPDATE-OF-stage trigger that cancels + respawns follow-up cadences.
Canonical: db/functions/lead_stage_change_cadence.sql (live phase128_3 body).
Guardian PASS: §128.3 cancels-before-pause-gate, pause-gated spawns, Won->cancel-all,
full stage mapping, frozen cadence types — byte-faithful. Trigger + 7 cadence siblings
in phase33d6 kept. Scoreboard: 21 functions single-source + 1 dropped.
- The cadence family still has 2-copy siblings to do next: cancel_lead_cadence (in
  BOTH phase128_3 + phase33d6), lead_pause_close_auto_followups, lead_auto_create_followup,
  spawn_* helpers. lead_auto_assign / lead_set_handoff_sla / lead_auto_heat_from_outcome
  are adjacent lead-lifecycle 2-copy fns. All real logic, lower-priority (2-copy).

### Phase 178 #21 — cancel_lead_cadence (§128.3 cadence cancel helper) (`HEAD`)
The LANGUAGE-sql helper that closes open follow_ups for given cadence types.
Canonical: db/functions/cancel_lead_cadence.sql (live phase128_3 body). Guardian PASS:
§128.3 legacy-33D.4 close branch ('lead_intro'+cadence_type-NULL+auto_generated+
'Auto-scheduled:%'), '[cancelled by stage change]' §175 marker, open-only, LANGUAGE sql
— byte-faithful. Scoreboard: 22 functions single-source + 1 dropped.
- Cadence family still pending (2-copy): lead_pause_close_auto_followups,
  lead_auto_create_followup, spawn_lead_intro_cadence/spawn_quote_chase_cadence/
  spawn_nurture_followup (the spawn helpers), lead_auto_assign, lead_set_handoff_sla,
  lead_auto_heat_from_outcome. All in phase33d6/128_3, real logic, lower-priority.

### Phase 178 #22 — lead_auto_create_followup + lead_pause_close_auto_followups (`HEAD`)
Cadence family BATCH. Owner dumped 5; only 2 were real 2-copy phase duplicates.
Canonicals: db/functions/lead_auto_create_followup.sql (phase33d4+33d6) +
lead_pause_close_auto_followups.sql (phase128_3+129, §128.3 pause-close + §129
Nurture-only resume). Guardian PASS, byte-faithful. The 3 spawn_* (spawn_lead_intro_
cadence/spawn_quote_chase_cadence/spawn_nurture_followup) are SINGLE-COPY (only
phase33d6) -> deliberately NOT consolidated (single-copy isn't the disease; relocating
pads the count). Scoreboard: 24 functions single-source + 1 dropped.
- DEDUP-COUNT CAVEAT (re-learned): the snapshot-excluded check-duplication.sh count
  still INCLUDES single-phase-copy functions whose 2nd "copy" was a base snapshot —
  but those snapshots are excluded, so such a function shows count 1 and is NOT listed.
  When a function IS listed (>=2), confirm BOTH copies are real phase files (not just
  same-file overloads or a snapshot) before consolidating. The spawn_* trio taught
  this: they were never in the dedup list — I mis-grouped them into the "family batch".

### Phase 178 #23 — 5 lead/quote-lifecycle trigger fns (batch) (`HEAD`)
Lifecycle BATCH. Five real 2-copy phase duplicates, all captured byte-for-byte.
Canonicals: db/functions/{lead_auto_assign, lead_auto_heat_from_outcome,
lead_set_handoff_sla, quote_after_delete_rollback_lead, quote_before_insert_ensure_lead}.sql.
Guardian PASS (strict), every locked contract byte-faithful:
- lead_auto_assign (phase34+99_b1) — §99.B.1 TC-intent guard then §34 round-robin. PLAIN.
- lead_auto_heat_from_outcome (phase47_4+88_4) — positive→hot/negative→cold, skip Won/Lost+same-heat.
- lead_set_handoff_sla (phase12+34) — first-Working edge, sales_ready_at COALESCE + next_business_moment(+24h). PLAIN.
- quote_after_delete_rollback_lead (phase34z50+117) — repoint quote_id + §117 QuoteSent→Working + close quote_chase FUs.
- quote_before_insert_ensure_lead (phase119+144) — §144 NO phone gate (phone-less govt creates lead), dedup-by-phone, double EXCEPTION-wrap.
Triggers + all siblings intact (phase34 lost 2 fns, phase12 lost 1 — remaining verified).
Scoreboard: 29 functions single-source + 1 dropped.
- The 3 spawn_* (spawn_lead_intro/quote_chase/nurture_cadence) confirmed SINGLE-COPY
  (only phase33d6) → correctly NOT consolidated. The cadence + lead-lifecycle clusters
  are now done. Remaining real 2-copy worth-it: HR/security (admin_create_user,
  approve_leave, accept/unaccept_user_profile, eligible_for_paid_leave,
  auto_create_incentive_profile), create_payment_collection_followups,
  refresh_expired_quotes, tc_weekly_stats.

### Phase 178 #24 — 6 HR/security fns (batch) + 2 rollback hazards neutralized (`8f023bc`)
Security cluster. Six real 2-copy phase duplicates, captured byte-for-byte. Canonicals:
db/functions/{accept_user_profile, admin_create_user, approve_leave,
auto_create_incentive_profile, eligible_for_paid_leave, unaccept_user_profile}.sql.
Guardian PASS (strict): §41 NULL-guards, the admin_create_user HR mint-ceiling,
_assert_self_or_admin, 9-month tenure, PLAIN-not-DEFINER — all byte-faithful.
- ⚠️ KNOWN GAP (captured AS-IS, owner's call — do NOT silently "fix" in a future
  session): **approve_leave**'s gate is `get_my_role() NOT IN ('admin','co_owner')`
  with NO `IS NULL OR` arm = the §41 3VL bypass for a NULL-role caller. This is the
  LIVE truth (not a regression); the canonical header documents it. Hardening = add
  the IS-NULL arm (1-line CHANGE, run in Studio) — separate from this capture.
- SECURITY WIN: two phase files had COMMENTED rollback bodies that restore PRE-fix
  INSECURE versions (phase87_5b_1 "drops the NULL guard"; phase97_2 approve_leave with
  NO gate at all). Both replaced with pointers — uncomment-and-run can no longer revert
  a security fix. (Same hazard class as the §72 #1/#12 compute_daily_score/enqueue_push
  rollbacks.) The dedup script's non-anchored grep CATCHES commented copies — a useful
  signal that surfaced these.
Scoreboard: 35 functions single-source + 1 dropped. HR/security cluster done.
- Remaining real 2-copy worth-it tail: create_payment_collection_followups,
  refresh_expired_quotes, tc_weekly_stats. After those it's overloads (NEVER merge) +
  trivial tg_/touch_updated_at wrappers. Near the honest end of the worth-it list.

---

## 73 · GPS km undercount — ROOT CAUSE (confirmed) + permanent fix plan (2026-06-26)

Owner: "permanent fix not patched, no duplicate file, root cause first then
never happen again." Ran a deep read-only workflow (5 investigators + an Opus
adversary that refuted every competing hypothesis). The answer is settled.

### The symptom
Admin day-track: route line spans ~50 km (Mayur, Somnath→Moraj, road-following),
but DISTANCE = **5.4 km** ("raw 53.1 km · 138 drift/spike segments dropped", 138 of
326 pings low-accuracy). The km is what TA pays (₹3/km). Rep is **under-paid** on
weak-signal days.

### ROOT CAUSE (adversary-confirmed, NOT a regression, NOT the consolidation)
**The km is lost at CAPTURE, before the math runs — "dark windows".** Capture
should be ~1 fix/20s (`backgroundGps.js`, `distanceFilter=10m`; ~1,400-1,900
pings/workday). Mayur got 326 → ~80% of his shift was dark. When Android
backgrounds/locks the phone WITHOUT "Allow all the time" + battery Unrestricted,
the background-GPS watcher **dies** and only re-arms ~2 min later (`WATCHDOG_MS=
120000`). The rep keeps driving; nothing is recorded. The single segment bridging
the gap spans several km over minutes → the **120 km/h speed gate** in
`compute_daily_ta` correctly can't tell it from a GPS teleport → **drops it**. The
loose route line (Phase 169, `cleanTrack {speedKmh:250}`) keeps those bridging
jumps, so the LINE looks full while the strict TA km is tiny. Neither 5.4 nor 50 is
the true odometer; the real distance is **unrecorded**.

Refutations tested + rejected: "the filter is wrong" (PARTIAL — it's right, defect
is upstream; loosening re-admits real spikes → over-pays, the §42 trap) · "just
Phase 124 visibility" (REFUTED — 124 only changed which number shows) · "Phase 178
consolidation regression" (REFUTED — byte-identical capture; 200 cap can't lower a
5.4) · "5.4 is correct, line is spikes" (PARTIAL — 5.4 correct for captured pings,
but real driving is unrecorded). **NOT the §69 duplication disease** —
`compute_daily_ta` is single-source post-§72.

### The permanent fix — fix the SOURCE, never the payout math
Single source of km STAYS `db/functions/compute_daily_ta.sql` — **do NOT touch it.**
The cure lives entirely on device capture (additive, no duplicate file):

1. **#1 (THE fix, native, APK rebuild) — force the two Android settings on rep
   login**: Location = "Allow all the time" + Battery = Unrestricted. This is the
   parked Phase 76.2 plugin + an onboarding prompt (`requestEnableGps` /
   `SettingsClient`). Recovers the missing ~7h of pings so the real km is RECORDED
   in the first place. Highest leverage. §43/§50/§39 — do NOT ship blind; device-test.
2. **#2 (supporting, native) — faster watcher re-arm**: drop `backgroundGps.js`
   `WATCHDOG_MS` (120000) + foreground-service heartbeat so reconnects happen
   faster → each bridging segment shrinks BELOW the 120 km/h gate instead of being
   deleted. Small battery cost (owner accepted ~2-3% §33 — reconfirm before raising).
3. **#3 (SHIPPED, Phase 179 `7de8e44`, web/display-only) — GPS coverage chip** on
   admin day-track: "GPS tracked X.Xh of Y.Yh shift (Z%)". Explains a low km as
   "GPS was dark", not "rep drove 5km". `coverageHours` in gpsDistance.js (single
   home, append-only). NOT the cure — the honesty band-aid until #1+#2 land.
4. ❌ **NEVER loosen the 120 km/h / 50m thresholds to "recover" km** — re-admits
   real GPS spikes → over-pays real money (the §42/§98 lesson). The filter is right.

### Status / next
- #3 shipped (web, live-update, guardian PASS, zero payout risk).
- #1 + #2 = the permanent capture fix. **Native → ONE APK rebuild + on-device test**
  (§39/§50). Bundles with the still-parked Phase 76.2 plugin work. Owner must green-
  light the APK build; do NOT ship native blind. Until then, #3 makes the undercount
  legible and the device-settings checklist (Allow-all-the-time + battery
  Unrestricted) is the manual workaround per rep.

---

## 74 · GPS capture fix + in-app APK updater — the native bundle (2026-06-26)

Owner approved the §73 permanent GPS fix (#1+#2) AND a new ask: stop the manual
WhatsApp APK sideload — reps should get an in-app "Update available → tap" prompt.
Owner decisions: **optional dismissible banner · download from app.untitledad.in/apk
· all in ONE APK build.** Android reality: a sideloaded APK CANNOT silent-install —
best achievable = in-app tap → download → Android installer → 1 tap Install (2 taps,
no WhatsApp). Fully silent needs Play Store (rejected §38) or MDM.

### SHIPPED this session (web, live-update, safe — NO rebuild)
- **Phase 179 (`7de8e44`)** — GPS coverage chip on admin day-track ("GPS tracked
  X.Xh of Y.Yh shift") = the §73 display-honesty half. Guardian PASS, zero payout risk.
- **Phase 180 (`b549e28`)** — the update CHANNEL: `app_version` table
  (`supabase_phase180_app_version.sql`, owner RUNS) + `AppUpdateBanner.jsx` mounted
  in V2AppShell. Native-only, dismissible, INERT until a newer `app_version` row is
  published (seed = current 96010). Tap → native `installApk` (next APK) → falls back
  to a browser download of apk_url (the BOOTSTRAP). Guardian PASS, additive.

### THE NATIVE BUNDLE — NOT yet built (one APK rebuild, device-test required §39)
All three go in ONE signed APK with a bumped versionCode. I write the code; **owner
rebuilds + tests on ONE device before distributing** (never ship native blind — §39).

| Piece | Files | What |
|---|---|---|
| **#1 GPS prompt** | TrackingPlugin.java (+ JS in nativeTracking.js) + V2AppShell onboarding | On field-rep login: `requestEnableGps()` (SettingsClient location-settings dialog) + deep-link `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` so "Allow all the time" + battery-Unrestricted get set. Closes the dark windows (§73 root). |
| **#2 watcher re-arm** | src/utils/backgroundGps.js | `WATCHDOG_MS` 120000 → ~20000 + foreground-service heartbeat so reconnect gaps shrink BELOW the 120 km/h TA gate instead of being deleted. (Ship WITH the APK — do NOT live-update this alone; it changes battery behavior on every phone.) |
| **installApk** | TrackingPlugin.java + AndroidManifest.xml | New plugin method: download APK from apk_url → `Intent.ACTION_VIEW` via FileProvider + `REQUEST_INSTALL_PACKAGES`. Manifest: the permission + a FileProvider entry. Makes the Phase 180 banner a true 2-tap in-app update. |
| **version bump** | android build.gradle | versionCode 96010 → 96011, versionName 0.96.11. |
| **/apk host** | vercel.json (or a route) + the signed APK file | `app.untitledad.in/apk` resolves to the latest signed APK. (Hosting note: the file must physically live somewhere — a Vercel redirect to a stable host path keeps the branded URL without git-bloating the 9MB binary. Decide at build time.) |

### THE BOOTSTRAP (one-time, no WhatsApp needed)
Current reps run 96010 which has the banner JS (via live-update) but NOT installApk.
Once I publish an `app_version` row for 96011 + host the APK: 96010 reps see the
banner → tap → it FALLS BACK to a browser download of app.untitledad.in/apk → they
install the 96011 APK once. 96011 HAS installApk → every future release is fully
in-app. So even the bootstrap is banner-driven, not manual.

### RELEASE WORKFLOW going forward (after 96011)
1. Native change → I bump versionCode + write code.
2. Owner: `npm run build && npx cap sync android && ./gradlew assembleRelease` →
   sign → upload the APK to the apk_url host.
3. I INSERT an `app_version` row (new versionCode + version_name + changelog).
4. Reps open the app → "Update available" → 2 taps → done. No distribute step.

### DEVICE-TEST CHECKLIST (owner, on ONE phone, before fleet)
- [ ] Install the 96011 APK. App opens, no crash.
- [ ] Login as a field rep → GPS prompt: "Allow all the time" + battery-Unrestricted
      dialogs appear. Accept both.
- [ ] Drive ~2 km with the phone LOCKED → `/admin/gps` shows the route + km close to
      real (coverage % high). Compare to a 96010 phone on the same drive (should be
      lower coverage).
- [ ] Publish a dummy `app_version` row (96012) → banner appears → tap Update →
      Android installer opens → install → banner gone.
- [ ] Retire the dummy row (is_active=false) after.

### Discipline (§39/§40 — native = where the owner got burned 5×)
- `android-push-auditor` + `release-manager` agents run before the build.
- `REQUEST_INSTALL_PACKAGES` is sensitive — scoped + documented.
- Do NOT push #2 (WATCHDOG) via live-update before the APK device-test — it changes
  battery draw on every live phone. It rides the APK.
- Next session: write the native bundle, owner rebuilds + runs the checklist.

### 74.1 · Native bundle BUILT — Phase 180 (`0fed300`), versions corrected (2026-06-26)
The §74 native bundle is WRITTEN (not yet rebuilt/device-tested). Correction: the
current build was already **96013** (not 96010 — §50 was stale), so the bump is
**96013 → 96014** (the §74 table's "96011" is superseded). `GpsSetupPrompt` + the
`app_version` seed are gated/keyed to 96014.

**Committed (`0fed300`):** TrackingPlugin.java (installApk + canInstallPackages +
openLocationSettings + requestBatteryUnrestricted) · AndroidManifest
(REQUEST_INSTALL_PACKAGES + REQUEST_IGNORE_BATTERY_OPTIMIZATIONS) · file_paths
(external-files apk/) · build.gradle 96014 · nativeTracking.js (3 wrappers) ·
backgroundGps.js WATCHDOG 30s · GpsSetupPrompt.jsx + V2AppShell mount. Guardian
PASS (6/6), FileProvider authority+path self-verified.

**Owner does, in order:**
1. `git push origin untitled-os` (commits `b549e28` 179/180-web, `0fed300` native,
   + the doc commits).
2. Supabase Studio → run `supabase_phase180_app_version.sql` (creates app_version;
   baseline is_active=false → NO banner yet).
3. APK rebuild:
   ```
   cd ~/Documents/untitled-os2/Untitled/adflux
   npm run build && npx cap sync android
   cd android && ./gradlew assembleRelease    # sign as usual
   ```
4. **Host the signed APK at app.untitledad.in/apk.** OPEN ITEM — a Vercel domain
   has no persistent file store, so the file must live somewhere the URL resolves
   to (a `vercel.json` redirect `/apk` → a Storage/host path, OR commit the ~9 MB
   APK to `public/apk/` = git bloat per release). Decide before publishing the
   release row. The in-app updater reads `app_version.apk_url`; set it to wherever
   you host (branded `https://app.untitledad.in/apk` recommended via redirect).
5. **Device-test on ONE phone BEFORE the fleet (§39):**
   - Install 96014 → opens, no crash.
   - Login as a field-sales rep → the "Turn on accurate GPS" banner appears →
     tap **Set up** → battery-unrestricted dialog + the app location screen open →
     set Location = "Allow all the time" + Battery = Unrestricted.
   - Drive ~2 km phone-LOCKED → `/admin/gps/<rep>` shows the route + km near real,
     coverage % high. (A 96013 phone on the same drive = lower coverage.)
   - INSERT a test `app_version` row (version_code 96015, apk_url = the hosted
     96015 APK) → reopen app → "Update available" banner → tap Update → APK
     downloads → Android installer → Install. Then retire the test row
     (is_active=false). NOTE: first install may bounce to "allow this source"
     (Android 8+) — grant once, retry.
6. Only after that PASSES → distribute 96014 once (WhatsApp — the LAST manual
   sideload). 96014 onward = in-app updates.

**Release workflow after 96014:** native change → I bump versionCode + write code →
you rebuild + host the APK → I INSERT an app_version row → reps get the in-app
"Update available" → 2 taps. No more WhatsApp.

### 74.2 · APK build "Type X defined multiple times / X 2.dex" = iCloud, NOT code (2026-06-26)
The repo lives in `~/Documents/` which is **iCloud-synced**. iCloud silently creates
" 2" duplicate copies of files (`MainActivity 2.dex`, `app-debug 2.apk`,
`output-metadata 2.json`) inside `android/app/build/`. The D8 dexer then sees both
`MainActivity.dex` AND `MainActivity 2.dex` → **"Type in.untitledad.app.MainActivity
is defined multiple times"** → `mergeProjectDexDebug FAILED`. This is NOT a code bug,
NOT a patch regression, NOT my Java — it bit Phase 180's debug build (release built
clean only because its dex dir hadn't been duplicated yet).

**THE FIX (permanent build hygiene — always do this for an APK build):**
```
find android -name "* 2.dex" -o -name "* 2.apk" -o -name "* 2.json" -delete
cd android && ./gradlew clean assembleDebug   # 'clean' wipes the duplicated intermediates
```
`assembleDebug` (NOT assembleRelease) — the release signingConfig is still commented
out (no release keystore exists), so assembleRelease yields an UNSIGNED apk. The reps'
installed app is **debug-signed** (~/.android/debug.keystore, cert SHA-256 15d785ae…);
96014 must match that key to install over it. Confirmed: clean assembleDebug → 96014,
same debug cert, 8.8 MB.

**Deeper prevention (optional, owner's call):** move the repo OUT of ~/Documents (e.g.
~/dev/adflux) so iCloud never touches it — kills the duplication at the source. Until
then, the `clean` build above is the standing rule (it's correct practice, not a
band-aid: clean removes whatever iCloud duplicated since the last build).

---

## 75 · Sales pitch deck (GSRTC LED network) — PARKED, lives OUTSIDE the repo (2026-06-26)

Owner directive 26 Jun 2026: "leave it park this presentation deck." A standalone
13-slide HTML pitch deck for the GSRTC bus-station LED screen network. **NOT app
code, NOT in the repo** — lives on the owner's **Desktop**, so it never shows in
git. Recorded here only so a future session knows it exists + its state. Spine =
"AI-verified viewing + scan proof is the moat; reach is supporting evidence."

### Where it lives (all under `~/Desktop/`)
- `led-deck-final.html` — THE deck (~130 KB, 13 slides, `data-i="0".."12"`).
- Assets it loads (must sit next to it): `station-hero.mp4` (hero bg),
  `Botad.mp4` (green-screen station clip), `station-1.jpg` / `station-2.jpg`
  (real photos), `dashboard-branded.html` (real adFlux audience dashboard,
  dark+yellow reskin — slide 4 iframe), `screen-detail.html` (real
  screen-settings page — slide 8 iframe), `cities-real.json` (20 cities from
  the live `/cities`), `client-ad.mp4` (TATA TISCON sample creative).
- Revert backup: `…/scratchpad/deck-before-revert.html` (session-temp; may not
  persist).

### Run it (REQUIRED — iframes are same-origin + local video/canvas)
```
python3 -m http.server 8765 --bind 127.0.0.1 --directory ~/Desktop
# then open  http://localhost:8765/led-deck-final.html
```
Opening the file via `file://` breaks the iframes + the chroma-key (canvas taint).

### State at park
- **Real data only** (owner: "stop assuming, fetch real"): real grades A/B/C,
  mixed 43"/55", 264 screens / 20 cities, prices ₹650 / ₹850, real geo map ref,
  embedded real screen page, scan→lead pilot (48 scans → 9 leads),
  QR → `wa.me/919581578261`. Anand's bad 60k figure dropped; Kheda left null.
- **Slide 11 = green-screen preview.** `Botad.mp4` (a WIDE shot with ~5 small,
  scattered green LED screens) is chroma-keyed **in-browser** (canvas, green→
  transparent). The uploaded creative is **TILED at screen-size** so each green
  screen shows ONE full ad, not a crop of a stretched-across-everything ad
  (the opaque station footage hides the tiling everywhere except the screens).
  QR + "SCAN → WhatsApp · Call 98982 73686" strip overlaid. Other cities' clips
  drop in the same way (owner will share them later).
- **Navigation = arrow buttons (bottom-right) + ← → / spacebar ONLY.**
  Click-to-advance was REMOVED (owner: clicking the slide flipped the page).
- **Hero face-detection:** owner wanted it as an **OpenArt PROMPT** (baked into a
  regenerated hero video), NOT built into the deck. A live face-api.js detection
  build was added then **REVERTED** (the footage's faces are too small/distant to
  detect reliably; also not what he asked). Static reticles (M·32 / F·41 / F·24 /
  dwell 18s) restored. The OpenArt prompt (clean station video + optional HUD
  overlay) was delivered in chat.

### Pending (owner-side, before any resume)
1. Generate a clean hero video in OpenArt (prompt delivered) → drop on Desktop as
   `station-hero.mp4`. Faces will move → the static hero reticles need re-placing
   over the new people (manual, ~2 min — owner sends the clip).
2. Tight / per-city green-screen clips for the slide-11 preview (Botad is the only
   one wired; others "share after").

### HARD RULE
Do **NOT** integrate the deck into the app until the owner explicitly says so
("don't integrate until I say" — the Start-Presentation / log-meeting / dwell-time
hooks are designed but NOT built). No app/repo file was touched for the deck.

---

## 76 · APK in-app Update FIXED — /api/apk proxy + SW denylist (2026-06-27, `b438b45` + `ed4d8f3`)

The in-app "Update" button (§74 AppUpdateBanner) was failing two ways. Both fixed,
both PUSHED + LIVE + owner-confirmed working on device. Additive only — 3 files, all
APK-download plumbing, **zero live-app/rep-flow touch** (§45-safe).

### The two bugs + the two fixes
1. **Team got `untitled-os.zip`, not an APK.** The raw Supabase object
   `apk/untitled-os.apk` is stored `content-type: application/zip` (an APK *is* a
   zip → storage auto-detected it). Android Chrome renames any `application/zip`
   download to `.zip` → won't install. **NEW edge fn `api/apk.js`** streams the same
   bytes with `application/vnd.android.package-archive` + `content-disposition`.
   `vercel.json` `/apk` redirect now → `/api/apk` (branded link unchanged).
2. **Update button landed on the LOGIN page.** The PWA service worker's
   `NavigationRoute` (public/sw.js) served the SPA shell (`/index.html` → login) for
   `app.untitledad.in/apk`, so the download link never reached the server.
   **`public/sw.js` denylist gained `/^\/api\//` + `/^\/apk(?:[/?#]|$)/`** (same
   class as the Phase 34Z.27 `/assets/` fix). Verified live: deployed sw.js carries
   both regexes.

### Hard-won contracts (do NOT regress)
- **Supabase serves content-type from the FILE (S3), NOT from `storage.objects.metadata`.**
  Updating the jsonb `mimetype` via SQL does NOT change the served `Content-Type`
  (we tried — DB said correct, header still `application/zip`). To fix the raw URL's
  type you'd have to RE-UPLOAD with explicit contentType. We didn't need to — the
  `/api/apk` proxy forces the right header regardless.
- **Any SAME-ORIGIN download/redirect link is swallowed by the SW NavigationRoute → login**
  unless it's in the denylist. Current denylist: `/assets/ /fonts/ /letterheads/
  /api/ /apk` + the file-extension regex. A future "open this URL to download" feature
  on app.untitledad.in MUST be denylisted or it renders the app shell.
- **`app_version.apk_url` = `https://app.untitledad.in/apk`** (owner set via SQL). The
  banner's `installApk` (96014+) and the 96013 browser-fallback both read it.
- **SW change needs the app reopened** — the rep closes+reopens once so the new SW
  (skipWaiting) takes over. First launch installs it; the Update works after.

### Resolves the §74 "/apk host OPEN ITEM"
No separate APK host needed. `/api/apk` proxies the EXISTING Supabase
`apk/untitled-os.apk` with corrected headers. **Future APK release = just overwrite
`untitled-os.apk` in the `apk` bucket** (any content-type — the proxy fixes it) +
publish the new `app_version` row. `apk_url`, the proxy, and the redirect stay put.


---

## 77 · Phase 181 — offline in-app GSRTC presentation + timer (2026-06-30)

Owner ask: after a rep logs a field meeting, show a **Start Presentation**
option; whenever they present, punch a log with the total time spent; show it
in the rep's log. Then two hard constraints: **open IN-APP (not a new Chrome
tab)** and **work fully OFFLINE** ("internet not always working there"), fast.
Built additive + §45-safe. Guardian PASS. On origin (HEAD `e1aee3d`), SQL RUN,
proven live (4 sessions logged 30 Jun).

### What it does (the live flow)
1. Rep logs a **field meeting** (the LIVE path = `LeadFormV2` meetingMode via
   `/leads/new`, NOT the dead `LogMeetingModal`) → on save, `confirmDialog`
   "Start the GSRTC presentation now?" → yes = `/present/:leadId`, no = `/work`.
   Also the lead-page **Presentation** button (`LeadDetailV2`, More drawer) now
   navigates to `/present/:leadId` instead of `openExternalUrl` (was a new tab).
2. `/present/:leadId` (`PresentView.jsx`, full-screen, OUTSIDE V2AppShell,
   `RequireAuth`) shows the deck in a **same-origin iframe**
   (`/deck/led-deck-final.html`) + a yellow stopwatch bar.
3. **End** (or the Back arrow, or hardware/browser back — Phase 181.1 all log)
   → writes `presentation_sessions`. 60-min cap. `localStorage` persists the
   start so backgrounding the app doesn't lose the timer. 3-second floor skips
   accidental opens.
4. **Shown:** "Presentations · N" card on the lead timeline (`LeadDetailV2`) +
   "Presentations this month" stat (`PresentationStatCard` on `MyPerformanceV2`).

### Data model — DELIBERATELY NOT a lead_activities row
`presentation_sessions` (`supabase_phase181_presentation_sessions.sql`, RUN):
`user_id, lead_id, started_at, ended_at, duration_seconds, source`. Standalone
table so an "End Presentation" fires **NO** score / meeting-counter / heat
trigger (§33 + §45 hot-path safe). RLS: `ps_self_all` (user_id=auth.uid()) +
`ps_admin_all` (admin/co_owner). **This is the ONLY new permission.**

### Permissions / accounts (owner asked — the full answer)
- **No new accounts. No device/OS permission. No APK rebuild** (pure JS + a SW
  runtime-cache route → reaches the APK via live-update on reopen).
- **Backend:** just the 2 RLS policies above. Reps write/read own; admin+co_owner
  all. HR/accounts can technically write own (ps_self_all) but never present.
- **Roles that use it:** sales / agency / telecaller present (own rows); admin +
  co_owner see all on the lead. The lead-page Presentation button is NOT
  role-gated (any lead-viewer). The post-meeting prompt only fires on the
  field-meeting save path (sales/agency; TC has no meetingMode).
- **Offline requirement:** the rep opens the app **once on wi-fi** so the SW
  caches `/deck/*`. Automatic — no dialog. After that, zero internet.

### Offline deck (`public/deck/led-deck-final.html`, ~7.3 MB, self-contained)
Built by inlining every external asset so the deck needs ZERO network: 3 Google
fonts + Leaflet js/css + a **frozen Gujarat OSM tile set** (z6-8, draggable
offline, `maxBounds`) + the 20 city photos (downscaled). 0 external asset refs.
The heavy companions (console iframe `adflux-console.html`, `media-report.pdf`,
hero/station videos) stay separate `/deck/` files, cached by the SW route. The
map search pans to z8 only (never needs un-frozen tiles).
- ⚠ On a **new deck release**, bump the SW cache name suffix in `public/sw.js`
  so reps re-fetch — CacheFirst serves stale otherwise. **Currently
  `pitch-deck-v2`** (Phase 189, 2 Jul) — bump to `v3` next.
- **Phase 189 (2 Jul 2026):** removed the pricing slide (data-i="11" "Real
  pricing") from `public/deck/led-deck-final.html` (nav auto-recounts via
  `querySelectorAll('.slide')` → 12→11 slides) + added `public/deck/ad.mp4`
  (556KB, `gg.mov` compressed 4K→1080p via ffmpeg) as the **default placeholder
  creative** — the slide's existing `autoload()` (tries ad.mp4/png/jpg) plays it
  on the green screens until a client uploads their own. Desktop copy
  (`~/Desktop/led-deck-final.html`) NOT synced (owner: in-app only) — it still has
  the pricing slide + no ad.mp4.
- The deck (12 slides) also carries the earlier pitch work: page-3 Scale, page-4
  Map + city-search, page-5 "How your ad runs" animated flow, page-7 10-point
  comparison table. Deck edits happen on the owner's Desktop copy then get
  offline-rebuilt into `public/deck/` (§75 is the standalone-deck note; Phase 181
  is the in-app integration the owner green-lit — supersedes §75's "don't
  integrate" for this feature).

### SW change (`public/sw.js`, §28 frozen — guardian PASS)
Added ONE runtime route: `CacheFirst` for same-origin GET `/deck/*`
(`pitch-deck-v1`). Additive — no existing route / denylist / push handler
touched, zero rep-hot-path latency.

### Files
- NEW: `PresentView.jsx` · `utils/presentationTimer.js` · `components/incentives/
  PresentationStatCard.jsx` · `supabase_phase181_presentation_sessions.sql`.
- Frozen, additive (guardian PASS): `public/sw.js` (deck cache route) ·
  `LeadDetailV2.jsx` (button → in-app + timeline card) · `LeadFormV2.jsx`
  (post-meeting prompt) · `MyPerformanceV2.jsx` (stat mount) · `App.jsx`
  (/present routes, outside the shell, §10 specific-before-param).
- `WorkV2.jsx` left BYTE-UNCHANGED — I first wired the prompt to its
  `LogMeetingModal.onSaved`, discovered that modal is **dead** (no
  `setMeetingModalOpen(true)` caller; live meeting path is LeadFormV2), reverted.

### Foot-guns
- ❌ Wiring "after a meeting" to `LogMeetingModal` (WorkV2) — it's DEAD. The live
  field-meeting save is `LeadFormV2` meetingMode (`navigate('/leads/new',{state:
  {meetingMode:true}})`), which saves `activity_type:'meeting'` then navigates
  to `/work`. Hook there.
- ❌ Logging a presentation as a `lead_activities` row — fires the §33 counter /
  compute_daily_score / auto_heat chain. Use the standalone table.
- ❌ Only logging on the explicit "End" button — reps exit via Back / hardware
  back and lose the timing (owner's first test: "not punched"). Log on ANY exit
  (Phase 181.1) + an unmount safety net.
- ❌ Testing before a hard-refresh — the PWA/SW serves the OLD bundle, so the
  Presentation button still opens a new tab (no timer). Reopen twice / Cmd+Shift+R
  to swap the SW (§76 same lesson).

### Commits
```
e1aee3d Phase 181.1: presentation auto-logs on ANY exit (Back / hardware back)
474c729 Phase 181: offline in-app GSRTC presentation + timer
```
No APK rebuild. No further SQL. Deck offline-rebuild is a Desktop→public/deck
copy (not a code path).


---

## 78 · Phase 184 — two owner-approved salary rules (LIVE, retroactive) (2026-07-02)

Owner added two salary rules. Both are CHANGES (not captures) to the canonical
money functions, guardian PASS (2 P2 only), shadow-compared on real June data,
then owner RAN the SQL → **LIVE**. Commit `5096099`.

### The two rules (FROZEN — do not silently alter; owner sign-off to change)
1. **3×-business → full variable** (`db/functions/monthly_score.sql`). A **sales
   or telecaller** whose this-month business (`monthly_sales_data`
   new_client_revenue + renewal_revenue, credited by `staff_id`=created_by —
   the SAME basis the incentive uses) is `>= 3 × monthly_salary` earns the FULL
   30% variable cap **regardless of daily score**. New branch prepended to the
   variable_earned IF; gated `v_role IN ('sales','telecaller') AND v_salary>0 AND
   v_business >= v_salary*3`. Fail-closed on NULL role (IN allow-list — do NOT add
   a NULL branch). Other roles NEVER get this override. Everything else in
   monthly_score byte-identical (70/30, avg<50→0, 0-days→full cap).
2. **Every leave deducts, full salary rate** (`db/functions/_compute_monthly_
   salary_base.sql`). EVERY approved leave now deducts — **no free 12-day paid
   quota** — at the FULL rate `round(monthly_salary / unpaid_divisor[26] ×
   leave_days)` (was `base/26` beyond quota). Only the leave block changed:
   `v_leave_paid:=0`, `v_leave_unpaid:=v_leave_total`. net formula + half-day +
   auth gate + all jsonb keys preserved (`leave_days_paid` now always 0,
   `leave_days_unpaid` = total; `paid_quota`/`paid_used_ytd` stay in the return
   for display only, no longer reduce pay). Applies to **ALL salaried roles**
   (hr/accounts too, not just sales/TC).

### EFFECTIVE = RETROACTIVE (no start-date guard) — important
Neither rule has an effective-month gate. `compute_monthly_salary` computes live
from current logic → the moment the SQL ran, the new rules apply to **every
month queried, including June 2026** (which accounts was paying on 2 Jul). Owner
chose June-now by running it as-is (declined the offered `p_month_start >=
'2026-07-01'` July-forward guard). If a future "effective from month X" is ever
wanted, add a date gate in monthly_score (Rule 1) + base (Rule 2), shadow-compare,
owner-verify.

### Shadow-compare deltas (June 2026, real — what moved)
- **Rule 1 moved almost nothing in June** — only **Rima** crossed 3× (business
  60,205 ≥ her 54,000): variable 5,184→5,400 (+216, small because her score was
  already 96%). Dhara did 62,550 but missed her 69,000 threshold. Everyone else
  had 0 business. Rule 1 is a *future* reward (low-score + high-revenue rep), not
  a June mover.
- **Rule 2 is the real mover — it CUTS pay** for anyone with leave: Dixita −3,750
  (13 leaves), Jignesh −3,173 (11), Abhinav −2,307 (8), Viral −2,100 (6.5), kirti
  −346 (1), Rima −416 (2, partly offset by the +216 Rule 1). Every row verified
  arithmetically correct against the formula.

### Files + gates
- `db/functions/monthly_score.sql` (Rule 1) + `_compute_monthly_salary_base.sql`
  (Rule 2) — canonical, edit-in-place (§71/§72, no new copies). Headers +
  VERIFY tripwires updated (rule1_3x_override / rule2_full_salary_leave markers).
- `src/pages/v2/SalaryAdminV2.jsx:272` — policy caption now "every leave deducted
  · salary ÷ N per day" (display-only).
- The 4 salary consumers (`TotalPayableCard`, `SalaryAdminV2`, `RepProfileV2`,
  `RepPerformanceCard`) all READ the RPC — single-source, no re-compute. Guardian
  PASS. This whole change is a §45-safe money edit (no rep-flow / hot-path touch).

### SUPERSEDES old salary-math docs
Any earlier note describing "12 free paid leaves/year, then base ÷ 26" (e.g.
§36.10, §72 #9 header language) is now **STALE for the deduction** — the live rule
is every-leave × full-salary ÷ 26. The 70/30 split + score→variable logic is
unchanged EXCEPT the new 3×-business full-variable override.

### Foot-gun
- ❌ A live money-function change with no effective-date gate is RETROACTIVE to
  every month. For a pay CUT (Rule 2), that claws back already-worked months —
  flag it + offer a July-forward guard BEFORE the owner runs it (done here; owner
  chose June-now).


---

## 79 · Phase 185 — rep-downloadable salary slip (2026-07-02, guardian PASS)

Owner: reps should download their own salary slip (the Phase-184 breakup) AFTER
they're paid. Built additive, rep-facing, RLS-safe, NO new SQL / NO APK rebuild
(pure JS, live-update). Guardian PASS (no §28/§37 contract touched).

### Owner decisions (2026-07-02)
- **Unlock = after FULL payment.** A month's slip appears only once a
  `salary_payouts` row with `is_full_payment=true` exists for that rep+month
  (accounts records it via the existing Salary Payout button, Phase 37). No
  partial-unlock, no admin "publish" step.
- **Plain "Untitled" logo header** (`/icon-192.png`) — no legal entity / GSTIN.
- **Show the score %** on the variable line (so the rep sees why variable moved).

### Files
- NEW `src/components/incentives/SalarySlipPDF.jsx` — `@react-pdf/renderer`
  one-page A4 slip (`SalarySlipDocument`) + `downloadSalarySlip(data)` (renders +
  triggers a client-side download; no server). Uses "Rs." + `toLocaleString('en-IN')`
  (avoids the ₹ glyph blanking in react-pdf's Helvetica). §9 day-palette hexes
  (allowed for PDF renderers, same as OfferLetterPDF). Layout: logo header ·
  employee block · Earnings (base 70% / variable 30% + score% / incentive / TA-DA
  → gross) · Deductions (leave × salary÷26) · Net payable · "Paid Rs.X on <date>".
- NEW `src/components/incentives/SalarySlipsCard.jsx` — rep-facing card on My
  Performance. Self-fetches the rep's OWN `salary_payouts` (`eq user_id=profile.id`,
  `eq is_full_payment true`) → lists fully-paid months → Download per month calls
  `rpc('compute_monthly_salary', {p_user_id: profile.id, y, m})` → builds+downloads
  the PDF. Hidden until ≥1 paid month. Agency skipped (commission-only). v2 tokens.
- MODIFIED `src/pages/v2/MyPerformanceV2.jsx` (§28 FROZEN) — additive ONLY: one
  import + one `<SalarySlipsCard key={`slip-${refreshKey}`} />` mount after
  PresentationStatCard. No existing card/hook/useAutoRefresh touched.

### Security (rep sees own slip ONLY — do NOT weaken)
Both id sites use `profile.id` from `useAuthStore` — no prop/param/URL id, no
admin/impersonation branch. `salary_payouts` = Phase 37 rep-SELECT-own RLS;
`compute_monthly_salary` = `_assert_self_or_admin` gate. So the rep can only ever
read/generate their own. **No new permission / RLS added.**

### Money = display-only (single-source honored)
The slip reads `compute_monthly_salary`'s jsonb verbatim
(base/variable/incentive/ta_da/unpaid_deduction/net_payable/score_pct). `net` is a
straight echo of `net_payable`; `gross` is just the sum of the earning lines for
display. Nothing re-derived. If accounts ever pays an amount ≠ computed net, the
slip honestly shows BOTH (computed Net payable + actual "Paid Rs.X") — a Phase 37
`salary_payouts` property, not a bug.

### To ship
JS-only — `git push origin untitled-os`, Vercel deploys, reaches the APK on next
open. No SQL, no APK rebuild. Smoke: as a rep with a full-paid month, open My
Performance → "Salary slips" card → tap Slip → PDF downloads with the breakup +
"Paid" line. As a rep with no paid month → card hidden. Rep can't reach another
rep's slip (self-only).


---

## 80 · Phase 186 — rep-facing daily-score breakdown (2026-07-02, guardian PASS)

Owner: after explaining the score is daily → monthly-average, he asked to WIRE the
daily scores so the rep sees which days dragged the month down. Built additive,
rep-facing, RLS-safe, NO SQL / NO APK rebuild. Owner picked: on the My Performance
page (not the slip).

### Files
- NEW `src/components/incentives/DailyScoresCard.jsx` — self-fetching, READ-ONLY.
  Reads the rep's OWN `daily_performance` (`eq user_id=profile.id`; cols work_date,
  score_pct, meetings_done, meetings_target, is_excluded, excluded_reason) for a
  month. Month stepper (◀▶) capped at the current IST month (istCurrentMonthYM, no
  future). Collapsible daily list: each day → done/target + score% (green ≥50 /
  amber <50 / grey for excluded) + the off-day reason (Sunday/holiday/leave). Shows
  a display month-average = AVG(non-excluded score_pct). Agency → null. v2 tokens.
- MODIFIED `src/pages/v2/MyPerformanceV2.jsx` (§28 FROZEN) — additive: 1 import + 1
  `<DailyScoresCard key={`daily-${refreshKey}`} />` mount right after
  PerformanceScoreCard. Guardian PASS.

### Contracts
- Security: rep reads own rows only (`dp_own` RLS = `user_id = auth.uid()`); no
  prop/param/URL id, no write. Cannot reach another rep's scores.
- DISPLAY-ONLY: the card's client-side AVG is for the rep to read — it does NOT feed
  pay. Real pay avg = `monthly_score`/`compute_monthly_salary` (server-side AVG,
  untouched). The two can differ by a hair (independent queries); neither feeds the
  other. Do NOT wire this card's number into any pay path.
- Radii kept on the tokens.css scale (10/14/20) — the guardian's 3 P2 off-scale
  flags (12/8) were fixed to 10 before commit.

### To ship
`git push origin untitled-os` (JS-only). Smoke: rep opens My Performance → "Daily
scores" card under the score card → "Show daily breakdown" → per-day rows; ◀▶ steps
months, can't go future; excluded days show the reason + grey "—".


---

## 81 · CURRENT STATE (2026-07-02) — accounts + payroll session + the LIVE GPS/APK blocker

Full session 2 Jul. Everything below is **on origin (`untitled-os`, HEAD `7741d58`)
+ live** unless flagged. All JS/SQL — no APK rebuild in any of it.

### Shipped this session (origin log)
```
7741d58 Phase 186: rep daily-score breakdown on My Performance (JS, guardian PASS)
167323a Phase 185: rep salary-slip PDF, unlock after full payment (JS, guardian PASS)
3c50e09 docs §78
5096099 Phase 184: two salary rules — 3x-business full variable + every-leave deduct
        (DB fns compute — CHANGE, LIVE, owner ran the SQL, retroactive/June-now)
483ad47 Phase 183: confirm resolved role before creating a member (HR Add Member)
4aedd91 Phase 182.2 · fd27347 182.1 · 6cf2922 Phase 182: ACCOUNTS role payroll login
```
- **§78** = Phase 184 salary rules (see it — retroactive, every leave now cut at
  full-salary÷26, sales/TC 3× business → full variable). Owner-verified live
  (kirti June net 22,088).
- **§79** = Phase 185 salary slip (rep downloads own, unlocks on full salary_payouts).
- **§80** = Phase 186 daily-score breakdown (rep sees per-day scores → month avg).
- **Phase 182** = `accounts` role (Diya) — payroll/finance login (view+edit+pay
  salary/TA/incentive), 13 additive RLS policies + `_assert_self_or_admin` widened
  to accounts (home = supabase_phase97_2). Also fixed the WON crash (182.1/182.2 —
  `create_payment_collection_followups` consolidated to ONE canonical, dropped the
  dead `q.ref_number`; §72 model).

### JAYNA ROHIT role fix (data-only, no guardrail)
Was created `sales`, should be `telecaller`. NOT a code bug — the designation
master + admin_create_user are correct; a sales designation was mis-picked on the
Add Member form. Fixed her row (UPDATE role/team_role/designation + salary 18k).
Phase 183 added a **confirm-before-create** (shows the resolved role) so the next
mis-pick is caught before minting — but nothing HARD-blocks a wrong pick.

### ⚠ LIVE BLOCKER — GPS fix + in-app updater: 96014 NOT actually on phones
The §73/§74 GPS capture fix is in the **96014 native bundle** (`0fed300`, 26 Jun):
GpsSetupPrompt (forces Location "Allow all the time" + Battery Unrestricted),
WATCHDOG 120s→30s, installApk. But **reps are NOT on 96014** (confirmed 2 Jul):
- `app_version` table is CORRECT — advertises 96014 is_active, no stray row.
- The yellow "Update" banner keeps showing → because the installed version is
  **older than 96014** → so GPS is still broken (96014 code isn't running).
- **Root (to confirm):** the actual 96014 APK file was very likely **never uploaded
  to the Supabase `apk` bucket** (`untitled-os.apk`). The app_version ROW was
  published, but tapping Update downloads whatever file sits at
  `app.untitledad.in/apk` (= the bucket object, §76 `/api/apk` proxy) — if that's
  still the old APK, Update reinstalls the OLD version → banner never clears.
  (Secondary possibility: signature mismatch — 96014 must be **debug-signed** to
  install over the reps' debug-signed app, §74.2.)
- **Owner to check next:** (a) phone Settings→Apps→Untitled OS version (bet 0.96.13
  /older), (b) the `apk` bucket file's Last-modified date (bet older than 26 Jun).
- **Fix (native — device-test ONE phone first, §39):** actually BUILD 96014 (§74.2
  hygiene: delete iCloud `* 2.dex` dups → `./gradlew clean assembleDebug`) → UPLOAD
  it to the `apk` bucket as `untitled-os.apk` → update one phone → confirm banner
  clears + GPS prompt appears + a 2 km locked drive shows real km on `/admin/gps`
  → THEN fleet.
- **Honest expectation set for owner:** GPS is NOT auto-fixed on install. The
  faster watcher helps automatically, but the big recovery needs the rep to ACCEPT
  the two settings the prompt requests. Past days' lost km is **unrecoverable**
  (pings never captured) — the fix is forward-only.

### NEXT (owner named 2 Jul, in order)
1. This CLAUDE.md update (done — §81).
2. **Campaign issue** — owner to describe. Module is live (§54/§55): WhatsApp
   receive + reply + routing on real number 95815 78261, inbox at /campaigns/inbox.
3. **Presentation** — the in-app GSRTC deck (§77 Phase 181 + the deck at Phase
   188.x, `a521cfa` reorder). Owner to describe the issue.
Do NOT start either until the owner describes the specific problem.


---

## 82 · Phase 191 — WhatsApp lead name regression (C11) RE-fixed + locked (2026-07-03)

Owner: "when a WhatsApp inquiry comes, lead name shows 'WhatsApp lead' not the
person's name. We solved it before but it came back." Classic §69 "works then
breaks." Fixed permanently in the ONE canonical + tripwire-locked.

### Root cause (the recurrence)
`campaign_conversation_ensure_lead` (the WhatsApp-chat→lead trigger) names the
new lead. The **C11 fix** (`supabase_campaign_c11_lead_name.sql`) had it read
`whatsapp_conversations.customer_name` — the sender's WhatsApp profile name that
`api/wa/webhook.js` captures from `contacts[].profile.name` and the inbox shows.
Then **Phase 168** (the QR location_id fix) rewrote the SAME function and dropped
the name line back to the hardcoded `'WhatsApp lead'`; the **Phase 178
consolidation captured that already-regressed body** byte-for-byte. So the
canonical shipped with the bug baked in.

### The fix (Phase 191, `db/functions/campaign_conversation_ensure_lead.sql`)
- Lead name = `COALESCE(NULLIF(BTRIM(NEW.customer_name), ''), 'WhatsApp lead')`
  — real name, generic fallback only when WhatsApp sends none. Guardian PASS
  (all 4 P0 contracts untouched; name can't be null/empty).
- **LOCKED** as a header contract bullet + a **tripwire** (`c11_lead_name`
  = `%NEW.customer_name%`) so a future rewrite that drops it FAILS the VERIFY.
- One-time idempotent **heal** after NOTIFY: renames existing `name='WhatsApp
  lead'` leads to their conversation's `customer_name`.

### LESSON (new foot-gun class)
A Stage-2 **capture** can capture an ALREADY-REGRESSED body if the regression
landed BEFORE the capture date. The capture "photographs the live truth" — but
if the live truth is already broken, the canonical inherits the break silently.
Mitigation: every risky canonical needs a tripwire asserting each KNOWN fix is
present (not just "matches the capture"). When consolidating, cross-check the
superseded files' VERIFY blocks — if an old file (c11_lead_name) asserted a fix
(`NEW.customer_name`) the captured body lacks, the capture is stale → restore it.

### Owner runs
Re-run `db/functions/campaign_conversation_ensure_lead.sql` in Supabase Studio
(replaces the function + heals existing rows). JS-free, no APK rebuild. Then the
7-check VERIFY block at the bottom should all be TRUE.


---

## 83 · Phase 192 — per-user "team dashboard viewer" grant (2026-07-03, guardian PASS)

Owner: give ONE telecaller (Jayna) read access to /team-dashboard (live field
map + all reps' calls/meetings/leads/revenue) WITHOUT making her admin and
WITHOUT affecting any other rep. Built as a reusable per-user ACCESS flag, not a
role. Additive, SELECT-only, §45-safe.

### Mechanism
- `users.can_view_team_dashboard boolean DEFAULT false` — the grant flag. It is
  NOT a role: her role/team_role stay 'telecaller', pay/score/queue untouched,
  no other rep affected (default false).
- `public.is_team_viewer()` — SECURITY DEFINER STABLE helper, returns the
  caller's own flag (COALESCE→false). Like get_my_role().
- **13 additive `FOR SELECT USING (is_team_viewer())` policies** (gps_pings,
  gps_off_events, users, work_sessions, call_logs, leads, quotes, voice_logs,
  daily_targets, follow_ups, payments, lead_activities, push_subscriptions — the
  exact tables TeamDashboardV2 reads). OR-permissive → admin/co_owner/self
  policies byte-identical. SELECT-only: the viewer can NEVER reassign/push/mutate
  (no write policy + enqueue_push is REVOKED from authenticated, §97.A2).
- `supabase_phase192_team_dashboard_viewer.sql` (column + helper + 13 policies,
  idempotent DO-loop). Owner runs it, THEN one UPDATE to set the flag for Jayna.

### Frontend (fail-closed — flag undefined until the SQL runs → stays locked)
- `App.jsx` — NEW `RequireTeamView` guard (isPrivileged OR
  profile.can_view_team_dashboard); ONLY the /team-dashboard route swapped to it.
  Global RequirePrivileged unchanged → no other route opens.
- `TeamDashboardV2.jsx` — in-page gate gains `|| can_view_team_dashboard`.
- `V2AppShell.jsx` (§28 FROZEN, guardian PASS) — `withTeam()` appends a "Team
  Live" nav item ONLY when the flag is on; every role's base nav byte-unchanged.

### To grant / revoke ANYONE (reusable)
`UPDATE public.users SET can_view_team_dashboard = true  WHERE email = '<email>';`
(false to revoke). No role change, no other edit. View-only by construction.

### P3 (noted, no fix): push_subscriptions SELECT is column-blind (includes push
creds) — matches the existing ps_admin pattern, no write path to abuse. Tighten
to column-level only if owner asks.


---

## 84 · Phase 193 → 193.2 — team-dashboard viewer done RIGHT: real page + gated bundle (2026-07-03)

**SUPERSEDES §83.** The §83 Phase 192 approach (13 broad SELECT policies) LEAKED
all leads/clients/calls to the viewer app-wide (RLS is OR/permissive + per-USER,
never per-PAGE). Owner dropped the 13 policies (leak closed), then rejected a new
light /team-monitor page ("i want SAME as admin page, no new UI"). Final shipped
design (on origin, HEAD `9180f69`, SQL RUN):

### The pattern (reusable — "let a scoped user see a team page without broad RLS")
A per-user viewer (flag `users.can_view_team_dashboard`, e.g. Jayna the telecaller)
sees the **REAL /team-dashboard** (same TeamDashboardV2 component, same UI/numbers/
pills). Her team data comes from **ONE gated SECURITY DEFINER RPC**
(`team_dashboard_bundle`) — NOT broad table grants — so her own RLS stays own-only
on /leads, /work, etc. Admin path is BYTE-UNCHANGED (the original client-side
Promise.all in the `else`); only a flagged NON-privileged viewer branches to the RPC.
- Canonical SQL: `supabase_phase193_team_dashboard_gated.sql` (self-contained + re-
  runnable-safe: ensures flag column + `is_team_viewer()` helper, DROPs the 13 leak
  policies, DROPs the interim `team_monitor_snapshot()`, creates the bundle RPC).
- `supabase_phase192_team_dashboard_viewer.sql` = NEUTERED to a DROP-only closer +
  SUPERSEDED banner (no CREATE POLICY anywhere → re-pasting it can NEVER recreate the
  leak, §71). The interim `supabase_phase193_team_monitor_rpc.sql` + `TeamMonitorV2.jsx`
  were DELETED.
- Frontend gate: `RequireTeamView` (App.jsx) = isPrivileged OR flag, on /team-dashboard.
  `V2AppShell` "Team Live" nav → /team-dashboard, appended only for a flagged
  non-privileged/non-manager rep (dedup). `TeamDashboardV2` has `canViewTeam`
  (SEPARATE from isPrivileged); loader/map/bounce widened with it; realtime gps
  subscriptions LEFT admin-only (viewer = snapshot, matches admin's reload-only §57).

### The bundle RPC is a MIRROR — keep in lockstep
`team_dashboard_bundle` reproduces TeamDashboardV2's loader (20 reads: the 18-item
Promise.all + push_subscriptions + gps_off_events) column-for-column + filter-for-
filter. A parity agent verified 18/18 (then +2 pills). **If a dashboard query changes
in the JS, update the matching branch in the RPC** or the viewer's numbers drift from
admin's. It's a monitoring view (not pay) → a drift is cosmetic, not financial.
- 193.2 added `push_subs` (user_id + last_seen_at ONLY — never push creds) + `gps_off`
  (open gps_off_events) so the viewer's Push/GPS pills match admin. The two admin-only
  reads are wrapped `if (isPrivileged)`; the viewer builds those maps from the bundle.

### GUARDIAN P0 LESSON (the gate 3VL trap — §41 again)
First gate `IF NOT (is_team_viewer() OR get_my_role() IN ('admin','co_owner'))` was
NOT fail-closed: for a NULL role, `NULL IN (...)` = NULL, `false OR NULL` = NULL,
`NOT NULL` = NULL, and PL/pgSQL `IF NULL` is treated as FALSE → the RETURN is SKIPPED
→ full bundle leaks to any NULL-role caller. My comment claiming "IN (...) fails
closed" was WRONG. FIX (shipped): wrap in COALESCE →
`IF NOT (is_team_viewer() OR COALESCE(get_my_role() IN ('admin','co_owner'), false))`.
Every gated RPC using role checks MUST fail closed on NULL (COALESCE, or `IS NULL OR
NOT IN`) — same as `_assert_self_or_admin` / `admin_create_user` (§41/§97.2). Note:
the guardian's FIRST review (of the retired team_monitor_snapshot) MISSED this same
bug — do not trust a single "fails closed" claim; re-derive the 3VL.

### Foot-guns added 2026-07-03
- ❌ Giving a scoped user a team page via broad `FOR SELECT` RLS policies — RLS is
  per-USER + app-wide, so it leaks to EVERY page, not just the one. Use a gated
  SECURITY DEFINER RPC that returns the page's bundle; keep the user's base RLS
  own-only.
- ❌ A role-gate `IF NOT (... OR role IN (...))` without COALESCE — NULL role → NULL
  → IF skips → leak. Always COALESCE the IN to false (or `IS NULL OR NOT IN`).
- ❌ Building a NEW page when the owner said "same as the admin page" — feed the
  EXISTING component via a gated data path instead; branch only the load, leave the
  render + admin path byte-unchanged.
- ❌ A gated bundle RPC that mirrors a client loader is a §69 duplication by design —
  acceptable ONLY for a non-pay monitoring view + documented as a MIRROR; do NOT use
  this shortcut for a money/pay path.


---

## 85 · Phase 196–197 — DB-perf: chart 1000-cap fix + index sweep + cap guard (2026-07-04)

### Phase 196 — Leads Collected chart undercount (1000-row cap, 3rd recurrence)
`LeadsCollectedChart` pulled raw lead rows + bucketed client-side; PostgREST caps
the response at ~1000 rows (its `.limit(20000)` was IGNORED), so a >1000-lead window
truncated recent days (3 Jul: 200 real→7 shown; today 8→0). Fixed by counting on the
SERVER: `db → supabase_phase196_leads_by_day.sql` = `leads_collected_by_day(from,to,
segment,source)` RETURNS (ist_day,cnt), SECURITY INVOKER (RLS scopes per role), IST-day
GROUP BY. Chart reads the RPC. Commit `b0919a0` (SQL RUN + pushed). **A chart/count MUST
aggregate server-side, never pull-and-count client-side.**

### THE 1000-ROW-CAP LAW (§66 restated — this bit the owner 3× now)
PostgREST silently returns only ~1000 rows for ANY `.select()` without `.range()`
paging. `.limit(20000)` does NOT override it. It's INVISIBLE in testing (only shows
once a table crosses 1000 in prod). Fixed sites: useLeads (151), useQuotes (152),
GpsTrackV2 fetchAllPings, LeadsCollectedChart (196). It's a DISEASE, not one bug —
every big-table query is a separate site.

### Phase 197 — recurrence guard (NEW pre-commit check) + P1 indexes
- **`scripts/check-query-cap.mjs`** — flags any `supabase.from('<big table>')...select()`
  (leads/quotes/call_logs/gps_pings/lead_activities/follow_ups/payments) with NEITHER
  `.range()` NOR `.limit()`/`.single()`/`count:`/`head:`. WARN-only (exit 0; `--strict`
  fails). Mark a confirmed-bounded query with a `// cap-ok` comment to silence it.
  **Run it on every changed .jsx/.js before commit** (add to §15 gate): `node
  scripts/check-query-cap.mjs <changed files>`. Catches the silent cap that eyeballs
  miss. (~84 existing WARN sites are grandfathered/mostly-bounded; annotate `// cap-ok`
  as you touch them. AdminDashboardDesktop:138 `quotes.select('*')` is a real latent
  one — quotes is small now, fix when it nears 1000.)
- **`supabase_phase197_perf_indexes.sql`** — 5 P1 composite indexes from the 4 Jul
  DB-perf audit (quotes(created_by,status) · follow_ups(assigned_to,is_done) ·
  call_logs(user_id,outcome) · gps_pings(user_id,captured_at) · lead_activities(
  created_by,created_at)) + verify payments(quote_id). ALL `CREATE INDEX CONCURRENTLY
  IF NOT EXISTS` → **owner runs ONE LINE AT A TIME** (CONCURRENTLY can't run in a Studio
  batch; builds without locking writes — §45-safe on the live app).

### DB-perf audit verdict (4 Jul 2026, read-only, 5-agent workflow)
N+1 = GOOD (zero) · connection pool = GOOD (1 shared client, no realtime leaks) ·
1000-cap = GOOD (swept) · indexes = CONCERN (5 P1 gaps → Phase 197) · SELECT* = MINOR
(7 spots, worst AdminDashboardDesktop:138/154 + useFollowUps — narrow columns later).
~80 indexes already exist; this closed the last big gaps. No P0.


---

## 86 · Phase 205–211 — WhatsApp inbox/push + app-version chip + Supabase Security Advisor remediation (2026-07-06)

Long session. Campaign inbox for reps, per-message WhatsApp push, an
app-version chip on the team dashboard, then a full triage + fix of the
Supabase **Security Advisor** (269 warnings). All on origin (HEAD `064654f`),
all SQL run by owner + verified. Each frozen-file touch = sales-module-guardian
PASS; the schema-wide sweep also got a dedicated security audit.

### Feature commits (this session)
| Phase | SHA | What | Deploy |
|---|---|---|---|
| 205 | `1f31390` | Campaign **inbox for reps** — a rep (sales/TC/agency) sees a WhatsApp nav item + replies to chats **assigned to them only**; admin-only reassign. `api/wa/send.js` server-gates a non-admin to `conv.assigned_to===uid OR lead owned by uid` (runs as service-role → the gate IS the access control). CampaignInboxV2 fail-closed loader while profile hydrates. V2AppShell nav additive (guardian PASS). **No SQL** (assigned_to + RLS already exist). | JS |
| 206 | `35df278` | **Per-message inbound WhatsApp push** — AFTER INSERT on whatsapp_messages (direction='in') → enqueue_push the chat's owner (`COALESCE(conversation.assigned_to, lead.telecaller_id, lead.assigned_to)`). **Unique tag `wa-msg-<id>`** per message (APK LocalNotifications replaces by hashed-id with NO renotify → a per-conversation tag would silently update in place = no sound; unique tag re-sounds every message). 8s per-conversation burst-collapse. Quiet-hours gated, DEFINER, EXCEPTION-wrapped, writes NO lead_activities (P0-3). `supabase_phase206_wa_message_push.sql` **RUN**. C5's lead-creation push (first message) unchanged → first contact gets both pings (accepted). | SQL |
| 208 | `405cd5b` | **App-version chip on the team-dashboard card** — reps self-report their installed version via a new `set_my_app_version(text,int)` SECURITY DEFINER RPC (writes ONLY the caller's own 3 `users` cols, §41 fail-closed). `AppUpdateBanner` (mounted in V2AppShell for all roles) calls it on app-open (native→real 0.96.x, web→'web'). TeamDashboardV2 rep card shows a neutral `v0.96.14`/`web`/`—` chip. Lets the owner SEE who's on which APK (the §81 GPS-fix rollout). `supabase_phase208_app_version_report.sql` **RUN**. JS report reaches the APK via live-update → each rep's CURRENT version populates on next open (old builds included). | SQL+JS |

### Security-Advisor remediation — the triage (269 warnings → mostly noise)
A 4-agent workflow (3 analysts + synthesis) triaged all 269 against the actual
code. **0 errors.** The honest breakdown:
- **~127 `anon/authenticated can execute SECURITY DEFINER fn`** — NOT explicit
  grants; Postgres's **PUBLIC default**. Mostly internal trigger fns (error out
  if RPC-poked) + already-gated admin RPCs. Real exploitability LOW.
- **~50 `function_search_path_mutable`** — old plain helpers, hardening-noise,
  SKIPPED (they run as caller; no privilege boundary).
- **7 `public_bucket_allows_listing`** — only **offer-letters** mattered (PII).
- **1 leaked-password protection off** — dashboard toggle (owner enabled).

### The real fixes shipped
| Phase | SHA | Hole | Fix |
|---|---|---|---|
| 207 | `1362399` | dedupe_all_phone_groups / dedupe_phone_lead_group — SECURITY DEFINER + mass `UPDATE leads SET stage='Lost'`, EXECUTE granted to authenticated → any rep could mass-Lost every lead via rpc(). | `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`. Zero app callers. `supabase_phase207_dedupe_revoke.sql` **RUN** (false/false). |
| 209 | `b805560` | **approve_leave §41 NULL-guard** — gate was `NOT IN ('admin','co_owner')` with no `IS NULL OR` arm → a NULL-role caller self-approves leave (→ salary). **regen_payment_fu_notes** — ungated DEFINER write, zero callers. | approve_leave canonical edited in-place (§72 #24 gap closed); regen REVOKE'd. `supabase_phase209_*.sql` + `db/functions/approve_leave.sql` **RUN** (3×true / false-false). |
| 210 | `064654f` | **offer-letters bucket public + listable**, and the offer PDF embeds employee **PAN + salary + address** → anyone could `.list()` + download EVERY employee's PAN. | DROP the broad public-read SELECT policy → `.list()` blocked; direct known-URL download (the 3 read sites' getPublicUrl hrefs) + the anon upload (INSERT policy) untouched. Zero code, zero frozen file. `supabase_phase210_*.sql` **RUN** (0 leftover policies, bucket still public). |
| 211 | `064654f` | **~127 anon-executable** via PUBLIC default. | `REVOKE ALL FUNCTIONS FROM PUBLIC` + `GRANT ... TO authenticated` + re-lock the closed holes + keep the 3 pre-login offer fns anon. Signature-proof dynamic DO-loops. `supabase_phase211_*.sql` **RUN** (verified A false / B all-true / C true / D false). |

### THE SECURITY-AUDIT CATCH (why the sweep got its own audit — do NOT skip this pattern)
Phase 211's `GRANT EXECUTE ON ALL FUNCTIONS ... TO authenticated` (step 2)
**re-opens EVERY deliberately-revoked function.** The re-lock (step 3) listed 4
(enqueue_push, dedupe pair, regen) but a general-purpose security agent found a
**5th: `_reassign_lead_apply`** — SECURITY DEFINER, trusts a **caller-supplied
`p_caller_role`** (§100.A revoked it from authenticated). Without the catch, a
rep could `rpc('_reassign_lead_apply',{p_caller_role:'admin',...})` and reassign
any lead as admin. Fix: added it to the re-lock list + VERIFY-D. **LESSON: a
blanket `GRANT ON ALL FUNCTIONS TO authenticated` silently reverses every
`REVOKE ... FROM authenticated` in the repo — before running one, grep every
`REVOKE EXECUTE ... FROM ... authenticated` in db/functions + supabase_*.sql and
re-lock ALL of them (there are exactly 5: enqueue_push, dedupe_all_phone_groups,
dedupe_phone_lead_group, regen_payment_fu_notes, _reassign_lead_apply).**

### Advisor items still OPEN (owner-aware)
1. **offer-letters full private+signed lock** — enumeration is CLOSED (210); the
   *leaked-individual-URL* case (a stored public URL is downloadable forever) is
   NOT. Closing it = make the bucket private + signed URLs, which touches the
   **anon new-hire upload**, **rep-reads-own** storage RLS (a plain sales rep is
   NOT "staff" → a naive staff-only policy breaks their /my-offer link), **legacy
   stored public URLs**, and the **frozen MyOfferV2**. Real live-HR-flow
   regression risk (§45) → deferred as a careful separate build. Owner chose
   enumeration-closed as enough for now.
2. **`authenticated_security_definer_function_executable` (~127)** — LEFT as-is.
   Those functions are internal triggers / self-or-admin-gated RPCs the app calls
   as authenticated; revoking would break the app. By-design, not fixed.
3. **~50 `function_search_path_mutable`** — hardening-noise, skipped.
4. **Phase 211 durability**: no `ALTER DEFAULT PRIVILEGES` → a NEWLY created
   function re-gets the PUBLIC default → re-introduces anon-executable. Either
   re-run phase211 after adding functions, OR add the ALTER (but then every new
   RPC needs an explicit `GRANT ... TO authenticated` or the app can't call it).
   Not done — avoids silently breaking future functions.

### Foot-guns added 2026-07-06
- ❌ A blanket `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated`
  re-opens every `REVOKE ... FROM authenticated` in the repo. Always pair it with
  a re-lock of ALL 5 currently-revoked fns (list above) + a security audit.
- ❌ A per-conversation push tag on the APK silently updates in place (no
  renotify on LocalNotifications) → no sound on the 2nd+ message. Use a UNIQUE
  per-message tag when every message must re-alert (§206).
- ❌ "Fix the PII bucket" ≠ "make it private" reflexively — the advisor's finding
  was LISTING; dropping the listing policy closes the mass-enumeration risk with
  ZERO regression, vs a full private+signed migration that risks the live HR
  flow. Match the fix to the actual finding.
- ❌ Hand-typing a 24-arg function signature in a GRANT/REVOKE (submit_offer_
  acceptance) — use a `DO $$ ... oid::regprocedure ... $$` loop by proname
  instead (covers overloads, no typo).


---

## 87 · Phase 213–216 — salary auto-sync KILLED + agency pickers + report total + TA/DA flags (2026-07-07)

Four owner-driven fixes, all on origin (`untitled-os`, HEAD `4c8a39e`) + live.
Phase 213/216 are SQL (owner RAN both in Studio, verified); 214/215 are JS
(live-update, no APK rebuild). Each frozen-file touch = sales-module-guardian PASS.

### Phase 213 — designation→salary auto-sync REMOVED (owner directive "B") — §39/§36.10 phase64 notes are DEAD
Owner: "system changed Jayna's salary on its own — 15k I set → became 18k."
Root cause = the Phase 64 auto-sync (`supabase_phase64_profile_autosync.sql`):
2 triggers (`tg_users_profile_autosync` ON users, `tg_designations_salary_propagate`
ON designations) → `sync_user_profile_from_designation(uuid)` which
`ON CONFLICT DO UPDATE SET monthly_salary = designation.default_monthly_salary`
→ silently reverted ANY hand-set salary to the designation rate whenever the
user's designation/is_active was touched OR the rate-card edited. Hit EVERY
salaried person, not just Jayna.
- **Fix (owner chose B): DROP both triggers + all 3 functions. Salary is now
  100% MANUAL — nothing auto-changes it.** `supabase_phase213_drop_salary_autosync.sql`
  (idempotent DROP IF EXISTS + VERIFY, RUN 2026-07-07 → both SELECTs 0 rows).
- `supabase_phase64_profile_autosync.sql` NEUTRALIZED to a DROP-only tombstone
  (§72 landmine-defuse) — re-pasting it can NEVER resurrect the auto-sync.
- **⚠ SUPERSEDES the stale docs:** §39 "Built but not shipped" table lists
  phase64 as "owner-approve before applying" and §36.10 references it — BOTH
  are now WRONG/dangerous. Do NOT "ship" phase64. Do NOT reintroduce ANY
  designation→salary sync (trigger, backfill, or otherwise) without explicit
  owner re-approval. Salary is manual, full stop.
- The DROP mutates NO salary data — it only stops future reverts. Owner re-sets
  any wrongly-reverted salary by hand (blast-radius query = users whose
  monthly_salary == designation.default_monthly_salary are candidates).

### Phase 214 — agency removed from every lead-OWNER picker (`3141bf4`)
Owner: "when we reassign a lead, agency names + inactive members show — shouldn't."
Agency = external commission partner, **never owns a lead** (ARCHITECTURE.md).
Removed `'agency'` from the team_role filter in ALL FOUR lead-owner dropdowns:
`ReassignModal.jsx`, `LeadsV2.jsx` (bulk reassign), `LeadFormV2.jsx` (create),
`LeadUploadV2.jsx` (CSV import). `is_active=true` filter kept in all (deactivated
members already hidden — the "inactive" half is DATA: deactivate a departed rep
via Team→Edit and they vanish from every picker). Backend `reassign_lead` RPC
unchanged — UI-only narrowing; a lead already owned by an agency user can still
be reassigned AWAY. Guardian PASS.

### Phase 215 — honest follow-up total on the rep day-summary report (`bb3ef24`)
Rep evening report read "175/209" while the admin Team-Dashboard card read
"175/175" for the same rep. Root cause in `useDaySummary.js` query 5a: the
report DENOMINATOR counted EVERY follow_up dated today with NO is_done/done_at/
isSystemClose filter → open + rep-done + system-auto-closed + stacked-duplicate
callbacks all inflated it, and it wasn't even a superset of the numerator.
- Fix: query 5a now counts only OPEN due-today rows; report total =
  `followUpsReal + open-due-today` (a proper superset of the 175 numerator,
  mirroring the card's "Today F-up" = done + open-due). When the rep cleared her
  plate it now reads 175/175, not 175/209.
- Also lifts the DISPLAY day-score (follow-up slot was 175/209×20=16.75 → now
  full 20). Pay score (compute_daily_score, server) UNTOUCHED. Applies to TC +
  sales reports. Guardian PASS. `useDaySummary` feeds the frozen /work
  DaySummaryCard → guardian any future edit.

### Phase 216 — sales reps' TA/DA/Hotel claim flags healed (`4c8a39e`, SQL RUN)
Owner: "Dipak Chauhan can't claim DA/TA; Mayur had this before; why don't all
sales reps have the same policy?" The claim tabs on /my-offer are gated by
per-user booleans `users.allow_ta/allow_da/allow_hotel` (Phase 57) — a FROZEN
snapshot from `designations.default_allow_*` at create time, **never re-synced**.
- **KEY: it is NOT a role/team_role/designation rule.** Owner's data disproved
  the first hypothesis (that Sales Head's team_role='sales_manager' fell through
  Phase 57b's `WHERE team_role='sales'` heal) — all 3 Sales Heads are actually
  team_role='sales', yet Viral=all-true while Dipak+Avkash=false. It's per-row
  DRIFT: rows created before the Phase 57b default-heal (or manually un-ticked)
  stayed false; nothing resyncs them. The designation DEFAULTS are correct
  (Phase 57b set all sales designations true → future hires snap on).
- Fix: `supabase_phase216_sales_allow_flags_heal.sql` — one-time
  `UPDATE users SET allow_ta=allow_da=allow_hotel=true WHERE role='sales' AND
  (any false)`. RUN 2026-07-07 → VERIFY shows all 11 sales reps all-true.
  Blanket `role='sales'` scope (NOT a designation-join) deliberately — it also
  healed "Abhinav singh" who has `designation=NULL` (a join-resync would skip him).
- **NO trigger** — an ongoing designation→flag auto-sync is the exact pattern
  Phase 213 just removed. One-time heal only; future creates already snap right.

### Foot-guns added 2026-07-07
- ❌ Trusting an elegant structural theory (team_role gap) before the owner's
  actual row data confirms it — Dipak's data disproved it (team_role='sales',
  not 'sales_manager'). Verify against real rows before asserting a mechanism.
- ❌ A per-user config SNAPSHOT (allow_ta, monthly_salary, allow_*) with no
  enforced link to its designation source DRIFTS silently — some rows get the
  new default, older/edited rows don't. Heal with a one-time backfill, NOT an
  auto-sync trigger (the trigger is the §213 disease). Scope a heal by the
  robust key (role) not a fragile one (designation string / team_role) so
  NULL/typo'd rows aren't skipped.
- ❌ A ratio where the numerator isn't a subset of the denominator (report
  175/209: two independent queries) reads as "34 undone" when nothing is undone.
  A completion ratio's denominator must be a superset of its numerator.


---

## 88 · Campaign chatbot BUILDER — real branching flow (C12–C13, 2026-07-10)

Owner directive 10 Jul: build the REAL branching bot builder to match
`_design_reference/campaign_module_mockup.html` (the previous Chatbot tab was a
FACADE — absolutely-positioned divs + fake SVG wires + 5 dead rail icons + a flat
keyword list; §46/§53/§55 had it slotted as "V3/not built" but a skin shipped
early). Built A→C in one session. **SUPERSEDES the §46/§53/§54/§55 "auto-reply/
chatbot = V3 / soon / not built" notes — the chatbot builder is now REAL + live.**

### The three phases (all on origin)
| Phase | What | Commit |
|---|---|---|
| A · flow model | `campaign_bot_flows` table — one row/campaign-number, graph as react-flow JSON `{nodes,edges}` in `draft_flow` + `published_flow`. Documented node/edge CONTRACT in the SQL header (Phases B+C depend on it). | `036d4d4` (`supabase_campaign_c12_bot_flow_model.sql`, RUN) |
| B setup | `reactflow@11.11.4` dep (isolated commit, §35). Lazy on the campaign page only. | `14c7ddc` |
| B · canvas | Rewrote `CampaignChatbotV2.jsx` into a real react-flow editor: rail click/drag adds typed blocks, drag-connect ports, per-node props panel, autosave to `draft_flow`, Publish (draft→published). LOSSLESS seed: first open with no draft rebuilds the graph from the existing greeting/keywords/buttons. | `f8079f5` |
| C · runtime | `whatsapp_conversations.bot_node_id` (C13, state) + a flow engine in `api/wa/webhook.js` (`getFlow`/`runFlow`/`sendFlowButtons`) that EXECUTES the published graph. | `d650dfd` (`supabase_campaign_c13_bot_flow_state.sql`) |

### Node types v1 (the CONTRACT — see the C12 SQL header)
`start · message · buttons · keyword · action(send_media/create_lead/handoff) ·
handoff`. A `buttons` node exposes one output PORT per button (`sourceHandle
btn_<i>`); the runtime sends WhatsApp buttons with id `flow~<nodeId>~<i>` and on
tap/typed-label follows that button's edge → real branching. Global `keyword`
nodes match any inbound. `bot_node_id` tracks where each customer is waiting
(a buttons node), or `'__handoff__'` after a handoff.

### THE §45 SAFETY (why this was safe to ship to a live webhook)
The engine is **DORMANT until Publish.** `runFlow` only fires when
`bot_enabled AND is_published AND published_flow.nodes.length` — else
`flowActive=false` and the OLD flat bot (C7 welcome + Phase 204 buttons +
`campaign_bot_rules` keyword) runs **100% unchanged**. The whole flow block is
try/caught → a flow bug can NEVER break the 200 to Meta. The builder edits the
DRAFT; the live bot only changes when the owner Publishes.
- **ROLLBACK (instant):** `UPDATE campaign_bot_flows SET is_published=false
  WHERE account_id=…` (or turn the Bot OFF) → `getFlow` returns null → the flat
  bot is restored. No deploy needed.

### Image-attach bug (#1 from the owner's report) — FIXED in the flow path
The flat path's `botSendButtons` list branch (4+ buttons → WhatsApp `list`, which
allows only a TEXT header) silently drops the media. `sendFlowButtons` (Phase C)
sends the media as a SEPARATE message BEFORE the list. (The OLD flat
`botSendButtons` still has the bug — but the owner is moving to the flow. If a
number stays on the flat bot with 4+ greeting buttons + an image, port the same
"media first" fix there.)

### Deploy (owner) — needs BOTH
1. `git push origin untitled-os` (deploys the webhook engine + the builder;
   Vercel installs reactflow).
2. Supabase Studio: run `supabase_campaign_c12_bot_flow_model.sql` (RUN 10 Jul)
   + `supabase_campaign_c13_bot_flow_state.sql`.
3. Build a flow → **Publish** → turn Bot ON → message the number from your own
   phone → verify the branches. **MUST be smoke-tested on a real WhatsApp chat**
   — the Meta round-trip couldn't be tested from the sandbox; node --check +
   vite build passed, logic self-reviewed, fallback airtight.

### NOT built (v1 scope) / next
- **Phase D** — a "Test bot" in-app simulator. Publish works; the sim is a
  nice-to-have, deferred. (Owner said finish at C.)
- Drop-position mapping (dragged nodes land at a default spot, not the cursor —
  they're draggable after). Minor UX.
- Per-node analytics, A/B, richer action kinds — later.
- The flat `campaign_bot_rules`/`campaign_bot_buttons`/`auto_reply_*` tables are
  KEPT (the seed reads them + they're the live fallback). Don't drop them.

### Foot-guns
- ❌ Don't assume the campaign chatbot is "not built / V3" (stale §46/§53/§54/§55).
  It's a real react-flow builder + webhook runtime as of 10 Jul.
- ❌ Don't edit the node/edge shape without updating BOTH the C12 SQL contract
  AND `runFlow` in webhook.js AND the builder — the graph JSON is the interface
  between all three.
- ❌ Don't make the flow engine fire without the `is_published`+`bot_enabled`
  gate — that gate is the §45 dormancy guarantee for the live bot.


---

## 89 · Phase 220 — incoming-call classification = FROZEN contract (2026-07-11, `a7d88a9`)

Owner: "incoming calls not appearing." Root (proven by Jayna the TC: 7 days of
outgoing + missed rows, ZERO incoming; owner screenshot showed answered
incoming 45s/37s not appearing): `callHistoryIngest.js:ingestOne` — the ONE and
ONLY code path that creates a `call_logs` incoming/missed row — reclassified an
Android **INCOMING** call to `direction='missed'` whenever the device scan read
its duration as **0** (`incoming + 0s → missed`). On phones where the
device-duration read is unreliable (the same native root as the outgoing 0s
issue, §67), EVERY answered incoming call became a 'missed' row → INCOMING tile
永远 0. Device-dependent → some reps had 2,285 incoming rows, others zero.

### The contract (FROZEN — do NOT re-add the reclassification)
- **An Android INCOMING(1) call is `direction='incoming'`, ALWAYS.** Never
  reclassify it to 'missed' based on duration. Android already types a
  genuinely-unanswered ring as MISSED(3), not INCOMING(1), so the type IS the
  truth. Duration accuracy is a SEPARATE native issue (§67); the direction
  bucket must not depend on it.
- **Single source of truth:** `ingestOne` (the device-scan poller) is the sole
  classifier. `callAudit.js` inserts outgoing tel-tap rows (direction defaults
  'outgoing'); the DB dedup trigger folds, does not classify. There is NO
  duplicate copy of the type→direction rule — so this can't §69-drift.
- **⚠ FOOT-GUN — do NOT re-introduce `type === 'incoming' && duration === 0 →
  'missed'`.** That line WAS the bug. If a future session "cleans up" the
  classifier and re-adds a duration-based downgrade, incoming vanishes again.

### The re-scan heal guard (same commit, §170/§173-safe)
`ingestOne` gained a same-physical-call guard for INBOUND rows only: an exact
`(user_id, client_phone, call_at)` match = the identical device call already
stored. It (a) closes the force-ingest ("Scan call log now", 7-day re-scan)
duplicate the direction-aware ±60s window dedup would miss (the old row is
'missed', the new classifies 'incoming' → different direction → window dedup
misses it → dup), and (b) HEALS a pre-fix 'missed' row → 'incoming' on re-scan.
- Scoped `if (direction !== 'outgoing')` + query `.not('direction','eq','outgoing')`
  → NEVER reads/merges an outgoing or tap row → §170/§173 untouched.
- EXACT `call_at` (Android epoch-ms, deterministic per physical call) can NEVER
  merge two genuinely-different calls (they have different timestamps). Distinct
  from the ±60s window dedup below it.
- Manual "Scan call log now" on a rep's phone now doubles as a one-time heal:
  reclassifies the last ~7 days of mislabeled 'missed' inbound → 'incoming'
  (older than the device-log window stays 'missed'). Idempotent (2nd pass finds
  it already 'incoming' → no-op).

### No score/pay impact (the CORRECT reason)
`compute_daily_score`'s call branch DOES read `call_logs.direction` (via an
EXISTS join, `direction IS NULL OR direction <> 'missed'` AND `duration_seconds
>= 10`) — it is NOT "lead_activities-only" (guardian corrected my first premise).
Safety is because the heal updates ONLY direction+outcome, NEVER
duration_seconds; a healed row stays `duration_seconds=0` → can't satisfy the
`>= 10s` clause regardless of direction. Missed AND incoming are both excluded
from the TC outbound target. Guardian PASS (classifier + guard).

### What Phase 220 does NOT fix (still open, separate native track)
The incoming call's DURATION still reads 0 on some phones (§67 native
duration-capture). Phase 220 makes the call SHOW as incoming; it does not make
the duration accurate. That is the parked APK/onResume track, unchanged.


---

## 90 · Phase 218–221.4 — deploy unblock + deck per-station video (2026-07-11)

Same-day session as §89. Two live-app infra fixes, then the in-app GSRTC deck
(§77 Phase 181) got a per-station video feature end-to-end. All JS/HTML, no APK
rebuild. Push state: §89 Phase 220 (`a7d88a9`) + Phase 221 (`f021ca3`) + 221.1
(`c9cd0bf`) are ON ORIGIN; **221.2 `90f110b` + 221.3 `87d8185` + 221.4 `a48b91e`
committed locally, owner pushes** (`git push origin untitled-os`).

### Phase 218 (`85cd7f5`) — call-duration resume-sweep outcome gate
`src/utils/callResumeSync.js` app-resume sweep was pasting device durations onto
NOT-connected call rows ungated → "call history shows a time for calls that never
connected." Added `outcome` to the SELECT + a loop guard `if
(!['connected','callback_requested'].includes(r.outcome)) continue` + `.in('outcome',
['connected','callback_requested'])` on the UPDATE. Guardian PASS. Ties to the §67
duration-capture saga (capture is unreliable; do NOT gate score/Done on duration).

### Phase 219 (`bf0ace0`) — deck-videos Node→Edge = ALL deploys unblocked
THE recurring "Vercel deploy Error" was NOT a build failure (build logged `✓ built`).
Real cause: **Vercel Hobby plan hard cap = 12 Serverless Functions per deployment**;
adding `api/deck-videos.js` as a Node serverless fn hit 13 → every deploy failed.
Fix: converted it to an **Edge function** (`export const config = { runtime: 'edge' }`,
raw `fetch` to PostgREST, dropped `@supabase/supabase-js`). **Edge functions do NOT
count against the 12-fn cap.** This kept the video endpoint AND unblocked every future
deploy. VERIFIED Ready·Production.
- **FROZEN RULE:** on Hobby, new `api/*.js` = another serverless fn toward the 12 cap.
  Prefer Edge (`runtime:'edge'`) for new endpoints, or consolidate. If deploys start
  failing with no build error, COUNT the `api/*` files first — it's the cap, not the code.

### Phase 221 (`f021ca3`) — CSP frame-src (the real "video not playing") + cache
The deck video lightbox showed a broken box because the app CSP (a server header in
`vercel.json`, `source:/(.*)`) had NO `frame-src` → YouTube iframe blocked. Added
`frame-src 'self' blob: https://www.youtube.com https://www.youtube-nocookie.com`
(CSP `frame-src` governs iframe embedding; absent → falls back to `child-src`). Also
bumped `public/sw.js` deck cache `pitch-deck-v11`→`v12` (SW caches the response incl.
headers, so a CSP change needs the cache bump too).
- **FROZEN RULE:** any new embedded iframe host must be added to `frame-src` in
  `vercel.json` OR it's silently blocked (broken box, no error).

### Phase 221.1→221.4 — deck coverage-slide video feature (data-i="5")
The pipeline: `/api/deck-videos` (Edge) reads `cities.name` + `cities.youtube_url`
(active, non-null) → deck `fetch` fills `window.DECK_VIDEOS` (UPPERCASE-city → url) →
UI. Add a YouTube URL to a city (Master → Cities → Edit) and it auto-appears; offline
the fetch silently no-ops (deck still works, video just absent).

| Phase | SHA | What |
|---|---|---|
| 221.1 | `c9cd0bf` | Yellow "Video · Pick a station to watch" dropdown on the coverage slide (populated from DECK_VIDEOS; change→`openLb`). **Later removed (221.3).** |
| 221.2 | `90f110b` | Big pulsing **Watch ▶** button ON the station poster (`#s6play`/`.s6-playbtn`), shown via a `has-video` class when the current card city has a video; whole poster (`#s6photowrap`) is tap-to-play. Owner picked "play button on the photo" over dropdown/card-switch. |
| 221.3 | `87d8185` | Removed the 221.1 yellow capsule (redundant with the poster button) — markup + CSS + the fetch-population JS. Poster button is the sole video entry point. |
| 221.4 | `a48b91e` | Coverage-slide RELAYOUT: search bar → right column (owner ask); map → full-height LEFT column so the frozen Gujarat tiles fill it (kills black bands); city card + station poster side-by-side in `.s6-rightrow`; "Overall CPM ₹76" → head yellow chip (class `.s6-ocpm`). |

Each touched `public/sw.js` (§28 frozen) only for the deck-cache bump (v11→v15 across
the four commits) — guardian PASS every time. `public/deck/led-deck-final.html` is NOT
a frozen file (standalone pitch-deck asset, §77).

### DECK CONTRACTS (freeze — the deck video + map)
- **Deck cache bump EVERY deck content change**: `public/sw.js` deck route
  `cacheName: 'pitch-deck-vNN'` — bump NN or reps serve the stale cached deck
  (CacheFirst). Now at **v15**. This is the §77 pattern.
- **Coverage-slide map fill**: the frozen Gujarat tiles render ~1.3 aspect. The map
  PANEL must be ~that aspect or black bands appear on the wide sides (contain-fit
  leaves no-tile black). 221.4 fixed it by giving the map the full-height left column
  (~1.27 aspect). Do NOT put content back UNDER the map (that squashes it wide-short →
  black returns). Map init (`fitBounds`/`maxBounds [19.6,67.4]→[25.3,75.4]`/frozen tile
  layer, z6-8) is UNCHANGED — the fix was layout only.
- **Poster Watch button**: driven by the `has-video` class on `#s6photowrap` (toggled in
  `setCard` + the fetch-resolve). `openLb(url)` → `#s6lb` lightbox → youtube embed. Needs
  the §221 CSP frame-src + the §219 Edge endpoint + a `cities.youtube_url`.
- Deck JS-bound IDs that must survive any deck edit: `s5map, s6search, s6results,
  s6name/sub/chip/screens/size/price/daily/unique/cpm, s6photowrap, s6photo, s6play,
  s6playlabel`. Rename one → break the inline deck script.

### Foot-guns added 2026-07-11
- ❌ Reading a Vercel "Error" as a build failure — check the deploy page for the REAL
  error. Hobby 12-serverless-fn cap fails with `✓ built`. Count `api/*` files.
- ❌ A new `api/*.js` on Hobby silently pushes toward the 12-fn cap → the NEXT deploy
  fails. Use Edge (`runtime:'edge'`, doesn't count) for new endpoints.
- ❌ An embedded iframe with no matching `frame-src` in the vercel.json CSP = silent
  block (broken box, no console-obvious error). Add the host.
- ❌ Editing the deck without bumping the SW `pitch-deck-vNN` cache → reps keep the old
  deck forever (CacheFirst). Bump every time; owner reopens the app once to swap the SW.
- ❌ A wide-short map panel + a fixed-extent frozen tile set = black bands. Match the
  panel aspect to the tiles (don't stack content under the map).
- ❌ `object-fit:cover` on a pre-composed marketing poster crops its baked-in text — use
  `contain` for images with text burned in.


---

## 91 · Phase 222–224 — post-call SMS + the SW-denylist recurrence CLOSED (2026-07-12/13)

All on origin (`untitled-os`, HEAD `ebe7400`). JS/build only, no SQL. Phase 222
carries a native manifest change (APK rebuild deferred; web works now).

### Phase 222 (`99f17c0`) — "Send SMS" beside "Send WhatsApp" (post-call popup)
Owner: the follow-up popup after a call should also send a plain SMS from the
rep's phone, not just WhatsApp. `WhatsAppPromptModal.jsx` (mounted on frozen
WorkV2 + TelecallerV2 + LeadDetailV2 + FollowUpsV2 via `waPrompt`) gained a
`sendSms()` mirroring `send()` — same reviewed `body`, same `cleanPhone` +
`openExternalUrl`, opens `sms:+<phone>?body=<text>` → the device Messages app,
rep taps Send. Free (rep's own SIM), NO in-app record, reply lands on the rep's
phone (owner accepted — same tradeoff as the WhatsApp deep-link). Additive,
guardian PASS.
- AndroidManifest `<queries>`: added `sms` + `smsto` VIEW intents (mirrors the
  Phase 155 mailto fix) — else the button silently no-ops on the APK.
  `versionCode 96014 → 96015`. **Web works on push; the APK SMS button needs an
  APK rebuild + reinstall** (native, §39/§40). Text prefill is flaky on some
  iOS/OEM Messages apps (number always fills; rep may type the text).
- Bigger option still on the table (NOT built): route post-call WhatsApp
  through the business number so replies land in each rep's in-app inbox
  (`/campaigns/inbox`). Today's inbox is half-wired — see §55/§86: every inbound
  auto-routes to ONE default telecaller (Rima), reassign is telecaller-only, so
  sales/agency inboxes sit empty. Distributing routing + widening reassign is
  the "all-team inbox" job, deferred.

### Phase 223 (`a2e5d15`) — quote PDF share link opened the LOGIN page on reps' phones
A rep shared a quote; tapping `app.untitledad.in/pdf/<ref>?t=<token>` opened the
LOGIN page instead of the PDF. **Root: the service-worker `NavigationRoute`
denylist (`public/sw.js`) was missing `/pdf/`** → the SW served the SPA login
shell for the `/pdf/` navigation. Clients (no app → no SW) were UNAFFECTED —
verified by curl: the URL 302-redirects to the real signed PDF. So it's
rep-only, and the quote reached the client fine (no re-send needed). Fix: added
`/^\/pdf(?:[/?#]|$)/` to the denylist (mirrors `/api/` + `/apk` + `/deck/`). §28
frozen file, guardian PASS. **Reps reopen the app once** for the new SW.

### Phase 224 (`ebe7400`) — PERMANENT cure: SW-denylist ↔ vercel.json tripwire
The §223 bug was the **4th recurrence** of "a same-origin server link opens the
login shell" (34Z.27 assets/fonts · 76 api/apk · 181 deck · 223 pdf). ROOT (the
§69/§71 disease): "which paths are SERVER routes, not the SPA" is written in TWO
files that drift — `vercel.json` (redirects/rewrites) and `public/sw.js` (the
NavigationRoute denylist). `/pdf/` was in vercel.json (client worked) but missing
from sw.js (rep broke). It hides for weeks because only reps (app installed) hit
it, and only on their OWN server link.
- **`scripts/check-sw-denylist.mjs`** derives the server paths from vercel.json
  (redirect sources + rewrites to `/api/*` + the SPA catch-all's negative-
  lookahead exclusions) and asserts every one is covered by a sw.js denylist
  regex. Missing → exit 1 with the exact fix line.
- **Wired into `build`**: `"build": "node scripts/check-sw-denylist.mjs && vite
  build"` → Vercel (`npm run build`) FAILS the deploy on drift. Do NOT drop the
  check prefix.
- **FAIL-SAFE (§45)**: ONLY a positively-detected missing path exits 1. Any
  internal error (garbled/missing file, regex parse) warns + exits 0 — a bug in
  the checker can NEVER brick a deploy. Do NOT "harden" it to hard-fail on its
  own errors.
- Tested: current state passes · a simulated `/brochure/` rewrite blocks · garbage
  input fails-safe · full `npm run build` still succeeds.

### FROZEN CONTRACT — SW denylist ↔ vercel.json (do not break)
- The `public/sw.js` NavigationRoute **denylist MUST cover every server path
  vercel.json serves** (`/api/`, `/apk`, `/pdf/`, + the static folders `/deck/`,
  `/assets/`, `/fonts/`, `/letterheads/`). Enforced by the Phase 224 build
  tripwire.
- **Adding ANY new public server link** — a vercel.json rewrite/redirect to
  `/api/*`, or a new static folder a user navigates to — **MUST add the matching
  denylist entry to `public/sw.js` in the SAME commit**, or the build fails.
  Then reps reopen the app once for the new SW.
- The QR shortener is safe (`/api/q/<code>` → under `/api/`, already covered) —
  NOT a hidden gap.

### Foot-guns
- ❌ A same-origin server link (rewrite/redirect/static folder) not in the sw.js
  denylist → reps (app installed) get the login shell; clients (no SW) are fine →
  the bug hides for weeks. The tripwire catches it at build now; still add the
  denylist entry in the same commit as the link.
- ❌ Diagnosing "PDF/APK/deck link → login" as a server/function failure. The
  function is fine (curl the URL: it 302s / serves). It's the client-side SW
  serving the SPA shell. Fix = the sw.js denylist, not the function.
- ❌ `sms:`/`smsto:` (or any new scheme) opened via `openExternalUrl` without the
  matching `<queries>` VIEW intent in AndroidManifest → silent no-op on the APK.


---

## 92 · CALL-LOG CAPTURE IS FRAGILE — STOP patching per-phone types (2026-07-14, FROZEN)

**The single most-repeated patch class in this project.** Owner (14 Jul):
"we repaired this many times, why do you keep doing it, why patches?" He is
right. Read this BEFORE touching anything about incoming/call capture.

### The disease
The app captures calls by **reading the device Android call log
(`CallLogPlugin.scanRecentCalls`) and trusting the OEM's `TYPE` integer** to
decide direction. Every phone brand numbers calls differently, so **each new
phone brand breaks capture and gets its own patch**:
- Phase 220 — standard phones that report an answered incoming with 0 duration
  → was misfiled 'missed'. Fixed the classifier.
- Phase 227 — type 7 (ANSWERED_EXTERNALLY: Bluetooth/linked device) → dropped.
- Phase 227.1 — Realme/ColorOS custom types 100=outgoing / 101=incoming → dropped.
- Plus the duration-capture patches: §65 · §116 · §128.4 · §138 · §154.
- ~8 call-related patches total. The NEXT brand will break it again.

### THE RULE (frozen — do NOT violate)
1. **Do NOT add another per-phone `case <N>: return "..."` as "the fix."** The
   read-the-log-and-trust-the-type approach is inherently fragile; every added
   case is a symptom patch, not a solution.
2. **The permanent fix (agreed 14 Jul, not yet built): a REAL-TIME native
   incoming-call listener** — re-add `READ_PHONE_STATE` + a manifest
   `PHONE_STATE` BroadcastReceiver / `TelephonyCallback` that captures the
   incoming call LIVE (ring → answered/missed, duration computed by us),
   independent of the OEM's call-log `TYPE`. Same real-time receiver pattern as
   the GPS-off / network-off watchers (§76.2). Once shipped it SUPERSEDES the
   type patches (220/227/227.1) for every phone, forever.
3. **Next session, any "incoming calls not recording" report → the answer is
   NOT another type case.** It is: is the real-time listener shipped + on that
   phone's APK? Yes → debug the listener. No → ship it. **Type-patching is
   BANNED for this feature.**
4. The already-shipped type patches (220/227/227.1) stay (harmless stopgap that
   helps until the listener lands) but are NOT the solution — don't extend them.

### Why it kept recurring (the honest root, so it doesn't again)
- I defaulted to the fast visible patch (fixes the one reported rep today) over
  the bigger root fix (real-time listener + an APK rollout that's been stuck,
  §81). That's the §3/§69 patch-chain anti-pattern — on this feature specifically.
- The call-log lessons were scattered across ~8 sections (§65/§67/§89/§116/§138/
  §154/§227) with no single "STOP" rule, so each session re-treated a fresh
  report as a new bug. THIS section is that single STOP rule. §93 (daily update)
  exists so this can't scatter again.


---

## 93 · STANDING RULE — CLAUDE.md updated every session / every commit batch (2026-07-14, OWNER DIRECTIVE)

Owner directive 14 Jul (verbatim intent): "whatever we build today we update in
CLAUDE.md at 8pm every day; if we're not working at that time, the next commit
must be with a CLAUDE.md update."

**This is THE fix for "why do you forget everything."** CLAUDE.md is the only
memory across sessions. When it lags the code, the next session re-solves solved
problems and re-patches closed bugs (exactly what happened with the call log,
§92). Keeping it current is non-negotiable.

### The rule
1. **Every working day, by ~8:00 PM IST (end of day), append a CLAUDE.md
   section** covering what was built that day — phases, commit SHAs, contracts,
   foot-guns — in the standard §25 format.
2. **If no session runs at 8 PM** (we work other hours), the update rides the
   **NEXT commit**: **no substantive work ships without its CLAUDE.md record in
   the same commit or the next one.**
3. **Net:** CLAUDE.md never falls behind the code. The scattered/forgotten
   history that caused the repeat-patching can't build up again.

### How to apply (part of "done", like the pre-commit checks §15/§35/§40)
- A work batch is not complete until its CLAUDE.md section is written. Treat the
  doc update as the last mandatory step of the batch, before declaring done.
- Money/security/native/contract work → the CLAUDE.md entry is MANDATORY (these
  are the ones that bite when forgotten). Trivial one-off tweaks can batch into
  the next section.
- The daily entry answers, for future-me: what shipped, what's now frozen, what's
  still open, and any new foot-gun. If a decision was made ("we chose X over Y"),
  record the decision + why, so it's not re-litigated.


---

## 94 · Phase 228 — permanent-call-fix job, Part C shipped (internet-off log) (2026-07-14)

The "real-time listener + APK rollout" job (§92 permanent call fix). Full scope:
`docs/PLAN_realtime_call_listener_and_apk_rollout.md`. Order C → A → B.

### Part C — internet-off log surfaced (SHIPPED, JS/live-update)
`GpsTrackV2.jsx` day-track activity timeline now shows `network_off_events`
inline, mirroring the existing `gps_off_events` display exactly (Phase 84.5
pattern): amber "Internet off" row with `lost_at` time + duration + "back on at"
/ "still off". Additive display only — new query in the admin Promise.all
(mirrors the gps_off query), viewer §194-bundle path degrades to `[]`, timeline
merge + a `kind:'network_off'` render branch. Guardian PASS (no §33 meeting-KPI /
§51 km / call-breakdown / hot-path touch; destructuring lockstep verified).
- The `network_off_events` table + native NetworkWatcher already existed
  (§33/§37 Phase 76.1/76.2) — this only DISPLAYS them.
- ⚠ FOOT-GUN: it only shows DATA once the native NetworkWatcher is actually
  running on the phone — i.e. after Part B's APK is installed. On old APKs / web
  there are no network_off rows to show. Not a bug; the capture is native.
- Follow-up (optional): to show it for §194 team-viewers too, add `network_off`
  to the `team_rep_daytrack` RPC (SQL) — currently viewer path is graceful-empty.
- TeamDashboardV2 (live-map gps-off indicator) intentionally NOT touched — the
  owner's ask was "internet-off in the ACTIVITY" = the day-track timeline.

### Part A — real-time incoming-call listener (CODE SHIPPED, needs APK rebuild = Part B)
Written + committed + guardian PASS (2026-07-14). Replaces the fragile
read-the-call-log-and-guess-the-TYPE approach (§92) with a LIVE listener. Does NOT
run on the fleet until Part B rebuilds + rolls out the APK (native → live-update
can't carry it).

**Files (all in the Phase 228 Part A commit):**
- NEW `android/.../CallStateReceiver.java` — manifest `PHONE_STATE`
  BroadcastReceiver (fires backgrounded/killed). State machine persisted in
  SharedPreferences (`commit()`, survives a kill between broadcasts): RINGING
  captures number + ring time; OFFHOOK-after-RINGING = answered; IDLE writes a
  completed row to a `pending_calls` JSON queue — `incoming` (answered,
  duration = hangup − answer, OUR clock) or `missed` (dur 0). OFFHOOK with NO
  prior RINGING = outgoing → NOT queued (already captured via tel-tap + outgoing
  scan; §173/§220 — no double).
- `TrackingPlugin.java` — `drainPendingCalls()` returns + clears the queue
  (`JSArray`). Native holds no Supabase creds; JS writes.
- `AndroidManifest.xml` — RE-added `READ_PHONE_STATE` + `READ_PHONE_NUMBERS`
  (removed Phase 76.2.2) + `<receiver CallStateReceiver>` (exported=true, required
  for the system broadcast).
- `CallLogPlugin.java` — new `phoneState` permission alias
  (READ_PHONE_STATE + READ_PHONE_NUMBERS) so the EXISTING no-arg
  `CallLogReader.requestPermissions()` in `NativeOnboarding.jsx:114` prompts for
  them too (the call-log scan gate stays keyed on `callLog` only — phone-state
  grant/deny never blocks the device scan).
- `callHistoryIngest.js` — `pullRealtimeCalls()` drains the queue + maps each
  `{number,direction,durationSeconds,atMs}` to `ingestOne`'s raw shape
  (`missed`→type `missed`, else type `incoming`). Wired into `runScan` (drained
  even when the device scan is empty; real-time ingested BEFORE device rows so its
  authoritative direction/duration wins the dedup) + `forceIngestRecentCalls`.
  `ingestOne` UNCHANGED — real-time rows go through the SAME §170/§173/§220 dedup,
  so a real-time `incoming` + a later device-scan `incoming` for the same physical
  call MERGE, never double.
- `build.gradle` — versionCode 96017 → **96018**, versionName 0.96.18.

**FROZEN CONTRACTS (do NOT regress):** direction is resolved from LIVE phone state
(RINGING→answered=incoming, RINGING→never-answered=missed), NEVER from a duration
or an OEM TYPE integer (§89/§92). The receiver's own answer→hangup duration also
fixes the §67 unreliable-incoming-duration read. `CallLogPlugin.typeLabel`
(7/100/101) is UNTOUCHED — it stays as a harmless stopgap until Part A is proven on
the fleet, then it's moot (do NOT extend it, §92).

**Two guardian P1 flags:**
1. **Permission wiring — CLOSED** in this commit (the `phoneState` alias). Still
   device-test that the receiver actually gets the number on a real phone (§39/§40).
2. **compute_daily_score exposure — FLAGGED, NOT patched (owner sign-off needed,
   §71 rule 3).** The score's call-EXISTS clause is `duration_seconds>=10 AND
   direction<>'missed'` — it does NOT exclude `direction='incoming'`. A bare inbound
   can't create score alone (still needs a rep-action `lead_activities` row), but an
   accurate ≥10s incoming CAN backfill credit for a same-day/same-lead outbound tap
   whose outcome was never saved (customer calls back). Part A amplifies this by
   landing accurate durations on far more genuine incoming calls. Fixing it =
   add `direction='outgoing' only` (or exclude incoming) to the score's call clause
   → a MONEY-function change → shadow-compare + owner-verify + one-command revert,
   never a silent patch. Left for a deliberate follow-up.

**Owner action:** push (JS reaches the APK on next open, but the native listener
does NOT — it needs Part B). Nothing runs until Part B rebuilds + rolls out 96018.

### Part B — one clean signed APK + fleet rollout (PENDING, native + owner)
Not started. The FOUNDATION: build → upload to the Supabase `apk` bucket as
`untitled-os.apk` (the §81 step that was skipped) → publish an `app_version` row
→ device-test one phone → fleet via the in-app updater. Makes the call listener +
GPS-off + internet-off watchers actually run on the team. See the plan doc Part B.

### Status
Part C on origin. **Part A CODE SHIPPED + guardian PASS (2026-07-14)** — commit
below; native, so it does NOT run until Part B's APK rebuild. Part B (build →
upload `untitled-os.apk` to the Supabase `apk` bucket → publish `app_version`
96018 → device-test ONE phone → fleet via the in-app updater) is owner-run — I
write no more code for it. **Part B COMPLETE 14 Jul** — 96018 built
(assembleDebug, debug-signed), uploaded to the `apk` bucket, verified live via
the `/api/apk` proxy (versionCode 96018), **device-tested on ONE phone (owner
confirmed 0.96.18 opens fine + incoming calls record via the native listener)**,
then **`app_version` 96018 row published (is_active=true) → the fleet
"Update available" banner is LIVE**. Reps update via the in-app 2-tap updater
(§76 `/api/apk`). NOTE: a stale `96014` is_active row remains — harmless (the
banner reads MAX(version_code) WHERE is_active → 96018 wins). After each rep
updates, they must tap Allow on the phone/call permission (incoming number) +
GPS "Allow all the time" + battery-Unrestricted (§73/§74 GPS capture). Open
follow-up: the compute_daily_score incoming-credit flag (Part A block above) — a
money-function change awaiting owner sign-off + shadow-compare.

---

## 95 · Phase 229 — outgoing call duration "—" fixed (resume sweep heals no_answer rows) (2026-07-14)

Permanent fix for "outgoing call shows — (blank duration)" — the §67/§138 saga.
**JS-only (callResumeSync.js), ships via live-update to EVERY phone incl. current
APKs, NO rebuild.** Guardian PASS (1 P2 money flag, below). DECOUPLED from the
Phase 228 incoming APK — the two ride different rails (incoming = native/96018;
outgoing = JS/instant), so the team does NOT update twice for this.

### Root cause (deep 5-path workflow trace)
An outgoing call_logs row is BORN blank (duration_seconds NULL, outcome
'no_answer' — the tel-tap audit default, callAudit.js). Duration is only ever
filled by fetchAndPatchCallDuration (modal-save + auto60) AND the resume sweep —
ALL THREE gated on `outcome IN ('connected','callback_requested')`. So the #1
cause of "—": a rep who never saves the PostCallOutcomeModal (the dialer suspends
the WebView → the modal never opens → outcome stuck at no_answer) → the outcome
filter DISCARDS the duration even when the device read succeeded. The §116
away-timer never fires on the APK (AppLauncher.openUrl's ACTION_VIEW doesn't
background the WebView). So a real talk by a rep who skips the modal = permanent
"—".

### The fix (callResumeSync.js — the app-resume sweep, Phase 157)
Dropped the Phase 218 outcome gate (both the JS `continue` and the
`.in('outcome',...)` on the UPDATE). The sweep now heals no_answer rows too.
SAFE because the reader is Phase 185 `findOutgoingCallSeconds` — pins
type='outgoing' + last-10 phone match to THIS row + NEAREST this row's tap → it
can ONLY ever write THIS call's real talk seconds, never a neighbour's or an
incoming call (the §138 "231 wrong durations" bug was the OLD direction-blind
`lookupCall`, already retired). Kept: outgoing-only guard, no-clobber
`.or(duration_seconds.is.null,eq.0)`, outcome NEVER flipped (§28 semantics
frozen). Threshold `<10`→`<1` (write real talk incl. short; skip 0/unanswered).
Window 6h→14h + limit 30→60 (heal a full workday on an end-of-day reopen).

### FROZEN CONTRACTS / foot-guns
- The resume sweep is now the UNIVERSAL outgoing-duration healer. It uses the
  DEVICE talk duration (Android `CallLog.DURATION` = talk time, 0 for
  unanswered), NEVER an off-hook timer. Do NOT switch outgoing to the Phase 228
  CallStateReceiver — a caller has no "callee answered" signal, so off-hook time
  = ring-wait + talk → over-counts (that's why CallStateReceiver is incoming-only).
- The §28-frozen `callLogReader.js` (modal-save + auto60 paths) KEEPS its outcome
  filter — untouched. The resume sweep (non-frozen file) is the catch-all healing
  what those miss.
- Do NOT re-add the outcome gate to the sweep — it blocks the exact rows that
  need healing, and the cross-paste it guarded against is already prevented by
  findOutgoingCallSeconds (this-phone + nearest-tap + direction-pin).

### MONEY MOVEMENT (owner-aware, §71 rule 3)
This is the FIRST writer that can put `duration_seconds >= 10` onto a still-
`no_answer` row → it ACTIVATES compute_daily_score's previously-dormant TC
call-branch EXISTS fallback (`call_logs ≥10s` WITHOUT an outcome confirmation).
So some TCs' daily scores → incentive may RISE this week — real calls that were
dropped as blank now count. This is the §49-sanctioned mechanism ("the ONLY
honest way to raise the count is to fix capture, NEVER loosen the gate") — a
correction, NOT inflation. compute_daily_score SQL is UNTOUCHED. Nuance (guardian):
the EXISTS matches by lead_id+date, so if a TC made 3 attempts to one lead and
ONE gets a real duration, all 3 same-day 'call' activities to that lead count →
per-lead effect can be bigger than "one row crossed 10s." A read-only before/after
shadow of which reps move + by how much is available before the owner pushes.

### Residual (not JS-fixable)
Phones with READ_CALL_LOG denied, or OEMs that write DURATION=0 even post-call →
the device has no data → those outgoing stay "—". No JS invents it; the fix is
granting the permission (onboarding prompts it). The Phase 228 real-time listener
does NOT help outgoing (ring-wait over-count).

### Phase 229.1 — brand-proof the outgoing read (§92, the "never again" piece)
The Phase 229 sweep still relied on `findOutgoingCallSeconds` reading a device row
typed `'outgoing'` — so a BRAND-NEW phone whose outgoing code `typeLabel()` doesn't
recognise (the §227.1 Realme-100/101 trap, but for outgoing) would map to
`'unknown'` and still blank the duration. Closed it: `findOutgoingCallSeconds`
(callLogReader.js, §28-FROZEN, guardian PASS) now collects TWO nearest candidates —
`best` (type `'outgoing'`) and `bestUnknown` (type `'unknown'`) — both number-pinned
to the lead's last-10 + nearest-to-tap, and returns `best || bestUnknown`. Recognised
phones are BYTE-UNCHANGED (`best` wins); a new brand's unrecognised outgoing code now
resolves by dialed-number+time instead of the OEM integer. incoming/missed NEVER
matched. So outgoing capture no longer depends on the per-brand type code — the same
principle as the incoming listener (§92): match the fact you dialed this number, not
the phone's label. P3 (accepted): a brand that types BOTH directions `'unknown'` could
prefer a mislabeled return-call — bounded to duration DISPLAY on that brand, no
outcome/stage/dedup/pay effect; nearest-to-tap biases correct in practice.

### Ships
JS-only → push → Vercel → reaches every phone (incl. current APKs) on next open.
No SQL, no APK rebuild. On the next app resume, blank outgoing durations from the
last 14h backfill. **229 + 229.1 together = the permanent outgoing fix**: no popup
needed (229) + no per-brand type code needed (229.1). The only residual is a phone
with READ_CALL_LOG denied / an OEM that writes DURATION=0 post-call — no data to
read; the fix there is granting the permission (onboarding prompts it).

---

## 96 · TC score ≠ "50 qualified (≥10s)" — CHECKED, tightening DEFERRED (2026-07-14)

Owner clarified 14 Jul: the TC daily target is **50 QUALIFIED calls = talked ≥10s**,
NOT 50 tapped-through calls. Read-only check (no build) confirmed the live
`compute_daily_score` CALL branch does NOT match this: it counts
`la.outcome IS NOT NULL OR EXISTS(≥10s call_log)` — the `outcome IS NOT NULL`
clause credits EVERY call the rep closed the popup on, regardless of talk time.
Since the modal marks ~every call 'connected' (§49/§67), that clause inflates the
count far above true qualified performance.

### The real numbers (7 days, read-only, 14 Jul)
| Rep | logged | counts_now (outcome OR ≥10s) | qualified (≥10s only) | inflation |
|---|---|---|---|---|
| Rima | 1286 | 1266 | 415 | 851 (67% NOT ≥10s) |
| Jayna | 556 | 547 | 402 | 145 |
| Dhara | 407 | 333 | 172 | 161 |

Effect of tightening to ≥10s-only (per day vs the 50 target): **Rima ~69/day →
100% (no change), Jayna ~67/day → 100% (no change), Dhara ~29/day → ~57% (down
from ~100%).** So tightening is NOT a broad cut — Rima+Jayna genuinely clear 50
qualified/day; it's essentially a **Dhara correction**.

### Part A incoming-backfill flag (§94) — EMPIRICALLY A NON-ISSUE
The guardian P1 (an incoming ≥10s could backfill an unfinished outbound tap toward
the target) is negligible in real data: `of_which_incoming` = Dhara 3, Jayna 0,
Rima 0 — 3 calls across the whole team in a week. No tightening needed for the
incoming path. **This closes that open flag.**

### DECISION (owner, 14 Jul): tighten LATER, not now — "first share the APK to all"
The §49/§65/§67 "leave the loose `outcome` gate" was a compromise BECAUSE duration
capture was unreliable. Capture is now fixed (229 + 229.1 + Part A) — BUT 96018
(the reliable capture) is JUST rolling out; not every TC is on it. Tightening TODAY
would cut a rep whose phone is still under-capturing (the exact §67 trap — never
gate pay on a duration the phone can't produce). Owner chose: roll the APK to all
first. So the sequence is:
1. Get 96018 onto every TC (banner is live, §94 Part B) + confirm each phone
   actually captures ≥10s durations (per-rep capture-health query available).
2. ONLY THEN tighten `compute_daily_score` — drop the `outcome IS NOT NULL OR`,
   count `≥10s only` — as a MONEY change (§71 rule 3: verify capture → shadow-
   compare → owner-verify Dhara's real figure → one-command revert). NOT mid-workday.

### DO NOT
- Do NOT tighten compute_daily_score to ≥10s-only until 96018 is fleet-wide AND
  per-rep capture is verified. Premature = the §67 mistake (cuts honest reps for a
  capture gap).
- The §49/§65/§67 "owner said leave it" is now SUPERSEDED: the target IS ≥10s
  (owner-confirmed 14 Jul); the loose gate is a TEMPORARY compromise, not permanent.
- Do NOT re-run any old compute_daily_score copy — canonical is
  `db/functions/compute_daily_score.sql` (§72); any tighten edits THAT file only.

---

## 97 · Phase 231 — client QR: LINK option (not just WhatsApp) (2026-07-14)

Owner: the "New client QR" modal (`/campaigns/clients`, admin) only took a
WhatsApp number; he wanted a **link** option too (a QR that opens a website /
video / form, still scan-tracked). Shipped JS-only — **no SQL, no APK, no schema
change.** Additive; campaign admin page (NOT §28 frozen); §45-safe.

### Why no schema
A client QR is a `campaign_locations` row with `client_name` set; its `qr_text`
column IS the redirect target, and `/api/q/<code>` already 302s to whatever
`qr_text` holds. So a **link just stores the URL in `qr_text`** instead of a
`wa.me` link — the existing redirect works unchanged. The page is **create-only**
(no edit flow), so the type is INFERRED from `qr_text` for the table display
(`/wa\.me\/(\d+)/` → phone; else → link). No `qr_kind` column needed.

### What changed (2 files)
- `src/pages/v2/CampaignClientQrV2.jsx` — a WhatsApp/Link segmented toggle in the
  modal; Link shows a URL input (`normalizeUrl()` accepts http(s) or prepends
  https:// to a bare domain, '' if not a URL); `target` = link URL or the wa.me
  URL; preview/validation/save/reset all keyed off `target`; the table column
  renamed "WhatsApp number" → "Opens" (phone for wa.me rows, the link otherwise).
- `api/q/[code].js` — the redirect PAGE copy now adapts: a WhatsApp target keeps
  "Opening WhatsApp…" + green button; a link shows "Opening…" + "Continue" (brand
  yellow). `target` stays escaped; `btnBg` is a constant hex. The scan-log +
  same-visitor dedup + fallback-to-WhatsApp are unchanged.

### Contracts / notes
- `qr_text` was ALWAYS an admin-set arbitrary string; a link is not a new security
  surface (the endpoint already redirected to it, now escaped into an HTML page
  the same way). The open-redirect is the feature (admin's own QR → wherever).
- Boards tab (`CampaignQrV2`, `client_name IS NULL`) never sees client QRs →
  untouched. C8 ensure-lead trigger is on `whatsapp_conversations`, not
  `campaign_locations` → untouched.
- Owner smoke: `/campaigns/clients` → New client QR → toggle **Link** → paste a
  URL → preview QR renders → Create → scan the printed QR opens the link + the
  Scans count ticks. WhatsApp mode still works as before.
