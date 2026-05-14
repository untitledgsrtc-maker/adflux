# PR 2 — Sales Mobile v2.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Rebuild `/work` + V2AppShell mobile chrome as ONE coherent module, fix 5 real P0 bugs, end the Phase 34Z sub-letter chain in those files. Net LOC change: -300 to -500 in `WorkV2.jsx`.

**Architecture:** Drop `/work`'s 5-state machine (`A_PLAN / A_CHECKIN / B_ACTIVE / C_CHECKOUT / D_DONE`). Replace with 3 always-visible surfaces where content (not which card renders) changes by state. Mobile V2AppShell shrinks to 4 nav tabs + hides IncentiveMiniPill since the full purple incentive card already mounts on /work. Consume PR 1 primitives (`<PageHeader>`, `<Modal>`, `<EmptyState>`, `<ActionButton>`, etc.) wherever a primitive replaces a bespoke implementation. Map provider switches OSM → MapTiler via `import.meta.env.VITE_MAPTILER_KEY`.

**Tech Stack:**
- React 18 + Vite + React Router v6
- Zustand for global state (existing)
- Supabase Postgres (no schema changes in this PR)
- PR 1 primitives at `src/components/v2/primitives/`
- Leaflet + MapTiler tiles
- `lucide-react`
- `esbuild` for parse-check; `scripts/check-jsx-brand.sh` for brand-check

**No automated test framework** — verification is owner walkthrough on Vercel staging across iPhone PWA (390 px) + desktop (1440 px).

---

## File Structure

**Modify:**
- `src/pages/v2/WorkV2.jsx` — full rebuild (1,799 → ~1,300 LOC). Drop state machine; render 3 surfaces with state-dependent content.
- `src/components/v2/V2AppShell.jsx` — mobile chrome rebuild: 4-tab `MOBILE_NAV_SALES` (drop "New" tab); hide `IncentiveMiniPill` on mobile via `useMediaQuery` or pathname check; clean patch-chain comments from JSX bodies.
- `src/components/v2/Toast.jsx` — accept `bottomGap` prop; drop CSS `!important` workaround.
- `src/styles/v2.css` — remove the `.v2-toast-viewport` `!important` override.
- `src/components/leads/MeetingsMapPanel.jsx` — switch tileLayer URL to MapTiler; drop one of the two `invalidateSize()` ticks (now only needed inside conditional render guard).
- `src/pages/v2/LeadDetailV2.jsx` — replace OCR `confirm()` loop with single `<Modal>` (P0-2).
- `src/pages/v2/QuotesV2.jsx` — replace `confirm()` + `alert()` at lines 68-72 with `confirmDialog` + `toastError` (P0-1).
- `CLAUDE.md` — append §27 emoji waiver.

**Delete (after re-verifying no consumers):**
- `src/components/incentives/IncentiveHeroCard.jsx` (dead since Phase 34Z.3).
- `src/components/leads/UpcomingTasksCard.jsx` (merged into Surface 2 of new WorkV2).

**Touch only if confirmed dead by grep:**
- `src/components/leads/TodayTasksBreakdown.jsx` (if external definition exists; else inline definition in WorkV2.jsx is gutted as part of the rebuild).

---

## Task 1: Pre-flight + branch hygiene

**Files:** none (verification only)

- [ ] **Step 1: Confirm PR 1 is on the branch**

Run from `/Users/apple/Documents/untitled-os2/Untitled/adflux`:

```bash
git rev-parse phase-35-pr1-primitives && git log --oneline phase-35-pr1-primitives -1
```

Expected: SHA `f8e7a79` (or later if owner committed during smoke).

- [ ] **Step 2: Confirm Vercel deployed PR 1 cleanly (no rollback)**

Owner-side: confirm `/primitives-demo` and `/settings` are live on `https://untitled-os-tau.vercel.app`. If anything is broken, fix BEFORE starting PR 2.

- [ ] **Step 3: Confirm MapTiler env var is set on Vercel**

Owner-side. Setup → Environment Variables → `VITE_MAPTILER_KEY` is present (Production + Preview + Development). Without this, Task 3 will ship a broken map on staging.

If the var is missing, owner adds it from `https://vercel.com/dashboard` before Task 3 runs. The local `.env` file already has it (see PR 1 close).

- [ ] **Step 4: Verify spec ban is intact**

```bash
git log --oneline phase-35-pr1-primitives..HEAD | grep -E "Phase 34Z\.[4-9]|Phase 35[a-z]" || echo "BAN HOLDS"
```

Expected: `BAN HOLDS`. No sub-letter patches snuck in between PR 1 close and PR 2 open.

---

## Task 2: CLAUDE.md §27 — emoji waiver

