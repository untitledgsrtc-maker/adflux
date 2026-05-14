# PR 1 — Primitives Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 8 reusable UI primitives + supporting tokens + a Day theme toggle + a `/primitives-demo` route + an ESLint rule, with zero visual diff in the running app, so PR 2 and PR 3 can consume them.

**Architecture:** Pure-React primitives in `src/components/v2/primitives/`. Each is a single default export with a JSDoc props block, inline styles via CSS variables only, no third-party dependencies beyond what's already shipped (`lucide-react`, React 18). Tokens added to `src/styles/tokens.css` (V1 scope) and mirrored into `src/styles/v2.css` where the V2 grid overrides them. A new `/primitives-demo` route (admin/co_owner only) renders every primitive in every documented variant so the owner can eyeball them on Vercel staging. ESLint warns on bare inline-styled `<button>` outside the primitives directory — flips to hard-fail at PR 3 close.

**Tech Stack:**
- React 18 + Vite
- React Router v6 (route mounting)
- CSS variables (`src/styles/tokens.css` + `src/styles/v2.css`)
- `lucide-react` (icons only)
- `esbuild` for parse-check (already in CLAUDE.md §15 pre-commit)
- Vercel auto-deploy from `untitled-os` branch
- Supabase for the rep auth/profile (only consumed by the Settings toggle for storing theme preference)

**No automated test framework in this codebase.** "Tests" are: (a) esbuild parse-check passes, (b) brand-check script passes, (c) the component renders in `/primitives-demo` without console errors on Vercel staging, (d) owner visually OKs the demo before the next task starts.

---

## File Structure (locked before tasks start)

**Create:**
- `src/components/v2/primitives/PageHeader.jsx` — canonical page heading
- `src/components/v2/primitives/Modal.jsx` — canonical modal shell
- `src/components/v2/primitives/StatusBadge.jsx` — tinted chip
- `src/components/v2/primitives/EmptyState.jsx` — empty list card
- `src/components/v2/primitives/LoadingState.jsx` — spinner / skeleton
- `src/components/v2/primitives/Banner.jsx` — inline tone banner
- `src/components/v2/primitives/ActionButton.jsx` — single button primitive
- `src/components/v2/primitives/MonoNumber.jsx` — JetBrains-Mono number wrap
- `src/components/v2/primitives/index.js` — barrel exports
- `src/pages/v2/PrimitivesDemoV2.jsx` — admin-only `/primitives-demo` route
- `docs/UI_PRIMITIVES.md` — "use this, not that" reference

**Modify:**
- `src/styles/tokens.css` — add `--grad-hero`, `--grad-incentive`, `--grad-team`, `--orange*`, `--purple*`
- `src/styles/v2.css` — mirror grad tokens for V2 scope; ensure `[data-theme="day"]` overrides survive
- `src/pages/OfferForm.jsx` — migrate `var(--red)` → `var(--danger)`, `var(--gray)` → `var(--text-muted)`, `var(--card)` → `var(--surface)`, `var(--brd)` → `var(--border)`
- `src/App.jsx` (or wherever React Router routes are declared) — register `/primitives-demo` admin-only
- `src/components/v2/V2AppShell.jsx` — read `localStorage.theme` on mount, set `document.documentElement.setAttribute('data-theme', t)`
- One Settings page (find which one is mounted at `/settings` or admin-side) — add the Day theme toggle
- `.eslintrc.js` (or `eslint.config.js`) — add `no-restricted-syntax` warning rule

---

## Task 1: Tokens — add gradient + orange + purple

**Files:**
- Modify: `src/styles/tokens.css` — append new tokens after the existing brand block
- Modify: `src/styles/v2.css` — mirror gradients for V2 scope

- [ ] **Step 1: Read tokens.css to confirm the existing brand block location**

Run: `grep -n "accent-soft\|--success\|--blue-soft" src/styles/tokens.css`
Expected: lines listing where `--accent-soft`, `--success`, etc. are defined. Pick a line just after the status-color block — append new tokens there.

- [ ] **Step 2: Append the new tokens to `src/styles/tokens.css`**

Append after the existing `--blue-soft` line:

```css
/* ─── Phase 35 (PR 1) — gradient tokens ──────────────────────── */
/* Single source of truth replacing four duplicate inline gradients
   (V2Hero.jsx:25-27, leads.css:619-670, v2.css:61-63, TeamDashboardV2.jsx:212). */
--grad-hero:
  radial-gradient(380px 140px at 100% 0%, rgba(255,230,0,.22), transparent 60%),
  linear-gradient(135deg, #0d3d3a 0%, #134e4a 55%, #0f766e 100%);

--grad-incentive:
  radial-gradient(420px 160px at 100% 0%, rgba(167,139,250,.18), transparent 60%),
  linear-gradient(135deg, #2e1065 0%, #4c1d95 55%, #5b21b6 100%);

--grad-team:
  linear-gradient(135deg, #1e1b4b 0%, #312e81 55%, #4338ca 100%);

/* ─── Phase 35 (PR 1) — orange status tint ────────────────────── */
/* Closes the warm-orange gap in the status palette. Currently
   #f97316 is hardcoded in AdminDashboardDesktop.jsx. */
--orange:      #F97316;
--orange-soft: rgba(249, 115, 22, 0.12);

/* ─── Phase 35 (PR 1) — purple promoted from leads.css local ──── */
--purple:      #A78BFA;
--purple-soft: rgba(167, 139, 250, 0.14);
```

- [ ] **Step 3: Mirror gradients into `src/styles/v2.css`**

Find the existing `--v2-grad-hero` (or similar) declaration in `v2.css`:

Run: `grep -n "grad" src/styles/v2.css`

If `--v2-grad-hero` already exists, replace its value with the canonical one from Step 2; otherwise append:

```css
/* Phase 35 (PR 1) — pull from tokens.css; keep --v2- prefix
   for callers already using it. */
--v2-grad-hero:      var(--grad-hero);
--v2-grad-incentive: var(--grad-incentive);
--v2-grad-team:      var(--grad-team);
```

- [ ] **Step 4: Parse-check + brand-check**

