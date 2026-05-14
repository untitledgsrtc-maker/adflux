# Sales Mobile v2.1 + UI Primitives Pack — Design Spec
**Date:** 2026-05-13
**Owner:** Brijesh Solanki
**Author:** Claude
**Status:** Approved (owner Y on 3-PR sequence + ban, 13 May 2026)

Companion docs:
- `2026-05-13-sales-mobile-audit.md` — code/behaviour audit of /work + V2AppShell + modals
- `2026-05-13-ui-audit-every-screen.md` — visual / token / primitive drift across every screen

---

## 1 · Why this spec exists

Between Phase 34A (3 May 2026) and Phase 34Z.3 (13 May 2026) the team shipped 35 distinct sub-letter patches into the sales mobile module. The two audits above show:

- `WorkV2.jsx` carries 25 `Phase 34` markers in 1,799 lines — one every 72 lines, concentrated in three JSX blocks where 3-5 sub-letters stack and contradict each other.
- `V2AppShell.jsx` carries another 8 — most of them re-deciding which roles get a hamburger, how many bottom-nav slots there are, and how many incentive widgets render at once.
- Three style-system generations (V1 globals, leads.css, v2.css) layer with the newest V2Hero primitive on top, never reconciled. 36 pages render 4 distinct page-heading patterns; 118 status-chip sites use 4 implementations; 200+ inline-style `<button>` calls bypass the `--button` primitives entirely.
- 17 `alert()` / `confirm()` calls still ship despite Phase 34A delivering `toastError` and `confirmDialog`.
- The patch chain produced 5 real P0 bugs (alert/confirm regressions, MediaRecorder timer leak, empty-state hiding the panel, stale-state optimistic rollback) and a slow accumulation of polish debt.

CLAUDE.md §3 (5 May 2026) explicitly forbids this anti-pattern. The directive: **"build modules, don't patch."** The next 10 commits that would otherwise land as `34Z.4 / 34Z.5 / 35a / 35b / 35c…` get replaced by one design (this doc) and three coherent PRs.

---

## 2 · Scope

| In scope | Out of scope |
|---|---|
| `/work` (full rebuild of the page; new layout) | Admin-only pages (`/admin/*`, `/cockpit`, `/master`) — visual fixes only via Part 3 |
| `V2AppShell.jsx` mobile chrome (topbar + bottom nav + drawer at ≤860 px) | Desktop sidebar / topbar appearance — visual fixes only via Part 3 |
| 8 new UI primitives + supporting tokens | New features (no business logic changes) |
| 5 real P0 bugs identified in Audit 1 §2 | TDS / govt invoice work (Sprint 4) |
| Mechanical migration of 36 V2 pages to the new primitives | RLS / data model changes |
| Migration of `OfferForm.jsx` off undefined tokens | PDFs (printable, day-palette intentional per CLAUDE.md §9) |
| Patch-chain comment cleanup on `WorkV2.jsx` + `V2AppShell.jsx` | Cronberry / Trackdek sunset (Phase 4+) |

---

## 3 · Approach summary

Three coherent PRs in strict order. **No sub-letter patches during this window.**

| PR | Purpose | Effort | Files touched |
|---|---|---|---|
| **PR 1** — Primitives Pack (Prep) | Ship 8 reusable components + tokens. Zero page changes. | ~3 days | ~12 new files in `src/components/v2/primitives/`, 3 token additions to `tokens.css` + `v2.css`, 1 `docs/UI_PRIMITIVES.md` |
| **PR 2** — Sales Mobile v2.1 | Rebuild `/work` + V2AppShell mobile chrome. Fix 5 P0 bugs. Consumes PR 1 primitives. | ~2-3 days | `src/pages/v2/WorkV2.jsx`, `src/components/v2/V2AppShell.jsx`, 4 small support files |
| **PR 3** — Mechanical Migration | Sweep 36 pages + 50 components to the new primitives. Parallelisable via subagents. | ~5-7 days | ~50 files; one subagent per page-group |

Total: ~10-13 days end-to-end. Each PR is independently shippable; PR 2 cannot land without PR 1; PR 3 can ship in batches against the same PR 1 + PR 2 base.

---

## 4 · PR 1 — Primitives Pack