**Files:**
- Modify: `CLAUDE.md` — append section §27 at the end.

- [ ] **Step 1: Locate end of file**

Run: `tail -10 CLAUDE.md`
Expected: shows §26 closing block.

- [ ] **Step 2: Append §27**

Append after the existing last line:

```markdown

---

## 27 · Emoji waivers (2026-05-13)

Emoji are forbidden by default per §7 + §20. The following site-specific waivers are owner-approved:

| Site | Glyphs | Approved in | Notes |
|---|---|---|---|
| `V2AppShell.greetingFor()` | `☀️ ⛅ 🌙` | Phase 34Z.1 | Time-band suffix on the greeting; replaces three Lucide icons that didn't carry enough warmth |

No other emoji exceptions. The five sites flagged in the 2026-05-13 UI audit (`StaffTable.jsx:38 🎉`, `MyPerformance.jsx:188 🎉`, `WonPaymentModal.jsx:157 💰`, `AdminDashboardDesktop.jsx:899/1772 ⚡🎉`, `SalesDashboardDesktop.jsx:523/660 ⚡`) are NOT in this table and must be migrated to Lucide icons during PR 3.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "Phase 35 PR 2: CLAUDE.md §27 — emoji waiver"
```

---

## Task 3: MeetingsMapPanel → MapTiler

**Files:**
- Modify: `src/components/leads/MeetingsMapPanel.jsx`
- Modify: `public/sw.js` (service worker tile cache rule)

- [ ] **Step 1: Read current tileLayer init**

Locate the `L.tileLayer(...)` call in `MeetingsMapPanel.jsx`. Currently:

```js
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap',
  crossOrigin: true,
}).addTo(mapRef.current)
```

- [ ] **Step 2: Switch URL to MapTiler**

Replace with:

```js
// Phase 35 PR 2 — switched OSM operational tiles to MapTiler. OSM
// policy explicitly discourages production use of tile.openstreet
// map.org; MapTiler's free tier covers 100k requests/month, well
// above the rep team's expected traffic. Key lives in env var so
// it never enters git. If the key is missing at build time, fall
// back to OSM with a console warning — better than a blank map.
const mtKey = import.meta.env.VITE_MAPTILER_KEY
if (!mtKey) {
  console.warn('[MeetingsMapPanel] VITE_MAPTILER_KEY missing — falling back to OSM')
}
const tileUrl = mtKey
  ? `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${mtKey}`
  : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const attribution = mtKey
  ? '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
  : '&copy; OpenStreetMap'

L.tileLayer(tileUrl, {
  maxZoom: 19,
  attribution,
  crossOrigin: true,
}).addTo(mapRef.current)
```

- [ ] **Step 3: Update service worker tile cache rule**

Open `public/sw.js`. The current cache rule matches `tile.openstreetmap.org` + cartocdn. Add `api.maptiler.com` to the matcher:

Find this block (around line 47):

```js
registerRoute(
  ({ url }) => url.host === 'tile.openstreetmap.org'
            || url.host.endsWith('.tile.openstreetmap.org')
            || url.host === 'a.basemaps.cartocdn.com'
            || url.host === 'b.basemaps.cartocdn.com'
            || url.host === 'c.basemaps.cartocdn.com',
```

Add the MapTiler host:

```js
registerRoute(
  ({ url }) => url.host === 'tile.openstreetmap.org'
            || url.host.endsWith('.tile.openstreetmap.org')
            || url.host === 'api.maptiler.com'
            || url.host === 'a.basemaps.cartocdn.com'
            || url.host === 'b.basemaps.cartocdn.com'
            || url.host === 'c.basemaps.cartocdn.com',
```

- [ ] **Step 4: Drop the double invalidateSize workaround**

In `MeetingsMapPanel.jsx`, the current effect calls `invalidateSize()` twice (one in `requestAnimationFrame`, one in `setTimeout 80ms`). MapTiler tiles load reliably; one `requestAnimationFrame` call is sufficient once the panel renders only when `open === true`.

Remove the `setTimeout(80)` block. Keep the `requestAnimationFrame` call.

- [ ] **Step 5: Verify the panel renders only when `open`**

Check the JSX render block — if the `<div ref={mapElRef} />` mounts even when `open === false`, conditional-render it instead so Leaflet never initialises into a height-0 container. The current code at MeetingsMapPanel.jsx already gates with `{open && (...)}` per Phase 34Z.1 — confirm.

- [ ] **Step 6: Parse-check + brand-check**

