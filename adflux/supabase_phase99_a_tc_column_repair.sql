-- supabase_phase99_a_tc_column_repair.sql
--
-- Phase 99.A — /telecaller routing repair (column mismatch).
--
-- BACKGROUND
-- ──────────
-- /telecaller deep audit on 2026-05-28 surfaced that both Dhara and
-- Rima saw an empty queue despite admin running Excel imports daily.
-- Initial hypothesis was "leads are stuck unassigned." The actual
-- root cause is a form-routing defect in LeadUploadV2.jsx:
--
--   * The "default assignee" dropdown filters
--     `team_role IN ('sales','agency','sales_manager','telecaller')`
--     so Dhara + Rima appear in it.
--   * When admin picks a TC, the form writes to `leads.assigned_to`
--     unconditionally (LeadUploadV2.jsx:350-351):
--       assigned_to:   defaultAssignee || null,
--       telecaller_id: telecaller?.id || null,   -- Cronberry parse only
--   * /telecaller filters on `telecaller_id = me`, so the leads
--     never surface for the rep they were meant for.
--
-- Live snapshot (2026-05-28 ~23:42 IST):
--   * 107 active leads have `assigned_to IN (Dhara, Rima)` AND
--     `telecaller_id IS NULL`.
--   * Stage in ('New','Working','Nurture'). Segment = 'PRIVATE'.
--   * Source mix: Excel 78 (Dhara) + Excel 29 (Rima) = 107 confirmed
--     by `users.role = 'telecaller'` join on assigned_to.
--   * 34 real sales-owned orphans (Mayur, Kirti, Dixita, Nikhil)
--     and 7 Field Meeting orphans are correctly attributed —
--     UNTOUCHED by this migration.
--
-- FIX
-- ───
-- Branch A from the 2026-05-28 decision pack:
--   1. Seed `daily_targets` rows for Dhara + Rima with default
--      policy (50 calls / 30% connect / 5 qualified weekly).
--      Both currently have no row; frontend falls back to
--      hardcoded values matching these defaults.
--   2. Column repair: move `assigned_to` → `telecaller_id` for
--      the 107 affected rows and null `assigned_to`. Predicate
--      explicitly excludes Won/Lost/QuoteSent/etc, Field Meeting
--      source, GOVERNMENT segment, and any row already owned by
--      a real sales rep.
--   3. NOTIFY pgrst.
--
-- IDEMPOTENCY
-- ───────────
-- Op A: NOT EXISTS guard on `daily_targets` re-runs as no-op.
-- Op B: WHERE filter requires `telecaller_id IS NULL` AND
--   `assigned_to IN (Dhara,Rima)`. After Op B runs, those rows
--   have `telecaller_id IN (Dhara,Rima)` AND `assigned_to IS NULL`,
--   so re-running matches 0 rows. Safe to re-run.
-- Op C: NOTIFY is always safe.
--
-- ROLLBACK FENCE
-- ──────────────
-- Rollback predicate uses `updated_at >= '<paste_timestamp>'` so
-- only rows touched by THIS migration get reverted. Owner captures
-- the paste-time `now()` value RIGHT BEFORE pasting (see VERIFY
-- block instructions below) and pastes it into the rollback
-- template if a regression appears.
--
-- SCOPE — UNTOUCHED
-- ─────────────────
--   * 34 real sales-owned orphans (Mayur, Kirti, Dixita, Nikhil).
--   * 7 Field Meeting orphans.
--   * 128 closed Lost + 3 closed Won orphans.
--   * 5 QuoteSent orphans.
--   * GOVERNMENT segment leads.
--   * Anything in stage NOT IN ('New','Working','Nurture').
--   * Anything where assigned_to is already cleared.
--   * Pre-existing 1 closed lead each for Dhara + Rima
--     (stage 'Won'/'Lost' → excluded by stage filter).
--   * LeadUploadV2.jsx — separate JS commit. This migration is
--     SQL-only.
--   * users, call_logs, lead_activities, follow_ups, work_sessions,
--     RLS policies, triggers, functions.
--
-- LOCKED UUIDs (verified by probe P2 on 2026-05-28):
--   Dhara = 43f13bab-2fa2-4bc8-ad72-1610bc0c4402
--   Rima  = 058b3000-7630-4112-a01f-c42e7e24b6e8


-- ────────────────────────────────────────────────────────────────
-- Op A — Seed daily_targets for Dhara + Rima (idempotent)
-- ────────────────────────────────────────────────────────────────