### 4.1 New components

All live in `src/components/v2/primitives/`. Each exports a single default component + a TypeScript-style JSDoc on its props. Inline styles are forbidden inside the primitives themselves — they consume tokens only.

#### `<PageHeader>`
The single canonical page-heading component. Replaces the four current patterns:

- `v2d-page-head` + `v2d-page-title` h1 (13 pages)
- `lead-page-head` + `lead-page-title` div (6 pages)
- `<V2Hero>` standalone (2 pages)
- Bespoke `v2d-hero v2d-hero--action` markup (4 pages)

Props:
- `title: string` (required)
- `eyebrow?: string` — small caps line above the title
- `subtitle?: string`
- `actions?: ReactNode` — slot for right-aligned action buttons
- `hero?: 'none' | 'compact' | 'full'` — when set, wraps the header in a `<V2Hero>`-style gradient card. Default `none`.

Rule of use:
- Every V2 page mounts exactly one `<PageHeader>` at the top of the page body.
- `hero='full'` is reserved for the rep's daily home view (`/work`) and the daily-numbers view (`/my-performance`). Every other page uses `hero='none'` or `hero='compact'`.

#### `<Modal>`
Replaces the 7+ ad-hoc modal shells (`ConfirmDialog`, `CopilotModal`, `WonPaymentModal`, `OfferDetailModal`, `LogMeetingModal`, `LogActivityModal`, `PaymentModal`, `BulkRateModal`, etc.).

Props:
- `open: boolean`
- `onClose: () => void`
- `title: string`
- `size?: 'sm' | 'md' | 'lg' | 'full'` — full == iOS-style full-screen on mobile, modal on desktop
- `children: ReactNode` — body
- `footer?: ReactNode` — slot for action buttons (sticky on mobile)
- `closeOnBackdrop?: boolean` (default `true`)

Standardises:
- Backdrop opacity `0.55` everywhere
- Close button top-right, lucide `<X size={18} />`
- Body padding 16-18 px depending on size
- Footer pinned to bottom on mobile (uses `dvh` units so it survives iOS keyboard)
- Backdrop scroll lock on body

#### `<StatusBadge tint="…">`
Replaces 38 token uses + ~80 hardcoded `rgba()` duplicates = 118 sites.

Props:
- `tint: 'success' | 'warning' | 'danger' | 'blue' | 'purple' | 'yellow' | 'neutral'`
- `icon?: LucideIcon`
- `children: ReactNode`
- `size?: 'sm' | 'md'`

Always uses the `--tint-*` token grid (Phase 34R added them; we depend on them here). No hardcoded rgba in consumers.

#### `<EmptyState>`
Replaces three current empty-state patterns.

Props:
- `icon: LucideIcon` (required)
- `title: string`
- `sub?: string`
- `action?: { label: string; onClick: () => void }`

Canonical visual: centered icon (40px) + title (16px bold) + sub (13px muted) + optional ActionButton. Always wrapped in `.v2d-empty-card`.

#### `<LoadingState>`
Replaces four current loading patterns.

Props:
- `type?: 'page' | 'inline' | 'table'`
- `label?: string`

`page` = full-page spinner with label. `inline` = small spinner + label on the same line. `table` = skeleton rows (3 by default) matching column count.

#### `<Banner>`
Replaces MasterV2 copy-paste status banners + inline tone banners scattered across QuoteDetail / PendingApprovals / OfferForm.

Props:
- `tone: 'success' | 'warning' | 'danger' | 'info'`
- `children: ReactNode`
- `onDismiss?: () => void` — when set, shows a close button

#### `<ActionButton>`
Replaces ~200 bare `<button style={{…}}>` calls.

Props:
- `variant: 'primary' | 'ghost' | 'danger' | 'subtle'`
- `size?: 'sm' | 'md' | 'lg'`
- `iconLeft?: LucideIcon`
- `iconRight?: LucideIcon`
- `disabled?: boolean`
- `loading?: boolean` — replaces label with spinner while pending
- `onClick: () => void | Promise<void>`
- `children: ReactNode`

Single source of truth for `:hover`, `:focus-visible`, `:disabled`, and `:active` states. Tap target ≥40px on every variant.

