# UNTITLED OS — UI DESIGN SYSTEM

**Source of truth:** `Adflux Dashboard _standalone_-6d69f50d.html` in user uploads (mockup the owner approved).
**Status:** mandatory reference. Every new screen follows these tokens. Owner is "very UI oriented" — broken UI is unacceptable.

> **For future Claude:** before building or editing any v2 page, read this file end-to-end. Match tokens exactly. If a screen needs a token that doesn't exist here, add it here first, then use it.

---

## 1. Theme architecture

Two themes: **Night (default)** and **Day**. Toggled via `data-theme="day"` on `<html>`. Components use CSS variables, never hardcoded colors.

### 1.1 Tokens — Night (default `:root`)

```css
/* Backgrounds */
--bg:          #0a0e1a;   /* page */
--surface-1:   #11172a;   /* cards, sidebar */
--surface-2:   #1a2138;   /* hover states, nested */
--surface-3:   #232b46;   /* deeper inputs, segmented */
--border:      #2a3450;
--border-soft: rgba(255,255,255,.06);

/* Brand */
--accent:      #facc15;   /* yellow */
--accent-ink:  #0a0e1a;   /* on-yellow text */

/* Status colors (use on tints below, not raw) */
--green:       #4ade80;
--amber:       #fbbf24;
--red:         #f87171;
--blue:        #60a5fa;
--purple:      #c084fc;

/* Hero revenue gradient stops */
--teal-1:      #0d3d3a;
--teal-2:      #134e4a;
--teal-3:      #0f766e;

/* Text */
--text-1:      #ffffff;
--text-2:      rgba(255,255,255,.62);
--text-3:      rgba(255,255,255,.40);

/* Status tints (always pair fg+bg+border) */
--tint-red-bg:    rgba(248,113,113,.10);  --tint-red-bd:    rgba(248,113,113,.28);
--tint-amber-bg:  rgba(251,191,36,.10);   --tint-amber-bd:  rgba(251,191,36,.28);
--tint-green-bg:  rgba(74,222,128,.10);   --tint-green-bd:  rgba(74,222,128,.28);
--tint-blue-bg:   rgba(96,165,250,.12);   --tint-blue-bd:   rgba(96,165,250,.30);
--tint-purple-bg: rgba(192,132,252,.12);

/* Effects */
--shadow-card:  0 1px 0 rgba(255,255,255,.02) inset, 0 8px 24px rgba(0,0,0,.25);
--kbd-bg:       rgba(255,255,255,.06);
```

### 1.2 Tokens — Day (`[data-theme="day"]`)

```css
--bg:          #f4f5f8;
--surface-1:   #ffffff;
--surface-2:   #f8f9fc;
--surface-3:   #eef0f6;
--border:      #e3e6ee;
--border-soft: rgba(10,14,26,.06);

--accent:      #f5b800;
--green:       #16a34a;
--amber:       #d97706;
--red:         #dc2626;
--blue:        #2563eb;
--purple:      #9333ea;

--text-1:      #0c1224;
--text-2:      rgba(12,18,36,.66);
--text-3:      rgba(12,18,36,.44);

--tint-red-bg:    rgba(220,38,38,.07);   --tint-red-bd:    rgba(220,38,38,.22);
--tint-amber-bg:  rgba(217,119,6,.08);   --tint-amber-bd:  rgba(217,119,6,.22);
--tint-green-bg:  rgba(22,163,74,.08);   --tint-green-bd:  rgba(22,163,74,.22);
--tint-blue-bg:   rgba(37,99,235,.07);   --tint-blue-bd:   rgba(37,99,235,.22);
--tint-purple-bg: rgba(147,51,234,.07);

--shadow-card: 0 1px 0 rgba(255,255,255,.6) inset,
               0 1px 2px rgba(12,18,36,.04),
               0 8px 22px rgba(12,18,36,.05);
```

### 1.3 Theme persistence

User preference saved to `localStorage.theme = 'night' | 'day'`. Toggle button in topbar. Default = night. Respect `prefers-color-scheme: light` on first visit.