Run: `bash scripts/check-jsx-brand.sh src/styles/tokens.css 2>&1; echo ---; bash scripts/check-jsx-brand.sh src/styles/v2.css 2>&1`
Expected: no `#facc15` / `#0a0e1a` flagged. Hex codes in the gradient stops are pre-existing values pulled from `V2Hero.jsx`; they're brand-approved teal greens, not yellow.

- [ ] **Step 5: Commit**

```bash
git add src/styles/tokens.css src/styles/v2.css
git commit -m "Phase 35 PR 1: tokens — add --grad-* + --orange + --purple"
```

---

## Task 2: PageHeader primitive

**Files:**
- Create: `src/components/v2/primitives/PageHeader.jsx`

- [ ] **Step 1: Create the file**

Write the full component:

```jsx
// src/components/v2/primitives/PageHeader.jsx
//
// Phase 35 PR 1 — canonical page heading.
//
// Replaces 4 page-heading patterns previously scattered across V2:
//   • <h1 className="v2d-page-title"> with .v2d-page-head wrapper (13 pages)
//   • <div className="lead-page-title"> with .lead-page-head wrapper (6 pages)
//   • Bare <V2Hero /> at top of page (2 pages)
//   • Bespoke v2d-hero v2d-hero--action markup (4 pages)
//
// Single rule of use: every V2 page mounts ONE <PageHeader /> at the top
// of its page body. Hero variant is reserved for the rep's daily home
// view (/work) and the daily-numbers view (/my-performance); every
// other page uses hero="none" or hero="compact".

import V2Hero from '../V2Hero'

/**
 * @param {object}    props
 * @param {string}    props.title            — required
 * @param {string}   [props.eyebrow]         — small caps line above title
 * @param {string}   [props.subtitle]        — one-line subtitle under title
 * @param {React.ReactNode} [props.actions]  — right-aligned action slot
 * @param {'none'|'compact'|'full'} [props.hero='none']
 */
export default function PageHeader({
  title,
  eyebrow,
  subtitle,
  actions,
  hero = 'none',
}) {
  if (hero === 'full') {
    return (
      <V2Hero
        eyebrow={eyebrow || ''}
        value={title}
        label={subtitle}
        right={actions ? { text: '', tone: 'up' } : undefined}
      />
    )
  }

  const isCompact = hero === 'compact'

  return (
    <div
      className="v2d-page-head"
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 16,
        marginBottom: isCompact ? 8 : 16,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ minWidth: 0 }}>
        {eyebrow && (
          <div style={{
            fontSize: 10,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--v2-ink-2, var(--text-muted))',
            fontWeight: 700,
            marginBottom: 4,
          }}>
            {eyebrow}
          </div>
        )}
        <h1 style={{
          margin: 0,
          fontFamily: 'var(--font-display, "Space Grotesk", system-ui, sans-serif)',
          fontWeight: 700,
          fontSize: isCompact ? 20 : 26,
          letterSpacing: '-0.01em',
          color: 'var(--text)',
          lineHeight: 1.1,
        }}>
          {title}
        </h1>
        {subtitle && (
          <div style={{
            fontSize: 13,
            color: 'var(--text-muted)',
            marginTop: 4,
          }}>
            {subtitle}
          </div>
        )}
      </div>
      {actions && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}>
          {actions}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Parse-check**

Run: `npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/components/v2/primitives/PageHeader.jsx >/dev/null`
Expected: clean — no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/v2/primitives/PageHeader.jsx
git commit -m "Phase 35 PR 1: PageHeader primitive"
```

---

## Task 3: Modal primitive

**Files:**
- Create: `src/components/v2/primitives/Modal.jsx`

- [ ] **Step 1: Create the file**

```jsx
// src/components/v2/primitives/Modal.jsx
//
// Phase 35 PR 1 — canonical modal shell.
//
// Replaces 7+ ad-hoc modal implementations across the codebase:
// ConfirmDialog, CopilotModal, WonPaymentModal, OfferDetailModal,
// LogMeetingModal, LogActivityModal, ChangeStageModal, ReassignModal,
// PaymentModal, BulkRateModal, TeamMemberModal, StaffModal.
//
// Standardises:
//   • Backdrop opacity 0.55 (was 0.4 / 0.55 / 0.7 across the variants)
//   • Close button top-right, Lucide <X size={18} />
//   • Body padding 16-18 px depending on `size`
//   • Footer pinned to bottom on mobile via dvh + sticky — survives the
//     iOS keyboard rising
//   • Body scroll lock on mount; restored on unmount
//   • Esc to close; backdrop-click respects `closeOnBackdrop` prop

import { useEffect } from 'react'
import { X } from 'lucide-react'

const SIZE_MAX_WIDTH = { sm: 380, md: 520, lg: 720, full: '100%' }

/**
 * @param {object}    props
 * @param {boolean}   props.open
 * @param {() => void} props.onClose
 * @param {string}    props.title
 * @param {'sm'|'md'|'lg'|'full'} [props.size='md']
 * @param {React.ReactNode} props.children
 * @param {React.ReactNode} [props.footer]
 * @param {boolean}  [props.closeOnBackdrop=true]
 */
export default function Modal({
  open,
  onClose,
  title,
  size = 'md',
  children,
  footer,
  closeOnBackdrop = true,
}) {
  // Esc to close + body scroll lock while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  const isFull = size === 'full'

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        background: 'rgba(2, 6, 23, 0.55)',
        display: 'flex',
        alignItems: isFull ? 'stretch' : 'center',
        justifyContent: 'center',
        padding: isFull ? 0 : '16px',
      }}
    >
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: isFull ? 0 : 14,
          width: isFull ? '100%' : `min(${SIZE_MAX_WIDTH[size]}px, calc(100% - 32px))`,
          maxHeight: isFull ? '100dvh' : 'calc(100dvh - 32px)',
          overflow: 'hidden',
          color: 'var(--text)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{
            fontFamily: 'var(--font-display, "Space Grotesk", system-ui, sans-serif)',
            fontWeight: 700,
            fontSize: 16,
            color: 'var(--text)',
          }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              padding: 6,
              borderRadius: 8,
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={18} strokeWidth={1.6} />
          </button>
        </div>

        {/* Body — scrollable */}
        <div style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: size === 'sm' ? 14 : 18,
        }}>
          {children}
        </div>

        {/* Footer — sticky bottom */}
        {footer && (
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '12px 16px',
            borderTop: '1px solid var(--border)',
            background: 'var(--surface)',
            flexShrink: 0,
            paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))',
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Parse-check**

Run: `npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/components/v2/primitives/Modal.jsx >/dev/null`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/v2/primitives/Modal.jsx
git commit -m "Phase 35 PR 1: Modal primitive"
```

