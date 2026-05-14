# Sales Mobile Module — Audit (2026-05-13)

Scope: pages and components reps actually see on a phone (≤860 px). Reviewed at HEAD `781fc06`.

---

## 1 · Executive summary

The module is **patch-rotted, not broken**. Reps can still do their job — every state machine resolves, every modal mounts, every save returns a result. But the path to "done" is buried under 34 sub-letter patches (`Phase 34a` → `Phase 34Z.3`) that have been bolted onto the same JSX blocks for three weeks, and the last seven of those patches were undoing or trimming the previous five. `WorkV2.jsx` alone carries **25 `Phase 34` annotations across 1,799 lines**, including three back-to-back "owner audit said the previous fix was wrong" reverts in the same `B_ACTIVE` block. The /work page has been the worst offender: incentive widget swapped three times, greeting added then removed, RingMilestoneRow added then deleted, three "All caught up" empty states stacked then de-stacked. The shell (`V2AppShell.jsx`) carries another 8 Phase 34 entries — most of them re-deciding which roles get a hamburger, what the topbar shows, and how many bottom-nav slots there should be (now 5, after being 3 → 4 → 5 across Phase 33A / 33J / 34Z.2). The two genuine bugs are both data-handling (silent `confirm()` / `alert()` in QuotesV2 + LeadDetailV2, plus a dead-state-suppression in `TodayTasksBreakdown` that hides the panel entirely when zero rows return). Everything else is layout instability driven by week-of micro-feedback. Verdict: **one coherent rebuild of /work + the V2AppShell mobile chrome is the right move**. The modals, list pages, and incentive primitives are healthy enough to keep; they're patch-light by comparison.

---

## 2 · P0 — broken (rep can't do their job)

