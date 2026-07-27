-- =====================================================================
-- leads_block_dup_phone()  — CANONICAL (Phase 260, consolidated §71/§72)
--
-- BEFORE INSERT trigger fn on public.leads — the DB-level safety net
-- that guarantees "no repeat lead ever" even for paths that bypass the
-- frontend phone dedup (CSV import cross-rep rows, programmatic inserts,
-- network-race double-taps). Original home: Phase 34W.
--
-- Rejects ONLY when an OPEN lead (stage NOT IN 'Won','Lost') already
-- exists for the normalized phone — a Lost/Won lead is re-addable
-- (renewal / re-engage). Attach-first paths never hit this: the quote
-- (quote_before_insert_ensure_lead) + campaign (campaign_conversation_
-- ensure_lead) flows call find_open_lead_id_by_phone first and attach.
--
-- Phase 260 (2026-07-22) — owner ask: the rejection now NAMES the
-- representative who already has the lead, so ANY path that hits the
-- block (CSV import error rows, API) surfaces WHO owns it — not just the
-- LeadFormV2 warning. Owner = COALESCE(telecaller_id, assigned_to)
-- (§113/§243). SECURITY DEFINER so the owner name resolves regardless of
-- the inserting rep's RLS on users; the body only READS + RAISEs (no
-- writes, no dynamic SQL) so DEFINER is contained. The users lookup runs
-- ONLY in the rare reject branch (v_existing IS NOT NULL) → zero added
-- cost on the common no-dup INSERT (hot path, §45).
--
-- Companion helper find_open_lead_id_by_phone(text) + the CREATE TRIGGER
-- trg_leads_block_dup_phone stay in supabase_phase34w_block_duplicate_
-- phone_inserts.sql (this canonical owns the trigger-fn BODY only).
--
-- CONTRACT (BLOCK on regress): rejects open-lead dup only; names the
-- owner (COALESCE(telecaller_id, assigned_to)); SECURITY DEFINER.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.leads_block_dup_phone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing  uuid;
  v_owner     text;
  v_lead_name text;
BEGIN
  -- No usable phone on the new row → nothing to dedup.
  IF NEW.phone IS NULL OR length(regexp_replace(NEW.phone, '\D', '', 'g')) < 10 THEN
    RETURN NEW;
  END IF;

  -- Find any OPEN lead (non-terminal stage) with the same phone.
  v_existing := public.find_open_lead_id_by_phone(NEW.phone);

  IF v_existing IS NOT NULL THEN
    -- Resolve the owning rep's name only in this (rare) reject branch.
    SELECT l.name, u.name
      INTO v_lead_name, v_owner
      FROM public.leads l
      LEFT JOIN public.users u ON u.id = COALESCE(l.telecaller_id, l.assigned_to)
     WHERE l.id = v_existing;

    RAISE EXCEPTION
      'This phone is already in an open lead "%" with %.',
      COALESCE(v_lead_name, '—'), COALESCE(v_owner, 'another rep')
      USING HINT = 'Open that lead or reassign it — do not create a duplicate. (lead id ' || v_existing || ')';
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY / tripwire ───────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM pg_proc WHERE proname = 'leads_block_dup_phone')                          AS fn_exists,
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_leads_block_dup_phone')                    AS trigger_wired,
  pg_get_functiondef('public.leads_block_dup_phone()'::regprocedure) LIKE '%v_owner%'             AS names_owner,
  pg_get_functiondef('public.leads_block_dup_phone()'::regprocedure) LIKE '%telecaller_id%'       AS resolves_tc_owner,
  pg_get_functiondef('public.leads_block_dup_phone()'::regprocedure) LIKE '%SECURITY DEFINER%'    AS is_definer;