#### `<MonoNumber>`
Tiny wrapper that applies `var(--font-mono)` + tabular-num figures. Used for currency, phone numbers, dates, IDs.

Props:
- `children: string | number`
- `size?: number`

Replaces scattered `fontFamily: 'monospace'` literals.

### 4.2 New tokens

Added to `src/styles/tokens.css` (V1 scope) and mirrored into `src/styles/v2.css` (V2 scope) where they need different values inside the v2 grid:

```css
/* Phase 34Z.4 — gradient tokens. Single definition replaces the
   four inline hardcoded gradient declarations in V2Hero.jsx,
   leads.css, v2.css, and TeamDashboardV2.jsx. */
--grad-hero:
  radial-gradient(380px 140px at 100% 0%, rgba(255,230,0,.22), transparent 60%),
  linear-gradient(135deg, #0d3d3a 0%, #134e4a 55%, #0f766e 100%);

--grad-incentive:
  radial-gradient(420px 160px at 100% 0%, rgba(167,139,250,.18), transparent 60%),
  linear-gradient(135deg, #2e1065 0%, #4c1d95 55%, #5b21b6 100%);

--grad-team:
  linear-gradient(135deg, #1e1b4b 0%, #312e81 55%, #4338ca 100%);

/* Phase 34Z.4 — orange tint to close the gap in the status palette.
   Currently #f97316 is hardcoded in AdminDashboardDesktop. */
--orange:      #F97316;
--orange-soft: rgba(249, 115, 22, 0.12);

/* Phase 34Z.4 — promote --purple from leads.css local to global. */
--purple:      #A78BFA;
--purple-soft: rgba(167, 139, 250, 0.14);
```

### 4.3 OfferForm token migration

`src/pages/OfferForm.jsx` consumes `var(--red)`, `var(--gray)`, `var(--card)`, `var(--brd)` — three of those are undefined and the page renders with browser defaults. Migrate to the canonical tokens:

| Old (undefined) | New |
|---|---|
| `var(--red)` | `var(--danger)` |
| `var(--gray)` | `var(--text-muted)` |
| `var(--card)` | `var(--surface)` |
| `var(--brd)` | `var(--border)` |

Single-file mechanical edit. ~6 sites.

### 4.4 Documentation

Add `docs/UI_PRIMITIVES.md`. One page, "use this, not that":

> When you need… | Use… | Not…
> ---|---|---
> Page heading | `<PageHeader>` | bare h1 + page-head class
> Modal | `<Modal>` | custom backdrop + close button
> Status chip | `<StatusBadge>` | inline `style={{ background: 'rgba(…)' }}`
> Empty list | `<EmptyState>` | bare `<div>No X yet</div>`
> …

This doc gates PR 3 reviews — any migration commit that introduces a non-canonical pattern fails review.

### 4.5 PR 1 acceptance gate

