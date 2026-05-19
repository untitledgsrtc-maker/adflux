-- supabase_phase57_allow_expense_kinds.sql
-- Phase 57 — per-user expense-kind toggles (TA / DA / Hotel / Other)
-- 19 May 2026
--
-- Owner directive (19 May 2026):
--   "need gps no ta count for telecaller but some need ta so what
--    we can do while create team we need toggle on off for ta, da,
--    hotel, other or tickmark"
--
-- Until now TaDaRequestPanel gated tabs by role (Phase 52c: TC sees
-- Other only). One-size-fits-all per role. Owner wants per-user
-- override at create time:
--   • 4 boolean columns on users — allow_ta / allow_da / allow_hotel
--     / allow_other.
--   • 4 default boolean columns on designations — so picking a
--     designation in the HR wizard snap-fills the user's toggles.
--   • HR can override per-user at create time + edit later.
--
-- Owner-approved defaults per designation (19 May 2026):
--   Sales Executive          all 4 ✓
--   Sr. Sales Executive      all 4 ✓
--   Sales Head               all 4 ✓
--   Telecaller               Other only ✓
--   Telecaller Head          Other only ✓
--   Graphic Designer         Other only ✓
--   Video Editor             Other only ✓
--   Operation Execution      all 4 ✓   (site work)
--   Office Boy               all 4 ✓   (errands)
--   HR / Admin / Accounts    Other only ✓
--   Proprietor / Partner     all 4 ✓
--   Creative Lead            Other only ✓
--
-- Idempotent. ADD COLUMN IF NOT EXISTS. UPDATE blocks safe to re-run.


-- ─── 1. Columns on users ─────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS allow_ta    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_da    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_hotel boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_other boolean NOT NULL DEFAULT true;


-- ─── 2. Columns on designations ──────────────────────────────────
ALTER TABLE public.designations
  ADD COLUMN IF NOT EXISTS default_allow_ta    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_allow_da    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_allow_hotel boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_allow_other boolean NOT NULL DEFAULT true;


-- ─── 3. Seed designation defaults ────────────────────────────────
-- Sales / field / ops / office boy / proprietor / partner → all 4.
UPDATE public.designations
   SET default_allow_ta    = true,
       default_allow_da    = true,
       default_allow_hotel = true,
       default_allow_other = true
 WHERE name IN (
   'Proprietor',
   'Partner in Government',
   'Sales Head',
   'Sales Executive',
   'Sr. Sales Executive',
   'Operation Execution',
   'Office Boy'
 );

-- TC + creative + back-office → Other only (defaults already set
-- above by column default, but re-write explicitly so the row state
-- is unambiguous after this migration).
UPDATE public.designations
   SET default_allow_ta    = false,
       default_allow_da    = false,
       default_allow_hotel = false,
       default_allow_other = true
 WHERE name IN (
   'Telecaller',
   'Telecaller Head',
   'Graphic Designer',
   'Video Editor',
   'HR',
   'Admin',
   'Accounts',
   'Creative Lead'
 );


-- ─── 4. Backfill existing users from their team_role ─────────────
-- Existing sales / sales_manager / ops users get full access; rest
-- already match the column default (Other only).
UPDATE public.users
   SET allow_ta    = true,
       allow_da    = true,
       allow_hotel = true,
       allow_other = true
 WHERE team_role IN ('sales', 'sales_manager', 'ops_execution', 'office_boy', 'owner', 'government_partner');


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users'
      AND column_name IN ('allow_ta','allow_da','allow_hotel','allow_other'))     AS user_cols_added,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='designations'
      AND column_name IN ('default_allow_ta','default_allow_da','default_allow_hotel','default_allow_other')) AS designation_cols_added,
  (SELECT count(*) FROM public.designations
    WHERE default_allow_ta = true)                                                 AS designations_with_ta,
  (SELECT count(*) FROM public.users
    WHERE allow_ta = true)                                                         AS users_with_ta;
-- Expected: 4 · 4 · ≥6 (sales/ops/office/proprietor/etc) · variable
