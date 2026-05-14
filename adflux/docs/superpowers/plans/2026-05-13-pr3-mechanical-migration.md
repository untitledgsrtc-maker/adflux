# PR 3 — Mechanical Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute the 6 group tasks. Per spec §9 Q1, owner reviews each group commit independently. Groups can ship in parallel (different files); merge as each is reviewed.

**Goal:** Migrate every V2 page + component to PR 1 primitives. Sweep 17 `alert/confirm` → toast/dialog, 80+ rgba chip-tint dupes → `<StatusBadge>`, ~200 bare `<button style>` → `<ActionButton>`, 5 emoji sites → Lucide, undefined `--v2-yellow` fallbacks, Material-palette hex in MasterV2 + GovtProposalDetailV2, 4 page-heading patterns → `<PageHeader>`, 7+ bespoke modal shells → `<Modal>`, ESLint guardrail flipped to hard-fail.

**Architecture:** Six independent file groups, six parallel subagents. Each subagent owns one group, opens ONE commit per group. Owner reviews per group (spec §9 Q1). No subagent touches another group's files. Final commit flips ESLint rule from `warn` to `error` once every group lands.

**Tech Stack:**
- React 18 + Vite + React Router v6
- PR 1 primitives at `src/components/v2/primitives/`
- `lucide-react` (icons only)
- ESLint flat config (introduced in PR 3 Task 0)
- `esbuild` parse-check; `scripts/check-jsx-brand.sh` brand-check

**Effort:** ~5-7 days end-to-end. With 6 parallel groups + per-group owner review, calendar time ~3-4 days.

---

## File Structure

PR 3 modifies many files; the list per group is below. No new components created (all primitives shipped in PR 1). One new file: `eslint.config.js`.

**Create:**
- `eslint.config.js` (Task 0)

**Group A — Modals** (~12 files):
- `src/components/leads/LogMeetingModal.jsx`
- `src/components/leads/LogActivityModal.jsx`
- `src/components/leads/ChangeStageModal.jsx`
- `src/components/leads/ReassignModal.jsx`
- `src/components/leads/WonPaymentModal.jsx`
- `src/components/leads/FollowUpModal.jsx`
- `src/components/incentives/IncentivePayoutModal.jsx`
- `src/components/v2/OfferDetailModal.jsx` (or wherever it lives)
- `src/components/quotes/PaymentModal.jsx`
- `src/components/quotes/BulkRateModal.jsx` (if exists)
- `src/components/team/TeamMemberModal.jsx` (if exists)
- `src/components/hr/StaffModal.jsx` (if exists)

**Group B — Lead pages** (~4 files):
- `src/pages/v2/LeadsV2.jsx`
- `src/pages/v2/LeadDetailV2.jsx` (already partially migrated in PR 2; finish the sweep)
- `src/pages/v2/FollowUpsV2.jsx`
- `src/pages/v2/LeadUploadV2.jsx`

**Group C — Quote pages** (~6 files):
- `src/pages/v2/QuotesV2.jsx` (already partially migrated in PR 2; finish)
- `src/pages/QuoteDetail.jsx`
- `src/components/quotes/IncentiveForecastCard.jsx`
- `src/components/quotes/QuoteWizard/Step1Client.jsx`
- `src/components/quotes/QuoteWizard/Step2Campaign.jsx`
- `src/components/quotes/QuoteWizard/Step3Review.jsx`
- `src/components/quotes/QuoteWizard/Step4Send.jsx`
- `src/components/quotes/QuoteWizard/WizardShell.jsx`
- `src/pages/v2/CreateQuoteOtherMediaV2.jsx`

**Group D — Dashboards** (~6 files, biggest chip-tint payload):
- `src/pages/v2/AdminDashboardDesktop.jsx`
- `src/pages/v2/SalesDashboardDesktop.jsx`
- `src/pages/v2/SalesDashboard.jsx`
- `src/pages/v2/TeamDashboardV2.jsx`
- `src/pages/v2/CockpitV2.jsx` (or wherever Cockpit lives)
- `src/components/dashboard/CockpitWidgets.jsx`