---

## 2. Typography

Three font families. Already loaded in `index.html` from Google Fonts.

```css
font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
font-feature-settings: "ss01", "cv11";
-webkit-font-smoothing: antialiased;
```

| Family | Use for | Class |
|---|---|---|
| **Inter** | All body text, paragraphs, default | (default) |
| **Space Grotesk** | Headings (h1/h2/h3), big numbers, brand mark, leaderboard rank, all `.num` | `.display`, `.num`, `h1-h3` |
| **JetBrains Mono** | IDs, codes, financial figures, age counters, kbd shortcuts | `.mono` |

**Type scale**

| Token | Size | Weight | Use |
|---|---|---|---|
| Display M | 28px | 600 | Greeting "Good morning, Brijesh" |
| Display S | 22px | 600 | Big stats in cards |
| Hero stat value | 30px | 600 | Hero revenue numbers |
| Card title | 13px | 600 | Card headers |
| Body | 14px | 400 | Default |
| Body sm | 13px | 400 | Tables, action rows |
| Caption | 11–12px | 500 | Sub labels |
| Eyebrow | 10–11px | 500 letter-spacing .14em uppercase | Section labels |
| KBD | 10px | mono | Keyboard shortcuts |

**Letter-spacing rule:** display text gets `-0.01em`. Eyebrow text gets `+0.12em` to `+0.18em`.

---

## 3. Layout shell

```css
.app {
  display: grid;
  grid-template-columns: 232px 1fr;  /* sidebar | main */
  min-height: 100vh;
}
```

### 3.1 Sidebar (232px wide, sticky, full height)

- Brand mark: 36×36 yellow tile, 9px radius, "A" in Space Grotesk 700.
- Nav groups separated by 18px gap and `.nav-label` (eyebrow style).
- Active nav item: surface-2 background + 3px yellow accent bar on the left.
- Hover: surface-2 background, text-1 color.
- Right-side red badge for counts (e.g. "3 pending approvals").
- `.sidebar-foot` pinned bottom (theme toggle, settings).

### 3.2 Topbar (64px, sticky)

```
[ Search input — 360px max ]    [ Period picker ] [ Segment ] [ Bell + dot ] [ + New CTA ] [ Avatar ]
```

- Search: rounded-pill, surface-1 background, 1px border, kbd "⌘K" hint.
- Period picker / Segment / Avatar: same pill style — surface-1 + 1px border + 999px radius.
- Icon button: 38×38, optional red dot (8×8) at top-right for notifications.
- Yellow CTA button (`.cta`): accent background, accent-ink text, 999px radius.

### 3.3 Main page area

```css
.main { padding: 28px 32px 56px; max-width: 1480px; }
```

Use `.row` (16px gap), with variants `.row.two` (1fr 1fr), `.row.three` (1.2fr .9fr .9fr).

---

## 4. Component library

### 4.1 Card (the workhorse)

```css
.card {
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow-card);
  overflow: hidden;
}
.card-pad { padding: 18px 20px; }
.card-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-soft);
}
```

`.card-title` = 13px / 600. `.card-sub` = 11px / text-3. `.card-link` = 12px, hover → accent.

### 4.2 AI Briefing card (the killer hero on dashboards)

Wide gradient card with purple+blue radial glows + animated pulse on the AI icon. Used on owner cockpit + sales dashboard for the daily AI brief.

Structure:
```
┌─[44px purple→blue gradient icon w/ pulse]── recap text ────[time + view-full button]─┐
│                                                                                       │
│  ⚡ AI BRIEFING · 9:00 AM                                                             │
│  Yesterday: ₹1,24,000 collected (83% target). 14 meetings, 32 leads, 2 wins.         │
│  Top 3 today: …                                                                       │
│  ● Vishnu hasn't checked in 3 days        [Call now]                                  │
│  ● Stanza Living invoice 28d overdue ₹46K [Send reminder]                             │
│  ● Pizza Hut creative on round 4          [Review]                                    │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

Keyframe `@keyframes pulse` defined globally — used by AI icon, live dots on status pills.

### 4.3 Hero revenue card

Teal gradient (`#0d3d3a → #134e4a → #0f766e`) with yellow radial glow at top-right corner. White text. 5 stats grid (label + value + delta) divided by 1px white-rgba lines. Floating yellow CTA at top-right.