```bash
npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/components/leads/MeetingsMapPanel.jsx >/dev/null
bash scripts/check-jsx-brand.sh src/components/leads/MeetingsMapPanel.jsx
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/leads/MeetingsMapPanel.jsx public/sw.js
git commit -m "Phase 35 PR 2: MeetingsMapPanel — switch tiles to MapTiler"
```

---

## Task 4: Toast viewport bottomGap prop

**Files:**
- Modify: `src/components/v2/Toast.jsx` — accept `bottomGap` prop, drop CSS `!important`.
- Modify: `src/styles/v2.css` — remove the `.v2-toast-viewport` mobile override.
- Modify: `src/components/v2/V2AppShell.jsx` — pass `bottomGap={64}` when the mobile bottom nav is showing (i.e. on sales pages with `<860px viewport).

- [ ] **Step 1: Update ToastViewport to accept the prop**

Open `src/components/v2/Toast.jsx`. Find the `ToastViewport` function. Currently:

```jsx
export function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  if (!toasts.length) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="v2-toast-viewport"
      style={{
        position: 'fixed',
        right: 16,
        bottom: 'max(16px, calc(env(safe-area-inset-bottom, 0px) + 16px))',
        ...
```

Replace with:

```jsx
/**
 * @param {object} props
 * @param {number} [props.bottomGap=16] — extra px above the bottom edge
 *   (default 16; pass 64+safe-area when a fixed bottom nav sits behind
 *   the toast). Replaces the Phase 34Z !important CSS override.
 */
export function ToastViewport({ bottomGap = 16 } = {}) {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  if (!toasts.length) return null

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        right: 16,
        bottom: `calc(${bottomGap}px + env(safe-area-inset-bottom, 0px))`,
        ...
```

Drop the `className="v2-toast-viewport"` since the CSS override is no longer needed.

- [ ] **Step 2: Remove the v2.css override**

Open `src/styles/v2.css`. Search for `.v2-toast-viewport` (around line 1067-1071). Remove the entire rule block:

```css
/* DELETE THIS BLOCK */
@media (max-width: 860px) {
  .v2-toast-viewport {
    bottom: calc(64px + env(safe-area-inset-bottom, 0px) + 12px) !important;
  }
}
```

- [ ] **Step 3: Pass bottomGap from V2AppShell**

Open `src/components/v2/V2AppShell.jsx`. The shell currently renders `<ToastViewport />` near the end. Conditionally pass the prop based on whether the mobile bottom nav is visible:

```jsx
// At top of V2AppShell component body (where other useState/useEffect blocks live):
const [isMobile, setIsMobile] = useState(false)
useEffect(() => {
  if (typeof window === 'undefined') return
  const mql = window.matchMedia('(max-width: 860px)')
  const update = () => setIsMobile(mql.matches)
  update()
  if (mql.addEventListener) mql.addEventListener('change', update)
  else mql.addListener(update)
  return () => {
    if (mql.removeEventListener) mql.removeEventListener('change', update)
    else mql.removeListener(update)
  }
}, [])

// ...later in render:
<ToastViewport bottomGap={isMobile ? 76 : 16} />
```

Why 76: the bottom nav is 64 px tall + 12 px gap = 76. Toast sits exactly 12 px above the nav with safe-area inset added below.

- [ ] **Step 4: Parse-check**

```bash
npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/components/v2/Toast.jsx >/dev/null
npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/components/v2/V2AppShell.jsx >/dev/null
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/v2/Toast.jsx src/styles/v2.css src/components/v2/V2AppShell.jsx
git commit -m "Phase 35 PR 2: Toast — bottomGap prop, drop !important override"
```

---

## Task 5: V2AppShell mobile chrome rebuild

**Files:**
- Modify: `src/components/v2/V2AppShell.jsx` — rebuild mobile nav + hide IncentiveMiniPill on mobile + purge stacked Phase-34 comments inside JSX.

- [ ] **Step 1: Revert MOBILE_NAV_SALES from 5 tabs to 4**

Find the `MOBILE_NAV_SALES` constant. Currently (Phase 34Z.2):

```jsx
const MOBILE_NAV_SALES = [
  { to: '/work',              label: 'Today',          icon: Sun },
  { to: '/follow-ups',        label: 'Follow-ups',     icon: ClockIcon },
  { to: '/leads/new',         label: 'New',            icon: Plus },
  { to: '/leads',             label: 'Leads',          icon: Inbox },
  { to: '/quotes',            label: 'Quotes',         icon: FileText },
]
```

Replace with:

```jsx
// Phase 35 PR 2 — locked to 4 tabs. /work now sticky-mounts the
// "Log meeting" CTA at the bottom of its scroll area, so the
// dedicated "New" tab is redundant. CLAUDE.md §3 (modules not
// patches): nav count fluctuated 3 → 4 → 5 across Phase 33A /
// 33J / 34Z.2; this is the stable shape.
const MOBILE_NAV_SALES = [
  { to: '/work',              label: 'Today',          icon: Sun },
  { to: '/follow-ups',        label: 'Follow-ups',     icon: ClockIcon },
  { to: '/leads',             label: 'Leads',          icon: Inbox },
  { to: '/quotes',            label: 'Quotes',         icon: FileText },
]
```

- [ ] **Step 2: Hide IncentiveMiniPill on mobile**

Find the topbar `<IncentiveMiniPill />` render (around line 397 in current file). Wrap conditionally:

```jsx
{!isMobile && <IncentiveMiniPill />}
```

(Reuses the `isMobile` state added in Task 4 Step 3.)

- [ ] **Step 3: Purge stacked Phase-34 comments inside JSX**

In the mobile-chrome section of V2AppShell (roughly lines 318-428 + 461-498 in current file), remove every comment block that explains a Phase 33-34 patch decision. Keep comments at function-doc level only. Move any historical context to the comment header at the top of the file.

Specifically delete comments matching patterns:
- `/* Phase 33G.4 — hamburger restored… */`
- `/* Phase 33G (A1/A2/A4) — … */`
- `/* Phase 34M — incentive mini-pill. Sales / agency / telecaller … */`
- `/* Phase 34Z — owner reported … */`
- `/* Phase 31O — moved the ProposedIncentiveCard up … */`
- `/* Phase 33G (C1) — owner audit (11 May) … */`
- `/* Phase 34S — May 13 UX audit … */`
- `/* Phase 34Z.3 (13 May 2026) — owner: "i want same card replica … */`

Reduce them to a single block at the TOP of the file in the existing comment header. Net comment removal: ~80 lines.

- [ ] **Step 4: Parse-check + ban audit**

```bash
npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/components/v2/V2AppShell.jsx >/dev/null
grep -nE "Phase 3[0-9][A-Z]?\.?[0-9]*" src/components/v2/V2AppShell.jsx | head -20
```

The grep can match phase-tagged comments in the file's top docstring (allowed). Acceptance: NO matches inside the return-tree JSX (lines 256-585 roughly).

- [ ] **Step 5: Commit**

```bash
git add src/components/v2/V2AppShell.jsx
git commit -m "Phase 35 PR 2: V2AppShell mobile chrome — 4 tabs + drop pill on mobile + comment purge"
```

---

## Task 6: WorkV2.jsx surface-driven rebuild

**Files:**
- Modify: `src/pages/v2/WorkV2.jsx` — full rebuild.

This is the biggest task. Split into clear sub-steps so review can catch regression.

- [ ] **Step 1: Snapshot current behaviour**

Read these blocks once and note what state each one handles so the rebuild doesn't drop a feature:

```bash
grep -n "stateName === 'A_PLAN'\|stateName === 'A_CHECKIN'\|stateName === 'B_ACTIVE'\|stateName === 'C_CHECKOUT'\|stateName === 'D_DONE'" src/pages/v2/WorkV2.jsx
```

List every branch. Each needs a content variant in the new surfaces. The state machine is dropped; the underlying conditions (`!session.plan_submitted_at`, `session.check_in_at`, `session.evening_report_submitted_at`) become content gates inside one surface.

- [ ] **Step 2: Replace the 5-state machine with three surfaces**

Restructure the WorkV2 return value as:

```jsx
return (
  <div className="lead-root">
    <div className="m-screen">

      {/* SURFACE 1 — Day status card (always visible) */}
      <DayStatusSurface session={session} ... />

      {/* SURFACE 2 — What's next (always visible) */}
      <NextActionSurface session={session} ... />

      {/* (scroll content: map, smart tasks, rep day tools) */}
      <MeetingsMapPanel userId={profile.id} />
      <RepDayTools workDate={...} checkedIn={...} />

      {/* SURFACE 3 — sticky bottom "Log meeting" CTA */}
      <StickyLogMeetingCta onClick={() => setMeetingModalOpen(true)} />

      {meetingModalOpen && (
        <LogMeetingModal ... />
      )}

    </div>
  </div>
)
```

Define `DayStatusSurface`, `NextActionSurface`, `StickyLogMeetingCta` as local components in the same file (keeps WorkV2 readable; each component handles ONE surface).

Inside `DayStatusSurface`, branch on `session?.check_in_at` and `session?.evening_report_submitted_at` to decide the CONTENT:
- No `plan_submitted_at` → "Plan today" + voice mic + form + Start My Day primary button.
- Plan submitted, no `check_in_at` → "Ready to check in" + GPS button.
- Checked in, no evening report → V2Hero progress block: `X / Y meetings logged · N calls · M new leads · K to go`.
- Evening report submitted → "Day done." + final counters + (re-)submit evening button.

Use `<PageHeader hero="full">` for the V2Hero variant when checked in. Use `<PageHeader>` with `subtitle` for the other variants.

Inside `NextActionSurface`, render the SINGLE highest-priority undone item by priority order:
1. Planned meeting with closest time (today, not done)
2. Highest-heat smart task from `useSmartTasks(profile.id)`
3. Most overdue follow-up

If nothing pending: `<EmptyState icon={CheckCircle2} title="Day is clear" sub="Send a quote or add a lead while you have a minute." action={{ label: 'Add lead', onClick: () => navigate('/leads/new') }} />`.

Replace the old `Next-up` card + `Focus mode` block + `TodayTasksBreakdown` + `UpcomingTasksCard`. Single surface, single empty state.

Inside `StickyLogMeetingCta`, fixed-position bottom (above the mobile bottom nav):

```jsx
function StickyLogMeetingCta({ onClick }) {
  return (
    <div style={{
      position: 'sticky',
      bottom: `calc(76px + env(safe-area-inset-bottom, 0px))`,
      zIndex: 5,
      padding: '12px 16px 0',
      marginTop: 16,
      background: 'linear-gradient(180deg, transparent 0%, var(--bg) 35%)',
    }}>
      <ActionButton variant="primary" size="lg" iconLeft={Calendar} onClick={onClick} style={{ width: '100%' }}>
        Log Meeting
      </ActionButton>
    </div>
  )
}
```

(76 px = mobile bottom nav height matches the Toast bottomGap from Task 4. Both must change together if nav height changes.)

- [ ] **Step 3: Fix P0-3, P0-4, P0-5 inline during the rebuild**

**P0-3** — kill the `TodayTasksBreakdown` empty-state-hides-panel bug. The new `NextActionSurface` replaces this entirely. No separate component, no `if (rows.length === 0) return null` mistake.

**P0-4** — MediaRecorder timer leak. In the existing `startRecording` function:

Currently:
```js
async function startRecording() {
  ...
  setTimeout(() => { stop() }, 60000)  // never cleared
  ...
}
```

Replace with:
```js
const recTimerRef = useRef(null)
async function startRecording() {
  if (recTimerRef.current) clearTimeout(recTimerRef.current)
  // ...
  recTimerRef.current = setTimeout(() => { stop() }, 60000)
  // ...
}
function stop() {
  if (recTimerRef.current) { clearTimeout(recTimerRef.current); recTimerRef.current = null }
  // ...
}
// In useEffect cleanup:
useEffect(() => () => {
  if (recTimerRef.current) clearTimeout(recTimerRef.current)
}, [])
```

Confirm `useRef` is imported.

**P0-5** — `toggleMeetingDone` stale-state rollback. Currently:

```js
const { error: err } = await supabase.from('work_sessions').update(...).eq(...)
if (err) {
  setSession(prev => prev ? { ...prev, planned_meetings: session.planned_meetings, daily_counters: session.daily_counters } : prev)
  // ^ `session` here is from the CLOSURE; if a second toggle ran in between, this is stale
}
```

Replace with:

```js
async function toggleMeetingDone(idx) {
  if (!session?.planned_meetings) return
  const prev = session    // CAPTURE at function start
  ...
  setSession(...optimistic...)
  const { error: err } = await supabase.from('work_sessions').update(...)
  if (err) {
    setSession(prev)    // Use captured prev, not closure session
    setError(err.message)
    return
  }
  load()
}
```

- [ ] **Step 4: Drop dead-code imports**

Remove these import lines (and any consumer code that references them):

```jsx
// DELETE:
import IncentiveHeroCard from '../../components/incentives/IncentiveHeroCard'
import { greetingFor as sharedGreetingFor } from '../../components/v2/V2AppShell'
```

If `sharedGreetingFor` is referenced elsewhere in WorkV2 (it shouldn't be after the rebuild), update those call sites — the new DayStatusSurface should NOT render a greeting (the topbar already does).

- [ ] **Step 5: Purge stacked Phase-34 comments**

Same rule as V2AppShell (Task 5 Step 3). Inside the WorkV2 return tree, delete all `/* Phase 34X */` patch annotations. Single comment block at the top of the file explains the surface architecture. Net comment removal: ~120 lines.

- [ ] **Step 6: Acceptance gate**

```bash
grep -nE "Phase 3[0-9][A-Z]?\.?[0-9]*" src/pages/v2/WorkV2.jsx | head -30
```

ALL matches must be inside the top-of-file docstring (first ~40 lines). ZERO matches inside the return-tree JSX. If any JSX-body match remains, fix before commit.

LOC check:

```bash
wc -l src/pages/v2/WorkV2.jsx
```

Target: ≤1,300 lines (current ~1,799). If above 1,300, audit which sub-components could move out (e.g. `DayStatusSurface` extracted to its own file).

- [ ] **Step 7: Parse-check + brand-check**

```bash
npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/pages/v2/WorkV2.jsx >/dev/null
bash scripts/check-jsx-brand.sh src/pages/v2/WorkV2.jsx
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/pages/v2/WorkV2.jsx
git commit -m "Phase 35 PR 2: WorkV2 — 3 surfaces, no state machine, P0-3/4/5 fixed, comment purge"
```

---

## Task 7: P0-1 — QuotesV2 confirm/alert

**Files:**
- Modify: `src/pages/v2/QuotesV2.jsx` — lines 68-72.

- [ ] **Step 1: Read current code**

```bash
sed -n '60,80p' src/pages/v2/QuotesV2.jsx
```

Locate the `confirm()` + `alert()` block in the delete handler.

- [ ] **Step 2: Replace with primitives**

Currently (typical pattern):

```js
async function handleDelete(id) {
  if (!confirm('Delete this quote?')) return
  const { error } = await supabase.from('quotes').delete().eq('id', id)
  if (error) { alert(error.message); return }
  // ...
}
```

Replace with:

```js
async function handleDelete(id) {
  const ok = await confirmDialog({
    title: 'Delete this quote?',
    message: 'This cannot be undone. The quote and its line items are removed permanently.',
    confirmLabel: 'Delete',
    danger: true,
  })
  if (!ok) return
  const { error } = await supabase.from('quotes').delete().eq('id', id)
  if (error) { toastError(error, 'Could not delete quote.'); return }
  toastSuccess('Quote deleted.')
  // ...
}
```

Verify the imports at the top of the file include both:

```js
import { confirmDialog } from '../../components/v2/ConfirmDialog'
import { toastError, toastSuccess } from '../../components/v2/Toast'
```

(If only `toastError` was imported, add `toastSuccess` and `confirmDialog`.)

- [ ] **Step 3: Verify no other `alert()` / `confirm()` in this file**

```bash
grep -n "alert(\|confirm(" src/pages/v2/QuotesV2.jsx
```

Expected: no output. If others exist (Audit 1 only flagged lines 68-72; there may be more), migrate them in the same commit since they're in the same file scope.

- [ ] **Step 4: Parse-check**

```bash
npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/pages/v2/QuotesV2.jsx >/dev/null
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/pages/v2/QuotesV2.jsx
git commit -m "Phase 35 PR 2: P0-1 — QuotesV2 confirm/alert → confirmDialog/toast"
```

---

## Task 8: P0-2 — LeadDetailV2 OCR confirm loop

**Files:**
- Modify: `src/pages/v2/LeadDetailV2.jsx` — replace the OCR conflict-resolution `forEach(confirm)` loop with one `<Modal>`.

- [ ] **Step 1: Read current OCR conflict code**

```bash
sed -n '910,940p' src/pages/v2/LeadDetailV2.jsx
```

Locate the loop that calls `confirm()` per OCR conflict.

- [ ] **Step 2: Refactor to single Modal**

The pattern:
- OCR returns a list of conflicts: each is `{ field, ocr_value, current_value }`.
- Currently the rep gets one `confirm()` per conflict; iOS PWA suppresses the second native modal ~30% of the time.

Replace with a single `<Modal>` that lists every conflict as a checkbox row. Rep ticks which conflicts to accept and clicks one "Apply" button.

Pseudocode (adapt to actual conflict shape):

```jsx
const [ocrConflicts, setOcrConflicts] = useState(null)
const [accepted, setAccepted] = useState(new Set())

async function startOcrScan() {
  const result = await runOcr(...)
  if (!result.conflicts || result.conflicts.length === 0) {
    // No conflicts: apply all changes silently.
    await applyOcrUpdate(result.updates)
    toastSuccess('Scanned fields applied.')
    return
  }
  setOcrConflicts(result)
  setAccepted(new Set(result.conflicts.map(c => c.field)))  // default: accept all
}

async function applyOcrConflicts() {
  if (!ocrConflicts) return
  const updates = {}
  for (const c of ocrConflicts.conflicts) {
    if (accepted.has(c.field)) updates[c.field] = c.ocr_value
  }
  const { error } = await supabase.from('leads').update(updates).eq('id', leadId)
  if (error) { toastError(error, 'Could not apply OCR updates.'); return }
  toastSuccess(`Updated ${Object.keys(updates).length} field(s).`)
  setOcrConflicts(null)
}

// ...in render:
{ocrConflicts && (
  <Modal
    open={true}
    onClose={() => setOcrConflicts(null)}
    title="Confirm OCR changes"
    footer={
      <>
        <ActionButton variant="ghost" size="sm" onClick={() => setOcrConflicts(null)}>Cancel</ActionButton>
        <ActionButton variant="primary" size="sm" onClick={applyOcrConflicts}>Apply ({accepted.size})</ActionButton>
      </>
    }
  >
    <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
      OCR found different values for these fields. Untick anything that's wrong.
    </p>
    {ocrConflicts.conflicts.map(c => (
      <label key={c.field} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
        <input
          type="checkbox"
          checked={accepted.has(c.field)}
          onChange={e => {
            const next = new Set(accepted)
            if (e.target.checked) next.add(c.field); else next.delete(c.field)
            setAccepted(next)
          }}
          style={{ marginTop: 3 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{c.field}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            <s>{c.current_value || '(empty)'}</s> &rarr; <strong style={{ color: 'var(--text)' }}>{c.ocr_value}</strong>
          </div>
        </div>
      </label>
    ))}
  </Modal>
)}
```

Imports needed:
```js
import { Modal, ActionButton } from '../../components/v2/primitives'
import { confirmDialog } from '../../components/v2/ConfirmDialog'
import { toastError, toastSuccess } from '../../components/v2/Toast'
```

- [ ] **Step 3: Verify no other `confirm()` in this file**

```bash
grep -n "confirm(\|alert(" src/pages/v2/LeadDetailV2.jsx
```

Expected: empty or only `confirmDialog` calls. Migrate any leftover `alert()` to `toastError` in the same commit.

- [ ] **Step 4: Parse-check**

```bash
npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/pages/v2/LeadDetailV2.jsx >/dev/null
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/pages/v2/LeadDetailV2.jsx
git commit -m "Phase 35 PR 2: P0-2 — LeadDetailV2 OCR confirm loop → batch Modal"
```

---

## Task 9: Dead-code purge

**Files:**
- Delete: `src/components/incentives/IncentiveHeroCard.jsx`
- Delete: `src/components/leads/UpcomingTasksCard.jsx`
- Possibly delete: `src/components/leads/TodayTasksBreakdown.jsx` (if it exists as a separate file)

- [ ] **Step 1: Verify no live consumers for IncentiveHeroCard**

```bash
grep -rn "IncentiveHeroCard" src/ --include="*.jsx" --include="*.js"
```

Expected: only the file itself + the WorkV2 import that should already be gone after Task 6 Step 4. If anything else imports it, STOP — escalate.

- [ ] **Step 2: Verify no live consumers for UpcomingTasksCard**

```bash
grep -rn "UpcomingTasksCard" src/ --include="*.jsx" --include="*.js"
```

Expected: only the file itself. If anything else imports it, list those files in the report — they need to migrate to the new `NextActionSurface` (which already merges this card's data per Task 6 Step 2).

- [ ] **Step 3: Check for separate TodayTasksBreakdown file**

```bash
find src -name "TodayTasksBreakdown*"
```

If a separate file exists AND grep shows no consumers, delete it. If it's inlined in WorkV2 only (which is the current state), Task 6's rebuild already removed it.

- [ ] **Step 4: Delete the dead files**

```bash
rm src/components/incentives/IncentiveHeroCard.jsx
rm src/components/leads/UpcomingTasksCard.jsx
# rm src/components/leads/TodayTasksBreakdown.jsx  # only if separate file found
```

- [ ] **Step 5: Build check**

```bash
npx vite build 2>&1 | tail -30
```

If anything still imports the deleted files, Vite errors here. Fix the importer before commit.

- [ ] **Step 6: Commit**

```bash
git add -A src/components/incentives/IncentiveHeroCard.jsx src/components/leads/UpcomingTasksCard.jsx
git commit -m "Phase 35 PR 2: drop IncentiveHeroCard + UpcomingTasksCard (merged into NextActionSurface)"
```

---

## Task 10: PR 2 acceptance audit + push + tag

**Files:** none — verification + ship.

- [ ] **Step 1: Patch-chain ban audit**

```bash
git log --oneline phase-35-pr1-primitives..HEAD | grep -E "Phase 34Z\.[4-9]|Phase 35[a-z]" || echo "BAN HOLDS"
```

Expected: `BAN HOLDS`. No sub-letter patches inside PR 2.

- [ ] **Step 2: Zero-Phase-N-in-JSX audit**

```bash
echo "=== WorkV2 JSX-body Phase N comments ==="
awk '/^export default function WorkV2/,/^}$/' src/pages/v2/WorkV2.jsx | grep -nE "Phase 3[0-9]" | head
echo "=== V2AppShell JSX-body Phase N comments ==="
awk '/^export function V2AppShell/,/^}$/' src/components/v2/V2AppShell.jsx | grep -nE "Phase 3[0-9]" | head
```

Expected: both empty. Any matches inside the function body fail the acceptance gate.

- [ ] **Step 3: P0 fix verification**

| Bug | Check |
|---|---|
| P0-1 QuotesV2 | `grep -n "alert(\|window.confirm(\|^ *confirm(" src/pages/v2/QuotesV2.jsx` → empty |
| P0-2 LeadDetailV2 | `grep -n "alert(\|window.confirm(\|^ *confirm(" src/pages/v2/LeadDetailV2.jsx` → empty (only `confirmDialog` allowed) |
| P0-3 WorkV2 empty-state | `grep -n "TodayTasksBreakdown" src/pages/v2/WorkV2.jsx` → empty (component gone) |
| P0-4 MediaRecorder timer | `grep -n "recTimerRef\|clearTimeout" src/pages/v2/WorkV2.jsx` → at least 2 hits |
| P0-5 toggleMeetingDone | `grep -n "const prev = session" src/pages/v2/WorkV2.jsx` → 1 hit |

If any check fails, fix in the relevant file before push.

- [ ] **Step 4: Brand + parse check every JSX changed in PR 2**

```bash
for f in $(git diff --name-only phase-35-pr1-primitives..HEAD | grep -E '\.jsx?$' | sed 's|^adflux/||'); do
  npx --yes esbuild --loader:.jsx=jsx --log-level=warning "$f" >/dev/null 2>&1 && echo "PARSE PASS $f" || echo "PARSE FAIL $f"
done

for f in $(git diff --name-only phase-35-pr1-primitives..HEAD | grep -E '\.jsx?$|\.css$' | sed 's|^adflux/||'); do
  bash scripts/check-jsx-brand.sh "$f" 2>&1 | grep -E "FAIL|✗" | head -3
done
```

Expected: every PARSE PASS; brand-check empty (no violations).

- [ ] **Step 5: Tag PR 2**

```bash
HEAD_SHA=$(git rev-parse HEAD)
git tag -a phase-35-pr2-sales-mobile-v21 -m "Phase 35 PR 2: Sales Mobile v2.1 — $HEAD_SHA"
git tag --list 'phase-35-*'
```

Expected: both `phase-35-pr1-primitives` and `phase-35-pr2-sales-mobile-v21` show.

- [ ] **Step 6: Push instruction for owner**

Print to console:

```
PR 2 ready to push:

cd ~/Documents/untitled-os2/Untitled/adflux
git push origin untitled-os
git push origin phase-35-pr2-sales-mobile-v21

Vercel rebuild ~2 min. Owner walks these on iPhone PWA + desktop:

  1. /work — three surfaces visible, no two greetings, ONE incentive
     card (purple), sticky "Log Meeting" CTA at bottom.
  2. Mobile bottom nav — 4 tabs (Today / Follow-ups / Leads / Quotes).
     No yellow "₹0" mini pill in topbar on mobile.
  3. Open the map panel on /work — MapTiler tiles render (not blank).
  4. Tap "Mark done" on a meeting — flips immediately, no 2-second lag.
  5. Try delete a quote on /quotes — confirm dialog (not browser native),
     toast notifies.
  6. OCR scan a business card on a lead — single batch modal, not 3
     native confirms in sequence.

If anything is off, file specifics. No new sub-letter commits.
```

---

## Self-review summary

Plan covers:
- Spec §5.1 — `/work` rebuild as 3 surfaces (Task 6).
- Spec §5.2 — V2AppShell mobile chrome rebuild (Tasks 4 + 5).
- Spec §5.3 — P0-1 through P0-5 fixes (Tasks 6 + 7 + 8).
- Spec §5.4 — dead-code purge (Task 9).
- Spec §5.5 — CLAUDE.md §27 emoji waiver (Task 2).
- Spec §5.6 — Toast viewport bottomGap prop (Task 4).
- Spec §5.7 — acceptance audit (Task 10).
- Spec §9 Q3 — MapTiler tile switch (Task 3).

Gaps to be aware of:
- ESLint rule from PR 1 Task 14 (deferred) is NOT installed in PR 2 either. The grep-based ban audit in Task 10 Step 2 is the substitute. Owner can install ESLint in PR 3 if desired.
- Spec §8 risk register #5 (subagents diverge on style choices) doesn't apply to PR 2 — only one implementer per task.
- Day theme CSS coverage is still leads.css-only after PR 2. PR 3 sweeps the rest.