**Group E — Master + Govt** (~4 files, largest single-file Material-palette sweep):
- `src/pages/v2/MasterV2.jsx`
- `src/pages/v2/GovtProposalDetailV2.jsx`
- `src/pages/v2/AutoDistrictsV2.jsx`
- `src/pages/v2/GsrtcStationsV2.jsx`

**Group F — Misc + admin + everything else** (~15 files):
- `src/pages/v2/PendingApprovalsV2.jsx`
- `src/pages/v2/ApprovalsV2.jsx` (if exists)
- `src/pages/v2/ClientsV2.jsx`
- `src/pages/v2/TaPayoutsAdminV2.jsx`
- `src/pages/v2/LeavesAdminV2.jsx`
- `src/pages/v2/MyPerformanceV2.jsx`
- `src/pages/v2/EveningVoiceV2.jsx`
- `src/pages/v2/VoiceLogV2.jsx`
- `src/pages/v2/GpsTrackV2.jsx` (incl. tile URL switch to MapTiler)
- `src/pages/v2/CallLogsV2.jsx`
- `src/pages/v2/TelecallerV2.jsx`
- `src/pages/v2/RenewalToolsV2.jsx`
- `src/components/leads/RepDayTools.jsx`
- `src/components/leads/MeetingsMapPanel.jsx` (already migrated; verify)
- `src/components/v2/NotificationPanel.jsx`
- `src/components/copilot/CopilotModal.jsx`
- `src/components/staff/StaffTable.jsx` (emoji removal)
- `src/components/incentives/IncentiveMiniPill.jsx` (drop inline hex fallbacks)
- Any other V2 page not picked up by Groups A-E

---

## Universal migration recipes (every group follows these)

### Recipe 1 — `alert()` / `confirm()` → primitives

```jsx
// OLD
if (!confirm('Delete this lead?')) return
const { error } = await supabase.from('leads').delete().eq('id', id)
if (error) { alert(error.message); return }
alert('Deleted')

// NEW
if (!(await confirmDialog({
  title: 'Delete this lead?',
  message: 'This cannot be undone.',
  confirmLabel: 'Delete',
  danger: true,
}))) return
const { error } = await supabase.from('leads').delete().eq('id', id)
if (error) { toastError(error, 'Could not delete lead.'); return }
toastSuccess('Deleted.')
```

Imports needed at top of consumer:
```js
import { confirmDialog } from '../../components/v2/ConfirmDialog'
import { toastError, toastSuccess } from '../../components/v2/Toast'
```

(Adjust `../../` depth per file location.)

### Recipe 2 — Hardcoded `rgba()` chip tints → `<StatusBadge>`

```jsx
// OLD — inline chip
<span style={{
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 999,
  background: 'rgba(16, 185, 129, 0.10)',
  border: '1px solid rgba(16, 185, 129, 0.28)',
  color: '#10B981',
  fontSize: 11,
  fontWeight: 600,
}}>Won</span>

// NEW
<StatusBadge tint="success">Won</StatusBadge>
```

Tint mapping:
- Green / `rgba(16,185,129,*)` → `tint="success"`
- Amber / `rgba(245,158,11,*)` / `#F59E0B` / `#fbbf24` → `tint="warning"`
- Red / `rgba(239,68,68,*)` / `#ef4444` / `#ef9a9a` → `tint="danger"`
- Blue / `rgba(59,130,246,*)` / `#3B82F6` / `#60a5fa` → `tint="blue"`
- Purple / `rgba(167,139,250,*)` / `#A78BFA` / `#c084fc` → `tint="purple"`
- Yellow / `rgba(255,230,0,*)` / `#FFE600` → `tint="yellow"`
- Orange / `#F97316` / `#f97316` → `tint="orange"`
- Gray / `var(--surface-2)` / `var(--text-muted)` → `tint="neutral"`

Import: `import { StatusBadge } from '../../components/v2/primitives'`.