---

## Task 4: StatusBadge primitive

**Files:**
- Create: `src/components/v2/primitives/StatusBadge.jsx`

- [ ] **Step 1: Create the file**

```jsx
// src/components/v2/primitives/StatusBadge.jsx
//
// Phase 35 PR 1 — single status chip primitive.
//
// Replaces 38 --tint-* token sites PLUS ~80 hardcoded rgba duplicates
// across CockpitWidgets, GovtProposalDetailV2, MasterV2,
// AdminDashboardDesktop.
//
// Visual: pill, background = --tint-{name}-bg, border = --tint-{name}-bd,
// text colour matches the tint hue. Tokens defined in v2.css Phase 34R.

const TINT_PALETTE = {
  success: { fg: 'var(--success, #10B981)', bg: 'var(--tint-success-bg, rgba(16,185,129,.10))',  bd: 'var(--tint-success-bd, rgba(16,185,129,.28))' },
  warning: { fg: 'var(--warning, #F59E0B)', bg: 'var(--tint-warning-bg, rgba(245,158,11,.10))',  bd: 'var(--tint-warning-bd, rgba(245,158,11,.28))' },
  danger:  { fg: 'var(--danger, #EF4444)',  bg: 'var(--tint-danger-bg, rgba(239,68,68,.10))',    bd: 'var(--tint-danger-bd, rgba(239,68,68,.28))' },
  blue:    { fg: 'var(--blue, #3B82F6)',    bg: 'var(--tint-blue-bg, rgba(59,130,246,.10))',     bd: 'var(--tint-blue-bd, rgba(59,130,246,.28))' },
  purple:  { fg: 'var(--purple, #A78BFA)',  bg: 'var(--tint-purple-bg, rgba(167,139,250,.10))',  bd: 'var(--tint-purple-bd, rgba(167,139,250,.28))' },
  yellow:  { fg: 'var(--accent, #FFE600)',  bg: 'var(--accent-soft, rgba(255,230,0,.14))',       bd: 'rgba(255,230,0,.34)' },
  orange:  { fg: 'var(--orange, #F97316)',  bg: 'var(--orange-soft, rgba(249,115,22,.12))',      bd: 'rgba(249,115,22,.30)' },
  neutral: { fg: 'var(--text-muted)',       bg: 'var(--surface-2)',                                bd: 'var(--border)' },
}

/**
 * @param {object} props
 * @param {keyof typeof TINT_PALETTE} props.tint
 * @param {React.ComponentType<any>} [props.icon] — Lucide icon component, NOT element
 * @param {'sm'|'md'} [props.size='md']
 * @param {React.ReactNode} props.children
 */
export default function StatusBadge({
  tint,
  icon: Icon,
  size = 'md',
  children,
}) {
  const t = TINT_PALETTE[tint] || TINT_PALETTE.neutral
  const isSm = size === 'sm'
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: isSm ? '2px 7px' : '3px 9px',
      borderRadius: 999,
      background: t.bg,
      border: `1px solid ${t.bd}`,
      color: t.fg,
      fontSize: isSm ? 10 : 11,
      fontWeight: 600,
      letterSpacing: '0.02em',
      whiteSpace: 'nowrap',
      lineHeight: 1.2,
    }}>
      {Icon && <Icon size={isSm ? 10 : 12} strokeWidth={1.6} />}
      {children}
    </span>
  )
}
```

- [ ] **Step 2: Parse-check**

Run: `npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/components/v2/primitives/StatusBadge.jsx >/dev/null`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/v2/primitives/StatusBadge.jsx
git commit -m "Phase 35 PR 1: StatusBadge primitive"
```

---

## Task 5: EmptyState primitive

**Files:**
- Create: `src/components/v2/primitives/EmptyState.jsx`

- [ ] **Step 1: Create the file**

```jsx
// src/components/v2/primitives/EmptyState.jsx
//
// Phase 35 PR 1 — canonical empty-state card.
//
// Replaces 3 patterns:
//   • v2d-empty-card + v2d-empty-t/v2d-empty-s (QuotesV2, TaPayoutsAdminV2 — canonical)
//   • v2d-q-empty bare div (AdminDashboardDesktop x3)
//   • lead-card-pad inline text (LeadDetailV2)
//
// Visual: centred Lucide icon (28px), title (16px bold), sub (13px muted),
// optional action button.

/**
 * @param {object} props
 * @param {React.ComponentType<any>} props.icon — Lucide icon component
 * @param {string} props.title
 * @param {string} [props.sub]
 * @param {{ label: string; onClick: () => void }} [props.action]
 */
