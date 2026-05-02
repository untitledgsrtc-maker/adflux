-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 9 / M1 STEP 1
-- daily_targets table — per-user activity targets
-- =====================================================================
--
-- WHAT THIS DOES:
--   New table public.daily_targets — one row per (user, effective window).
--   The newest non-archived row applies to that user TODAY.
--
--   Fields (architecture doc M1 spec):
--     min_quotes      — quotes the rep should SEND in a day
--     min_followups   — follow-ups the rep should COMPLETE in a day
--     min_calls       — calls the rep should LOG in a day
--                       (calls aren't tracked yet — placeholder for M1
--                        Phase 2 when lead_activities ships)
--     effective_from  — date this target became active
--     effective_to    — null = still active. When admin updates, the
--                       old row gets effective_to=today and a new row
--                       starts effective_from=today+1.
--
-- WHY:
--   Owner spec — "I want a system where everyone works in the same
--   direction." Daily targets are the unit of accountability. Without
--   per-user targets, the dashboard counter has no denominator.
--
-- DEFAULT TARGETS (seeded for any user with role=sales who doesn't
--                  already have an active target row):
--   min_quotes:    2 quotes/day
--   min_followups: 5 follow-ups/day
--   min_calls:     0 (placeholder — calls module not built yet)
--
-- IDEMPOTENT.
-- =====================================================================


-- 1) Table -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_targets (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  min_quotes      integer NOT NULL DEFAULT 2,
  min_followups   integer NOT NULL DEFAULT 5,
  min_calls       integer NOT NULL DEFAULT 0,
  effective_from  date NOT NULL DEFAULT CURRENT_DATE,
  effective_to    date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_targets_window_chk CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- One ACTIVE (effective_to is null) row per user. Composite covering
-- index speeds up the "what target applies today for user X" lookup.
CREATE UNIQUE INDEX IF NOT EXISTS daily_targets_one_active_per_user
  ON public.daily_targets (user_id) WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS daily_targets_user_date
  ON public.daily_targets (user_id, effective_from DESC);


-- 2) RLS -------------------------------------------------------------
ALTER TABLE public.daily_targets ENABLE ROW LEVEL SECURITY;

-- Read: every authenticated user can read all targets (the admin
-- dashboard needs the whole team's targets to compute the missed-
-- target banner). RLS scopes WRITE only.
DROP POLICY IF EXISTS "dt_read_all"     ON public.daily_targets;
CREATE POLICY "dt_read_all"     ON public.daily_targets
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Write: admin / owner / co_owner only (sales reps can't change
-- their own targets — that defeats the accountability layer).
DROP POLICY IF EXISTS "dt_admin_write"  ON public.daily_targets;
CREATE POLICY "dt_admin_write"  ON public.daily_targets
  FOR ALL USING (public.get_my_role() IN ('admin', 'owner', 'co_owner'));


-- 3) Seed defaults for existing sales users -------------------------
-- One row per active sales user that doesn't already have one.
INSERT INTO public.daily_targets (user_id, min_quotes, min_followups, min_calls)
SELECT u.id, 2, 5, 0
  FROM public.users u
 WHERE u.role = 'sales'
   AND NOT EXISTS (
     SELECT 1 FROM public.daily_targets dt
      WHERE dt.user_id = u.id AND dt.effective_to IS NULL
   );


-- 4) updated_at trigger ---------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_daily_targets_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS daily_targets_touch ON public.daily_targets;
CREATE TRIGGER daily_targets_touch
  BEFORE UPDATE ON public.daily_targets
  FOR EACH ROW EXECUTE FUNCTION public.touch_daily_targets_updated_at();


-- =====================================================================
-- VERIFY:
--
--   SELECT u.name, dt.min_quotes, dt.min_followups, dt.min_calls,
--          dt.effective_from, dt.effective_to
--     FROM public.daily_targets dt
--     JOIN public.users u ON u.id = dt.user_id
--    WHERE dt.effective_to IS NULL
--    ORDER BY u.name;
--
--   -- Expected: one row per active sales user with default 2/5/0.
--
-- =====================================================================