### Recipe 3 — Bare inline `<button style={}>` → `<ActionButton>`

```jsx
// OLD
<button
  onClick={save}
  style={{
    background: 'var(--accent)',
    color: 'var(--accent-fg)',
    border: 'none',
    padding: '10px 16px',
    borderRadius: 999,
    fontWeight: 700,
    cursor: 'pointer',
  }}
>Save</button>

// NEW
<ActionButton variant="primary" onClick={save}>Save</ActionButton>
```

Variant mapping:
- Yellow background → `variant="primary"`
- Bordered + transparent → `variant="ghost"`
- Red background → `variant="danger"`
- Gray surface-2 → `variant="subtle"`

Size mapping (by inline `padding`):
- `padding: '6px 12px'` or `'7px 14px'` → `size="sm"`
- `padding: '9-10px 14-16px'` → `size="md"` (default)
- `padding: '12-14px 20-22px'` → `size="lg"`

Icon: lift `<Plus size={14} />` etc. out into `iconLeft={Plus}` prop.

### Recipe 4 — Material-palette hex → tokens

```jsx
// OLD                  // NEW
'#81c784'        →     'var(--success)'   // green
'#fbbf24' or '#ffc107' → 'var(--warning)' // yellow-amber
'#ef9a9a' or '#f87171' → 'var(--danger)'  // red
'#64b5f6' or '#60a5fa' → 'var(--blue)'    // blue
'#c084fc' or '#A78BFA' → 'var(--purple)'  // purple
'#f97316'        →     'var(--orange)'   // orange
'#94A3B8'        →     'var(--text-muted)'
'#cdd9e6'        →     'var(--border)'
```

If a chip uses ALL of (bg + border + text) hardcoded, prefer `<StatusBadge>` over individual token swaps.

### Recipe 5 — Lucide off-spec → snap to 14/16/18/22 + stroke 1.6

```
size={10|11|12|13} → size={14}
size={15|17}       → size={16}
size={20|24}       → size={22} (or 18 if it's a chip prefix)
size={28|32|40}    → size={22} (or keep if it's a hero illustration)
strokeWidth={1.8|2|2.2|2.4} → strokeWidth={1.6}
```

### Recipe 6 — `fontFamily: 'monospace'` → `<MonoNumber>` or token

```jsx
// OLD
<span style={{ fontFamily: 'monospace' }}>{phone}</span>

// NEW (preferred)
<MonoNumber>{phone}</MonoNumber>

// or in CSS-only context:
fontFamily: 'var(--font-mono, "JetBrains Mono", Menlo, monospace)'
```

### Recipe 7 — Off-scale `borderRadius` → snap

```
borderRadius: 7  → 6 or 8 (pick closer to original visual intent)
borderRadius: 11 → 12
borderRadius: 20 → 16 (or 999 if pill)
borderRadius: 24 → 16
borderRadius: 4  → 6 (sub-scale; only allowed in PDFs which are out of scope)
```

### Recipe 8 — Page heads → `<PageHeader>`

```jsx
// OLD pattern A — v2d-page-head
<div className="v2d-page-head">
  <h1 className="v2d-page-title">My Leads</h1>
  <p className="v2d-page-sub">73 total · 18 hot</p>
</div>

// OLD pattern B — lead-page-head
<div className="lead-page-head">
  <div className="lead-page-title">My Leads</div>
</div>

// OLD pattern C — bespoke v2d-hero
<div className="v2d-hero v2d-hero--action">…</div>

// NEW
<PageHeader title="My Leads" subtitle="73 total · 18 hot" />
// or with actions:
<PageHeader
  title="My Leads"
  subtitle="73 total · 18 hot"
  actions={<ActionButton iconLeft={Plus}>New Lead</ActionButton>}
/>
```

### Recipe 9 — Bespoke modal → `<Modal>`

