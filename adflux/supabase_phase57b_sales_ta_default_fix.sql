-- supabase_phase57b_sales_ta_default_fix.sql
-- Phase 57b (2026-06-04) — permanent fix: every SALES designation
-- defaults TA + DA + Hotel ON, and backfill existing sales reps whose
-- flags were left OFF (Mayur).
--
-- ─── Root cause ──────────────────────────────────────────────────
-- Phase 57 added per-user expense toggles (users.allow_ta/da/hotel/
-- other) + designation defaults (designations.default_allow_*). It
-- turned the defaults ON only for a hard-coded NAME list and backfilled
-- EXISTING users by team_role. A sales rep ADDED LATER via HR inherits
-- the chosen DESIGNATION's default — and the per-user columns are
-- NOT NULL DEFAULT false, so:
--   • the panel's "?? !isTelecaller" fallback never fires (value is
--     never null), so it obeys the literal column;
--   • a sales designation NOT in the Phase 57 name list (or created
--     after it) defaults OFF.
-- Result: a new sales rep (mayur@untitledad.in) lands with
-- allow_ta/da/hotel = false → TaDaRequestPanel shows only "Other
-- expense", while the original 5 reps (backfilled by Phase 57) see
-- TA/DA/Hotel.
--
-- ─── Fix (data only — no app / APK change) ───────────────────────
-- 1. Every SALES designation (auth_role='sales' = Sales Executive /
--    Sr. Sales Executive / Sales Head + any future sales designation)
--    defaults TA + DA + Hotel ON. The HR "Add Member" form already
--    reads designation.default_allow_* (HRNewUserV2:120), so every
--    FUTURE sales hire auto-gets TA/DA. No JS change needed.
-- 2. Backfill EXISTING sales reps (team_role='sales') whose per-user
--    flags were left OFF — fixes Mayur + any other already-created
--    sales rep, NOW. Does NOT touch telecaller / creative / admin /
--    accounts / agency.
--
-- Idempotent: re-running sets the same values. No schema change (the
-- allow_* columns already exist from Phase 57), so no NOTIFY pgrst.

BEGIN;

-- ─── 1. Permanent: sales designations default TA/DA/Hotel ON ──────
UPDATE public.designations
   SET default_allow_ta    = true,
       default_allow_da    = true,
       default_allow_hotel = true,
       default_allow_other = true
 WHERE auth_role = 'sales';

-- ─── 2. Backfill existing sales reps left OFF (Mayur + any other) ─
UPDATE public.users
   SET allow_ta    = true,
       allow_da    = true,
       allow_hotel = true
 WHERE team_role = 'sales'
   AND (allow_ta = false OR allow_da = false OR allow_hotel = false);

COMMIT;


-- ─── VERIFY ──────────────────────────────────────────────────────
-- (a) Every sales designation now ON (expect all true):
SELECT name, auth_role,
       default_allow_ta, default_allow_da, default_allow_hotel
  FROM public.designations
 WHERE auth_role = 'sales'
 ORDER BY display_order;

-- (b) Every sales rep now ON (expect all true, incl Mayur):
SELECT email, name, team_role,
       allow_ta, allow_da, allow_hotel
  FROM public.users
 WHERE team_role = 'sales'
 ORDER BY name;

-- (c) Mayur specifically (expect t / t / t):
SELECT email, allow_ta, allow_da, allow_hotel
  FROM public.users
 WHERE email = 'mayur@untitledad.in';
