# Phase 36 — Sales Operator Visual Vocabulary

**Date:** 2026-05-14
**Owner sign-off:** "go C" (14 May 2026)
**Status:** Approved, ready to build

## Why

The /work page ships in 11 sub-letter patches (Phase 35 PR 2.0 → 2.11) because no shared visual vocabulary. Each fix introduces new colors / fonts / radii, then the next fix conflicts. Owner audit captured the symptoms: 4 different yellows, 2 greens, 1 purple, 1 blue all on /work. Frontend-design pass picked **Direction C — Sales Operator** (editorial / concierge). This spec locks the vocabulary so future work consumes it instead of inventing.

## The rule

After this ships, **no PR may add a new color, font, radius, or easing curve to the codebase**. Every new screen uses the vocabulary defined here. If something genuinely doesn't fit, owner approves an addition to this spec; we don't add tokens ad-hoc.

## Vocabulary

### Typography
- **Display** (page titles, big numbers): **GT America Mono** (or fallback `JetBrains Mono`)
- **Body** (paragraphs, labels): **Inter** (sans, 400/500/600/700)
- **Mono** (IDs, phone, currency): same GT America Mono as display

Two font families total. No three-way mixing.

### Color (extends existing `tokens.css`, no new hex)
Locked palette — every UI element resolves to one of these:

```
/* Surfaces */
--bg          (slate-deep)
--surface     (raised card)
--surface-2   (sub-card)

/* Ink */
--text        (primary)
--text-muted  (secondary)
--text-subtle (tertiary)

/* Accent — used SPARINGLY (≤ 1 yellow surface per viewport) */
--accent      (#FFE600 yellow)
--accent-fg   (dark text on yellow)

/* Status (chip-only, never primary surface) */
--success / --warning / --danger / --blue

/* Day spine glow */
--accent-soft (rgba yellow .14)
```

No new tokens. The 4 yellows / 2 greens / 1 purple / 1 blue that currently ship on /work all map to ONE of the above. Anything that doesn't fit gets cut.

### Spacing
Six-step scale, mostly multiples of 4:
`2 · 4 · 8 · 12 · 16 · 24 · 32 · 48`

No arbitrary numbers (7, 11, 13, 18, 22). Lint enforces.

### Radii
Three options:
- `6px` — input pills, dense chips
- `12px` — cards
- `999px` — buttons, status chips

No 7 / 11 / 14 / 16 / 20 anywhere.

### Easing
One curve, everywhere: `cubic-bezier(0.2, 0.8, 0.2, 1)` over **240 ms**. Faster animations (120ms) only for momentary feedback (button press). No bounce, no spring.

### Background atmosphere
Subtle 1% noise overlay on the body (PNG, ~3KB) to give "parchment grain" feel. Doesn't read as decoration — it just removes the flat-vector AI look.

## The Day Spine

The page's identity element. One vertical hairline (2px wide) pinned to the LEFT edge of `/work` content area, height = full viewport scroll.

- 13 dots evenly spaced from top to bottom representing **08:00 → 20:00** (1 dot per hour)
- Dot states:
  - **Future**: 4px circle, 50% opacity, slate
  - **Past**: 4px circle, 100% opacity, ink
  - **Current hour**: 6px circle, brand yellow `--accent`, with a 2-second pulse
  - **Has activity logged**: 6px filled yellow circle on top of normal dot (overlay)
- Hour labels (08, 12, 16, 20) shown as small caps next to every 4th dot
- Tapping a dot scrolls /work content to that time's surface (planned meeting, logged activity)
- Mobile (< 860 px): spine sits at LEFT edge with 28px gutter; content has 36px left padding to clear it
- Desktop (≥ 860 px): spine sits at LEFT edge with 48px gutter

The spine is what reps point at when describing the app: "see how my day fills up." Replaces 4 separate progress widgets (V2Hero target, meeting ring, smart-task panel, today's tasks chip).

## What gets demolished

PR 2 surfaces stay (architecture is sound). But on /work specifically:
- V2Hero teal gradient: keep as page hero card; same color
- Purple ProposedIncentive: keep at top (canonical purple is owner-approved)
- Next-up dark card: KEEP shape, drop the orange "meeting" chip (chip becomes `--accent-soft`)
- Today's Tasks lavender accent: DROP — replace with slate + accent-yellow on overdue only
- Map Leaflet blue: unchanged (third-party, owner approves drift)
- Yellow Speak evening button: KEEP shape, but use vocab's button primitive sizing

After: `/work` ships with **3 colors** visible to the rep: dark slate (everything), brand yellow (one CTA + day spine + accent chips), white text. Plus the purple incentive at the top (intentional contrast).

## Files

**Create:**
- `src/styles/v3-vocab.css` — typography + spacing/radius/easing custom properties (no new color tokens)
- `src/components/v2/DaySpine.jsx` — the spine
- `public/grain.png` — 1% noise (200x200 tile, 1.5KB)

**Modify:**
- `src/pages/v2/WorkV2.jsx` — mount `<DaySpine />`, consume vocab, drop the inline color literals
- `CLAUDE.md` — append §28 ("Phase 36 vocab is law")
- `index.html` — link the new font

**Don't touch (this PR):** other V2 pages. PR 3 mass migration brings them onto the vocab over time.

## Acceptance gate

Screenshot /work mobile + desktop side-by-side with:
- /leads
- /quotes
- /follow-ups

The four screenshots should LOOK LIKE THE SAME PRODUCT. If /work feels visually different (warmer, calmer, less chaotic) but the four together don't read as a family, the spec failed.

Specific checks:
- Inline `style={{ background: ... }}` count on WorkV2 drops by ≥ 50%
- Zero new color hex codes introduced
- Day spine renders on iPhone 14 Pro + 1440px Mac without overlap with content
- Brand yellow appears at most 2× in any viewport
- All animations use the locked easing curve

## Effort

~3 days end-to-end:
- Day 1: vocab CSS + grain.png + font link + CLAUDE.md §28
- Day 2: DaySpine component + WorkV2 rewire
- Day 3: visual smoke + owner walk + iterate

Ship as Phase 36 (clean phase, not 35.x). After ship, PR 3 mass migration just becomes "consume the vocab" instead of "introduce primitives."

## Next

Owner approved direction. Skip the full plan ceremony — go straight to code. Plan summary at `docs/superpowers/plans/2026-05-14-phase36-vocab-implementation.md` will track task checkboxes.