INSERT INTO public.daily_targets (
  user_id,
  min_calls,
  min_connect_pct,
  min_qualified_weekly,
  effective_from,
  effective_to
)
SELECT u.id,
       50,
       30,
       5,
       current_date,
       NULL
  FROM public.users u
 WHERE u.id IN (
   '43f13bab-2fa2-4bc8-ad72-1610bc0c4402'::uuid,   -- Dhara
   '058b3000-7630-4112-a01f-c42e7e24b6e8'::uuid    -- Rima
 )
   AND NOT EXISTS (
     SELECT 1
       FROM public.daily_targets dt
      WHERE dt.user_id      = u.id
        AND dt.effective_to IS NULL
   );


-- ────────────────────────────────────────────────────────────────
-- Op B — Column repair: assigned_to → telecaller_id for the 107
-- mis-routed active leads. Sets assigned_to = NULL on success.
-- ────────────────────────────────────────────────────────────────

UPDATE public.leads
   SET telecaller_id = assigned_to,
       assigned_to   = NULL,
       updated_at    = now()
 WHERE telecaller_id IS NULL
   AND assigned_to   IN (
     '43f13bab-2fa2-4bc8-ad72-1610bc0c4402'::uuid,   -- Dhara
     '058b3000-7630-4112-a01f-c42e7e24b6e8'::uuid    -- Rima
   )
   AND stage         IN ('New','Working','Nurture')
   AND COALESCE(source, '') <> 'Field Meeting'
   AND segment       = 'PRIVATE';


-- ────────────────────────────────────────────────────────────────
-- Op C — Schema reload
-- ────────────────────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';