```jsx
// OLD pattern (typical)
{open && (
  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', ...backdrop }}>
    <div style={{ background: 'var(--surface)', ... }}>
      <div style={{ ...header }}>
        <h2>Title</h2>
        <button onClick={onClose}>×</button>
      </div>
      <div style={{ ...body }}>{children}</div>
      <div style={{ ...footer }}>
        <button onClick={onClose}>Cancel</button>
        <button onClick={save}>Save</button>
      </div>
    </div>
  </div>
)}

// NEW
<Modal
  open={open}
  onClose={onClose}
  title="Title"
  size="md"
  footer={
    <>
      <ActionButton variant="ghost" size="sm" onClick={onClose}>Cancel</ActionButton>
      <ActionButton variant="primary" size="sm" onClick={save}>Save</ActionButton>
    </>
  }
>
  {children}
</Modal>
```

### Recipe 10 — Emoji → Lucide

| Emoji | Lucide replacement |
|---|---|
| 🎉 | `<PartyPopper size={14} />` or `<Trophy size={14} />` |
| 💰 | `<IndianRupee size={14} />` or `<Coins size={14} />` |
| ⚡ | `<Zap size={14} />` |
| 📞 | `<Phone size={14} />` |

(`StaffTable.jsx:38`, `MyPerformance.jsx:188`, `WonPaymentModal.jsx:157`, `AdminDashboardDesktop.jsx:899/1772`, `SalesDashboardDesktop.jsx:523/660`.)

### Recipe 11 — Off-brand `var(--v2-yellow, #fbc42d)` → `#FFE600`

```jsx
// OLD
'1px solid var(--v2-yellow, #fbc42d)'

// NEW
'1px solid var(--v2-yellow, #FFE600)'
```

3 sites: `Step2Campaign.jsx:228, 234`, `PeriodPicker.jsx:161`.

### Recipe 12 — Empty / loading / banner states → primitives

```jsx
// OLD empty
<div className="v2d-empty-card">
  <Inbox size={28} />
  <div>No leads yet</div>
  <div>Add your first lead</div>
  <button onClick={...}>+ Add lead</button>
</div>

// NEW
<EmptyState
  icon={Inbox}
  title="No leads yet"
  sub="Add your first lead"
  action={{ label: '+ Add lead', onClick: ... }}
/>

// OLD loading
<div style={{ padding: 60, textAlign: 'center' }}>Loading…</div>

// NEW
<LoadingState type="page" />

// OLD inline banner
{error && <div style={{ background: 'rgba(239,68,68,.1)', color: 'var(--danger)' }}>{error}</div>}

// NEW
{error && <Banner tone="danger">{error}</Banner>}
```

---

## Task 0: ESLint config + flip rule to warn

**Files:** Create `eslint.config.js` at repo root. Add `eslint` to devDependencies.

- [ ] **Step 1: Install ESLint**

```bash
cd /Users/apple/Documents/untitled-os2/Untitled/adflux
npm install --save-dev eslint @eslint/js eslint-plugin-react
```

- [ ] **Step 2: Create `eslint.config.js`**

Flat config:

```js
// eslint.config.js
//
// Phase 35 PR 3 — minimal ESLint config. The project did not lint
// before PR 3. This file enforces ONE rule: bare inline
// <button style={...}> outside the primitives directory is a
// WARNING (will flip to ERROR once PR 3 closes per spec §6.3).

import js from '@eslint/js'
import react from 'eslint-plugin-react'

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { react },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Promise: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
        FormData: 'readonly',
        MediaRecorder: 'readonly',
        Notification: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        crypto: 'readonly',
        Audio: 'readonly',
        HTMLElement: 'readonly',
        Image: 'readonly',
        Intl: 'readonly',
        Uint8Array: 'readonly',
      },
    },
    rules: {
      // Phase 35 PR 3 rule. Bare inline <button style={...}> outside
      // primitives is restricted. Migrate to <ActionButton>.
      'no-restricted-syntax': [
        'warn',
        {
          selector:
            'JSXOpeningElement[name.name="button"] > JSXAttribute[name.name="style"]',
          message:
            'Bare inline <button style={...}> is restricted. Use <ActionButton> from src/components/v2/primitives instead.',
        },
      ],
      // Project decisions (ship as warn for now; tighten later):
      'no-unused-vars': 'off',
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'off',
      'react/react-in-jsx-scope': 'off',
    },
    settings: { react: { version: 'detect' } },
  },
  {
    // Primitives directory is exempt — primitives ARE the wrapper.
    files: ['src/components/v2/primitives/**/*.{js,jsx}'],
    rules: { 'no-restricted-syntax': 'off' },
  },
]
```