Used on: admin cockpit (top of page).

### 4.4 Status chip

```html
<span class="chip [red|amber|green|blue|govt]">label</span>
```

3px×8px padding, 999px radius, 11px / 500. Use the matching `--tint-*-bg` + `--tint-*-bd`.

### 4.5 Banner (alerts above content)

Red/amber/green tinted banner with 28×28 icon tile, body text, optional anchor link in matching status color. 12px radius, 12×16px padding.

### 4.6 Action queue / list rows

Click-through rows with: 32×32 colored icon tile + big count number (Space Grotesk 22px) + label + sub + arrow. Hover: surface-2 background, arrow turns yellow + slides 2px right.

### 4.7 Compact table

```html
<table class="compact">
  <th>UPPERCASE EYEBROW HEADER</th>
  <td>row content</td>
  <tr class="below">below-target rows have red tint background</tr>
</table>
```

Eyebrow headers (10px / 500 / .14em letter-spacing / text-3 / uppercase). Border-bottom on every row except last. Hover entire row → surface-2.

### 4.8 Rep avatar

28×28 circle, 11px Space Grotesk 600, initials. Six rotating color schemes (`.r1` through `.r6`):
- r1: amber tint (#fef3c7 / #92400e)
- r2: violet tint (#ddd6fe / #5b21b6)
- r3: blue tint (#bfdbfe / #1e40af)
- r4: orange tint (#fed7aa / #9a3412)
- r5: green tint (#bbf7d0 / #166534)
- r6: pink tint (#fbcfe8 / #9d174d)

Assign by `userId.charCodeAt(0) % 6 + 1`.

### 4.9 Funnel bar (lead pipeline)

90px stage label · flex-1 colored bar (animated grow) · 50px count · 110px ₹value. Bar fills with `--text-3` (default), `--blue` (sent), `--amber` (negotiating), `--green` (won), `--red` (lost). 600ms cubic-bezier(.2,.8,.2,1) animation.

### 4.10 Trend chart bars

200px tall, 12px gap. Each col: bar (yellow accent for current period, surface-3 otherwise) + label. Tooltip on hover (`.tip`) above bar in JetBrains Mono.

### 4.11 Outstanding row

3-col grid: client info (avatar + name + id) | ₹amount | age. Age in JetBrains Mono — red if old, amber if warn.

### 4.12 Leaderboard row

4-col grid: rank (28px, gold/silver/bronze for top 3) | name+role | numbers | progress bar (green/amber/red).

### 4.13 Campaign card

Grid of 4 per row. Each card: status pill (live/soon/ending — live has pulsing green dot) + medium eyebrow + name + rep + amount + days + thin progress bar. Hover: lift 2px + yellow border.

### 4.14 Activity feed row

3-col grid: 28×28 icon tile (green/blue/amber/red/purple) | text (b for highlights) | mono time. Hover surface-2.

### 4.15 Form controls

| Element | Style |
|---|---|
| Text input | surface-2 background, 1px border, 6px radius, 8px padding, focus → accent border |
| Number input | same + tabular-nums + right-align |
| Textarea | same, min-height 60px |
| Select | same with chevron |
| Checkbox | accent-color: var(--accent) |
| File picker | dashed border tile, 8px radius, hover → accent border |
| Button primary | yellow accent + accent-ink text, 999px radius |
| Button secondary | surface-1 + border + text-1 |
| Button ghost | transparent + text-2, hover → surface-2 |
| Button danger | red text + red border |

### 4.16 Modal

Black 80%-opacity backdrop. Modal: surface-1 + 14px radius + max-width 560px (520 for confirm). Three sections: `.md-h` (header with title + ✕), `.md-b` (body, 18-20px padding), `.md-f` (footer with Cancel/Confirm right-aligned).

### 4.17 Pulse animation (live indicators)

```css
@keyframes pulse {
  0%   { box-shadow: 0 0 0 0 rgba(192,132,252,.5); }
  70%  { box-shadow: 0 0 0 6px rgba(192,132,252,0); }
  100% { box-shadow: 0 0 0 0 rgba(192,132,252,0); }
}
```

Used on: AI eyebrow dot, live campaign pill dot, "in progress" indicators.

---

## 5. Spacing scale

Use multiples of 4. Common values:

- 4 — chip padding-y
- 8 — small gap
- 12 — medium gap
- 14 — banner padding-y
- 16 — row gap (default)
- 18 — card padding-y
- 20 — card padding-x
- 22 — hero padding
- 28 — main padding-y
- 32 — main padding-x

Border-radius: **6px** for inputs, **8px** for small tiles, **9px** for chips/avatars/icon tiles, **12px** for banners, **14px** for cards, **16px** for AI briefing + hero, **999px** for pills.

---

## 6. Mobile breakpoints

```css
@media (max-width: 1100px) {
  .row.three { grid-template-columns: 1fr; }       /* stack */
  .campaigns { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 720px) {
  .app { grid-template-columns: 1fr; }             /* sidebar collapses */
  .sidebar { position: fixed; transform: translateX(-100%); transition: transform .2s; }
  .sidebar.open { transform: translateX(0); }
  .topbar { padding: 0 16px; }
  .topbar .search { display: none; }                /* search moves into menu */
  .main { padding: 16px; }
}
```

**Mobile-specific patterns:**
- The `/work` page (sales rep daily flow) is mobile-first. Big tap targets (min 44×44).
- `/cockpit` and `/leads` are desktop-first but must scroll cleanly on mobile.
- Bottom-fixed action button on mobile: yellow accent CTA, 56px round.

---

## 7. Iconography

Icons via `lucide-react`. Stroke 1.6, sizes 14/16/18/22 px depending on context. Color inherits from parent text.

| Context | Size | Color |
|---|---|---|
| Sidebar nav | 16 | text-2, active = text-1 |
| Card title | — | (no icons in card titles unless functional) |
| Action row | 16 | colored to match action-icon tile |
| Status chip prefix | 12 | matching chip color |
| Topbar buttons | 16 | text-1 |

---

## 8. Animation guidelines

- Hover transitions: 150ms ease.
- Bar/funnel fills: 600–800ms cubic-bezier(.2,.8,.2,1).
- Pulse: 2s infinite.
- Modal entrance: 150ms scale 0.96 → 1 + opacity 0 → 1.
- Toast: slide in from top, 200ms.

Don't use bounce, spring, or anything cute. The design language is precise / quiet / grown-up.

---

## 9. Accessibility floor

- Body contrast on `--bg`: AA (4.5:1) for `--text-1`, AA-large for `--text-2`.
- All interactive elements have focus ring: `outline: 2px solid var(--accent); outline-offset: 2px`.
- Status colors are never the only signal — always paired with icon or text.
- Forms have visible labels (no placeholder-only).
- Tap targets ≥ 44×44 on mobile.

---

## 10. Build checklist for any new screen

Before declaring a screen done:

1. ✅ Uses CSS variables only — no hardcoded colors.
2. ✅ Renders correctly in BOTH night and day theme.
3. ✅ All status badges use the chip + tint pattern.
4. ✅ Numbers in Space Grotesk; IDs/ages in JetBrains Mono; body in Inter.
5. ✅ Border-radius matches the scale (6/8/9/12/14/16/999).
6. ✅ Hover states defined on every interactive element.
7. ✅ Empty state designed (not a blank white box).
8. ✅ Loading state designed (skeleton or spinner with "Loading…" hint).
9. ✅ Error state designed (red banner with retry).
10. ✅ Mobile breakpoint tested at 720px and 1100px.
11. ✅ Focus rings visible on tab navigation.
12. ✅ Lucide icons only, stroke 1.6.

---

**End of Design System v1.**
**Updates:** when a new pattern is introduced, add it here first. Don't fork.
