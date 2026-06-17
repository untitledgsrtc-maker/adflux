# Duplication Audit — "the same thing defined in many places"
**Date:** 17 Jun 2026
**Why:** Owner-reported pattern — "we solve it, then it breaks again, every time something new."
Root cause is NOT the agents. It is that the same rule is written in many files, so a
later rewrite silently drops an earlier fix. This doc is the COMPLETE inventory + the
permanent cure + the safe cleanup order. Built from a full scan of 253 SQL files +
the `src/` frontend.

---

## The disease (one paragraph)

A business rule (the score, the km, "what counts as a call", "what is today") is
copy-pasted or re-declared across many files. When we fix it in one place, the other
copies still disagree. Worse, every Postgres function is `CREATE OR REPLACE`d in many
phase files — re-running an OLDER file overwrites the NEWER fix. Proven twice this
month: the QR bug (file `c8.1` dropped the `location_id` that `c8` added) and the
meeting counter (re-running an old file strips the scheduled-meeting skip). Fix one,
break another — because the truth lives in N places, not one.

---

## CATEGORY A — Postgres functions defined across ≥2 SQL files (the dangerous one)

**73 functions** are `CREATE OR REPLACE`d in 2+ files. Each rewrite must manually
re-include every earlier fix; miss one and something that worked breaks days later.
Ranked by blast radius.

### Tier 1 — MONEY (score / salary / TA / incentive) — extreme care
| Function | Files | Controls |
|---|---|---|
| `compute_daily_score` | **10** | rep daily score → incentive |
| `compute_monthly_salary` | **9** | monthly salary |
| `compute_daily_ta` | **7** | km → TA payout |
| `auto_create_incentive_profile` | 4 | incentive setup |
| `submit_offer_acceptance` | 3 | offer/CTC accept |
| `monthly_score` | 3 | month score rollup |
| `rebuild_monthly_sales` | 3 | sales rollup → incentive |
| `_compute_monthly_salary_base` | 2 | salary base |
| `score_history` / `shadow_score_compare` | 2 / 2 | score audit |
| `backfill_performance` / `backfill_ta` | 2 / 2 | backfills |
| `eligible_for_paid_leave` / `approve_leave` | 2 / 2 | leave → pay |
| `handle_final_payment` / `handle_payment_insert/update/delete` | 2–3 each | payments |

### Tier 2 — LEAD / SALES / CALL flow
| Function | Files | Controls |
|---|---|---|
| `generate_lead_tasks` | **8** | rep smart tasks |
| `lead_activity_after_insert` | 5 | activity side-effects |
| `lead_activity_bump_counter` | 5 | meeting/activity counters |
| `campaign_conversation_ensure_lead` | 5 | QR / WhatsApp lead intake |
| `call_logs_dedupe_before_insert` | 4 | call de-dup |
| `generate_quote_number` | 4 | quote ref numbers |
| `auto_create_followup` | 3 | follow-up spawn |
| `bump_meeting_counter` / `bump_daily_counter` | 3 / 3 | counters |
| `call_log_bump_counter` | 2 | call counter |
| `recompute_daily_meetings` | 2 | meeting recount |
| `lead_*` (assign, heat, cadence, handoff, close-followups, …) | 2 each (~12 fns) | lead lifecycle |
| `quote_before_insert_ensure_lead` / `quote_after_delete_rollback_lead` | 2 / 2 | quote↔lead link |

### Tier 3 — infra / push / helpers (lower business risk, still collision-prone)
`enqueue_push` (3), `push_followup_due_reminders` (3), `tg_push_on_*` (2 each ×5),
`get_my_role` (3), `run_select` (3), `next_workday` (2), `record_checkin` (2),
`auto_close_open_sessions` (2), `update_updated_at` (2), `is_sales_manager` (2),
`admin_create_user` (2), `accept_user_profile`/`unaccept_user_profile` (2),
`get_team_leaderboard` (2), `tc_weekly_stats` (2), `consecutive_missed_days` (2),
`my_chase_counts` (2), `todays_suggested_tasks` (2), and ~10 more at 2.

