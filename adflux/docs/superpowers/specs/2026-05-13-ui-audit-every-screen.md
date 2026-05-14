# UI Audit — Every Screen (2026-05-13)

Scope: visual consistency only. Logic, RLS, data fetches, PDFs out of scope. Source-of-truth: `src/styles/tokens.css` + `src/styles/v2.css` + CLAUDE.md §5–§7.

---

## 1 · Executive summary

Design drift is **systemic, not local**. The codebase shows three generations of UI primitives layered on top of each other and never reconciled:

1. **Old V1 globals** (`globals.css` + `legacy-compat.css` + `--gray`/`--brd`/`--y` shorthand vars) — still consumed by `OfferForm.jsx`, `QuoteDetail.jsx`, all wizard/modal components.
2. **Lead module** (`leads.css` + `lead-*` classes + V1 tokens) — used by 6 pages; defines a near-duplicate `lead-page-head/title` parallel to `v2d-page-head/title`.
3. **V2 desktop** (`v2.css` + `v2d-*` classes + `--v2-*` tokens) — used by ~14 pages; the canonical newer system.
4. **V2 Hero** (`V2Hero.jsx`) — newest layer (Phase 34R), used by only 2-3 pages with no rule about when to mount it.

Page headings alone use 4 distinct patterns across 36 pages. Tint chips for status badges live as 38 token usages plus ~80 hardcoded `rgba()` duplicates across CockpitWidgets, GovtProposalDetail, MasterV2. Brand-violation `#facc15` is now gone from code (only comments mention it), but a sibling violation `#fbc42d` exists as the fallback in `var(--v2-yellow, #fbc42d)`. Browser `alert()` / `confirm()` still ships in 17 places despite Phase 34A introducing `pushToast` / `confirmDialog`. Inline `style={{…}}` density on MasterV2 / WorkV2 / AdminDashboardDesktop runs 85–211 occurrences per file, with 19 instances of ≥5-property inline style on MasterV2 alone — a refactor smell, not just an aesthetic one.

Verdict: the owner is right. The app reads as three different products because it is.

---

## 2 · P0 — brand violations

CLAUDE.md §20 hard fails.

