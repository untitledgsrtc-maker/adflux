# Deep audit — 2026-05-26

Read-only audit, zero code changed. Validates the cross-Claude audit
report owner shared this session + adds findings the other Claude
missed.

## Other Claude's findings — graded

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | `#0a0e1a` hardcoded in `AdminDashboardDesktop.jsx:1934` | TRUE | Confirmed via grep, line 1934 `color: on ? '#0a0e1a' : 'var(--v2-ink-2)'` |
| 2 | `supabase_phase93_8_notification_cleanup.sql` FAILS strict schema linter for `r.lead_company / r.lead_name` aliases | FALSE POSITIVE | Aliases ARE declared at line 92 `l.name AS lead_name, l.company AS lead_company`. Linter doesn't trace CTE aliasing. Run-time SQL is valid. |
| 3 | "20 files contain `console.*` statements (mostly warnings on frozen surfaces)" | OVER-FLAGGED | On §28 frozen files there are 9 `console.*` calls across 4 files. All are `console.warn` / `console.info` inside catch blocks logging failure reasons. Zero `console.log` debug noise. Not an issue. |
| 4 | "Brand violations" | OVER-FLAGGED | Grep for `#facc15` returned 3 hits — all 3 are CLAUDE.md-aware comments (`// NOT #facc15`, `// was off-brand #facc15`). Zero real violations of brand yellow. |
| 5 | "17 TODO/FIXME/XXX/HACK markers" | OVER-FLAGGED | grep caught false positives like `placeholder="98XXXXXXXX"` (phone format hints). Real TODOs ≈ 0. |
| 6 | "MCP code-review-graph is unavailable → cannot do deep audit" | EXCUSE | grep + Read across 205 src files runs in <30 sec. MCP would be faster but isn't required for read-only review. |
| 7 | "No test/lint/type infrastructure" | TRUE | package.json has dev/build/preview only. Owner-known gap. Not new. |
| 8 | "54 uncommitted items in git status" | TRUE BUT NORMAL | 50+ are deleted `_design_reference/` HTMLs (intentional cleanup), Android splash res, and today's in-flight 93.19 / 93.20 / 93.19.1 work. Normal mid-session state. |

## Real findings the other Claude missed

### F1 — Dead CSS class after Phase 93.20

| | |
|---|---|
| Severity | P3 |
| File | `src/styles/leads.css:1331-1383` |
| What | `.lead-mobile-sticky-bar` + `.lead-mobile-sticky-btn` + media query block (53 lines total). No JSX consumer since Phase 93.20 deleted the sticky bar from LeadDetailV2. |
| Risk | Bundle includes 53 dead lines of CSS. No runtime cost; no correctness risk. |

**BEFORE:** 53 lines of dead `.lead-mobile-sticky-bar` rules in `leads.css`.

**AFTER:** Block deleted, CSS file shrinks.

**FIX COMMENT (when applied):**
```
Phase 93.20.1 — remove dead .lead-mobile-sticky-bar CSS. Phase 93.20
deleted the JSX consumer in LeadDetailV2.jsx; CSS was orphaned.
```

### F2 — Stale rollback config filename

| | |
|---|---|
| Severity | P3 |
| File | `capacitor.config.live-update.json` |
| What | Filename says "live-update" but the file IS the live-update config which has been ACTIVE since Phase 94a (24 May 2026). The "rollback" framing is from the Phase 88.2 era when bundled was canonical. Today's reader expects this file to swap mode — it would swap to the same mode. |
| Risk | Future-Claude confusion. Today I confused myself for 4 messages. |

**BEFORE:** `capacitor.config.live-update.json` (misleading filename, redundant copy of current canonical config).

**AFTER:** Delete the file. `capacitor.config.bundled.json` already serves as the bundled-mode rollback config. CLAUDE.md §38 documents the active mode.

**FIX COMMENT (when applied):**
```
Phase 94a.1 — delete stale capacitor.config.live-update.json. Phase
94a made live-update canonical; this file became a redundant copy of
capacitor.config.json. capacitor.config.bundled.json remains as the
sole rollback config.
```

### F3 — `#0a0e1a` hardcoded on yellow chip