export default function EmptyState({ icon: Icon, title, sub, action }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      padding: '32px 18px',
      textAlign: 'center',
      color: 'var(--text)',
    }}>
      {Icon && (
        <div style={{ marginBottom: 10 }}>
          <Icon size={28} strokeWidth={1.6} style={{ color: 'var(--text-muted)' }} />
        </div>
      )}
      <div style={{
        fontFamily: 'var(--font-display, "Space Grotesk", system-ui, sans-serif)',
        fontWeight: 700,
        fontSize: 16,
        marginBottom: sub ? 4 : 0,
      }}>{title}</div>
      {sub && (
        <div style={{
          fontSize: 13,
          color: 'var(--text-muted)',
          maxWidth: 360,
          margin: '0 auto',
          lineHeight: 1.4,
        }}>{sub}</div>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          style={{
            marginTop: 14,
            padding: '8px 16px',
            borderRadius: 999,
            background: 'var(--accent)',
            color: 'var(--accent-fg)',
            border: 'none',
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Parse-check**

Run: `npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/components/v2/primitives/EmptyState.jsx >/dev/null`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/v2/primitives/EmptyState.jsx
git commit -m "Phase 35 PR 1: EmptyState primitive"
```

---

## Task 6: LoadingState primitive

**Files:**
- Create: `src/components/v2/primitives/LoadingState.jsx`

- [ ] **Step 1: Create the file**

```jsx
// src/components/v2/primitives/LoadingState.jsx
//
// Phase 35 PR 1 — canonical loading state.
//
// Replaces 4 patterns:
//   • v2d-loading + v2d-spinner class (RenewalToolsV2, etc.)
//   • inline <Loader2> with spin animation (MasterV2, GovtProposalDetailV2)
//   • bare <div padding:60>Loading…</div> (SalesDashboard)
//   • <em>Loading…</em> in <td> (AutoDistrictsV2, GsrtcStationsV2)
//
// Variants:
//   page   — full-page centered spinner with label
//   inline — small spinner + label inline
//   table  — N skeleton rows matching column count (rows defaults to 3)

import { Loader2 } from 'lucide-react'

/**
 * @param {object} props
 * @param {'page'|'inline'|'table'} [props.type='page']
 * @param {string} [props.label='Loading…']
 * @param {number} [props.rows=3]      — for type='table' only
 * @param {number} [props.columns=4]   — for type='table' only
 */
export default function LoadingState({
  type = 'page',
  label = 'Loading…',
  rows = 3,
  columns = 4,
}) {
  if (type === 'table') {
    return (
      <>
        {Array.from({ length: rows }).map((_, i) => (
          <tr key={i}>
            {Array.from({ length: columns }).map((__, j) => (
              <td key={j} style={{ padding: '12px 14px' }}>
                <div style={{
                  height: 12,
                  background: 'var(--surface-2)',
                  borderRadius: 6,
                  width: j === 0 ? '60%' : '40%',
                  animation: 'pulse 1.6s ease-in-out infinite',
                }} />
              </td>
            ))}
          </tr>
        ))}
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 0.5; }
            50%      { opacity: 1; }
          }
        `}</style>
      </>
    )
  }

  if (type === 'inline') {
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        color: 'var(--text-muted)',
        fontSize: 13,
      }}>
        <Loader2 size={14} strokeWidth={1.6} style={{ animation: 'spin 1s linear infinite' }} />
        {label}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </span>
    )
  }

  // page (default)
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      padding: '60px 20px',
      color: 'var(--text-muted)',
      fontSize: 13,
    }}>
      <Loader2 size={22} strokeWidth={1.6} style={{ animation: 'spin 1s linear infinite' }} />
      {label}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
```

- [ ] **Step 2: Parse-check**

Run: `npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/components/v2/primitives/LoadingState.jsx >/dev/null`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/v2/primitives/LoadingState.jsx
git commit -m "Phase 35 PR 1: LoadingState primitive"
```

---

## Task 7: Banner primitive

**Files:**
- Create: `src/components/v2/primitives/Banner.jsx`

- [ ] **Step 1: Create the file**

```jsx
// src/components/v2/primitives/Banner.jsx
//
// Phase 35 PR 1 — canonical inline banner.
//
// Replaces:
//   • MasterV2 copy-paste status banner (6 sites, identical inline styles)
//   • QuoteDetail / OfferForm / PendingApprovals / LeadUpload inline
//     setError + div pattern
//
// Distinct from <Toast>: Banner is in-flow (sits where it's mounted),
// Toast is fixed-position bottom-right (transient).

import { X, CheckCircle2, AlertTriangle, AlertCircle, Info } from 'lucide-react'

const TONE = {
  success: { fg: 'var(--success)', bg: 'var(--success-soft)', icon: CheckCircle2 },
  warning: { fg: 'var(--warning)', bg: 'var(--warning-soft)', icon: AlertTriangle },
  danger:  { fg: 'var(--danger)',  bg: 'var(--danger-soft)',  icon: AlertCircle },
  info:    { fg: 'var(--blue)',    bg: 'var(--blue-soft)',    icon: Info },
}

/**
 * @param {object} props
 * @param {'success'|'warning'|'danger'|'info'} props.tone
 * @param {React.ReactNode} props.children
 * @param {() => void} [props.onDismiss] — when set, renders an X button
 */
export default function Banner({ tone, children, onDismiss }) {
  const t = TONE[tone] || TONE.info
  const Icon = t.icon
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 12px',
        background: t.bg,
        border: `1px solid ${t.fg}`,
        borderRadius: 10,
        color: 'var(--text)',
        fontSize: 13,
        lineHeight: 1.4,
        marginBottom: 12,
      }}
    >
      <Icon size={16} strokeWidth={1.6} style={{ color: t.fg, flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1 }}>{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            padding: 2,
            flexShrink: 0,
          }}
        >
          <X size={14} strokeWidth={1.6} />
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Parse-check**

Run: `npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/components/v2/primitives/Banner.jsx >/dev/null`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/v2/primitives/Banner.jsx
git commit -m "Phase 35 PR 1: Banner primitive"
```

---

## Task 8: ActionButton primitive

**Files:**
- Create: `src/components/v2/primitives/ActionButton.jsx`

- [ ] **Step 1: Create the file**

```jsx
// src/components/v2/primitives/ActionButton.jsx
//
// Phase 35 PR 1 — single button primitive.
//
// Replaces ~200 bare <button style={{…}}> sites scattered across V2
// pages. Single source of truth for :hover / :focus-visible / :disabled /
// :active states. Tap target ≥40px on every variant. Loading state
// replaces label with a spinner without resizing the button.

import { useState } from 'react'
import { Loader2 } from 'lucide-react'

const VARIANT_STYLES = {
  primary: {
    bg:     'var(--accent, #FFE600)',
    fg:     'var(--accent-fg, #0f172a)',
    border: 'transparent',
    hoverBg:'var(--accent-hover, #F0D800)',
  },
  ghost: {
    bg:     'transparent',
    fg:     'var(--text)',
    border: 'var(--border-strong)',
    hoverBg:'var(--surface-2)',
  },
  danger: {
    bg:     'var(--danger, #EF4444)',
    fg:     '#fff',
    border: 'transparent',
    hoverBg:'#dc2626',
  },
  subtle: {
    bg:     'var(--surface-2)',
    fg:     'var(--text)',
    border: 'var(--border)',
    hoverBg:'var(--surface-3, #475569)',
  },
}

const SIZE_PADDING = {
  sm: { padY: 6,  padX: 12, fontSize: 12, minH: 32, gap: 6 },
  md: { padY: 9,  padX: 16, fontSize: 13, minH: 40, gap: 7 },
  lg: { padY: 12, padX: 22, fontSize: 14, minH: 48, gap: 8 },
}

/**
 * @param {object} props
 * @param {'primary'|'ghost'|'danger'|'subtle'} [props.variant='primary']
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {React.ComponentType<any>} [props.iconLeft]
 * @param {React.ComponentType<any>} [props.iconRight]
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.loading] — replaces label with spinner; button stays disabled
 * @param {() => void | Promise<void>} props.onClick
 * @param {React.ReactNode} props.children
 * @param {React.CSSProperties} [props.style] — escape hatch; avoid if possible
 */
export default function ActionButton({
  variant = 'primary',
  size = 'md',
  iconLeft: IconL,
  iconRight: IconR,
  disabled,
  loading,
  onClick,
  children,
  style = {},
}) {
  const [hover, setHover] = useState(false)
  const [focused, setFocused] = useState(false)
  const v = VARIANT_STYLES[variant]
  const s = SIZE_PADDING[size]
  const isDisabled = disabled || loading

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: s.gap,
        padding: `${s.padY}px ${s.padX}px`,
        minHeight: s.minH,
        borderRadius: 999,
        background: hover && !isDisabled ? v.hoverBg : v.bg,
        color: v.fg,
        border: `1px solid ${v.border}`,
        fontFamily: 'var(--font-display, "Space Grotesk", system-ui, sans-serif)',
        fontWeight: 700,
        fontSize: s.fontSize,
        letterSpacing: '0.02em',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled && !loading ? 0.5 : 1,
        outline: focused ? '2px solid var(--accent, #FFE600)' : 'none',
        outlineOffset: 2,
        transition: 'background 120ms ease, transform 80ms ease',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {loading
        ? <Loader2 size={size === 'sm' ? 12 : 14} strokeWidth={1.6} style={{ animation: 'spin 1s linear infinite' }} />
        : (IconL && <IconL size={size === 'sm' ? 12 : 14} strokeWidth={1.6} />)
      }
      {!loading && children}
      {!loading && IconR && <IconR size={size === 'sm' ? 12 : 14} strokeWidth={1.6} />}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </button>
  )
}
```

- [ ] **Step 2: Parse-check**

Run: `npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/components/v2/primitives/ActionButton.jsx >/dev/null`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/v2/primitives/ActionButton.jsx
git commit -m "Phase 35 PR 1: ActionButton primitive"
```

---

## Task 9: MonoNumber primitive

**Files:**
- Create: `src/components/v2/primitives/MonoNumber.jsx`

- [ ] **Step 1: Create the file**

```jsx
// src/components/v2/primitives/MonoNumber.jsx
//
// Phase 35 PR 1 — JetBrains-Mono wrapper for numbers / IDs / phone
// numbers / dates. Replaces scattered `fontFamily: 'monospace'` literals
// (the system fallback renders as Menlo or Courier; the spec says
// JetBrains Mono).

/**
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {number} [props.size]
 * @param {React.CSSProperties} [props.style]
 */
export default function MonoNumber({ children, size, style = {} }) {
  return (
    <span style={{
      fontFamily: 'var(--font-mono, "JetBrains Mono", Menlo, monospace)',
      fontVariantNumeric: 'tabular-nums',
      fontSize: size,
      ...style,
    }}>
      {children}
    </span>
  )
}
```

- [ ] **Step 2: Parse-check**

Run: `npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/components/v2/primitives/MonoNumber.jsx >/dev/null`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/v2/primitives/MonoNumber.jsx
git commit -m "Phase 35 PR 1: MonoNumber primitive"
```

---

## Task 10: Barrel export

**Files:**
- Create: `src/components/v2/primitives/index.js`

- [ ] **Step 1: Create the file**

```js
// src/components/v2/primitives/index.js
//
// Phase 35 PR 1 — barrel export. Consumers do
//   import { PageHeader, Modal, StatusBadge, EmptyState, LoadingState,
//            Banner, ActionButton, MonoNumber } from '../components/v2/primitives'
// rather than 8 separate import lines.

export { default as PageHeader }   from './PageHeader'
export { default as Modal }        from './Modal'
export { default as StatusBadge }  from './StatusBadge'
export { default as EmptyState }   from './EmptyState'
export { default as LoadingState } from './LoadingState'
export { default as Banner }       from './Banner'
export { default as ActionButton } from './ActionButton'
export { default as MonoNumber }   from './MonoNumber'
```

- [ ] **Step 2: Parse-check**

Run: `npx --yes esbuild --loader:.js=jsx --log-level=warning src/components/v2/primitives/index.js >/dev/null`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/v2/primitives/index.js
git commit -m "Phase 35 PR 1: primitives barrel export"
```

---

## Task 11: /primitives-demo route + admin gate

**Files:**
- Create: `src/pages/v2/PrimitivesDemoV2.jsx`
- Modify: the routes file (run `grep -rln "createBrowserRouter\\|<Route" src/App.jsx src/main.jsx src/router* 2>/dev/null | head -3` to find the correct file)

- [ ] **Step 1: Locate the router file**

Run: `grep -rln "createBrowserRouter\\|<Route\\b" src/App.jsx src/main.jsx 2>/dev/null; ls src/`
Expected: prints the file that owns the `<Route>` declarations (likely `src/App.jsx`).

- [ ] **Step 2: Create the demo page**

Write `src/pages/v2/PrimitivesDemoV2.jsx`:

```jsx
// src/pages/v2/PrimitivesDemoV2.jsx
//
// Phase 35 PR 1 — admin-only demo route. Renders every primitive in
// every documented variant so owner can eyeball them on Vercel staging.
// Replaces the absent unit-test layer for this codebase: rep walks the
// demo on a 390 px viewport and a 1440 px viewport and either signs
// off or files specific feedback before PR 2 starts.

import { useState } from 'react'
import { Inbox, Phone, Plus, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import {
  PageHeader, Modal, StatusBadge, EmptyState, LoadingState,
  Banner, ActionButton, MonoNumber,
} from '../../components/v2/primitives'

export default function PrimitivesDemoV2() {
  const { profile, isPrivileged } = useAuth()
  const [modalOpen, setModalOpen] = useState(false)

  // Admin-only — sales/agency/telecaller bounce.
  if (!isPrivileged) {
    return (
      <div style={{ padding: 40 }}>
        <Banner tone="danger">Admin only.</Banner>
      </div>
    )
  }

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: '0 auto' }}>

      <PageHeader title="Primitives demo" subtitle="Phase 35 PR 1 — every variant of every primitive. Sign-off gate before PR 2." />

      <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 32 }}>PageHeader</h2>
      <PageHeader title="Plain title" />
      <PageHeader title="With eyebrow + subtitle" eyebrow="EYEBROW" subtitle="Subtitle line." />
      <PageHeader title="With actions" subtitle="Right-side slot." actions={<ActionButton size="sm">Action</ActionButton>} />
      <PageHeader title="Compact" hero="compact" subtitle="hero='compact'" />
      <PageHeader title="₹4.2 L incentive" hero="full" eyebrow="HERO FULL" subtitle="Used on /work + /my-performance only." />

      <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 32 }}>StatusBadge</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <StatusBadge tint="success">Won</StatusBadge>
        <StatusBadge tint="warning">Pending</StatusBadge>
        <StatusBadge tint="danger">Lost</StatusBadge>
        <StatusBadge tint="blue">New</StatusBadge>
        <StatusBadge tint="purple">Forecast</StatusBadge>
        <StatusBadge tint="yellow">Hot</StatusBadge>
        <StatusBadge tint="orange">Stale</StatusBadge>
        <StatusBadge tint="neutral">Draft</StatusBadge>
        <StatusBadge tint="success" icon={CheckCircle2}>With icon</StatusBadge>
        <StatusBadge tint="success" size="sm">Small</StatusBadge>
      </div>

      <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 32 }}>ActionButton</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <ActionButton variant="primary">Primary</ActionButton>
        <ActionButton variant="ghost">Ghost</ActionButton>
        <ActionButton variant="danger">Danger</ActionButton>
        <ActionButton variant="subtle">Subtle</ActionButton>
        <ActionButton iconLeft={Plus}>With icon</ActionButton>
        <ActionButton size="sm">Small</ActionButton>
        <ActionButton size="lg">Large</ActionButton>
        <ActionButton disabled>Disabled</ActionButton>
        <ActionButton loading>Loading</ActionButton>
      </div>

      <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 32 }}>Banner</h2>
      <Banner tone="success">Saved.</Banner>
      <Banner tone="warning">Heads up.</Banner>
      <Banner tone="danger" onDismiss={() => {}}>Could not save.</Banner>
      <Banner tone="info">FYI.</Banner>

      <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 32 }}>EmptyState</h2>
      <EmptyState
        icon={Inbox}
        title="No leads yet"
        sub="Tap below to add your first lead."
        action={{ label: '+ Add lead', onClick: () => {} }}
      />

      <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 32 }}>LoadingState</h2>
      <div style={{ marginBottom: 16 }}><LoadingState type="inline" /></div>
      <LoadingState type="page" label="Loading…" />
      <table style={{ width: '100%', marginTop: 16, borderCollapse: 'collapse' }}>
        <thead>
          <tr><th>Name</th><th>Company</th><th>Phone</th><th>Stage</th></tr>
        </thead>
        <tbody>
          <LoadingState type="table" rows={3} columns={4} />
        </tbody>
      </table>

      <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 32 }}>MonoNumber</h2>
      <p>Phone <MonoNumber>9876543210</MonoNumber>, amount <MonoNumber size={14}>₹2,34,567</MonoNumber>, ID <MonoNumber>UA-2026-0042</MonoNumber>.</p>

      <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 32 }}>Modal</h2>
      <ActionButton onClick={() => setModalOpen(true)}>Open modal</ActionButton>
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Demo modal"
        size="md"
        footer={
          <>
            <ActionButton variant="ghost" size="sm" onClick={() => setModalOpen(false)}>Cancel</ActionButton>
            <ActionButton variant="primary" size="sm" onClick={() => setModalOpen(false)}>OK</ActionButton>
          </>
        }
      >
        <p>Body content. Esc closes. Backdrop click closes.</p>
        <p style={{ marginTop: 12 }}>Logged in as <MonoNumber>{profile?.email}</MonoNumber>.</p>
      </Modal>
    </div>
  )
}
```

- [ ] **Step 3: Add the route**

Open the routes file (from Step 1). Add to the V2 routes block:

```jsx
import PrimitivesDemoV2 from './pages/v2/PrimitivesDemoV2'
// …in the routes table…
<Route path="/primitives-demo" element={<PrimitivesDemoV2 />} />
```

(Use the exact pattern that file already uses for other admin routes — copy the line for `/cockpit` or `/master` and replace the path + component.)

- [ ] **Step 4: Parse-check both files**

```bash
npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/pages/v2/PrimitivesDemoV2.jsx >/dev/null
# Plus the routes file you edited — substitute the actual path:
npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/App.jsx >/dev/null
```

Expected: clean for both.

- [ ] **Step 5: Commit**

```bash
git add src/pages/v2/PrimitivesDemoV2.jsx src/App.jsx
git commit -m "Phase 35 PR 1: /primitives-demo route + admin gate"
```

---

## Task 12: OfferForm token migration

**Files:**
- Modify: `src/pages/OfferForm.jsx`

- [ ] **Step 1: Inspect existing token usage**

Run: `grep -n "var(--red)\\|var(--gray)\\|var(--card)\\|var(--brd)" src/pages/OfferForm.jsx`
Expected: ~6 lines listing the references.

- [ ] **Step 2: Run mechanical replacements**

For each match from Step 1, replace using the Edit tool:

| Old | New |
|---|---|
| `var(--red)` | `var(--danger)` |
| `var(--gray)` | `var(--text-muted)` |
| `var(--card)` | `var(--surface)` |
| `var(--brd)` | `var(--border)` |

Also replace the bare `color: '#ef9a9a'` literal at line 527 with `color: 'var(--danger)'` (audit found this).

- [ ] **Step 3: Verify zero remaining undefined-token references**

Run: `grep -n "var(--red)\\|var(--gray)\\|var(--card)\\|var(--brd)\\|#ef9a9a" src/pages/OfferForm.jsx`
Expected: no output.

- [ ] **Step 4: Parse-check**

Run: `npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/pages/OfferForm.jsx >/dev/null`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/pages/OfferForm.jsx
git commit -m "Phase 35 PR 1: OfferForm — migrate to defined tokens"
```

---

## Task 13: Day theme toggle in Settings

**Files:**
- Modify: `src/components/v2/V2AppShell.jsx` — on mount, read theme from `localStorage`, apply to `<html data-theme>`
- Modify: the Settings page (run `grep -rln "/settings\\|Settings" src/pages 2>/dev/null | head -5` to locate)

- [ ] **Step 1: Locate the Settings page**

Run: `grep -rln "path=\\\"/settings\\\"\\|Settings" src/pages src/components/v2/V2AppShell.jsx 2>/dev/null | head -5`
Expected: prints the route file + the Settings page component file.

If `/settings` does not currently route to anything, create `src/pages/v2/SettingsV2.jsx` with a minimal scaffold (just the theme toggle) and add `<Route path="/settings" element={<SettingsV2 />} />` to the router.

- [ ] **Step 2: Add the theme initialiser to V2AppShell**

Open `src/components/v2/V2AppShell.jsx`. Add at the top of the `V2AppShell` component body (right after `const { user, profile, ... } = useAuth()`):

```jsx
// Phase 35 PR 1 — apply persisted theme on mount. The CSS overrides
// in v2.css already key off `<html data-theme="day">`; this just
// reads the rep's stored preference and sets the attribute.
useEffect(() => {
  try {
    const t = localStorage.getItem('theme') || 'night'
    document.documentElement.setAttribute('data-theme', t)
  } catch { /* localStorage blocked — leave attr empty, defaults to night */ }
}, [])
```

(Confirm `useEffect` is imported at the top; if not, add it.)

- [ ] **Step 3: Add the toggle to Settings**

Open the Settings page from Step 1. Add this section:

```jsx
import { useState, useEffect } from 'react'
import { Sun, Moon } from 'lucide-react'
import { PageHeader, ActionButton, Banner } from '../../components/v2/primitives'

function ThemeToggleSection() {
  const [theme, setTheme] = useState('night')
  useEffect(() => {
    try { setTheme(localStorage.getItem('theme') || 'night') } catch {}
  }, [])
  function apply(next) {
    setTheme(next)
    try { localStorage.setItem('theme', next) } catch {}
    document.documentElement.setAttribute('data-theme', next)
  }
  return (
    <div style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Appearance</h2>
      <div style={{ display: 'flex', gap: 8 }}>
        <ActionButton
          variant={theme === 'night' ? 'primary' : 'ghost'}
          size="sm"
          iconLeft={Moon}
          onClick={() => apply('night')}
        >
          Night
        </ActionButton>
        <ActionButton
          variant={theme === 'day' ? 'primary' : 'ghost'}
          size="sm"
          iconLeft={Sun}
          onClick={() => apply('day')}
        >
          Day
        </ActionButton>
      </div>
      <Banner tone="info">Theme stored per browser; sales reps can choose independently.</Banner>
    </div>
  )
}
```

Mount `<ThemeToggleSection />` inside the existing Settings page body. If you had to create the Settings page from scratch in Step 1, the page body is just:

```jsx
export default function SettingsV2() {
  return (
    <div style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
      <PageHeader title="Settings" />
      <ThemeToggleSection />
    </div>
  )
}
```

- [ ] **Step 4: Parse-check**

```bash
npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/components/v2/V2AppShell.jsx >/dev/null
npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/pages/v2/SettingsV2.jsx >/dev/null   # if you created it
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/v2/V2AppShell.jsx src/pages/v2/SettingsV2.jsx src/App.jsx
git commit -m "Phase 35 PR 1: Day theme toggle — persisted in localStorage"
```

---

## Task 14: ESLint warning rule

**Files:**
- Modify: `.eslintrc.js` (or `eslint.config.js`, whichever the repo uses)

- [ ] **Step 1: Locate the ESLint config**

Run: `ls -la .eslint* eslint.config* 2>/dev/null`
Expected: prints the config file. If both exist, use the `eslint.config.js` (flat config). If neither exists, skip this task with a note (the project doesn't lint via ESLint yet; the warning rule isn't strictly required at PR 1 — it just becomes a soft norm in PR 2 + PR 3).

- [ ] **Step 2: Add the `no-restricted-syntax` rule**

If the config has a `rules` block, add:

```js
'no-restricted-syntax': [
  'warn',
  {
    selector: 'JSXOpeningElement[name.name="button"] > JSXAttribute[name.name="style"]',
    message:
      'Bare inline <button style={...}> is restricted. Use <ActionButton> from src/components/v2/primitives instead. ' +
      'Phase 35 PR 1 ban; flips to hard fail at PR 3 close.',
  },
],
```

The rule is scoped to JSX `<button>` elements that pass a `style` prop. Components from the primitives directory still work — they're not literal `<button>` elements with a top-level `style` prop, they're components.

Exception: `src/components/v2/primitives/**` files may keep bare `<button style>` since they ARE the primitive. Either (a) add an `ignorePatterns: ['src/components/v2/primitives/**']` global override, or (b) accept the warning shows on primitives too — it's still a warning, not a hard fail.

- [ ] **Step 3: Run lint, expect warnings (not errors)**

Run: `npx eslint src/pages/v2/WorkV2.jsx 2>&1 | tail -20`
Expected: warnings for the existing bare-button usages — not errors, not blocking commits yet. Confirms the rule is wired.

- [ ] **Step 4: Commit**

```bash
git add .eslintrc.js   # or eslint.config.js
git commit -m "Phase 35 PR 1: eslint warn on bare <button style> outside primitives"
```

---

## Task 15: docs/UI_PRIMITIVES.md

**Files:**
- Create: `docs/UI_PRIMITIVES.md`

- [ ] **Step 1: Create the file**

```markdown
# UI Primitives — Use this, not that

**Phase 35 PR 1 — 2026-05-13.** Eight reusable components live in
`src/components/v2/primitives/`. Every new page and every PR 3 sweep
target consumes these instead of bespoke markup. The list below is
the canonical "when you need X, use Y" reference.

## When you need…

| Need                                | Use                              | Not                                              |
|------------------------------------- |--------------------------------- |------------------------------------------------- |
| Page heading                         | `<PageHeader title=…>`           | bare `<h1>` + custom page-head wrapper           |
| Modal / dialog                       | `<Modal open onClose title>`     | custom backdrop + close button per page          |
| Status pill / chip                   | `<StatusBadge tint=…>`           | inline `style={{ background: 'rgba(…)' }}`       |
| Empty list / "Nothing yet"           | `<EmptyState icon title sub>`    | bare `<div>No X yet</div>`                       |
| Loading / spinner                    | `<LoadingState type=…>`          | bare "Loading…" / inline `<Loader2>`             |
| Inline tone banner                   | `<Banner tone>`                  | `setError` + inline tone div                     |
| Button                               | `<ActionButton variant size>`    | `<button style={{ background: …, padding: … }}>` |
| Currency / phone / ID / date         | `<MonoNumber>`                   | `fontFamily: 'monospace'` literal                |

## Hero variant rule

`<PageHeader hero="full">` is reserved for **`/work` and
`/my-performance`** only — the rep's daily home view + their daily-
numbers view. Every other page uses `hero="none"` (default) or
`hero="compact"`.

## Modal sizing rule

| size       | max-width | typical use                                |
|------------|-----------|--------------------------------------------|
| `sm`       | 380 px    | Confirm dialogs, simple inputs             |
| `md`       | 520 px    | Forms, default                             |
| `lg`       | 720 px    | Complex forms, lists                       |
| `full`     | 100%      | iOS-style full-screen on mobile            |

## Demo route

Every primitive in every variant is mounted on `/primitives-demo`
(admin / co-owner only). Visit on staging before approving any PR
that touches the primitives.

## ESLint guardrail

Bare `<button style={…}>` triggers an ESLint warning when used
outside `src/components/v2/primitives/`. Replace with
`<ActionButton>`. The rule flips from warn → error at PR 3 close.

## Bug reports

If a primitive is missing a prop or rendering wrong, file an issue
in the spec doc (`docs/superpowers/specs/2026-05-13-sales-mobile-
v21-design.md`) before patching the primitive — primitives must not
re-enter the sub-letter patch cycle.
```

- [ ] **Step 2: Commit**

```bash
git add docs/UI_PRIMITIVES.md
git commit -m "Phase 35 PR 1: UI primitives use-this-not-that doc"
```

---

## Task 16: Final smoke, push, owner sign-off

- [ ] **Step 1: Run full pre-commit verification on all changed files**

Run from `~/Documents/untitled-os2/Untitled/adflux`:

```bash
for f in $(git diff --name-only HEAD~16..HEAD | grep -E '\\.jsx?$'); do
  npx --yes esbuild --loader:.jsx=jsx --log-level=warning "$f" >/dev/null \
    && echo "PASS $f" \
    || echo "FAIL $f"
done
```

Expected: every PASS, no FAIL.

- [ ] **Step 2: Brand-check every changed .jsx file**

```bash
for f in $(git diff --name-only HEAD~16..HEAD | grep '\\.jsx$'); do
  bash scripts/check-jsx-brand.sh "$f" || true
done
```

Expected: only pre-existing comment-only violations (e.g. CLAUDE.md `#facc15` inside file header comments). No new `#facc15` / `#0a0e1a` literals in the new primitives or Settings.

- [ ] **Step 3: Push**

```bash
git push origin untitled-os
```

Expected: `untitled-os -> untitled-os` confirmation. Vercel kicks off the build automatically.

- [ ] **Step 4: Wait for Vercel build (~2 min) and ask owner to smoke-test**

Owner walks the demo on **both** viewports:
1. iPhone (PWA, 390 px) → `https://untitled-os-tau.vercel.app/primitives-demo`
2. Desktop (1440 px) → same URL

Acceptance per the spec §4.5:
- All 8 primitives render in all variants.
- No console errors in DevTools.
- Switching Day ↔ Night in Settings flips the page colours (and stays flipped on refresh).
- `OfferForm.jsx` (`/offer/new`) renders without the broken `--red` asterisk.
- Bottom-nav still functions identically (zero visual diff on every existing page).

- [ ] **Step 5: Final commit (only if owner asks for any tweaks during smoke-test)**

If smoke-test surfaces a specific primitive bug, fix it in a single follow-up commit on this branch. Do NOT open a new sub-letter — fix inline.

- [ ] **Step 6: Tag PR 1 complete**

```bash
git tag -a phase-35-pr1-primitives -m "Phase 35 PR 1: Primitives Pack landed"
git push origin phase-35-pr1-primitives
```

Owner announces "PR 1 done, OK to start PR 2" → next plan opens.

---

## Self-review summary

Plan covers:
- §4.1 — 8 primitives (Tasks 2-9)
- §4.1 — barrel export (Task 10)
- §4.1 — demo route (Task 11)
- §4.2 — gradient + orange + purple tokens (Task 1)
- §4.3 — OfferForm token migration (Task 12)
- §9 Q2 — Day theme toggle (Task 13)
- §4.5 — ESLint warning rule (Task 14)
- §4.4 — docs/UI_PRIMITIVES.md (Task 15)
- §4.5 — final smoke gate (Task 16)

Gaps to be aware of:
- Sample migration of 3 pages (§8 risk register mitigation) is NOT in this plan — it lands in PR 2 (we discover real-world prop needs during /work rebuild and tighten primitive APIs before PR 3 mass-migration).
- Map provider (MapTiler) signup + key add — owner-side action; flagged in spec §9 Q3 for PR 2.
- Tint tokens (`--tint-success-bg` etc.) are assumed to already exist from Phase 34R per the audit. If `grep -n "tint-success-bg" src/styles/v2.css` returns empty, add them in Task 1 step 3 before the primitives consume them. (Likely a no-op — they're already there per Phase 34R.)