- [ ] **Step 3: Verify ESLint runs**

```bash
npx eslint src/pages/v2/WorkV2.jsx 2>&1 | head -10
```

Expected: warnings (not errors) for any leftover bare-button uses; warnings are not blocking.

- [ ] **Step 4: Commit**

```bash
git add eslint.config.js package.json package-lock.json
git commit -m "Phase 35 PR 3 Task 0: install ESLint + no-restricted-syntax warn"
```

---

## Group prompts (one per subagent)

Each group runs the universal recipes above on ITS file list. Below are the per-group acceptance gates and the exact files.

### Group A — Modals → `<Modal>` shell

**Files:** see "Group A — Modals" above.

**Recipes applied:** 9 (modal shell), 1 (alert/confirm), 3 (button), 5 (icons), 7 (radii), 10 (emoji in WonPaymentModal).

**Acceptance:** every modal uses `<Modal>`. Zero bespoke backdrop divs in the listed files. Zero `alert()` / `confirm()` calls.

**Commit:** `Phase 35 PR 3 Group A: modals migrated to <Modal> primitive`

### Group B — Lead pages

**Files:** LeadsV2, LeadDetailV2, FollowUpsV2, LeadUploadV2.

**Recipes:** 1 (alert/confirm sweep), 2 (status badges), 3 (buttons), 4 (Tailwind hex), 5 (icons), 8 (page header), 12 (empty/loading/banner).

**Acceptance:** zero `alert()`/`confirm()`. All status pills are `<StatusBadge>`. PageHeader at top of each list page.

**Commit:** `Phase 35 PR 3 Group B: lead pages migrated to primitives`

### Group C — Quote pages

**Files:** QuotesV2, QuoteDetail, IncentiveForecastCard, QuoteWizard/{Step1..4 + WizardShell}, CreateQuoteOtherMediaV2.

**Recipes:** 1, 2, 3, 4 (Material hex in QuoteDetail), 5, 8 (PageHeader), 11 (`#fbc42d` fallbacks in Step2Campaign).

**Acceptance:** zero `confirm()` / `alert()`. All `var(--v2-yellow, #fbc42d)` → `#FFE600`. Status chips via StatusBadge.

**Commit:** `Phase 35 PR 3 Group C: quote pages migrated to primitives`

### Group D — Dashboards (biggest chip-tint payload)

**Files:** AdminDashboardDesktop, SalesDashboardDesktop, SalesDashboard, TeamDashboardV2, Cockpit, CockpitWidgets.

**Recipes:** 2 (chip-tint — 80+ sites concentrated here), 3 (button), 4 (Material hex in AdminDashboard), 5 (icons), 8 (PageHeader for non-hero pages), 10 (emoji ⚡🎉).

**Acceptance:** zero hardcoded `rgba()` chip tint patterns (3-line bg + border + color). All chips via `<StatusBadge>`. Emoji at AdminDashboardDesktop:899/1772 + SalesDashboardDesktop:523/660 → Lucide.

**Commit:** `Phase 35 PR 3 Group D: dashboards migrated to primitives (80+ chip-tint sites)`

### Group E — Master + Govt (largest single-file mechanical change)

**Files:** MasterV2, GovtProposalDetailV2, AutoDistrictsV2, GsrtcStationsV2.

**Recipes:** 4 (17 Material hex in MasterV2 + 22 in GovtProposalDetailV2), 2 (chip-tint), 3 (button), 5 (icons), 7 (radii: `MasterV2:105` has 7px), 8 (PageHeader), 12 (loading state in AutoDistricts + GsrtcStations table loading).