-- ───────────── VERIFY ─────────────
-- Paste each query separately. Studio shows last result on
-- multi-statement so single-at-a-time is required.
--
-- V1 — daily_targets seeded for both TCs:
--
--   SELECT u.name,
--          dt.id IS NOT NULL          AS has_target_row,
--          dt.min_calls,
--          dt.min_connect_pct,
--          dt.min_qualified_weekly,
--          dt.effective_from,
--          dt.effective_to
--     FROM public.users u
--     LEFT JOIN public.daily_targets dt
--       ON dt.user_id      = u.id
--      AND dt.effective_to IS NULL
--    WHERE u.id IN (
--      '43f13bab-2fa2-4bc8-ad72-1610bc0c4402'::uuid,
--      '058b3000-7630-4112-a01f-c42e7e24b6e8'::uuid
--    )
--    ORDER BY u.name;
--
--   Expected: 2 rows, both has_target_row=true,
--             50 / 30 / 5, effective_from=today IST, effective_to NULL.
--
-- V2 — Column repair landed: 107 rows moved:
--
--   SELECT
--     count(*) FILTER (WHERE telecaller_id IN (
--         '43f13bab-2fa2-4bc8-ad72-1610bc0c4402'::uuid,
--         '058b3000-7630-4112-a01f-c42e7e24b6e8'::uuid)
--       AND assigned_to    IS NULL
--       AND stage          IN ('New','Working','Nurture')
--       AND COALESCE(source, '') <> 'Field Meeting'
--       AND segment        = 'PRIVATE')                            AS repaired,
--     count(*) FILTER (WHERE assigned_to IN (
--         '43f13bab-2fa2-4bc8-ad72-1610bc0c4402'::uuid,
--         '058b3000-7630-4112-a01f-c42e7e24b6e8'::uuid)
--       AND telecaller_id IS NULL
--       AND stage IN ('New','Working','Nurture')
--       AND COALESCE(source, '') <> 'Field Meeting'
--       AND segment = 'PRIVATE')                                   AS still_wrong_column
--     FROM public.leads;
--
--   Expected: repaired = 107 (or close, ±5 if drift), still_wrong_column = 0.
--
-- V3 — Real sales-owned orphans UNCHANGED (must stay 34):
--
--   SELECT count(*) AS sales_owned_orphans
--     FROM public.leads l
--     JOIN public.users u ON u.id = l.assigned_to
--    WHERE l.telecaller_id IS NULL
--      AND l.assigned_to    IS NOT NULL
--      AND l.stage          IN ('New','Working','Nurture')
--      AND u.role           = 'sales';
--
--   Expected: 34 (UNCHANGED — proves we didn't steal sales-owned).
--
-- V4 — Field Meeting orphans UNCHANGED (must stay 7):
--
--   SELECT count(*) AS field_meeting_orphans
--     FROM public.leads
--    WHERE telecaller_id   IS NULL
--      AND COALESCE(source, '') = 'Field Meeting'
--      AND stage              IN ('New','Working','Nurture');
--
--   Expected: 7 (UNCHANGED).
--
-- V5 — Per-TC visible queue rose to 78 (Dhara) and 29 (Rima):
--
--   SELECT u.name,
--          count(*) FILTER (WHERE l.stage NOT IN
--            ('Won','Lost','QuoteSent','Negotiating','MeetingScheduled'))
--            AS visible_queue,
--          count(*) AS total_assigned
--     FROM public.leads l
--     JOIN public.users u ON u.id = l.telecaller_id
--    WHERE u.id IN (
--      '43f13bab-2fa2-4bc8-ad72-1610bc0c4402'::uuid,
--      '058b3000-7630-4112-a01f-c42e7e24b6e8'::uuid
--    )
--    GROUP BY u.name
--    ORDER BY u.name;
--
--   Expected:
--     Dhara: visible_queue ≈ 78, total_assigned ≈ 79 (+1 from prior closed lead)
--     Rima:  visible_queue ≈ 29, total_assigned ≈ 30 (+1 from prior closed lead)
--
-- V6 — No GOVERNMENT lead routed to PRIVATE TCs (must stay 0):
--
--   SELECT count(*) AS govt_routed_to_private_tc
--     FROM public.leads l
--     JOIN public.users u ON u.id = l.telecaller_id
--    WHERE l.segment        = 'GOVERNMENT'
--      AND u.segment_access = 'PRIVATE'
--      AND u.id IN (
--        '43f13bab-2fa2-4bc8-ad72-1610bc0c4402'::uuid,
--        '058b3000-7630-4112-a01f-c42e7e24b6e8'::uuid
--      );
--
--   Expected: 0 (post-paste safety check).
--
-- V7 — Schema reload landed:
--
--   SELECT 1;
--
--   Expected: 1.
--
-- LIVE SMOKE (post-paste, manual):
--   Sign in as Dhara → /telecaller → visible queue ≈ 78.
--   Sign in as Rima  → /telecaller → visible queue ≈ 29.
--   Auto-refresh poll (20s) picks up new state on tab resume.


-- ───────────── PRE-PASTE CAPTURE ─────────────
-- RUN THIS BEFORE PASTING THE MIGRATION. The returned timestamp
-- is your rollback fence. Save it in a scratchpad — you'll paste
-- it into the ROLLBACK block below if a regression appears.
--
--   SELECT now() AS paste_clock_before,
--          (now() AT TIME ZONE 'Asia/Kolkata')::timestamp AS ist_clock_before;
--
--   Save the `paste_clock_before` value INCLUDING timezone suffix
--   (e.g. 2026-05-28 18:30:00.123456+00). Paste-time should follow
--   within ≤30 seconds of capture.


-- ───────────── ROLLBACK ─────────────
-- Re-apply ONLY if a real regression appears. Restores Phase 12
-- ownership shape for the 107 affected rows + deletes the 2
-- daily_targets rows seeded above.
--
-- Replace <paste_timestamp> with the value captured above before
-- running the rollback. Strip the leading "-- " from each line
-- to execute.
--
-- Step 1 — Revert column repair (LEADS).
-- The updated_at fence ensures only rows touched by THIS migration
-- are reverted. Pre-existing closed leads (stage in Won/Lost) are
-- excluded by the stage filter regardless.
--
-- UPDATE public.leads
--    SET assigned_to   = telecaller_id,
--        telecaller_id = NULL,
--        updated_at    = now()
--  WHERE telecaller_id IN (
--    '43f13bab-2fa2-4bc8-ad72-1610bc0c4402'::uuid,
--    '058b3000-7630-4112-a01f-c42e7e24b6e8'::uuid
--  )
--    AND assigned_to    IS NULL
--    AND stage          IN ('New','Working','Nurture')
--    AND COALESCE(source, '') <> 'Field Meeting'
--    AND segment        = 'PRIVATE'
--    AND updated_at    >= '<paste_timestamp>'::timestamptz;
--
-- Expected: 107 rows updated.
--
-- Step 2 — Revert daily_targets seed (POLICY).
-- Only deletes rows that match the seeded defaults exactly. If
-- owner has manually edited any value, the DELETE skips that row.
--
-- DELETE FROM public.daily_targets
--  WHERE user_id IN (
--    '43f13bab-2fa2-4bc8-ad72-1610bc0c4402'::uuid,
--    '058b3000-7630-4112-a01f-c42e7e24b6e8'::uuid
--  )
--    AND min_calls            = 50
--    AND min_connect_pct      = 30
--    AND min_qualified_weekly = 5
--    AND effective_to         IS NULL;
--
-- Expected: 2 rows deleted.
--
-- Step 3 — Schema reload.
--
-- NOTIFY pgrst, 'reload schema';
--
-- NOTE: Rollback does NOT undo any TC action taken on the 107
-- assigned leads (calls logged, outcomes saved, stages flipped).
-- Those persist as historical data. Rollback also bumps updated_at
-- again — audit log will show two touches per affected row.