> Note: some Tier-3 helpers (`update_updated_at`, `get_my_role`) are tiny + stable —
> re-declaring them is low-harm. The danger scales with how much LOGIC the function
> holds. Tier 1 + Tier 2 are the real targets.

---

## CATEGORY B — Frontend business rules copy-pasted (no single source)

| Rule | Files | What goes wrong |
|---|---|---|
| **"today" via `new Date().toISOString().slice(0,10)`** (UTC, not IST) | **43** | Before 05:30 IST it returns *yesterday*. Latent wrong-day bug everywhere. A shared `istDate.js` ALREADY exists — these 43 don't use it. |
| **phone-clean `/\D/g`** idiom inline | **19** | Number matching drifts (the Vimal-Oil ...121 vs ...122 class). Should be one `cleanPhone()`. |
| **lead-stage strings inlined** (`'QuoteSent'` etc.) | **16** | Rename a stage → 16 silent breakers. Should be one `STAGES` constant. |
| **"≥10s = a connected call"** threshold | **8** | Call stats disagree page-to-page ("her app shows X, admin shows Y"). Should be one `isConnectedCall()`. |
| **IST helper re-declared locally** instead of importing `istDate.js` | 2 rogue | `PostCallOutcomeModal.jsx`, `ManagerDashboardV2.jsx` carry their own copy → drift from canonical. |

**Already healthy (1 source, just importers — leave alone):**
- `src/utils/gpsDistance.js` — km + track. 9 readers, ONE definition. (Phase 169 split
  the km-vs-line jobs via opts. Good.)
- `src/utils/istDate.js` — exists and correct. Problem is the 43 files that don't use it.

---

## CATEGORY C — one function serving two conflicting jobs (the km/map trap)

`cleanTrack()` feeds BOTH the paid km number AND the map line. Tightening it for km
once broke the map. Phase 169 fixed THIS instance (opts split strict/loose). The RULE
to keep: a function that feeds money AND display must take the mode as a parameter —
never silently serve both with one threshold.

---

## CATEGORY D — dead / orphan files (nothing imports them)

Full `src/` scan (229 js/jsx files). 5 are imported by NOTHING — only stale comments
mention them. Deleting them cannot change behaviour (zero importers).

| File | Lines | Why dead |
|---|---|---|
| `src/components/leads/MeetingsMapPanel.jsx` | 702 | Replaced by `RepMapPanel` (Phase 89.11). WorkV2:42: "kept on disk for one cycle in case rollback" — cycle long past. **In §28 frozen list — stale; delete = also remove from §28.** |
| `src/components/v2/DidYouKnow.jsx` | 160 | Zero references |
| `src/components/dashboard/RejectionBanner.jsx` | 111 | Only a comment in PendingApprovalsBanner (itself dead) mentions it |
| `src/components/dashboard/PendingApprovalsBanner.jsx` | 106 | Zero references |
| `src/components/dashboard/RenewalReminderBanner.jsx` | 96 | Only a comment in useDaySummary mentions it |

**Total: 1,175 lines dead.** Zero-risk delete (one commit, guardian PASS expected).

**Also confirmed during the scan (housekeeping):**
- `Untitled Proposals/` folder — already gone. CLAUDE.md §23.5 + §22 Sprint 5 reference
  it as still-present; those notes are stale.
- No rogue `.old/.bak/.orig` files in `src` (only Android build artifacts + one
  intentional `_drop_old_bump_overload.sql` migration).
- No V1/V2 page duplicates — every `*V2.jsx` has no shadowing `*.jsx`. Clean.

## CATEGORY E — unused npm packages (confirmed zero imports, whole repo)

