# AGENTS.md — Untitled OS / AdFlux Working Rules

This file is loaded at the start of every Codex session in this workspace. **Read it end-to-end before doing anything else.** It captures rules the owner has established across many sprints and that you cannot derive from `git log` or the code.

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
7. `_design_reference/dashboard_mockup.html` — owner-approved visual reference.
8. The owner's auto-memory files at `~/Library/Application Support/Codex/local-agent-mode-sessions/.../memory/MEMORY.md`.

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
--font-mono:    Space Grotesk (Phase 41.6 — JetBrains Mono dropped per owner directive; mono now aliases display font, use `.tabular-nums` utility for aligned columns)
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

Before `git commit`, run this sequence in order. **Each step is a hard gate** — don't proceed if a step fails.

### Step 1 — Delegate to `code-reviewer` subagent

```
Task(subagent_type="code-reviewer",
     description="Pre-commit review",
     prompt="Review the currently-modified files in the working tree against AGENTS.md rules and ARCHITECTURE.md conventions. Report PASS or FAIL with line numbers if issues found.")
```

The subagent runs in its own context (doesn't bloat mine) and returns a single verdict. If it returns FAIL, fix the issues — do NOT commit on a FAIL.

### Step 2 — Delegate to `test-runner` subagent

```
Task(subagent_type="test-runner",
     description="Pre-commit validation",
     prompt="Run scripts/check-sql-schema.sh on every changed .sql file and scripts/check-jsx-brand.sh + esbuild parse on every changed .jsx file. Report PASS or FAIL per file.")
```

Same rule: FAIL = don't commit.

### Step 3 — Final gates

1. `git status` → confirm only intended files staged.
2. Commit message follows pattern: `Phase {N}{rev?}: {one-line summary}` with bullet body.

### Why two subagents instead of one inline check

- **Context isolation:** subagents read every changed file fully without polluting the main agent's context window.
- **Specialization:** `code-reviewer` does subjective judgment (foot-guns, naming, tone). `test-runner` does mechanical checks (esbuild, schema grep). Different prompts, different jobs.
- **Parallelism:** the two can run concurrently when the main agent has time pressure.

### `explorer` subagent — for lookups during work

Not for pre-commit. Use during a task when you need:
- "Where is `enqueue_push` defined?"
- "Which files reference `next_workday`?"
- "What columns does `daily_ta` have?"

Faster than Grep-then-Read-then-Grep loops, and keeps the main context clean.

### Manual fallback (subagents unavailable)

```
bash scripts/check-sql-schema.sh <each changed .sql>
bash scripts/check-jsx-brand.sh <each changed .jsx>
./node_modules/.bin/esbuild --loader:.jsx=jsx --log-level=warning <each changed .jsx> >/dev/null
```

Documented in `.Codex/README.md`.

---

## 16 · Scope discipline

When fixing code, **don't auto-fix unrelated pre-existing violations** in the same file. Flag them, leave them for a separate commit. Example: if `MasterV2.jsx` has 14 hardcoded `#facc15` from old tabs and you're only touching MediaTypesTab, fix only your section. Tell the owner the rest is outside this batch's scope.

---

## 17 · Memory system rules

Auto-memory lives at `~/Library/Application Support/Codex/local-agent-mode-sessions/.../memory/`.

When to write:
- **user** memory: anything you learn about Brijesh's role, preferences, knowledge.
- **feedback** memory: corrections OR validated approaches. Always include `**Why:**` + `**How to apply:**` lines.
- **project** memory: ongoing initiatives. Convert relative dates to absolute dates.
- **reference** memory: pointers to external systems / files.

When NOT to write:
- Code conventions derivable from current files.
- Git history / who changed what.
- Anything already in this AGENTS.md.
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

## 23 · Known gaps / things future-Codex must check

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

When you (future-Codex) learn something important about this project, **append to this file**. The auto-memory directory at `~/Library/...` is outside the connected workspace folders, so the Write tool can't reach it from this session. AGENTS.md is the single source of truth that survives across sessions.

Format for additions: add a numbered section at the bottom, dated, with title `## {N} · {Title} ({DD-MM-YYYY})`. Don't rewrite history — append.

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.

---

## 28 · Sales module FROZEN (16 May 2026 baseline, commit `e232069`)

Phase 34Z.73 closed the sales-module audit cycle. The rep-facing flow is locked. Any future edit that touches the surrounding code — whether or not the file is in `/pages/v2/` — MUST be audited by the `sales-module-guardian` agent before commit. The full contract list lives at `.Codex/agents/sales-module-guardian.md`. Summary:

**Frozen frontend files** (full list in agent file):
- `WorkV2.jsx`, `LeadDetailV2.jsx`, `LeadFormV2.jsx`, `LeadsV2.jsx`, `FollowUpsV2.jsx`,
  `QuotesV2.jsx`, `MyOfferV2.jsx`, `MyPerformanceV2.jsx`, `PushDebugV2.jsx`,
  `SalesDashboard*.jsx`, `CreateQuote*V2.jsx`
- `V2AppShell.jsx`, `PostCallOutcomeModal.jsx`, `TodaySummaryCard.jsx`,
  `TodayTasksPanel.jsx`, `MeetingsMapPanel.jsx`
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

**How to invoke the guardian** before committing anything touching surrounding code:

```
Agent({
  subagent_type: "sales-module-guardian",
  description: "Sales-module diff review",
  prompt: "Audit the following changed files against the frozen sales-module contracts: <list>. Report PASS / FLAG / BLOCK with line-level findings."
})
```

The guardian is read-only. It will NEVER edit or commit. It returns a punch list; the
implementing agent then chooses what to fix.

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

Final pre-ship sweep complete. Sales module is SHIPPED on `untitled-os` and
ready for Sunday 17 May 2026 deadline. Treat as a closed module — no
inline patches without a guardian audit.

### What Phase 34Z.88 fixed (post-freeze audit)

Guardian agent returned 7 findings — 1 P0, 4 P1, 2 P2. All applied. No
contract churn, no functional change, no SQL.

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

Anything that even brushes the frozen files in §28 — including styling,
imports, or fallback values — needs the `sales-module-guardian` agent
to PASS before commit. Patch-chain anti-pattern (§3) is the explicit
failure mode the freeze prevents.

If a real bug surfaces post-ship, the right path is:
1. Reproduce on staging.
2. Run guardian on the proposed diff.
3. Land as a single Phase 34Z.{N+1} commit, not as a sub-letter chain.

### What's still NOT built (do not assume otherwise)

- **P&L module** — spec only. `docs/UNTITLED_OS_v2_ARCHITECTURE.md` §7.5 +
  §8.2 describes the tables (`quote_pnl`, `monthly_admin_expenses`),
  pages (`PnLLanding`, `PnLSummary`, `QuotePnL`, `AdminExpenses`),
  store (`pnlStore`), trigger (`auto_create_quote_pnl`), and owner-only
  RLS gating. **No code, no SQL, no routes exist.** Listed as Sprint 3
  pending in §22 + §26 backlog item #5.
- **Govt invoice template** — backlog item, Sprint 4.
- **TDS columns on `payments`** — required before first Govt deal hits
  PARTIAL_PAID. Not added yet.
- **Telecaller module Sprint 1** — PostCallOutcomeModal wiring into
  TelecallerV2 audited + scoped but NOT shipped. Awaiting go-ahead.

### Push deadline

Owner pushes from his Mac terminal:
```
cd ~/Documents/untitled-os2/Untitled/adflux
git push origin untitled-os
```
Vercel auto-deploys. No SQL for 34Z.88. Smoke test = open hamburger
drawer at `/work` on iPhone, confirm bell + badge sit BEHIND the
drawer overlay.

---

## 30 · HR module Phase 36 → 39 (17 May 2026)

Two-week sprint on the admin HR / Payroll / Compensation surface.
Sales module stayed FROZEN throughout (§28 + §29) — every commit here
audited by sales-module-guardian against the 16 May 2026 baseline.
**Guardian verdict (17 May): PASS on every P0 sales-module contract.
Sales module is ship-safe.**

### Phase 36 — TA/DA + Leave + Salary RPC consolidation (DONE)

- **36.0–36.5** Approve/Reject queue for rep TA/DA claims; merged
  approved claims into `compute_monthly_salary` RPC.
- **36.6** PostgREST FK embed nulling (`users(name)`) bypassed with
  two-query merge — defensive pattern for similar FK+RLS combos.
- **36.7** Hotel + Other claim kinds added to `ta_da_requests.kind`
  enum.
- **36.8** Approved claims merged into `daily_ta` via trigger
  (`trg_ta_claim_recompute`); `v_ta_from_claims` block dropped from
  the salary RPC so TA isn't double-counted.
- **36.9 + .9.1** Hard cap on DA + Hotel claims at city ceiling
  (`city_da_ceilings.daily_da` + `hotel_rate`). Case fix:
  `.eq('city')` → `.ilike('city')` because the master had `Bhavnagar`
  while reps typed `BHAVNAGAR`.
- **36.10** Paid vs Unpaid leave choice with **9-month tenure gate**.
  New `leaves.is_paid_request` boolean. New
  `eligible_for_paid_leave(uuid)` RPC. `compute_monthly_salary`
  splits `paid_req` vs `unpaid_req`. Unpaid deduction = `base / 26`
  per Indian Factories Act.
- **36.11 + .11.1** Rep-side leave history panel on `/my-offer`
  (`RepLeaveHistory.jsx`). Mobile-first card layout (5-col grid was
  overflowing iPhone). Required SQL:
  `ALTER TABLE leaves ADD COLUMN IF NOT EXISTS admin_note text;`
- **36.12** `TotalPayableCard` switched from 4 client-side queries
  to single `compute_monthly_salary` RPC call. Grand total now =
  `data.netPayable`. Adds the "Unpaid-leave deduction" row in red.

### Phase 37 — salary_payouts (DONE)

SQL: `supabase_phase37_salary_payouts.sql`. New table mirroring
`incentive_payouts` (id, user_id, month_year text, amount_paid,
is_full_payment, paid_date, paid_by, note). RLS: admin/co_owner full
read+write; rep SELECT own rows. Owner ran VERIFY 17 May, returned
`table_present=1`, `rls_count=2`.

`SalaryPayoutModal.jsx` is the punch UI — Net / Paid / Pending grid
+ entry form + history list with delete. `SalaryAdminV2.jsx` adds
"Paid" + "Payout" columns; clicking Payout opens the modal against
the rep's `net_payable`.

### Phase 38 → 38.2 — People module consolidation (DONE)

Owner directive: "can we merge this 4 module in 1 becas all same data
repeting" + "i want incentive page ui its looking so perfect" +
"make sure all function shuld not be chnaged".

- **38.0** Created `src/pages/v2/PeopleV2.jsx` — tab shell + URL
  `?tab=` param + mounts existing pages as sub-components. New
  `/people` route. ADMIN_NAV consolidated 5 entries (Team /
  Incentives / Leaves / Salary Sheet / TA Payouts) into one **People**
  entry. MOBILE_NAV_ADMIN `/team → /people`. SALES_NAV /
  TELECALLER_NAV / AGENCY_NAV / MOBILE_NAV_SALES /
  MOBILE_NAV_TELECALLER **untouched** (guardian-verified).
- **38.1** `embedded` prop pattern: TeamV2 / IncentivesV2 /
  SalaryAdminV2 / LeavesAdminV2 each accept `embedded` to suppress
  own page-head when mounted inside PeopleV2. The right-side toolbar
  controls (Add Member, month picker, Export CSV) preserved as a
  toolbar row when embedded. Salary tab gains 4 summary cards above
  the table: Net Payable / Already Paid / Pending / Unpaid Leave Cut.
- **38.2** Pixel-match the owner-approved mockup
  `_design_reference/people_module_mockup.html`. Tab badges with live
  counts (Team=N reps, Salary="May 2026", Leaves+TA="N pending").
  Salary tab gets Role + Search filters in embedded mode. Table
  padding bumped to 12/16 (th) and 14/16 (td) per mockup. Payout
  button → `.btn-mini` exact spec; flips to ghost "View" once
  full-payment recorded. New TOTAL row label "TOTAL · N of M" when
  filtered. New empty-state for filtered=0.

Old routes `/team /incentives /admin/leaves /admin/salary` kept as
deep-links (no redirect — non-admin rep view of `/incentives`
preserved).

### Phase 39 — single payout flow + 4 tabs + font (PARTIALLY ROLLED BACK)

Owner directive: "there are 2 pay optin in incentive and in salary
1st need to pay in incentive then it came to salarty its vwey
cofusing for team" + "i want one simple tab salalry thats count
eveythng no more tab" + "can we also add ta da payment in this
people tab".

Shipped:
- People tabs reduced to 4: Team · Salary · Leaves · TA Claims.
  Incentive Payout button removed from `IncentiveDashboard`. TA
  Claims tab added (mounts `TaPayoutsAdminV2` with `embedded` prop).
- `TaPayoutsAdminV2` accepts `embedded` prop. `useAutoRefresh`
  remains unconditional so background polling fires whether mounted
  standalone or embedded (guardian-verified).
- `/admin/ta-payouts` dropped from ADMIN_NAV sidebar (deep-link kept
  in App.jsx).
- **Font fix**: `index.html` Google Fonts URL now includes
  **JetBrains Mono** (`@400;500;600;700`). `tokens.css --font-mono`
  was listing it as preferred but the family wasn't loaded — currency
  figures fell back to SF Mono / Consolas / system mono and looked
  different per machine. Mockup uses JetBrains Mono.
- **IST date anchor** in both `IncentivePayoutModal.jsx` and
  `SalaryPayoutModal.jsx`. Was `new Date().toISOString().slice(0,10)`
  (UTC); before 18:30 IST that returned yesterday's date. New
  `istTodayISO()` helper anchors to IST.

Then owner said: **"incentive put back we will discuss tomorrro"**.
Phase 39.x reverted the Incentives tab drop:
- Incentives back as **2nd tab** in PeopleV2 (5 tabs total: Team ·
  Incentives · Salary · Leaves · TA Claims).
- Payout button + `IncentivePayoutModal` mount restored on
  `IncentiveDashboard`.
- Single-payout-flow consolidation PARKED for tomorrow's discussion.

Phase 39.y closed two sales-module-guardian findings on admin-only
surfaces (no frozen contract touched):
- `SalaryPayoutModal.remove()`: native `confirm()` → `confirmDialog()`
  per §26 Sprint A pattern.
- 6× off-scale `borderRadius: 8` → `var(--v2-r-sm, 10px)` (tokens
  scale is 6/10/14/20, v2 scale is 10/14/20 — 8 is on neither).

### Open decisions for 18 May 2026 discussion

1. **Single payout flow vs two flows.** Owner first said "one tab
   salary counts everything", then "incentive put back we will
   discuss tomorrow". Decision parked. Today's UI: both flows
   reachable (Incentive Payout button on `/incentives` admin view,
   Salary Payout button on Salary tab). Accounts can use either —
   not great UX, but ship-safe.
2. **Where does incentive slab/profile editing live long-term?**
   Owner's earlier ask: Master tab → new "Incentive Setup" sub-tab
   (mirrors Holidays / Media Types). Not built yet. `/incentives`
   URL still loads in full (Staff Profiles · What-If Simulator ·
   Settings sub-tabs).
3. **Bulk full-pay on Salary tab.** Phase 38.2 added a disabled stub
   with tooltip "Coming next sprint". Owner hasn't asked for it yet.
4. **Forecast incentive in Salary NET.** Today the Salary tab
   "Incentive" column shows paid-out (from `incentive_payouts`). To
   make Salary tab truly "count everything regardless of whether
   incentive was paid yet" needs client-side override using
   `calculateIncentive(profile, monthly_sales_data)` or an RPC
   change. Estimated 30-min ship; depends on decision (1).

### Where things live now (post-39.y, before tomorrow's session)

| Surface | Route | Sidebar | Status |
|---|---|---|---|
| People shell | `/people` | **People** (only entry) | Phase 38 ship-ready |
| Team tab | `/people?tab=team` | inside People | Frozen-shaped |
| Incentives tab | `/people?tab=incentives` | inside People | Re-mounted 39.x |
| Salary tab | `/people?tab=salary` | inside People | Phase 37 + 38.2 |
| Leaves tab | `/people?tab=leaves` | inside People | Phase 33G.8 |
| TA Claims tab | `/people?tab=ta` | inside People | Phase 36 work |
| Salary deep-link | `/admin/salary` | (none) | Renders own page-head |
| TA deep-link | `/admin/ta-payouts` | (none) | Renders own page-head |
| Leaves deep-link | `/admin/leaves` | (none) | Renders own page-head |
| Team deep-link | `/team` | (none) | Renders own page-head |
| Incentives deep-link | `/incentives` | (none) | Renders own page-head; rep view preserved |

### Foot-guns added in Phase 36–39 (don't repeat)

- ❌ `new Date().toISOString().slice(0, 10)` for "today" — returns
  UTC, breaks at the IST boundary. Use `istTodayISO()` pattern
  (see Phase 39 modal helpers).
- ❌ `.eq('city_name', x)` when comparing user-entered city against
  master — case-sensitive. Use `.ilike(x)` (see Phase 36.9.1).
- ❌ PostgREST `users(name)` embeds in incentive/salary queries —
  silently null under some FK + RLS combos. Run two queries +
  merge client-side (see Phase 36.6).
- ❌ Adding pages to ADMIN_NAV without mobile-nav consideration —
  MOBILE_NAV_ADMIN must mirror (Phase 38 forgot, fixed same commit).
- ❌ Hardcoded `borderRadius: 8` — off-scale on both tokens (6/10/
  14/20) and v2 (10/14/20). Use `var(--v2-r-sm)` (10) or `var(--v2-
  r)` (14) or `var(--radius-sm)` (6) for inline chips.
- ❌ Native `confirm()` for destructive actions — use
  `confirmDialog()` from `src/components/v2/ConfirmDialog`.

### Commit log (untitled-os branch, this sprint)

```
06cb9a5 Phase 39.x: revert Incentives tab drop
be2247b Phase 39.y: sales-module-guardian audit fixes (admin-only)
c2dd2b5 Phase 39: People = single payout flow + 4 tabs + font
156c6f8 Phase 38.2: pixel-match Salary tab
7467d6b Phase 38.1: close mockup gap on People module
66fe030 Phase 38: People module consolidate 4 admin pages
f230650 Phase 37: salary payout with multi-payment history
30fc66b Phase 36.12: TotalPayableCard reads from RPC + leave deduction
4f86e8b Phase 36.11.1: RepLeaveHistory mobile-first card layout
4499b0f Phase 36.11: rep-side Leave History panel on /my-offer
00bd3ae Phase 36.9.1: city ceiling lookup case-sensitivity fix
... (earlier Phase 36.x in §28 / §29)
```

### Next session opening move (18 May 2026)

1. Read this section + §28/§29 to confirm the frozen-contract list
   is intact.
2. Owner will name the call on open decision (1) — single vs two
   payout flows. Don't pre-build either path.
3. If single flow wins: ship Phase 40 = drop Incentive Payout button
   permanently, wire forecast incentive into Salary NET, move
   incentive config to Master tab. ~2 hr scope.
4. If two flows stay: ship Phase 40 = polish only (forecast column
   on Salary tab as a separate "Earned this month" line that doesn't
   double-count with the paid-out Incentive column).
5. Either way: smoke `/people` on iPhone after deploy. PWA cache can
   serve old bundle for ~24 hr — owner sometimes needs a hard
   refresh (long-press reload → "Reload without cache") on staging.

---

## 31 · Sales module RE-FROZEN — Phase 41.8 baseline (2026-05-18)

Second full freeze. Original 16 May 2026 (§28, commit `e232069`) +
post-ship sweep 34Z.88 (§29) shipped before. Phase 40–41 work
followed: People polish, admin dashboard restructure (kill
duplication / add gaps / polish), Salary tab restyled to copy
Incentive page chrome, global JetBrains Mono drop, plus full
guardian-driven cleanup. **New baseline commit: `3859955`.**

### What changed between 34Z.88 and 41.8

| Phase | What | SHA |
|---|---|---|
| 40 | People polish — Total Salary col, Incentive chrome match (later reverted), TA tooltip | `4b6e3da` |
| 41.1 | Admin dashboard — kill duplication (2-col KPI row, RepActivityPanel, RecentActivity, /lead-dashboard + /team-dashboard sidebar entries) | `6be0eb5` |
| 41.2 | Admin dashboard — add gaps (SegmentToggle pill, AdminActionsCard, RepsInFieldCard, CashForecastCard) | `d0b4577` |
| 41.3 | Admin dashboard — polish (Pipeline funnel period-bucketed, TopHotLeadsCard, BriefDeliveryCard) | `ae3973f` |
| 41.4 | Salary tab copies Incentive styling (revert mockup spec; canonical `.inc-summary-card` + `.staff-table` numbers) | `4b1159d` |
| 41.5 | Drop 5 duplicated top-of-page widgets (AiBriefingCard, PipelineFunnelCard, WinRateCard, RecentActivityFeedCard, old ActionQueueCard items mount, segment chips in filter bar) | `5679668` |
| 41.6 | `--font-mono` token swap to Space Grotesk; JetBrains Mono dropped from index.html | `a4d8524` |
| 41.7 | Sweep 17 hardcoded `fontFamily: 'monospace'` → `'inherit'` across 7 jsx + 2 css | `71be402` |
| 41.8 | Guardian audit close: 1 P1 + 4 P2 (TaPayoutsAdminV2 confirm()→confirmDialog ×2, off-scale radii ×2, stale "JetBrains Mono" fallback strings ×6) | `3859955` |

### What's protected (same contracts as §28 + §29, unchanged)

All §28 contracts still apply:
- Frozen rep-facing files (WorkV2, LeadDetailV2, LeadFormV2, LeadsV2,
  FollowUpsV2, QuotesV2, MyOfferV2, MyPerformanceV2, PushDebugV2,
  SalesDashboard*, CreateQuote*V2, V2AppShell, PostCallOutcomeModal,
  TodaySummaryCard, TodayTasksPanel, MeetingsMapPanel) + hooks
  (useLeadTasks, useAutoRefresh) + push surfaces (pushNotifications,
  public/sw.js).
- Frozen DB contracts: lead stages, cadence types, activity types,
  Phase 34Z.50 quote→lead propagation, Phase 34Z.55 push triggers,
  Phase 34Z.61 9:30 IST morning push, Phase 34Z.66/67/69/70 score +
  TA + push_log triggers.
- Frozen UX contracts: PostCallOutcomeModal chain, useAutoRefresh
  mounts on 6 pages, push enrollment in V2AppShell only.
- All §29 z-index landscape (10/40/50/60/100/200/201/1000/9000/9999/
  10000) — no new tier invented.

### Net deltas vs 34Z.88 (so future you knows what to ship-test)

1. **ADMIN_NAV consolidation**: 5 entries (Team / Incentives /
   Leaves / Salary Sheet / TA Payouts) → 1 `/people` entry. Deep-
   links to all 5 old routes still work — just no sidebar entries.
2. **MOBILE_NAV_ADMIN**: `/team` → `/people`. Other mobile navs
   (SALES, TELECALLER) untouched.
3. **`--font-mono` token**: now resolves to Space Grotesk. Any
   future code that needs aligned digits should add the
   `.tabular-nums` utility class (declared in tokens.css) rather
   than reintroducing monospace.
4. **`MonoNumber.jsx` primitive**: still exists, now renders Space
   Grotesk. If a future column needs explicit mono digits, opt in
   inside that component — don't reintroduce monospace globally.
5. **Admin dashboard layout**: 12 sections → 9. New page order is
   documented in §41.5 commit body.
6. **People module**: 5 tabs (Team · Incentives · Salary · Leaves
   · TA Claims). Single-payout-flow decision still **parked** —
   today both Incentive Payout (on /incentives admin view) AND
   Salary Payout (on Salary tab) are reachable. Owner needs to
   call it before Phase 42.

### Smoke test before merging anything to main

1. `/dashboard` (admin) — hero near top, no AI Briefing or old
   action queue above. Segment toggle pill renders + filters work.
   Action queue + Reps in field + Cash forecast all show. Hot
   leads + brief delivery cards render. Pipeline funnel is period-
   bucketed (switch PeriodPicker → numbers change).
2. `/people` — 5 tabs. Salary tab: 11 columns including Total
   Salary. Payout button uses `.btn .btn-ghost` (same as Incentive
   Edit button). Numbers should be Space Grotesk, not monospace.
3. `/work` (sales rep) — no nav change. Today's plan + GPS + log
   meeting flow intact.
4. `/leads/:id` — PostCallOutcomeModal opens after tel: click +
   1.5s. Stage / cadence / activity_type unchanged.
5. iPhone hard refresh after deploy (PWA cache holds old fonts +
   bundle).

### Guardian-clean — what NOT to touch without re-audit

Any change to: V2AppShell.jsx, PostCallOutcomeModal.jsx,
WorkV2.jsx, LeadDetailV2.jsx, FollowUpsV2.jsx, QuotesV2.jsx,
MyOfferV2.jsx, MyPerformanceV2.jsx, TaPayoutsAdminV2.jsx,
TodaySummaryCard.jsx, TodayTasksPanel.jsx, MeetingsMapPanel.jsx,
public/sw.js, hooks/useLeadTasks.js, hooks/useAutoRefresh.js,
utils/pushNotifications.js — invoke sales-module-guardian agent
**before** commit. Single-file token / brand fixes are cheap;
behavioural changes need explicit owner approval.

### Next: telecaller module

Audit started 18 May 2026. See ad-hoc notes in next session — will
land as §32 once scope is locked.

---

## 32 · Telecaller module Phase 43 — call-chain parity (18 May 2026)

Telecaller (TelecallerV2.jsx) had three structural gaps vs sales:
no call audit on tel-tap, no PostCallOutcomeModal capture, no
auto-refresh. Phase 43 closed all three plus added the productivity
layer (target ring + connect-rate) and callback visibility.

### Phase 43.1 — bleed-stop (`583fd38`)

- New `quickLogCall(lead)` in TelecallerV2 mirrors WorkV2:532 chain
  exactly: tel: link fires on user gesture, then logCallAudit +
  lead_activities insert + setPostCallOpen(true) on 1.5s timer.
- PostCallOutcomeModal mount at end of TelecallerV2. onSaved
  triggers `load()` so callsToday + connectedToday refresh inline.
- `useAutoRefresh(load)` mounted unconditionally — matches sales-
  frozen pattern.
- cleanPhone helper copied from WorkV2 (could extract to utils
  later; inline for parity).
- Dead `SalesReady` string dropped from stage filter (Phase 30A).
- Loading state upgraded text → spinning Loader2.
- `connectedToday` state + extra call_logs count query
  (outcome='connected'). Sets up 43.2 connect-rate KPI.
- V2AppShell.jsx TELECALLER_NAV drops /voice (matches Phase 33N
  sales-side drop). MOBILE_NAV_TELECALLER /voice → /quotes.
  /voice route + page kept as deep-link.

### Phase 43.2 — productivity layer (`35b650c`)

- Daily call target ring on V2Hero. Reads daily_targets.min_calls
  (Phase 12 column, never surfaced for TC before). Falls back to 50.
  Ring = callsToday / target × 100. Hero value swaps to "X/Y" format.
- Connect-rate KPI in hero footer + KPI strip. Green ≥30%, amber
  otherwise. Tells the TC "are you actually reaching anyone" at
  a glance.
- KPI strip restructured to 4 tiles: Calls today (X/target) ·
  Connect rate · Qualified today · Pending hand-offs.
- Auto-advance is implicit: PostCallOutcomeModal.onSaved →
  load() → sortedQueue useMemo recomputes → nextCall =
  sortedQueue[0] reflects the next lead. No code change.

### Phase 43.3 — callback scheduler (`b4d9458`)

- "Upcoming callbacks" panel between hero and 2-col grid. Renders
  only when ≥1 callback scheduled (saves vertical space).
- Source: follow_ups rows where assigned_to = profile.id, is_done
  = false, follow_up_date BETWEEN today AND today+2d.
- Each row: date+time pill, lead name + company + truncated note,
  Call button that re-enters quickLogCall chain.
- Sort: earliest date first, then earliest time.
- Data path already existed end-to-end (PostCallOutcomeModal writes
  follow_ups; Phase 34Z.55 push trigger fires at due time). This
  just surfaces it.

### Workflow after Phase 43

1. TC opens /telecaller → V2Hero shows X/Y calls done · connect %
   ring · upcoming callbacks panel near top (if any).
2. TC taps Call on Next Call hero → quickLogCall fires:
   - Tel: link opens dialer (user gesture).
   - logCallAudit writes call_logs row.
   - lead_activities row inserted with outcome=null.
   - 1.5s later PostCallOutcomeModal opens.
3. TC picks outcome (positive / neutral / negative) + next action
   (Follow up tomorrow / 3d / 7d / nurture / meeting / custom date
   / none). Optional voice-input note.
4. Save → activity row patched with outcome, follow_ups row spawned
   for next_action, smart_task closed if open. load() fires → hero
   swaps to next lead in queue.
5. Reload at any time → numbers + upcoming callbacks panel refresh.

### Deferred for next sprint (feedback-gated)

- WhatsApp template 1-click send (needs Master tab template store)
- Inline call scripts (needs Master tab script store)
- Telecaller incentive engine (owner needs to price first)
- DNC list / call recording / language tag (compliance work)
- Power dialer integration (Exotel / Knowlarity native)
- Renuka team-lead view (folds into Phase 42.2 sales_manager
  frontend — same MANAGER_NAV scope)

### What to test (handoff checklist for Dhara + Rima + Renuka)

- [ ] Open /telecaller → loading shows spinner, not blank text.
- [ ] Hero shows X/Y format calls today + % ring + connect-rate chip.
- [ ] Tap "Call now" → phone dialer opens immediately.
- [ ] Return to app → modal opens after 1.5s asking outcome + next.
- [ ] Pick "Good" + "Follow up tomorrow" + save → hero shows next
      lead, callbacks panel shows the new follow_up.
- [ ] Pick "Maybe" + "Pick custom date" + tomorrow 4 PM → callback
      pill shows "tomorrow · 16:00".
- [ ] Tap Call from upcoming callbacks panel → same modal chain
      fires.
- [ ] Connect-rate goes green when ≥30% of calls connected.
- [ ] Tab away + back → auto-refresh updates counts.
- [ ] /voice no longer in sidebar (deep-link /voice still loads).

### Pending guardian audit

Phase 43 ships need sales-module-guardian PASS before re-freezing
telecaller. Specifically: V2AppShell nav touch (43.1) and
TelecallerV2 isn't in §28 frozen list, but the PostCallOutcomeModal
chain it now uses is — verify no regression on tel:→1.5s→modal
contract.
