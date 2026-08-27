# Ops Tier-1 (trust) — F1 counts + F3 vocab + F2 station cleanup — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Steps use `- [ ]`.

**Goal:** Make the ops app's numbers trustworthy — reconcile + label the counts (F1), one Gujarati word for a fault everywhere (F3), and dedupe/de-test the station registry (F2, diagnostic-first + a sync fix so dups don't reappear).

**From the owner's diagnostic (27 Aug 2026).** Owner picked Tier 1. One sprint (§3). Ops files NOT §28-frozen except V2AppShell (nav — untouched here). Commit only named files; self-push + verify each (§211). Owner runs SQL in Studio.

**The fault model (the single definition F1 rests on):** a FAULT = an offline screen (CMS ground truth). "Screens down" = offline `ops_screens`. "Stations affected" = distinct depots with ≥1 offline screen. Tickets (manual + auto) are the WORK on top of faults. Every count labels its unit explicitly so no two numbers read as contradicting.

---

### Task 1: F2 — sync canonicalization + test-skip (stop new dups)

**Files:** Modify `api/ops/sync.js`

The CMS has multiple groups (different `group_id`) for one physical station; `norm()` collapses case + `gsrtc/bus stand/depot/station` but not `gidc`/`bus stop`, and test groups create a "Test Untitled" depot. Strengthen norm + skip test.

- [ ] **Step 1: widen `norm()`** — the strip regex (currently `/gsrtc|bus\s*stand|depot|station/g`) gains `gidc` + `bus\s*stop` + `stand`:
```js
const norm = (s) => String(s || '').toLowerCase()
  .replace(/gsrtc|gidc|bus\s*stand|bus\s*stop|stand|depot|station/g, '').replace(/[^a-z0-9]/g, '')
```
So "Ankleshwar Gidc" and "ANKLESHWAR GSRTC" both → `ankleshwar` (collapse). (Typo dups like Dwrka/Dwarka still won't collapse — those are Task 2's merge / a CMS fix.)

- [ ] **Step 2: skip test groups** — in the group loop (where a depot is created for a `gid`), skip when the name is a test row. Find the block that builds `groups`/creates a depot and add, before create:
```js
      if (/\btest\b/i.test(g.name || '')) continue   // never make a depot for a test group
```
(Place it at the top of the per-group `for` body so a test group is neither matched nor created.)

