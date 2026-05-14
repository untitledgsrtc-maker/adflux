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