- All 8 primitives ship with JSDoc + one usage example each (in `docs/UI_PRIMITIVES.md`).
- New tokens render in both Night and Day theme (CLAUDE.md §6 #2).
- No page consumes the new primitives yet — PR 1 ships zero visual diff in the running app.
- ESLint rule: `no-restricted-syntax` blocks `<button style={...}>` outside `src/components/v2/primitives/` (lint-warning level, hard-fail in PR 3 review).
- `OfferForm.jsx` no longer renders the broken `--red` asterisk.

---

## 5 · PR 2 — Sales Mobile v2.1

### 5.1 `/work` rebuild

Replace the current 5-state machine (`A_PLAN` / `A_CHECKIN` / `B_ACTIVE` / `C_CHECKOUT` / `D_DONE`) with **three persistent surfaces**. The same JSX renders all day; what changes is which surface is live vs collapsed.

**Surface 1 — Day status card (top)**
- Always visible. Inline `<PageHeader hero="full">` wrapping the time-of-day content.
- Content variants:
  - Pre-check-in: "Plan today" heading + voice mic button + 4 form fields (meetings/calls/leads target/focus) + "Start My Day" primary button.
  - Checked in, day in progress: V2Hero progress block — `X / Y meetings logged`, `N calls · M new leads` chip, `K to go` right-tone.
  - Day done: "Day done." heading + final counters + "Submit evening report" button if not submitted.

**Surface 2 — What's next (middle)**
- Always visible. Single "Next action" card.
- Merges today's: Focus mode + Next-up + TodayTasksBreakdown + UpcomingTasksCard.
- Renders the **one** highest-priority undone item: planned meeting with the closest time, OR the highest-heat smart-task, OR the most overdue follow-up — in that priority order.
- If literally nothing is pending, renders an `<EmptyState icon={CheckCircle2} title="Day is clear" sub="Send a quote or add a lead while you have a minute." action={{ label: 'Add lead', onClick: ... }} />`. Single empty-state, not three.

**Surface 3 — Log meeting (bottom, sticky)**
- Sticky-bottom `<ActionButton variant="primary" size="lg">` mounting `LogMeetingModal` on click.
- Sits inside a `<div className="m-sticky-foot">` with `position: sticky; bottom: 0` + safe-area + 16px gap above the mobile bottom nav.
- This replaces the current 3-CTA stack (Meeting / Call / Voice — Call+Voice already removed in Phase 34Z.1; Meeting moves here).
- Map panel + RepDayTools surfaces drop INTO scroll content below the sticky CTA, not above it. They're secondary, not primary.

**Patch comment cleanup:** after the rebuild, the file should contain **zero `Phase N` annotations inside JSX bodies**. Comments allowed at function-doc level only. This is the gate the next reviewer enforces.

### 5.2 V2AppShell mobile chrome rebuild

**Topbar (≤860 px):**
- Hamburger left.
- Greeting (with emoji per CLAUDE.md §27 waiver — see §5.6).
- Right-side: `IncentiveMiniPill` HIDDEN on mobile entirely (the full purple `ProposedIncentiveCard` on `/work` is the canonical incentive surface). On non-/work mobile pages, the pill also hides because the audit found it duplicates `IncentiveForecastCard` on `/quotes/:id` and the page-body strip elsewhere.
- Bell notification panel stays.
- No "Ask AI" button on mobile (already gated; verify it actually hides).

**Bottom nav (≤860 px):**
- 4 tabs: Today / Follow-ups / Leads / Quotes.
- Drop the "New" tab (Phase 34Z.2 added it; the new sticky Log Meeting CTA covers cold walk-in creation already).
- Center tab gets standard tab styling — no FAB pretensions.

**Drawer:** keep the existing More-drawer pattern unchanged. Voice / Score / Reward / Clients stay there.

### 5.3 Fix the 5 real P0 bugs (Audit 1 §2)

| id | file:line | fix |
|---|---|---|
| P0-1 | `QuotesV2.jsx:68-72` | Swap `confirm()` + `alert()` → `confirmDialog({ danger:true })` + `toastError()` |
| P0-2 | `LeadDetailV2.jsx:921` | Replace OCR `forEach(confirm)` loop → single `<Modal>` with checkbox per conflict, applies as batch |
| P0-3 | `WorkV2.jsx` `TodayTasksBreakdown` empty-state | Removed entirely in the rebuild — replaced by Surface 2's `<EmptyState>` |
| P0-4 | `WorkV2.jsx:300` MediaRecorder timer | Store `timeoutId` in a ref; `clearTimeout` in `onstop`, in cleanup, and at top of next `startRecording` |
| P0-5 | `WorkV2.jsx:541` optimistic rollback | Capture `prev = session` at function start; rollback uses `prev`, not the closure `session` |

### 5.4 Dead-code purge

- Delete `IncentiveHeroCard.jsx` (created Phase 34Z.2, replaced Phase 34Z.3, never re-mounted).
- Drop the `eslint-disable-next-line no-unused-vars` import line for `sharedGreetingFor` in `WorkV2.jsx`.
- Delete the 7-line "tombstone" comments in `WorkV2.jsx:684-691` and similar Phase-34 sub-letter explanations that explain removed widgets.

### 5.5 Emoji waiver

CLAUDE.md §7 + §20 forbid emoji. Phase 34Z.1 added `☀️ ⛅ 🌙` to the greeting per owner request without updating the rule. **Decision (owner-final in this spec):** keep emoji in greeting only, with an explicit waiver. Add to CLAUDE.md as new §27:

> ## 27 · Emoji waivers (2026-05-13)
> Emoji are forbidden by default (§20). Approved exceptions:
> - Greeting time-band suffix: `☀️ ⛅ 🌙` in `V2AppShell.greetingFor()` (owner directive Phase 34Z.1).
> No other exceptions. The five sites flagged in Audit 2 §2 (StaffTable, MyPerformance, WonPaymentModal, AdminDashboardDesktop, SalesDashboardDesktop) must be migrated to Lucide icons in PR 3.

### 5.6 Toast viewport fix

The current Phase 34Z mobile-offset for `ToastViewport` uses `!important` (V2AppShell line 1067 vicinity). Replace with a real layout primitive: `<ToastViewport bottomGap={64} />` props-driven, so the offset can be 64 (mobile bottom nav + safe area) or 16 (desktop) without `!important`.

### 5.7 PR 2 acceptance gate

- `WorkV2.jsx` has **0 `Phase N` annotations inside JSX bodies**.
- `V2AppShell.jsx` mobile-chrome section has **0 `Phase N` annotations inside JSX bodies**.
- 5 P0 bugs from Audit 1 §2 closed (with brief test plan in PR description).
- Smoke test: rep walks the full daily flow on a 390px viewport — Plan → Start → Log Meeting → Toggle Done → Submit Evening — without seeing two greetings, two incentive widgets, three empty-state cards, or a covered Save button.
- Cumulative diff: net **negative LOC** on `WorkV2.jsx` (currently 1,799 → target ≤1,300).

---

## 6 · PR 3 — Mechanical migration

Parallelisable via 4-6 subagents on independent file groups. Owner reviews + merges each group separately so the migration lands in slices, not one mega-PR.

### 6.1 Sweep targets (in priority order)

| Sweep | Sites | Replacement | Risk |
|---|---|---|---|
| `alert()` / `confirm()` | 17 sites | `toastError` / `confirmDialog` | Low — Phase 34A primitives already shipped |
| Hardcoded rgba chip tints | 80+ sites | `<StatusBadge>` | Low |
| Bare inline-style `<button>` | ~200 sites | `<ActionButton>` | Medium — touch interactivity; smoke-test required |
| Material-palette hex MasterV2 | 17 sites | `--success` / `--warning` / `--danger` tokens | Low |
| Material-palette hex GovtProposalDetailV2 | 22 sites | Same tokens | Low |
| CockpitWidgets hardcoded literals | 23 sites | `<StatusBadge>` + `--tint-*` | Low |
| Lucide icon sizes | ~80 out-of-spec sites (sizes 10/11/12/13/15/17/20/24/28/32/40) | Snap to 14/16/18/22 | Low — but visual review needed |
| Lucide strokeWidth | ~20 sites at 1.8/2/2.2 | Snap to 1.6 | Low |
| `fontFamily: 'monospace'` literals | 17 sites | `<MonoNumber>` or `var(--font-mono)` | Low |
| Off-scale borderRadius (7, 11, 20, 24) | ~10 sites | Snap to 6/8/9/12/14/16/999 | Low — visual review |
| Inline-style page heads | 4 patterns × ~33 pages | `<PageHeader>` | Medium |
| Bespoke modal shells | 7+ modals | `<Modal>` shell | Medium — modal contents migrate, shells consolidated |
| 4 borderline emoji sites | 5 occurrences | Lucide icons (per §5.6 waiver decision) | Low |
| `var(--v2-yellow, #fbc42d)` fallback | 3 sites | `var(--v2-yellow, #FFE600)` | Trivial |
| Empty states | 3 patterns × ~12 sites | `<EmptyState>` | Low |
| Loading states | 4 patterns × ~10 sites | `<LoadingState>` | Low |
| Inline banners | ~10 sites | `<Banner>` | Low |

Total: ~470 individual sites; expected ~1,200–1,500 LOC net removal.

### 6.2 Subagent strategy

Six file groups, each one subagent in its own git worktree:

1. **Group A — Modals** (LogMeeting, LogActivity, ChangeStage, Reassign, WonPayment, BulkRate, Payment, OfferDetail, TeamMember, Staff). Migrate to `<Modal>` shell.
2. **Group B — Lead pages** (LeadsV2, LeadDetailV2, FollowUpsV2, UpcomingTasksCard). PageHeader + StatusBadge + ActionButton sweep.
3. **Group C — Quote pages** (QuotesV2, QuoteDetail, IncentiveForecastCard, QuoteWizard steps). Same sweep + status-chip migration.
4. **Group D — Dashboards** (AdminDashboardDesktop, SalesDashboardDesktop, SalesDashboard, TeamDashboardV2, Cockpit, CockpitWidgets). PageHeader + StatusBadge — biggest chip-tint payload.
5. **Group E — Master + Govt** (MasterV2, GovtProposalDetailV2, AutoDistrictsV2, GsrtcStationsV2). Material-palette → tokens. Largest single-file mechanical change is here.
6. **Group F — Misc + admin + everything left** (LeadUploadV2, PendingApprovalsV2, ApprovalsV2, ClientsV2, TaPayoutsAdminV2, LeavesAdminV2, MyPerformanceV2, EveningVoiceV2, VoiceLogV2, GpsTrackV2, CallLogsV2, RepDayTools, MeetingsMapPanel, NotificationPanel, OfferForm). General cleanup.

Each subagent:
- Branches from `untitled-os` post-PR2.
- Migrates only its group.
- Runs the pre-commit checks from CLAUDE.md §15.
- Ships a single commit per group with the message template `Phase 35 (Group X): migrate {file-list} to primitives`.

### 6.3 PR 3 acceptance gate

- ESLint rule from PR 1 (`no-restricted-syntax` blocking `<button style>` outside primitives) flips from warning → hard-fail.
- No `alert()` / `confirm()` / `window.confirm()` call sites in `src/`. Grep returns 0.
- No `#facc15` / `#0a0e1a` / `#fbc42d` literals. Grep returns 0.
- All emoji removed except the §27 waiver sites.
- Day theme renders correctly on `/work`, `/leads`, `/quotes`, `/my-performance` (smoke test).
- `:focus-visible` rules present on every primitive — tab-navigation passes WCAG focus ring contrast.

---

## 7 · Sequencing + ban

1. PR 1 lands on `untitled-os`. Vercel verifies no visual diff. Owner approves.
2. PR 2 branches from post-PR1 `untitled-os`. Lands when acceptance gates pass.
3. PR 3 groups branch from post-PR2 `untitled-os`. Each lands independently as its subagent completes; owner reviews each group.

**The ban (in effect from spec approval until the last of the 6 PR 3 group-commits lands):**

- **No** `Phase 34Z.4` / `Phase 34Z.5` / `Phase 35a` / `Phase 35b` style sub-letter patches in `WorkV2.jsx`, `V2AppShell.jsx`, or any primitive.
- A real production bug surfaces → fix it inside the relevant PR, not a new commit.
- New feature requests during this window → log in `docs/superpowers/specs/`, do not implement.

The acceptance test for the ban is mechanical: between this commit and the PR 3 final commit, no commit on `untitled-os` whose subject starts with `Phase 34Z.4`-or-higher / `Phase 35{a-z}` sub-letter pattern in the affected files. Owner audits this with one `git log --oneline` at PR 3 close.

---

## 8 · Risk register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Primitive API misses a real-world need, requires a sub-letter patch | Medium | Medium | PR 1 reviews 3 sample migrations (one each from Groups A/B/D) before declaring primitive APIs stable |
| `/work` rebuild breaks the morning daily-brief flow for reps already in the field | Low | High | Ship PR 2 on a Saturday; verify Monday morning before the next change |
| Mechanical migration accidentally changes behaviour (button onClick semantics, modal close-on-backdrop, etc.) | Medium | Medium | Each sweep includes a "behaviour-preserving" assertion in the commit message and one screenshot diff per group |
| Owner asks for a new feature mid-flight | High | Low | Spec ban explicit; new requests land as new specs, not patches |
| Subagents diverge on style choices (e.g. PageHeader hero variant interpretation) | Medium | Low | `docs/UI_PRIMITIVES.md` is the single source of truth; reviewer rejects divergent commits |
| Phase 34A toast/confirm primitives have bugs the migration exposes | Low | Medium | PR 1 ships hotfix for any uncovered toast/confirm bug before PR 3 starts the sweep |

---

## 9 · Open questions for owner

1. **PR 3 review cadence:** review each subagent's commit immediately as it lands, or batch all 6 group commits and review at end? Recommendation: review per group; batches lose context.
2. **Day theme rollout:** the Day theme has been declared in `v2.css` since Phase 31; PR 1 will wire a toggle. Is the owner OK exposing the Day theme via Settings, or keep it CSS-only / off?
3. **Map provider:** OSM rate-limiting risk (Audit 1 P1-6) — switch to a paid Mapbox / Stadia tier as part of PR 2 or defer? Recommendation: defer to its own scoped commit; not critical for v2.1.

---

## 10 · Acceptance criteria summary

- 3 PRs land on `untitled-os` in order. Zero sub-letter patches in between.
- Patch-chain comment density on `WorkV2.jsx` + `V2AppShell.jsx` drops to zero inside JSX bodies.
- 5 P0 bugs from Audit 1 §2 closed.
- 17 `alert()` / `confirm()` sites migrated to `confirmDialog` / `toastError`.
- 118 status-chip sites consolidated to `<StatusBadge>`.
- ~200 bare inline `<button>` sites consolidated to `<ActionButton>`.
- Day theme toggle wired (pending owner answer to §9 Q2).
- Net LOC change on the sales mobile module: -1,200 to -1,500 across the codebase.
- CLAUDE.md §27 (emoji waiver) appended.

---

## 11 · Files to change/create

### PR 1 (Primitives Pack)
**Create:**
- `src/components/v2/primitives/PageHeader.jsx`
- `src/components/v2/primitives/Modal.jsx`
- `src/components/v2/primitives/StatusBadge.jsx`
- `src/components/v2/primitives/EmptyState.jsx`
- `src/components/v2/primitives/LoadingState.jsx`
- `src/components/v2/primitives/Banner.jsx`
- `src/components/v2/primitives/ActionButton.jsx`
- `src/components/v2/primitives/MonoNumber.jsx`
- `src/components/v2/primitives/index.js` — barrel export
- `docs/UI_PRIMITIVES.md`

**Modify:**
- `src/styles/tokens.css` — add `--grad-*`, `--orange*`, `--purple*` tokens
- `src/styles/v2.css` — mirror tokens for V2 scope
- `src/pages/OfferForm.jsx` — migrate to defined tokens (~6 sites)
- `eslint.config.js` (or `.eslintrc`) — add `no-restricted-syntax` warning for bare `<button style>` outside primitives

### PR 2 (Sales Mobile v2.1)
**Modify:**
- `src/pages/v2/WorkV2.jsx` — full rebuild (~1,799 → ~1,300 LOC)
- `src/components/v2/V2AppShell.jsx` — mobile chrome rebuild (~620 LOC affected)
- `src/components/v2/Toast.jsx` — accept `bottomGap` prop, drop `!important`
- `src/components/leads/MeetingsMapPanel.jsx` — drop double-invalidateSize, render only when `open`
- `src/pages/v2/LeadDetailV2.jsx` — replace OCR confirm loop with `<Modal>`
- `src/pages/v2/QuotesV2.jsx` — replace `confirm()` + `alert()` with `confirmDialog` + `toastError`
- `CLAUDE.md` — append §27 emoji waiver
- `src/components/leads/UpcomingTasksCard.jsx` — delete (merged into Surface 2)
- `src/components/leads/TodayTasksBreakdown` — delete (merged into Surface 2)

**Delete (after re-verifying no other consumer):**
- `src/components/incentives/IncentiveHeroCard.jsx` — dead code (created 34Z.2, abandoned 34Z.3). Grep confirms no callers at spec time; re-check during `writing-plans` execution.
- `src/components/leads/UpcomingTasksCard.jsx` — merged into Surface 2; re-check callers.
- `src/components/leads/TodayTasksBreakdown.jsx` (or wherever the inline definition lives in WorkV2) — merged into Surface 2.

### PR 3 (Mechanical Migration)
~50 files across the 6 subagent groups. List finalised when `writing-plans` produces the implementation plan.

---

## 12 · Next action

Owner reviews this spec. If approved, the next step is `superpowers:writing-plans` to break PR 1 / PR 2 / PR 3 into ordered implementation tasks ready for `subagent-driven-development`.
