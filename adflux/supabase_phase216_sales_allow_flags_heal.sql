-- =====================================================================
-- Phase 216 — heal sales reps' TA/DA/Hotel claim flags (one-time data fix)
-- 2026-07-07
--
-- SYMPTOM: Dipak Chauhan + Avkashbhai Raval (both role='sales', designation
--   'Sales Head') can't see the TA / DA / Hotel tabs on /my-offer, so they
--   can't file a claim. Viral Ghaskata — SAME designation/role/team_role —
--   can. Mayur (Sales Executive) had this before.
--
-- ROOT CAUSE: the claim tabs are gated by per-user boolean flags on
--   public.users — allow_ta / allow_da / allow_hotel (Phase 57). These are a
--   FROZEN SNAPSHOT copied from designations.default_allow_* at create time
--   and NEVER re-synced. Sales designations all default to TRUE (Phase 57b),
--   but rows created before that heal — or manually un-ticked — stayed false.
--   So it is NOT a role / team_role / designation RULE (all three Sales Heads
--   share role='sales', team_role='sales'); it is per-row drift. The DB/RLS
--   would accept their claim (tda_self only checks ownership) — the block is
--   purely the two hidden UI tabs.
--   NOTE: the earlier fix that healed Mayur (Phase 57b) was scoped
--   `WHERE team_role='sales'` — it happened to reach Mayur, but the true
--   reason others stayed off is creation timing, not a team_role gap.
--
-- FIX: one-time resync — every role='sales' user gets the sales policy
--   (TA + DA + Hotel = true). allow_other is already true for everyone.
--   Owner policy (Phase 57 header): every sales rep can claim all four.
--
-- NO TRIGGER. The designation->salary auto-sync was removed in Phase 213
--   precisely because an ongoing auto-resync silently overwrites hand-set
--   values. We do NOT reintroduce that pattern here. Future sales hires
--   already snap correctly via admin_create_user reading the (correct)
--   designation defaults; only these already-drifted rows need the one-time
--   correction. If a flag is ever intentionally changed later, it stays.
--
-- §45-safe: allow_* gate a claim panel, not a hot path. Idempotent (only
--   touches rows that are actually off). Mutates no claim/payout amounts.
-- =====================================================================

UPDATE public.users
SET allow_ta    = true,
    allow_da    = true,
    allow_hotel = true
WHERE role = 'sales'
  AND (allow_ta = false OR allow_da = false OR allow_hotel = false);

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY — every sales rep should now read all-true. Any row still
--     showing false = a role/designation edge to look at by hand. ───────
SELECT name, designation, team_role,
       allow_ta, allow_da, allow_hotel, allow_other
FROM public.users
WHERE role = 'sales'
ORDER BY allow_ta, allow_da, name;
