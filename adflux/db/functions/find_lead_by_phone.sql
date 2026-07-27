-- =====================================================================
-- find_lead_by_phone(text)  — CANONICAL (Phase 260, consolidated §71/§72)
--
-- The ONE phone→lead dedup lookup the UI reads
-- (src/utils/leadDedup.js::findLeadByPhone → LeadFormV2 dup-phone
-- warning; the dead LogMeetingModal reads it too and is unaffected —
-- this is a strict superset of the old columns).
--
-- SECURITY DEFINER so a rep learns a match across ALL reps — dedup must
-- see the whole pipeline — but the lookup is keyed to a SINGLE phone the
-- caller already typed, LIMIT 1, never an enumeration of the lead table.
--
-- Phase 260 (2026-07-22) — owner ask: "when someone adds a lead already
-- in the pipeline, show the representative who already has it." So the
-- row now carries the OWNER of the matched lead:
--   owner_id   = COALESCE(telecaller_id, assigned_to)  — the TRUE owner.
--                A TC-owned lead lives on telecaller_id (§113/§243); a
--                sales/agency lead on assigned_to. COALESCE picks the
--                live owner in every case.
--   owner_name = users.name of owner_id  (the rep to show)
--   owner_role = users.role of owner_id  (UI: "Rima · Telecaller")
--   is_open    = stage NOT IN ('Won','Lost')  — "in pipeline".
-- Prefers an OPEN match over a terminal one, then oldest first — the
-- SAME lead the block trigger (find_open_lead_id_by_phone) would pick,
-- so the warning and the DB safety net always agree.
--
-- Phone normalization matches find_open_lead_id_by_phone (v_digits /
-- v_key 10→91-prefixed / v_bare 12&91→stripped) so a stored "91XXXXX…"
-- and a typed 10-digit resolve to the same lead — catches more dups than
-- the old (v_digits, v_norm)-only match.
--
-- Previous home: supabase_phase33d6_full_cadence.sql (body removed there
-- → this is the single source; re-running phase33d6 can no longer revert
-- the owner columns). RETURNS-type change → DROP before CREATE.
--
-- CONTRACT (BLOCK on regress): returns owner_name; resolves the TC owner
-- via COALESCE(telecaller_id, assigned_to); single phone-keyed row;
-- SECURITY DEFINER.
-- =====================================================================

DROP FUNCTION IF EXISTS public.find_lead_by_phone(text);

CREATE FUNCTION public.find_lead_by_phone(p_phone text)
RETURNS TABLE (
  id          uuid,
  name        text,
  company     text,
  stage       text,
  assigned_to uuid,     -- kept for backward compat (old callers)
  owner_id    uuid,     -- COALESCE(telecaller_id, assigned_to) — TRUE owner
  owner_name  text,     -- users.name of owner_id
  owner_role  text,     -- users.role of owner_id
  is_open     boolean   -- stage NOT IN ('Won','Lost')
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits text := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  v_bare   text;
  v_key    text;
BEGIN
  IF length(v_digits) < 10 THEN RETURN; END IF;
  v_bare := CASE WHEN length(v_digits) = 12 AND v_digits LIKE '91%' THEN substring(v_digits, 3) ELSE v_digits END;
  v_key  := CASE WHEN length(v_digits) = 10 THEN '91' || v_digits ELSE v_digits END;

  RETURN QUERY
  SELECT l.id, l.name, l.company, l.stage,
         l.assigned_to,
         COALESCE(l.telecaller_id, l.assigned_to)          AS owner_id,
         u.name                                            AS owner_name,
         u.role                                            AS owner_role,
         (l.stage NOT IN ('Won', 'Lost'))                  AS is_open
    FROM public.leads l
    LEFT JOIN public.users u
      ON u.id = COALESCE(l.telecaller_id, l.assigned_to)
   WHERE regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g') IN (v_digits, v_key, v_bare)
   ORDER BY (l.stage NOT IN ('Won', 'Lost')) DESC, l.created_at ASC
   LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_lead_by_phone(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY / tripwire ───────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM pg_proc WHERE proname = 'find_lead_by_phone')                              AS fn_exists,
  pg_get_functiondef('public.find_lead_by_phone(text)'::regprocedure) LIKE '%owner_name%'          AS has_owner_name,
  pg_get_functiondef('public.find_lead_by_phone(text)'::regprocedure) LIKE '%telecaller_id%'       AS resolves_tc_owner,
  pg_get_functiondef('public.find_lead_by_phone(text)'::regprocedure) LIKE '%SECURITY DEFINER%'    AS is_definer;