- [ ] **Step 3: verify** — `node --check api/ops/sync.js` → no error. (Edge fn; can't run locally — the norm change is pure string, the skip is a guard.)

- [ ] **Step 4: commit + push.**
```bash
git add api/ops/sync.js
git commit -m "Ops sync: canonicalize depot names (gidc/bus-stop) + skip test groups (F2)"
git push origin untitled-os
git log origin/untitled-os..HEAD --oneline
```

---

### Task 2: F2 — station cleanup SQL (diagnostic-first)

**Files:** Create `supabase_ops_p4_station_cleanup.sql`

- [ ] **Step 1: write the file** — PART 1 a live diagnostic (owner runs, pastes back); PART 2 the safe cleanup (deactivate test) + a commented merge helper the owner/I fill from PART 1.

```sql
-- supabase_ops_p4_station_cleanup.sql
-- F2 — dedupe + de-test the station registry (owner diagnostic 27 Aug 2026).
-- Non-destructive: deactivate (is_active=false), never DELETE (keeps old-ticket FKs).
-- Run PART 1 first, paste the result, then run PART 2 (test rows) + the filled merges.

-- ==== PART 1 · DIAGNOSTIC (run + paste) =====================================
-- Depots with screen counts + a normalized key; rows sharing norm_key are dups.
SELECT d.id, d.name, d.external_group_id, d.is_active,
       (SELECT count(*) FROM public.ops_screens s WHERE s.depot_id = d.id AND s.is_active) AS screens,
       regexp_replace(lower(d.name), 'gsrtc|gidc|bus ?stand|bus ?stop|stand|depot|station|[^a-z0-9]', '', 'g') AS norm_key
  FROM public.ops_depots d
 ORDER BY norm_key, screens DESC;

-- ==== PART 2 · TEST ROWS (safe to run now) ==================================
-- Deactivate any test depot + its screens (never delete).
UPDATE public.ops_screens SET is_active = false, updated_at = now()
 WHERE depot_id IN (SELECT id FROM public.ops_depots WHERE name ILIKE '%test%');
UPDATE public.ops_depots SET is_active = false, updated_at = now()
 WHERE name ILIKE '%test%';

-- ==== PART 2b · MERGE A DUP (fill A/B from PART 1, then run) =================
-- Move screens from the DUP depot (A) to the CANONICAL (B), then deactivate A.
-- Repeat per dup pair. Example (REPLACE the uuids):
-- UPDATE public.ops_screens SET depot_id = '<B canonical>', updated_at = now() WHERE depot_id = '<A dup>';
-- UPDATE public.ops_tickets  SET depot_id = '<B canonical>', updated_at = now() WHERE depot_id = '<A dup>';
-- UPDATE public.ops_depots   SET is_active = false, updated_at = now() WHERE id = '<A dup>';

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: lint** — `bash scripts/check-sql-schema.sh supabase_ops_p4_station_cleanup.sql` (a NOTIFY + no CREATE — the "no IF NOT EXISTS" warnings are N/A for UPDATE-only; acceptable).

- [ ] **Step 3: commit + push** (same as Task 1 pattern). Owner runs PART 1 → pastes → I write the exact PART 2b merges.

---

### Task 3: F3 — one word (ખરાબી) for a fault everywhere

**Files:** Modify `src/utils/opsStrings.js`, `src/pages/v2/OpsTicketsV2.jsx`

The entity is called ટિકિટ / કામ / ખરાબી in different places. Standardize on **ખરાબી** (fault) — what the field tech sees on the ground. Statuses (Open/In process/Fixed) stay; only the ENTITY word unifies.

- [ ] **Step 1: opsStrings** — change the ENTITY-word values (keep the keys so nothing breaks):
```js
  tickets_title:   { gu: 'ખરાબી',                     en: 'Faults' },
  my_tickets:      { gu: 'મારી ખરાબી',                 en: 'My faults' },
  open_tickets:    { gu: 'ખુલ્લી ખરાબી',               en: 'Open faults' },
```
(Grep the file for `કામ`/`ટિકિટ` in the ENTITY sense and align to ખરાબી; do NOT touch `st_*` status words or `down_word2`=બંધ which correctly means a screen is "down".)

- [ ] **Step 2: OpsTicketsV2 title** — already reads `t('tickets_title', lang)` (now "ખરાબી"). No JSX change needed beyond confirming the eyebrow/title read as faults.

- [ ] **Step 3: parse** — `npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/utils/opsStrings.js src/pages/v2/OpsTicketsV2.jsx` per file → clean (ignore the §244 pre-existing dup-key warnings).

- [ ] **Step 4: commit + push.**

---

### Task 4: F1 — reconcile + label the counts

**Files:** Modify `src/pages/v2/OpsTicketsV2.jsx` (+ minimal `src/pages/v2/OpsWorkV2.jsx`)

- [ ] **Step 1: OpsTicketsV2 — a count-context line** under the tabs, so "59" is never bare. After the tab bar, before the tab render, add:
```jsx
      {tab === 'open' && (
        <div style={{ ...secLbl, marginBottom: 12, color: 'var(--text-secondary)' }}>
          {cityScreens.length} {lang === 'gu' ? 'સ્ક્રીન બંધ' : 'screens down'} · {new Set(cityScreens.map(s => s.depot_id)).size} {lang === 'gu' ? 'સ્ટેશન' : 'stations'}
        </div>
      )}
```
This makes the Open count read "59 screens down · N stations" — the unit is explicit (F1).

- [ ] **Step 2: OpsWorkV2 — label its queue count's unit** so it can't be misread as contradicting the board. Find the "open" count display (the "17 open / 0 done today" strip) and change its label to name the unit (e.g. "N open tickets" / "N ખરાબી ચાલુ") — the number counts open+in_progress *tickets* (line ~197), a different thing from the board's screens-down. One-line label change, no count-logic change.

- [ ] **Step 3: parse + build** — `npx esbuild` per file + `npm run build` → `files generated`.

- [ ] **Step 4: commit + push.**

---

### Task 5: Document (§93)

- [ ] Append CLAUDE.md §249: the fault model (fault = offline screen; counts label their unit), F3 vocab (ખરાبی entity everywhere), F2 (sync norm widened + test-skip; diagnostic-first cleanup SQL, owner-run; typo-dups need a CMS fix or manual merge), and the foot-guns: (a) the dups are a CMS data problem — our norm/merge is a stopgap, the permanent fix is deduping the groups in aiadflux; (b) never DELETE a depot (deactivate — old tickets FK it); (c) a fault's ONE count = offline screens, label station-vs-screen. Commit + push.

---

## Self-review
- F1 → Task 4 (labels + one model). F3 → Task 3 (ખરાબી). F2 → Task 1 (sync) + Task 2 (SQL). ✓
- No placeholders; every step has the code/SQL. The PART 2b merge is intentionally owner-filled after the PART 1 diagnostic (can't know the uuids without the live data). ✓
- Consistency: `norm()` regex identical in Task 1 (sync) + Task 2 PART-1 diagnostic key. `tickets_title` used by OpsTicketsV2 title. `secLbl` reused (defined in the restyle §248). ✓
- Scope: OpsWorkV2 gets a one-line label only (it's the Check-in page now); no count-logic rewrite. A shared count RPC is deliberately NOT built (over-engineering for Tier 1 — explicit labels achieve the trust goal). ✓