| | |
|---|---|
| Severity | P2 |
| File | `src/pages/v2/AdminDashboardDesktop.jsx:1934` |
| What | Period-picker chip text color when active: `color: on ? '#0a0e1a' : 'var(--v2-ink-2)'`. The on-color hex matches the legacy `--accent-fg` value (#0F172A approx), but CLAUDE.md §5 requires `var(--accent-fg)` token reference, not hex. |
| Visual impact | Zero — `#0a0e1a` ≈ `#0F172A`. Hex is darker by 5 RGB points. |
| Why it matters | Token traceability. When `--accent-fg` ever shifts, this chip drifts off-brand silently. |

**BEFORE:**
```jsx
color: on ? '#0a0e1a' : 'var(--v2-ink-2)',
```

**AFTER:**
```jsx
color: on ? 'var(--accent-fg, #0F172A)' : 'var(--v2-ink-2)',
```

**FIX COMMENT (when applied):**
```
Phase 93.x — swap hardcoded #0a0e1a for var(--accent-fg). Chip
inherits brand foreground from tokens.css instead of a stale
legacy hex.
```

### F4 — CLAUDE.md §37 / §38 drift risk

| | |
|---|---|
| Severity | RESOLVED today (commit `9e24d2a`) |
| What | §37 (Phase 88.2, 23 May) documented bundled mode as active. Phase 94a (24 May) reverted to live-update but didn't append §38. Today I followed §37 and incorrectly told owner 4 times that APK was bundled + needed redistribute. |
| Fix already in place | §38 added 26 May with explicit foot-gun: "Don't quote §37 / Phase 88.2 status as 'current mode = bundled'." |

No further action. Documented as a lesson.

### F5 — Uncommitted SQL files

| | |
|---|---|
| Severity | UNKNOWN (depends on which owner has applied) |
| Files | `supabase_phase93_2c_call_log_integrity.sql` (25 May) `supabase_phase93_6_meeting_count_fix.sql` (25 May) `supabase_phase93_7_unique_meeting_kpi.sql` (25 May) `supabase_phase93_7_1_counter_dedup.sql` (26 May — owner ran today) `supabase_phase93_8_notification_cleanup.sql` (25 May) |
| Risk | Sandbox can't apply SQL. Each needs owner paste in Supabase Studio. If any 93_x file is unapplied, the corresponding feature is half-shipped. |

**FIX COMMENT (when applied):**
Owner verifies in Supabase Studio:
```sql
-- Per-file: rerun the -- VERIFY block at the bottom. Idempotent
-- per CLAUDE.md §8; safe to re-paste.
```

If any verify block returns unexpected counts, the file wasn't applied yet.

## What's NOT broken (positive findings)

- ✅ `#FFE600` brand yellow used everywhere it should be. Zero `#facc15` raw uses.
- ✅ `.env`, `tokens.css`, `v2.css` all token-clean.
- ✅ Phase 93.19 + 93.19.1 + 93.20 commits compile clean (esbuild parse PASS on all 8 touched files).
- ✅ sales-module-guardian PASS on both 93.19 + 93.20 audits.
- ✅ `useAutoRefresh` mounts intact on all 6 frozen pages.
- ✅ Push enrollment is V2AppShell-only.
- ✅ PostCallOutcomeModal tel:→1.5s→modal contract preserved.
- ✅ All §28 frozen DB triggers in place per most recent audit.
- ✅ Lead stage / cadence_type / activity_type enums match the frozen set.
- ✅ No `owner` role anywhere.
- ✅ No raw `confirm()` / `alert()` on rep-facing pages (all use `confirmDialog` / `toastError`).

## Verification methodology

Tools used (all read-only):
- `grep -rn` for pattern sweeps (brand, console, TODO, identifiers)
- `Read` for line-context verification
- `git status --short` for uncommitted scope
- `ls -la supabase_phase*.sql` for SQL inventory

No `Write`, no `Edit`, no `git add`, no `git commit` triggered by this audit.

## Recommended fix order (when owner authorises code changes)

| Order | Item | Effort | Risk |
|---|---|---|---|
| 1 | F3 — swap `#0a0e1a` → `var(--accent-fg)` in AdminDashboardDesktop:1934 | 1 line | None (admin file, not frozen) |
| 2 | F1 — delete dead `.lead-mobile-sticky-bar` CSS block in leads.css | 53 lines | None (no consumers) |
| 3 | F2 — delete stale `capacitor.config.live-update.json` | 1 file | None (redundant config) |
| 4 | F5 — owner manually verifies each unapplied SQL file via -- VERIFY blocks | Per-file | None (idempotent) |

All four are non-frozen, no guardian audit required, single-commit batch viable.

## Anti-patterns flagged for future-Claude

1. Don't blame missing MCP for a read-only audit task. grep + Read are sufficient at this codebase size (~205 files).
2. Don't grep `#facc15` raw — sample the matches first; most will be CLAUDE.md-aware comments.
3. Don't flag `console.warn` / `console.info` in catch blocks as "dead code". Owner-spec error logging.
4. Don't flag SQL CTE aliases as "unknown" — read the file before declaring fail.
5. Don't compute "TODO count" via raw grep — placeholder strings (`98XXXXXXXX`, `e.g. XXX`) inflate the number.
6. When CLAUDE.md says "Phase X mode active" but config file says newer phase, the FILE wins (per §0 reading order rule).