| File:Line | Issue | Fix shape |
|---|---|---|
| `src/components/quotes/QuoteWizard/Step2Campaign.jsx:228` | `'1px solid var(--v2-yellow, #fbc42d)'` — fallback is off-brand amber yellow, not brand `#FFE600` | Change fallback to `#FFE600` |
| `src/components/quotes/QuoteWizard/Step2Campaign.jsx:234` | `'var(--v2-yellow, #fbc42d)'` same | Same |
| `src/components/v2/PeriodPicker.jsx:161` | `background: 'var(--v2-yellow, #fbc42d)'` same | Same |
| `src/styles/leads.css:117-122` | `.lead-avatar.av-1..av-6` use light-pastel hex pairs (`#fef3c7`/`#92400e`, etc.) — not in any token | Move to `--avatar-*` tokens or accept as designed exception |
| `src/styles/leads.css:315` | `background: linear-gradient(135deg, #faf7ff, #f3f8ff)` — off-token light gradient | Replace with token / accept as designed |
| `src/styles/leads.css:329` | `background: #c084fc` (purple pulse dot) — undefined token `--purple` exists locally but not in `tokens.css` | Promote `--purple` to global token or replace |
| `src/styles/leads.css:619-688` | 8 hex codes for hero gradient `#0d3d3a/#134e4a/#0f766e/#1c5856/#86efac/#fca5a5` — duplicate of `V2Hero.jsx:25-27` and `v2.css:61` | Consolidate into `--grad-hero` token |
| `src/components/v2/V2Hero.jsx:25-27,55,60` | Hero gradient + `#fca5a5`/`#86efac` are hardcoded literal hex, with `--accent`-token fallback only for the yellow dot | Pull gradient into `--grad-hero` token used by both V2Hero and leads.css |
| `src/components/v2/ConfirmDialog.jsx:71` | `state.danger ? '#fff' : '#0b1220'` — hardcoded ink colors, ignores `--accent-fg` token | Use `var(--accent-fg, #0f172a)` for accent button text |
| `src/pages/OfferForm.jsx:37,40,41,69-79` | Uses `var(--red)`, `var(--gray)`, `var(--card)`, `var(--brd)` — `--red` and `--card` are **undefined** in any CSS file | Migrate to `--danger`, `--text-muted`, `--surface`, `--border` |
| `src/pages/OfferForm.jsx:527` | `color: '#ef9a9a'` Material-palette pink, not token | Use `var(--danger)` |
| `src/pages/QuoteDetail.jsx:477,479,484,660,669` | 5 hardcoded Material palette hex (`#ef9a9a`, `#81c784`, `#ffb74d`) | Use `--danger` / `--success` / `--warning` tokens |
| `src/pages/v2/GovtProposalDetailV2.jsx:1613-2318` | 22 hardcoded Material-palette hex (`#64b5f6`, `#81c784`, `#ef9a9a`, `#fbbf24`, `#cdd9e6`, `#ffc107`) for status/info chips and accents | Bulk migrate to status tokens + tint tokens |
| `src/pages/v2/MasterV2.jsx:363-2218` | 17 hardcoded Material-palette hex (mirrors GovtProposalDetail) | Bulk migrate. CLAUDE.md §23 line 6 is **stale** — there are no `#facc15` / `#0a0e1a` left in MasterV2, but the Material-palette violations remain and are the real owner-deferred item |
| `src/pages/v2/LeadUploadV2.jsx:162,605-680` | 10 hardcoded `#f87171`/`#fbbf24`/`#4ade80`/`#60a5fa` (Tailwind palette) | Use status tokens |
| `src/pages/v2/AdminDashboardDesktop.jsx:896,1316,1548-1550` | 5 hardcoded color literals incl. `#f97316` (orange not in tokens) | Use status tokens + new `--orange` if needed |
| `src/pages/v2/TeamDashboardV2.jsx:212-213` | Indigo hero gradient hardcoded (`#1e1b4b/#312e81/#4338ca`) — drifts from teal-hero pattern used elsewhere | Decide: keep distinct (then make `--grad-team` token) or unify with `--grad-hero` |
| `src/pages/v2/WorkV2.jsx:1753` | `accent="#A78BFA"` purple literal as a prop | Token |
| `src/pages/v2/CreateQuoteOtherMediaV2.jsx:335,345` | Tailwind `#f87171` for required-asterisk + error | Token |
| `src/pages/v2/PendingApprovalsV2.jsx:140` | `color: '#ef9a9a'` Material pink | Token |
| `src/pages/v2/TaPayoutsAdminV2.jsx:730` | `'#94A3B8'` — equivalent to `--text-muted` but raw hex | Token |
| `src/components/dashboard/CockpitWidgets.jsx:164,182,279-636` | 23 hardcoded color literals — full tint-chip palette redefined locally rather than imported from `--tint-*` | Single biggest brand-token refactor. Already in scope per CLAUDE.md §26 Sprint D "What's left" #1 |
| `src/components/leads/UpcomingTasksCard.jsx` (15 sites) | New file from Sprint F — same `#fbbf24`/`#4ade80`/`#f87171` Tailwind palette as LeadUpload | Use status tokens (regressed Sprint D's progress) |
| `src/components/copilot/CopilotModal.jsx:131,156,208` | `#c084fc` / `#fbbf24` / `#4ade80` / `#60a5fa` | Use `--tint-purple` + status tokens |
| `src/components/incentives/IncentiveMiniPill.jsx:95,105,110` | Ink fallbacks `#f5f7fb`, `#6a7590` are correct v2 colors but inlined | Drop fallback — `--v2-ink-*` is always defined when v2.css is loaded |
| `src/components/leads/MeetingsMapPanel.jsx:207-309` | 9 inline `var(--v2-*, #hex)` patterns — same pattern as IncentiveMiniPill | Same |
| `src/components/v2/Toast.jsx` (6 sites) | Hardcoded status colors | Audit + tokenise |
| `src/components/v2/PeriodPicker.jsx` (4 sites) | Yellow / dark hex | Token |
| `src/components/quotes/QuotePDF.jsx`, `OtherMediaQuotePDF.jsx`, `hr/OfferLetterPDF.jsx` | Light-theme `#e2e8f0`/`#cbd5e1`/`#f8fafc` hex | **Owner-deferred per CLAUDE.md §9** (PDFs print white paper; day-theme palette intentional). Flag only — do not change |
| `src/styles/govt.css:480-740` | 20 `#fff`/`#111`/`#444` print-target literals | Same — print stylesheet, leave alone |

**Emoji audit:** clean per CLAUDE.md §20. Five intentional sites:
- `V2AppShell.greetingFor` (Phase 34Z.1, owner approved) — wave/sun emoji in greeting.
- `WorkV2.jsx:1121-1157` (replaced emoji with Lucide — comment only).
- `StaffTable.jsx:38` (`🎉` next to incentive-eligible badge) — borderline; flag.
- `MyPerformance.jsx:188` (`🎉` in streak congratulations copy) — borderline; flag.
- `WonPaymentModal.jsx:157` (`💰` in "Mark as Won" title) — borderline; flag.
- `AdminDashboardDesktop.jsx:899,1772` (`⚡`, `🎉`) — borderline; flag.
- `SalesDashboardDesktop.jsx:523,660` (`⚡` and `₹/◎/⏱/📞` glyphs) — `₹` is fine; the rest are emoji.

These five `StaffTable / MyPerformance / WonPayment / AdminDashboardDesktop / SalesDashboardDesktop` cases were added before Phase 34Z's owner-approved greeting carve-out and are not in the greeting code path. Flag as P0 unless the owner explicitly blesses them.

**Wrong-icon-library:** clean. `lucide-react` is the only icon import across the codebase.

---

## 3 · P1 — visual drift

### Typography

| File:Line | Issue |
|---|---|
| `src/styles/leads.css:153` vs `src/styles/v2.css:1250` | Two page-title classes with same intent, **different weights** (`lead-page-title` 600 vs `v2d-page-title` 700) and same 26px size. Used on disjoint page sets |
| `src/pages/v2/*` (36 files) | 4 distinct page-heading patterns: (a) `v2d-page-title` h1 — 13 pages; (b) `lead-page-title` div — 6 pages; (c) `<V2Hero>` only — 3 pages; (d) no heading — 14 pages. No documented rule for which page uses which |
| `src/pages/v2/AdminDashboardDesktop.jsx:939,950,963,974,985` | 5 inline `fontSize: 28` overrides on `v2d-hero-big` — the class already sets a size; the inline overrides break the type scale per page |
| All v2 pages | Inline `fontSize` values used: 9, 10, 11, 11.5, 12, 12.5, 13, 14, 15, 16, 17, 18, 20, 22, 24, 26, 28 (17 distinct sizes across ~500 sites) — no scale enforced |
| 4 sites | `fontSize: 11.5` and `fontSize: 12.5` — fractional sizes that don't snap to a scale anywhere |
| Multiple | Two heading-font tokens both in use: `var(--v2-display)` (24 sites) and `var(--font-display)` (19 sites). They resolve to the same Space Grotesk — but the duplication signals the migration was never completed |
| 17 sites | `fontFamily: 'monospace'` literal instead of `var(--font-mono)` — fallback renders as system mono (could be Menlo or Courier), not JetBrains Mono |
| `src/pages/v2/MasterV2.jsx`, `GovtProposalDetailV2.jsx` | Currency / phone / ID columns NOT in `--font-mono` — sales reps comparing 4 phone numbers see them rag-align in DM Sans |

### Iconography

| File:Line | Issue |
|---|---|
| All v2 pages, ~80 sites | Lucide icon sizes 10, 11, 12, 13, 15, 17, 20, 24, 28, 32, 40 used — only 14/16/18/22 are legal per CLAUDE.md §7 |
| All v2 pages, ~20 sites | strokeWidth 1.8/2/2.2/2.4 used — only 1.6 is legal |
| `src/components/v2/V2Hero.jsx:147-148` | `strokeWidth={1.8}` for TrendingUp/Down — out of spec |

### Spacing / radii

| File:Line | Issue |
|---|---|
| `src/pages/v2/QuoteDetail.jsx:516,562` | `borderRadius: 20`, `borderRadius: 7` — 7 is off-scale (legal: 6/8/9/12/14/16/999) |
| `src/pages/v2/EveningVoiceV2.jsx:218,222` + `VoiceLogV2.jsx:354,358` | `borderRadius: 24` + `borderRadius: 20` for "phone screen" mock — intentional? if so token it |
| `src/components/incentives/MyPerformance.jsx:350` | `borderRadius: 20, padding: '1px 8px'` for pill — should be 999 |
| `src/pages/v2/MasterV2.jsx:105` | `borderRadius: 7` — illegal |
| `src/pages/v2/EveningVoiceV2.jsx:218` | `borderRadius: 24` — illegal |
| ~40 sites total | `borderRadius: 4` — legal scale starts at 6; 4 is sub-scale (used in PDFs deliberately; not in JSX) |
| `MasterV2.jsx` padding distribution | 15 distinct padding values across one file: `'2px 6px'`, `'4px 6px'`, `'4px 8px'`, `'4px 10px'`, `'5px 10px'`, `'6px 8px'`, `'6px 12px'`, `'6px 14px'`, `'7px 14px'`, `'8px 12px'`, `'8px 14px'`, `'10px 12px'`, `'12px 14px'`, `'14px 12px'`. No spacing scale enforced |

### Layout / hero usage

| File:Line | Issue |
|---|---|
| 33 of 36 v2 pages | Do **not** mount `<V2Hero>` despite Phase 34R intending it "across /work, /leads, /follow-ups, /quotes, /telecaller, /my-performance" (per V2Hero.jsx:5-7). Actual usages: WorkV2 (2 mounts), TaPayoutsAdminV2 (1), WonPaymentModal (1), IncentiveHeroCard (1). 5 of 7 intended pages still missing |
| `src/pages/v2/AdminDashboardDesktop.jsx`, `SalesDashboardDesktop.jsx`, `SalesDashboard.jsx`, `TeamDashboardV2.jsx` | Use their own bespoke hero/banner markup — `v2d-hero v2d-hero--action`, `v2-banner`, `v2-glance-head`. Three more heading patterns on top of the four already counted |

### Hover states / focus

| File:Line | Issue |
|---|---|
| ~243 `<button>` elements in v2 pages | Only ~25 use a `btn`/`btn-y`/`btn-primary` class with defined `:hover`. Most are bare `<button style={{…}}>` with NO hover/focus CSS — CLAUDE.md §6 #6 + #11 violations |
| `src/pages/v2/MasterV2.jsx` | 211 inline-style sites; most interactive elements are inline divs/buttons without hover or focus styling |
| Only 1 file uses `onMouseEnter` for hover state | Means hover is mostly absent rather than implemented in JS |

### Sidebar / nav

| File:Line | Issue |
|---|---|
| `src/components/v2/V2AppShell.jsx:374-381` | `<Sparkles size={14} style={{ color: '#c084fc' }} />` inside greeting bar — hardcoded purple instead of `--tint-purple` |

---

## 4 · P2 — polish

| File:Line | Issue |
|---|---|
| `src/pages/v2/SalesDashboard.jsx:340` | Loading state = plain `<div style={{ padding: 60, textAlign: 'center' }}>Loading…</div>` — no spinner, no skeleton |
| `src/pages/v2/AutoDistrictsV2.jsx:121`, `GsrtcStationsV2.jsx:207` | `<tr><td colSpan><em>Loading…</em></td></tr>` — italicised "Loading…" inside a table row; inconsistent with `.v2d-loading` spinner used on 3 other pages |
| `src/pages/v2/LeadDetailV2.jsx:1012` | Empty state = inline `<div className="lead-card-pad" style={{ color: 'var(--text-muted)', fontSize: 12 }}>` — bare text, no icon, no CTA. Compare to `.v2d-empty-card` (with icon + title + sub + button) used by QuotesV2 |
| `src/pages/v2/AdminDashboardDesktop.jsx:1264,1381,1787` | `v2d-q-empty` empty state has no shared definition I can find — multiple sites use the same string with bare-div fallback styling |
| 17 sites use `alert()` / `confirm()` | `PaymentHistory.jsx:154`, `RepDayTools.jsx:122`, `OfferDetailModal.jsx:198`, `TaPayoutsAdminV2.jsx:159/183/195/234/248`, `QuotesV2.jsx:71`, `LeavesAdminV2.jsx:150`, `MasterV2.jsx:253/313/1562/1620/2347`, `PendingApprovalsV2.jsx:69/90/99/113`, `ClientsV2.jsx:488`, `IncentivePayoutModal.jsx:62`, `QuoteDetail.jsx:459`, `GovtProposalDetailV2.jsx:1561/1586/1907` — Phase 34A delivered `pushToast`/`confirmDialog` but adoption stopped at 5 sites |
| `src/components/v2/V2AppShell.jsx` and per-page `<header>` | No standardised mobile header height — some pages stick the heading under `--topbar-height: 60px`, others scroll it |
| Z-index distribution | 14 distinct z-index values in inline styles: `2, 9, 10, 20, 40, 50, 60, 100, 200, 999, 1000, 9999, 10000` — no layering scale |
| `ConfirmDialog`, `CopilotModal`, `WonPaymentModal`, `OfferDetailModal`, `LogMeetingModal`, `LogActivityModal`, `PaymentModal` | 7+ separately implemented modal shells. All differ in close-button position, backdrop opacity (`0.4` vs `0.55` vs `0.7`), header padding, footer button order, max-width |
| `src/pages/v2/MasterV2.jsx:875/878/1134/1137/1670/1673` | Status banner repeats 3× in the same file with identical inline styles (`background: 'rgba(76,175,80,.1)', border: '1px solid rgba(76,175,80,.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: '.82rem', color: '#81c784'`) — copy-paste, not a component |
| Day theme | `tokens.css` only declares dark. `v2.css` declares a light override `[data-theme="day"]` (line ~687). CLAUDE.md §6 #2 says "renders in both Night and Day theme" — Day theme has only been wired for PDF day-palette (govt.css) but not exposed via any toggle |
| Focus rings | No `:focus-visible` rules in any file searched. Sidebar links + all custom buttons fail CLAUDE.md §6 #11 |
| `src/pages/OfferForm.jsx` (public candidate page) | Uses tokens `--red`/`--card`/`--brd` that are partially undefined — `--red` not in any CSS file. Page renders with browser-default red for the `*` asterisk. Public-facing brand-perception risk |
| Sticky bottom action bars | Searched — none found. `/work`, `/leads`, `/follow-ups` have no fixed bottom CTA, which contradicts the mobile-primary directive on `/work`. Flag for owner |

---

## 5 · Cross-page inconsistency

| Pattern | Variants | Where |
|---|---|---|
| **Page heading** | 4 implementations | (a) `v2d-page-head` + `v2d-page-title` h1 in 13 pages; (b) `lead-page-head` + `lead-page-title` div in 6 pages; (c) `<V2Hero>` only in WorkV2 (2 mounts) + TaPayoutsAdminV2; (d) bespoke `v2d-hero v2d-hero--action` markup in AdminDashboardDesktop, SalesDashboardDesktop, TeamDashboardV2, SalesDashboard |
| **Status banner** (success / error inline) | 3 implementations | (i) MasterV2 copy-paste pattern (6 sites — see P2 above); (ii) `pushToast` (the new contract, ~5 adoptions); (iii) `setError` + inline div used by QuoteDetail/OfferForm/PendingApprovals/LeadUpload |
| **Confirmation dialog** | 2 implementations | (i) `confirmDialog()` from Phase 34A — 4 sites; (ii) `window.confirm()` — 13 sites |
| **Modal shell** | 7+ implementations | `ConfirmDialog` (v2), `CopilotModal`, `WonPaymentModal`, `OfferDetailModal`/`SendOfferModal`, `LogMeetingModal`/`LogActivityModal`/`ChangeStageModal`/`ReassignModal`, `PaymentModal`, `BulkRateModal`/`CityModal`, `TeamMemberModal`/`StaffModal`. Each has its own backdrop opacity, header padding, footer order |
| **Empty state** | 3 implementations | (a) `v2d-empty-card` + `v2d-empty-t`/`v2d-empty-s` (QuotesV2, TaPayoutsAdminV2 — the canonical one); (b) `v2d-q-empty` bare div (AdminDashboardDesktop ×3); (c) `lead-card-pad` inline text (LeadDetailV2). Plus several "No X yet" bare strings |
| **Loading state** | 4 implementations | (i) `v2d-loading` + `v2d-spinner` class (RenewalToolsV2, SalesDashboardDesktop, PendingApprovalsV2); (ii) `<Loader2>` lucide with inline `animation: 'spin 1s linear infinite'` (MasterV2, GovtProposalDetailV2); (iii) bare `<div style={{padding:60}}>Loading…</div>` (SalesDashboard); (iv) `<em>Loading…</em>` in `<td>` (AutoDistrictsV2, GsrtcStationsV2) |
| **Status pill / chip** | 4 implementations | (a) `--tint-*` token usage — 38 sites (the canonical pattern from Phase 34R); (b) hardcoded rgba pairs duplicating those tokens — `CockpitWidgets` (21 sites), `GovtProposalDetailV2` (16), `MasterV2` (14), `AdminDashboardDesktop` (6); (c) `.pill-blue`/`.pill-amber` etc. classes in `leads.css:140`; (d) inline-only `background: 'rgba(...)' color: '#...'` chips with no class |
| **Page wrapper / canvas** | 3 implementations | `v2-canvas` (SalesDashboard), `v2d` (V2AppShell main), `lead-canvas` (lead pages — search confirms it's a class) |
| **Form input** | 3 implementations | (a) `.fg input` from legacy-compat.css; (b) `.v2-input` / `.v2d-input` from v2.css; (c) `.lead-input` from leads.css |
| **Button** | 3+ implementations | (a) `.btn .btn-primary/-y/-ghost/-secondary/-danger` from globals.css (~25 sites); (b) `.v2-btn` / `.v2d-btn` from v2.css (occasional); (c) bare `<button style={{…}}>` with no class (>200 sites); (d) `.btn-icon` in StaffModal |
| **Hero card** | 4 implementations | (i) `<V2Hero>` component; (ii) `v2d-hero v2d-hero--action` class on AdminDashboardDesktop; (iii) `v2-banner` on SalesDashboard; (iv) `lead-hero-stat` / `lead-hero` block in leads.css (~70 LOC of duplicate gradient + stat-pair styling) |

---

## 6 · Component extraction candidates

| Candidate | Where it exists today | Estimated win |
|---|---|---|
| `<PageHeader>` (or canonical `<V2Hero>` for every page) | 4 distinct patterns across 36 pages | ~150 LOC removed; one place to enforce h1 hierarchy + breadcrumb + page-action button slot. Closes the "every page looks different at the top" complaint outright |
| `<Modal>` shell (header / body / footer slots + backdrop) | 7+ ad-hoc implementations | ~250 LOC removed across modals; standardises close-button position, backdrop, body padding, footer button alignment, mobile full-screen breakpoint |
| `<StatusBadge tint="success\|warning\|danger\|blue\|purple\|yellow">` | 38 token sites + ~80 hardcoded duplicate-rgba sites = ~118 sites | ~200 LOC removed; closes the chip-tint drift permanently. CockpitWidgets alone drops 21 inline rgba pairs |
| `<EmptyState icon title sub action>` (canonical = `v2d-empty-card`) | 3 patterns across ~12 sites | ~80 LOC removed; gives a place to standardise icon size + illustration |
| `<LoadingState type="page\|table\|inline">` | 4 patterns across ~10 sites | ~40 LOC removed; gives skeleton variant for tables |
| `<Banner tone="success\|warning\|danger\|info" dismissable>` (replaces the MasterV2 status-banner copy-paste + QuoteDetail / PendingApprovals inline banners) | ~10 sites | ~100 LOC removed |
| `<ActionButton variant="primary\|ghost\|danger" size="sm\|md">` to replace bare inline-styled `<button>` | ~200 sites | ~600 LOC removed (inline style props per button). Biggest win by volume; biggest behavior win (hover + focus + disabled states in one place) |
| `numberFormat` / `currencyFormat` mono-wrap component (Space Grotesk + `--font-mono` rules) | scattered inline `fontFamily: 'monospace'` and bare digit renders | Closes CLAUDE.md §6 #4 violations site-by-site |
| Single `--grad-hero` / `--grad-incentive` / `--grad-team` tokens | Duplicated literal gradients in `V2Hero.jsx`, `leads.css:619-670`, `v2.css:61-63/706-707`, `TeamDashboardV2.jsx:212` | ~30 LOC removed; brand gradient lives in one place |

Total estimated removal: ~1,200–1,500 LOC across ~50 files, with the dominant chunk being inline `<button>` styles.

---

## 7 · Recommendation

A single design-cleanup PR will not fix this. The drift exists because **two style-system migrations were started and neither finished** — V1→leads-css→V2-css→V2Hero — and every new feature picks whichever layer the last patch used.

The correct sequence is one preparation PR then one cleanup PR, gated by the prep:

**Prep PR (~3 days):** decide the canonical primitives and ship them as components: `<PageHeader>`, `<V2Hero>` (already exists; document when to use it vs PageHeader), `<Modal>`, `<StatusBadge>`, `<EmptyState>`, `<LoadingState>`, `<Banner>`, `<ActionButton>`. Add `--grad-hero` token. Add the missing `--red` / `--card` to `legacy-compat.css` or migrate `OfferForm` off them. Add `--orange` if the owner wants warm orange to remain a status color. No page changes in this PR — just primitives + a one-page "use this not that" reference in `docs/`.

**Cleanup PR (~5–7 days, parallelisable):** mechanical migration of all 36 pages + 50 components to the new primitives. This is where the brand violation table (P0) gets fixed in bulk, the alert/confirm holdovers get swept, the inline-style button sprawl gets collapsed, and the `lead-*` parallel classes get removed in favor of `v2d-*` + `lead-*`-suffixed variant tokens if leads genuinely needs a different look. The work is mostly find/replace once primitives exist, but a sales-rep-blind smoke test on `/work`, `/leads`, `/quotes`, `/cockpit` is non-negotiable before merge.

Doing this as one cleanup PR without the prep PR will produce another patch chain. Doing only the prep PR without the cleanup will leave the visible drift in place. Both, in that order, and in two weeks the owner stops feeling the 14px-vs-16px paper cut.