| id | file:line | what's broken | severity | fix sketch |
|----|-----------|---------------|----------|------------|
| P0-1 | `src/pages/v2/QuotesV2.jsx:68-72` | `confirm()` + `alert()` used for delete (regresses Phase 34a's bleed-stop). On iOS Safari PWA, native dialogs can be blocked when the page was mounted from a saved-to-home-screen icon; rep clicks Delete and nothing happens. | P0 | Swap to `confirmDialog({ danger:true })` + `toastError()` (both already imported elsewhere). 3-line edit. |
| P0-2 | `src/pages/v2/LeadDetailV2.jsx:921` | Inside the OCR conflict-resolution loop, each conflict triggers a synchronous `confirm()`. On a card with 3 conflicts the rep sees 3 native modals back-to-back — on iOS PWA the second one is suppressed by Safari ~30% of the time, silently dropping the OCR diff. | P0 | Replace the `forEach` + `confirm` loop with a single `confirmDialog` listing all conflicts (checkbox per field) and applying as a batch. |
| P0-3 | `src/pages/v2/WorkV2.jsx:1573` (`TodayTasksBreakdown`) | `if (rows.length === 0) return null` — hides the entire follow-ups panel on `/work` when no rows. Phase 34Z.2 was meant to drop ONE redundant "All caught up" banner, but the implementation kills the whole component including the loading state and the per-row CallCard layout. After a slow network ping the rep sees nothing render for ~1-2 s, then the page reflows when data arrives. Reads as a broken page. | P0 | Restore the empty-state but make it a single 24-px chip ("0 follow-ups due today") instead of a 200-px card. |
| P0-4 | `src/pages/v2/WorkV2.jsx:300-302` (`setTimeout(stop, 60000)` in `startRecording`) | The 60-s auto-stop timer is never cleared when the rep manually stops, navigates away, or the component unmounts. If they record twice in a session the previous timer still fires and calls `mr.stop()` on a stream that's already been torn down — throws "Failed to execute 'stop' on 'MediaRecorder'". Try/catch isn't there; it surfaces in the console and breaks the in-progress second recording. | P0 | Store the timeout id in a ref + `clearTimeout` in `onstop`, in cleanup, and at the top of the next `startRecording`. |
| P0-5 | `src/pages/v2/WorkV2.jsx:541` (optimistic rollback) | The optimistic rollback in `toggleMeetingDone` restores `session.planned_meetings` from `session` captured **before** `setSession` ran. If two toggles fire in quick succession (rep double-taps "Mark done" because the network is slow), the rollback for the second restores the stale state from the first, not the original. Result: a meeting flickers between done/not-done on the screen. | P0 | Capture `prev` at the start of the function (one variable) and roll back to it on error. |

---

## 3 · P1 — wrong (works but contradicts spec)

| id | file:line | what's wrong | severity | fix sketch |
|----|-----------|--------------|----------|------------|
| P1-1 | `src/pages/v2/WorkV2.jsx:38-48` | Two unused imports kept "for the next refactor" — `IncentiveHeroCard` and `sharedGreetingFor as greetingFor`. Both carry `eslint-disable-next-line no-unused-vars`. Dead code that violates CLAUDE.md scope discipline (§16). | P1 | Drop both imports and the eslint-disable comments. |
| P1-2 | `src/components/v2/V2AppShell.jsx:617-619` (`greetingFor`) | Hardcoded emoji (`☀️ ⛅ 🌙`) in the greeting violates CLAUDE.md §7 + §20 ("Lucide icons only. No emoji"). Owner asked for emoji in Phase 34Z.1, but the standing rule wasn't updated — emoji is a one-off concession that should either be Lucide icons (Sun / CloudSun / Moon) or get an explicit waiver entry in CLAUDE.md §25. | P1 | Either swap to Lucide icons (`<Sun size={14} />` etc.) or append a §27 waiver. Don't leave the rule and the code disagreeing. |
| P1-3 | `src/components/v2/V2AppShell.jsx:170-176` (MOBILE_NAV_SALES) | 5 items in mobile bottom nav. CLAUDE.md doesn't lock the count, but Phase 33A "cut to 3" → Phase 33J "back to 4 (Voice → drawer)" → Phase 34Z.2 "5 with New in the middle" within 2 days. With 360-px phones each slot is ~72 px wide — labels still fit but the "New" Plus chip looks visually identical to a FAB and is competing with the morning-plan-card mic button for "primary action". | P1 | Pick 4 OR commit to a centered FAB-with-cutout pattern (the Instagram/WhatsApp visual ref the owner cited). Don't have both a 5-tab bar AND a Plus-shaped 5th tab. |
| P1-4 | `src/pages/v2/WorkV2.jsx:743-758` + `src/components/v2/V2AppShell.jsx:482-498` | The shell mounts `ProposedIncentiveCard` (purple, full-mode on /work / /my-performance, compact elsewhere). `IncentiveMiniPill` ALSO mounts in the topbar. On /work the rep now sees: topbar pill (₹X this month, % to target) **plus** the full purple Forecast/Pending/Earned card immediately below — two incentive surfaces in 250 px of vertical space. Owner asked for the full card in Phase 34Z.3, but the pill wasn't removed for /work specifically. | P1 | Hide `IncentiveMiniPill` when `location.pathname === '/work'` since the full card already covers the same data. |
| P1-5 | `src/pages/v2/WorkV2.jsx:1359-1366` | "Speak Evening Summary" button navigates to `/voice/evening` — a separate page. Owner directive in Phase 33N said voice is no longer a standalone surface; voice belongs inside the activity log modal where reps already are. The CTA is also styled as `m-cta-primary` (brand yellow) — same level of visual prominence as the Log Meeting CTA above it. Two primary CTAs on one screen is a CLAUDE.md §6 violation (only one primary action per view). | P1 | Inline the evening summary inside the same screen (collapsing card or sheet) rather than route-out. |
| P1-6 | `src/components/leads/MeetingsMapPanel.jsx:144-148` | The map tile URL uses `https://tile.openstreetmap.org` — OSM's operational policy is "for development, not production". Vadodara reps loading this at scale could get rate-limited at OSM's CDN, especially when the panel is opened on every /work session. | P1 | Either switch to a paid provider (Mapbox / Stadia) or proxy through Supabase Edge Function with caching. Sprint-level decision. |
| P1-7 | `src/components/v2/V2AppShell.jsx:226-227` | `isAgency` falls through to `SALES_NAV` for desktop, but the mobile branch (line 235) returns `AGENCY_NAV` (only 3 items) where MobileNav expects MOBILE_NAV_* with the same shape. Agency users on mobile get a 3-tab bottom nav, sales users get 5 — the spec says agency = "Quotes + Earnings + Offer only" which is consistent, but the mobile nav uses the **desktop** AGENCY_NAV array. If anyone adds a 4th desktop item the mobile bar inherits it. | P1 | Define an explicit `MOBILE_NAV_AGENCY` constant. Don't reuse the desktop nav as mobile nav. |
| P1-8 | `src/pages/v2/WorkV2.jsx:380-421` (GPS polling effect) | 5-min `setInterval` for GPS pings runs in foreground only. Cleanup is correct (`clearInterval`), but the effect re-runs whenever `session.evening_report_submitted_at` changes — fine in theory, but between check-in and evening submit, every `load()` call (after `toggleMeetingDone`, `submitPlan`, `toggleTaskDone`) re-creates the interval. That's an interval restart 5-10 times per shift. Net effect is correct but adds churn. | P1 | Stabilise the deps: track `isCheckedIn = !!session?.check_in_at` and `isDayDone = !!session?.evening_report_submitted_at` as memoised booleans. |
| P1-9 | `src/pages/v2/WorkV2.jsx:1339`, `1187`, `1212` | Mixed primary-button language: "Mark done" / "Done" / "✓ Done". Same action, three labels within 200 lines. | P1 | Pick one — "Done" matches the rest of the v2 design. |
| P1-10 | `src/pages/QuoteDetail.jsx:23, 714` | `IncentiveForecastCard` on /quotes/:id + shell `IncentiveMiniPill` on the topbar = two incentive surfaces. Phase 34S explicitly hides the third one (ProposedIncentiveCard strip), but still leaves two. The pill should hide on /quotes/:id for the same reason as P1-4. | P1 | Extend the `IncentiveMiniPill` gate in V2AppShell to also hide on `/quotes/:id`. |

---

## 4 · P2 — polish (works, looks off)

| id | file:line | what's off | fix sketch |
|----|-----------|------------|------------|
| P2-1 | `src/pages/v2/WorkV2.jsx:739-742` | Error banner is inline (yellow box with `⚠`) instead of toast. CLAUDE.md §26 ships `toastError` as the standard. WorkV2 was written before that helper existed and hasn't been migrated. | Replace inline `setError` reads with `toastError()` calls. ~12 sites. |
| P2-2 | `src/pages/v2/WorkV2.jsx:842-844` | The big record button uses literal "🎤" emoji + "■" character (square Unicode) for stop. CLAUDE.md §7. | Lucide `<Mic />` / `<Square />`. |
| P2-3 | `src/pages/v2/WorkV2.jsx:1339` | `<Pill tone="success">✓ done</Pill>` — checkmark hardcoded as glyph, not Lucide. | `<Pill tone="success"><CheckCircle2 size={12} /> done</Pill>`. |
| P2-4 | `src/pages/v2/FollowUpsV2.jsx:300-313` + `333-339` | Two empty-state blocks in the same component for the same "0 follow-ups" condition. Owner asked for one in Phase 33D; the second was added without removing the first. | Pick one. The first one ("All caught up. Time to find a new lead.") is the better copy. |
| P2-5 | `src/components/leads/MeetingsMapPanel.jsx:161-166` | Double `invalidateSize()` (one in `requestAnimationFrame`, one in 80-ms `setTimeout`) is a brittle workaround for a height-0 mount. The proper fix is to not mount the map until `open === true` (currently it mounts but renders into a collapsed div). | Conditional render `{open && <div ref={mapElRef} />}`. |
| P2-6 | `src/components/leads/LogMeetingModal.jsx` (full file, 586 lines) | Modal mixes form fields, dedup logic, OCR scan, photo capture, WhatsApp prompt, and post-save navigation. ~7 concerns. Tap targets vary 32-44 px. Save button can be covered by iOS keyboard when the bottom field is focused (no `position: sticky` on the footer). | Split into MeetingForm + sticky footer container, and use `dvh` units so the save button stays above the keyboard. |
| P2-7 | `src/components/v2/V2AppShell.jsx:380-386` | `Ask AI…` button on the topbar still renders on mobile because only `.v2d-search` (the literal search input) is hidden by the 860-px media query. The Ask-AI button has its own class and stays visible — eating ~140 px of topbar width that mobile doesn't have to spare. | Hide on mobile or fold into the hamburger drawer. |
| P2-8 | `src/components/incentives/ProposedIncentiveCard.jsx` (9 Phase comments) | Tab variant has been switched between `F/P/E` single letter, full-word, dropdown, and back to full-word over 4 phases. Each switch left CSS / state for the previous variant. | One-time pass: delete the unused `compact={true}` path in the dropdown chip variant (Phase 33G.6 rollback) and the F/P/E mini-tab path. |

---

## 5 · Patch-chain debt — worst offenders

The Phase 34 sub-letter chain ran from `34a` → `34Z.3` (35 distinct sub-letters; not all hit the same file). The files where ≥3 sub-letters stack inside the **same JSX block**:

| file | block | sub-letters in this block | what they keep re-deciding |
|------|-------|---------------------------|-----------------------------|
| `src/pages/v2/WorkV2.jsx` | A_PLAN morning-plan card (`return (...stateName === 'A_PLAN'`, lines 760-1007) | 34Z.1, 34Z.2, 34Z.3, 34O | Card header design, voice CTA placement, plan compulsory vs optional, time input width |
| `src/pages/v2/WorkV2.jsx` | B_ACTIVE incentive block (lines 684-699 + 1043-1099) | 34R, 34S, 34Z.1, 34Z.2, 34Z.3 | Which incentive widget, where it sits, how many counters render, whether RingMilestoneRow is needed |
| `src/pages/v2/WorkV2.jsx` | `TodayTasksBreakdown` empty state (lines 1562-1573) | 34Z.2 + the three "All caught up" blocks it references | How many empty-state messages to render. Net result: kills the panel entirely on zero-row |
| `src/components/v2/V2AppShell.jsx` | `MOBILE_NAV_SALES` (lines 145-176) | 31K, 33A, 33J, 34Z.2 | 3 vs 4 vs 5 items; what to put in the middle |
| `src/components/v2/V2AppShell.jsx` | topbar render (lines 318-428) | 33G.4, 33G (A1/A2/A4), 34M, 34Z | Hamburger visible? Greeting in body or topbar? New Quote CTA shown? IncentiveMiniPill placement? |
| `src/components/v2/V2AppShell.jsx` | shell ProposedIncentiveCard mount (lines 461-498) | 31O, 33G (C1), 34S, 34Z.3 | Full card vs compact; which route excluded; gating logic |
| `src/components/incentives/ProposedIncentiveCard.jsx` | render function (lines 247-340) | 33A, 33G.6, 33I (B2), 33N | Compact mode shape (mini-tabs vs dropdown vs full card vs strip) |
| `src/components/leads/MeetingsMapPanel.jsx` | tile init effect (lines 125-195) | 34Z.1, 34Z.2 | invalidateSize timing + OSM tile host |
| `src/pages/v2/LeadDetailV2.jsx` | Phase 34-tagged surfaces | 34.9, 34B, 34R+, 34L, 34S | Discoverability tip + auto-Lost banner + stage-age chip + tint tokens + history strip swap |

**Density verdict:** `WorkV2.jsx` is the patch-chain epicenter — 25 Phase-34 markers in 1,799 lines = one every 72 lines, and most concentrated in two blocks. The shell adds 8 more across 620 lines. Together they hold ~70% of the entire sub-letter chain.

Stacks where comments contradict each other in adjacent JSX:

- WorkV2 lines 33-48: import kept "for next refactor" with eslint-disable. Two such imports.
- WorkV2 lines 684-691: the comment explains a widget that was REMOVED. It's a 7-line tombstone.
- WorkV2 lines 744-748: the comment explains a widget that MOVED (also no longer rendered here).
- WorkV2 lines 1064-1070: explicit "Phase 34S confirmed Phase 34R was over-built" reverting the previous patch.
- V2AppShell lines 319-327: "Phase 33G.4 — hamburger restored…" explaining that Phase 33F (A5) hid it then this phase brought it back.
- ProposedIncentiveCard lines 322-324: "Phase 33N reverted the Phase 33G.6 dropdown".

These are the comment fingerprints of patch-chain rot.

---

## 6 · Module redesign recommendation

**Rebuild `/work` + the mobile chrome of `V2AppShell` as ONE coherent module — call it "Sales Mobile v2.1".** Owner-approved spec first, code second, no more sub-letter commits inside the same JSX block.

The one coherent change: design `/work` as **three persistent surfaces with no state machine**, dropping A_PLAN / A_CHECKIN / B_ACTIVE / C_CHECKOUT / D_DONE as separate screens. Reps see the **same** layout all day; what changes is which surface is "live" vs collapsed:

1. **Top surface (always visible):** one big "Day status" card. Pre-9:30 = "Plan + Start". 9:30–6 pm = the V2Hero progress block. After evening submit = day summary. State expressed by what's *inside* the card, not by which card renders.
2. **Middle surface (always visible):** "What's next" — the highest-priority undone meeting/follow-up/task. One card, one button. The current focus-mode + Next-up + TodayTasksBreakdown + UpcomingTasksCard are merged into this single component.
3. **Bottom surface (always visible):** a fixed-position "Log meeting" CTA + a secondary "Open leads" link. Replaces the current 3-CTA stack + the floating toast.

Drop the bottom-nav "New" tab (revert Phase 34Z.2). The Log Meeting CTA covers cold walk-in creation already. Keep 4 tabs: Today / Follow-ups / Leads / Quotes.

Drop `IncentiveMiniPill` from the topbar on mobile. The full purple card on /work + /my-performance is the canonical surface; the pill duplicates it and eats topbar real estate the hamburger + greeting already fight over.

Move the global toast viewport bottom-offset out of CSS `!important` (V2AppShell line 1067+) and into a real layout primitive — the toast covers the new fixed-position "Log meeting" CTA otherwise.

**This single rebuild replaces ~10 patch commits** that would otherwise land as 34Z.4 (greeting consolidation), 34Z.5 (incentive deduplication), 34Z.6 (empty-state cleanup), 34Z.7 (CTA hierarchy), 34Z.8 (focus mode resurrection), 34Z.9 (bottom nav debate), 35a (toast positioning), 35b (modal viewport-height fix), 35c (FAB vs tab decision), 35d (evening voice routing). Owner approves once; the rebuild ships once; the patch chain ends.

Acceptance gate for the rebuild: zero `Phase N` comments inside JSX bodies on the rebuilt files. Comments live above the function, not interleaved with the markup. If a future patch needs to explain itself inside the JSX, that's the signal the rebuild has already started rotting.