**Acceptance:** zero Material-palette hex codes (#81c784, #fbbf24, #ef9a9a, #64b5f6, #cdd9e6, #ffc107). 6 MasterV2 status-banner copy-paste duplicates folded into `<Banner>`.

**Commit:** `Phase 35 PR 3 Group E: master + govt — Material-palette → tokens`

### Group F — Misc + admin + everything else

**Files:** PendingApprovalsV2, ApprovalsV2, ClientsV2, TaPayoutsAdminV2, LeavesAdminV2, MyPerformanceV2, EveningVoiceV2, VoiceLogV2, GpsTrackV2, CallLogsV2, TelecallerV2, RenewalToolsV2, RepDayTools, NotificationPanel, CopilotModal, StaffTable, IncentiveMiniPill, MeetingsMapPanel (verify-only), plus any V2 page not picked up by Groups A-E.

**Recipes:** 1, 2, 3, 5, 8, 10 (emoji in StaffTable + MyPerformance), 12.

**Special:** GpsTrackV2.jsx tile URL — switch from raw OSM (`https://{s}.tile.openstreetmap.org/...`) to the same MapTiler pattern as `MeetingsMapPanel.jsx`. Reuse `import.meta.env.VITE_MAPTILER_KEY` with same fallback.

**Acceptance:** zero `alert()` / `confirm()` anywhere in `src/`. Zero emoji outside CLAUDE.md §27 waiver. Zero raw OSM tile URLs.

**Commit:** `Phase 35 PR 3 Group F: misc pages + components migrated`

---

## Task 7: Final acceptance audit + ESLint flip + tag

After all 6 groups land.

- [ ] **Step 1: Run the master grep gauntlet**

```bash
cd /Users/apple/Documents/untitled-os2/Untitled/adflux

echo "=== alert/confirm sweep ==="
grep -rnE "(^|[^/])(alert|window\.confirm)\(" src/ --include="*.jsx" --include="*.js" | grep -v "confirmDialog\|test\|spec"
# Expected: empty (only inside comments, if any)

echo "=== legacy brand violations ==="
grep -rnE "#facc15|#0a0e1a|#fbc42d" src/ --include="*.jsx" --include="*.js" --include="*.css"
# Expected: empty (only inside .md docs)

echo "=== bare button style ==="
grep -rE '<button[^>]*style=\{' src/ --include="*.jsx" | grep -v "components/v2/primitives/"
# Expected: empty

echo "=== Material-palette hex ==="
grep -rnE "#81c784|#fbbf24|#ef9a9a|#64b5f6|#cdd9e6|#ffc107|#f87171|#4ade80|#60a5fa|#c084fc" src/ --include="*.jsx" --include="*.js"
# Expected: empty

echo "=== emoji outside §27 waiver ==="
grep -rnE "🎉|💰|⚡|📞|🔥|🚀|✨" src/ --include="*.jsx" | grep -v "V2AppShell.greetingFor\|CLAUDE\|test\|spec"
# Expected: empty (greeting emoji are inside greetingFor only)

echo "=== fontFamily: monospace literal ==="
grep -rn "fontFamily: 'monospace'\|fontFamily: \"monospace\"" src/ --include="*.jsx" --include="*.js"
# Expected: empty

echo "=== off-scale borderRadius ==="
grep -rnE "borderRadius: ?(7|11|20|24)[,)]" src/ --include="*.jsx" --include="*.js" | grep -v "// .*PDF"
# Expected: empty (PDFs may use 4 / 20 intentionally; flag if elsewhere)

echo "=== off-spec Lucide sizes ==="
grep -rnE "size=\{(10|11|12|13|15|17|20|24|28|32|40)\}" src/ --include="*.jsx" | head
# Note: 28+ may be intentional for hero illustrations; review-only
```

Any non-empty output is a follow-up commit before tag.

- [ ] **Step 2: Flip ESLint rule to error**

Edit `eslint.config.js`:

```js
// Change:
'no-restricted-syntax': ['warn', { ... }]
// To:
'no-restricted-syntax': ['error', { ... }]
```

Run: `npx eslint src/ 2>&1 | tail -10`
Expected: zero errors (warnings on legacy patterns are OK; the rule we flipped should report ZERO violations because Groups A-F cleaned them).

If ESLint reports any violations, fix them inline + re-run before commit.

- [ ] **Step 3: Brand-check + parse-check every changed file in PR 3**

```bash
for f in $(git diff --name-only phase-35-pr2-sales-mobile-v21..HEAD | grep -E '\.jsx?$' | sed 's|^adflux/||'); do
  npx --yes esbuild --loader:.jsx=jsx --log-level=warning "$f" >/dev/null 2>&1 \
    && echo "PARSE PASS $f" \
    || echo "PARSE FAIL $f"
done

for f in $(git diff --name-only phase-35-pr2-sales-mobile-v21..HEAD | grep -E '\.jsx?$|\.css$' | sed 's|^adflux/||'); do
  bash scripts/check-jsx-brand.sh "$f" 2>&1 | grep -E "FAIL|✗" | head -3
done
```

Expected: every PARSE PASS; brand-check empty.

- [ ] **Step 4: Commit + tag**

```bash
git add eslint.config.js
git commit -m "Phase 35 PR 3 Task 7: ESLint rule flipped to error; PR 3 acceptance gate passed"

HEAD_SHA=$(git rev-parse HEAD)
git tag -a phase-35-pr3-migration -m "Phase 35 PR 3: Mechanical migration — $HEAD_SHA"
git tag --list 'phase-35-*'
```

Expected: 3 tags shown.

- [ ] **Step 5: Push instruction**

```
PR 3 ready to push:

cd ~/Documents/untitled-os2/Untitled/adflux
git push origin untitled-os
git push origin phase-35-pr3-migration

After Vercel rebuild (~2 min), smoke-test:

  1. Every page renders without console errors
  2. Status chips show correct color (not flat gray)
  3. Delete confirms use custom dialog
  4. Toast notifications fire on save/error
  5. Map on GpsTrack page renders MapTiler tiles
  6. Day theme toggle still works on /settings

If any page breaks, file specifics. Final follow-up commit on this branch.

Phase 35 complete. Spec ban lifts. Module work resumes.
```

---

## Self-review summary

Plan covers:
- Spec §6.1 — all 14 sweep types listed in `Recipes` 1-12 above.
- Spec §6.2 — 6 parallel subagent groups.
- Spec §6.3 — final acceptance gate (Task 7).
- Spec §9 Q1 — per-group review (each group is its own commit).

Gaps to be aware of:
- The ESLint config in Task 0 is minimal. PR 3 only enforces `no-restricted-syntax`. Project-wide linting (no-unused-vars, jsx-key, react-hooks/exhaustive-deps) is OUT OF SCOPE — that's a future config-hardening commit. The current config is a guardrail, not a code-quality gate.
- Group F includes ~15 files. If a subagent runs long on one file, it can split into F.1 and F.2. Owner reviews each commit independently anyway.
- The Audit 2 §6 component-extraction candidates (PageHeader, StatusBadge, EmptyState, ActionButton, Modal, MonoNumber) all ship in PR 1; PR 3 consumes them. Banner + LoadingState also shipped in PR 1. All 8 primitives are exercised here.
- After PR 3, the spec ban (no sub-letter patches in `WorkV2.jsx` + `V2AppShell.jsx` + primitives) lifts. Future module work follows CLAUDE.md §3 normal rules.
- Day theme CSS coverage for the migrated pages is implicit — once a page consumes `<StatusBadge>` + `<Banner>` + token-driven hex, it gains Day theme support automatically (the tokens have `[data-theme="day"]` overrides). Pages still using bespoke hex won't react to the toggle; PR 3 closes that gap.