**17 packages — the entire shadcn-ui + react-hook-form + zod stack — imported NOWHERE:**
```
react-hook-form          @hookform/resolvers      zod
clsx                     tailwind-merge           class-variance-authority
@radix-ui/react-avatar   @radix-ui/react-dialog   @radix-ui/react-dropdown-menu
@radix-ui/react-label    @radix-ui/react-popover  @radix-ui/react-select
@radix-ui/react-separator @radix-ui/react-slot    @radix-ui/react-switch
@radix-ui/react-tabs     @radix-ui/react-toast    @radix-ui/react-tooltip
```
The app hand-rolls its forms + modals now; this stack was abandoned. **CLAUDE.md §21
still lists "React Hook Form + Zod" — stale, the app uses neither.** Heavy node_modules
weight. Removable, BUT: needs `npm install` + a clean build to confirm before push
(can't be a blind delete like the orphan files).

**Verified KEEP (false positives in the first pass):** all `@capacitor/*` +
`@capacitor-community/background-geolocation` (scoped imports the first grep missed),
`qrcode.react` (2 files), `pdf-lib` (1 file).

## CATEGORY F — dead exports inside live files (tiny)

Symbols exported + referenced nowhere, NOT used inside their own file either:
| Symbol | File |
|---|---|
| `HEAT_OPTIONS`, `groupForStage` | `src/hooks/useLeads.js` |
| `DURATION_OPTIONS`, `REVENUE_TYPES` | `src/utils/constants.js` |
| (candidates, verify each) `fetchPendingCount`, `getBackgroundGpsStatus`, `isFutureMonth`, `shiftMonth`, `downloadAsArrayBuffer`, `teardownNativeTracking` | various utils/hooks |

Small. The `gpsDistance.js` constants (`MIN_SEG_KM` etc.) flagged earlier are USED
internally — just over-exported, NOT dead. Leave them.

> Still NOT scanned: superseded SQL migrations (all are "history" — not safely
> deletable). Skipping unless you ask.

---

## THE PERMANENT CURE (not a patch)

### For Category A — one canonical file per function
1. Create `db/functions/<name>.sql` — the single current body of each hot function.
   New changes edit THAT file only.
2. Old `supabase_phaseN_*.sql` stay as history but are NEVER re-run.
3. Add `scripts/check-fn-single-source.sh` to pre-commit: FAIL if any function is
   `CREATE OR REPLACE`d outside its one canonical file. This makes the disease
   impossible to reintroduce.
4. A `db/functions/README.md` registry: function → canonical file → what it controls →
   what it must always include (the "don't drop this" list, e.g. meeting exclusions).

### For Category B — extract to the util pattern already in use
- `istDate.js` (exists) → migrate all 43 raw-UTC + 2 rogue copies to import it.
- `callRules.js` (new) → `isConnectedCall(sec)` → 8 files import.
- `phone.js` (new) → `cleanPhone(str)` → 19 files import.
- `leadStages.js` (new) → `STAGES` + helpers → 16 files import.

Each extraction is **behaviour-preserving** (replace identical inline logic with one
shared call) → testable → low risk.

---

## SAFE CLEANUP ORDER (live-app, staged, each independently shippable + guardian-gated)

**Stage 0 — safety net + dead-file delete (no behaviour change).** This audit doc +
the `check-fn-single-source.sh` script + delete the 5 orphan files (Category D, 1,175
lines, nothing imports them). Stops NEW duplication AND removes dead weight. Zero risk.
Ship first.

**Stage 1 — frontend helpers (behaviour-preserving, mechanical).**
phone.js → callRules.js → leadStages.js → istDate consolidation. One small commit each,
esbuild + guardian per commit. Cannot change pay or DB. Lowest risk.

**Stage 2 — DB canonicalization (one file per function).** Start Tier 3/Tier 2
(non-pay) to prove the pattern. Tier 1 (score/salary/TA) LAST, each with a shadow
compare (new vs old result on real rows) before it goes live. Highest care.

**Stage 3 — Option 2 map (road-snapped real GPS route).** Built ON the now-single
km/route source. Reuses `/api/snap-to-roads` (already exists, already secured). Not a
new silo — part of the km consolidation.

---

## Recurrence rule (add to CLAUDE.md once Stage 0 ships)
- A Postgres function has exactly ONE canonical file. Never `CREATE OR REPLACE` it
  elsewhere. Pre-commit enforces this.
- A business rule (date, phone, call threshold, stage list) has exactly ONE util.
  No inline copies.
- A function feeding both money and display takes the mode as a parameter.
