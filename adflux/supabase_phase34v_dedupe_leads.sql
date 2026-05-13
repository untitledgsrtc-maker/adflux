-- =====================================================================
-- Phase 34V — find + clean duplicate leads (by normalized phone)
-- 13 May 2026
--
-- WHY
--
-- Owner screenshot showed seven rows of "Mr. Nemi Shah · Vasant Masala
-- · 7069082826" assigned to kirti kotak — same phone, same name, same
-- company, seven separate lead rows. Phone-based dedup was added in
-- Phase 33D.6 (findLeadByPhone) and is enforced by every lead-creating
-- surface today (LogMeetingModal, LeadFormV2, LeadUploadV2), but
-- legacy / pre-dedup rows + any path that bypassed the check have
-- accumulated in the table.
--
-- WHAT THIS MIGRATION DOES
--
-- 1. View `lead_phone_duplicates`
--    Groups leads by normalized phone digits (strip non-digit, normalize
--    10-digit to "91" + digits). Returns groups with > 1 row.
--    Read-only — admin runs `SELECT * FROM lead_phone_duplicates;`
--    to see what's there.
--
-- 2. RPC `dedupe_phone_lead_group(p_phone text)`
--    Soft-cleans a single phone group:
--      * keeps the OLDEST lead (lowest created_at) as canonical
--      * marks every other row in the group with stage='Lost' +
--        lost_reason='Duplicate' + notes "merged into <oldest id>"
--    Soft (not DELETE) so the activity history per row is preserved;
--    if owner regrets a merge they can manually re-open by changing
--    stage back.
--    Admin calls per phone, OR runs the bulk wrapper below.
--
-- 3. RPC `dedupe_all_phone_groups()`
--    Iterates every duplicate group and calls the per-group RPC.
--    Returns the count of leads soft-cleaned. Admin runs ONCE after
--    auditing the view; safe to re-run (no-ops on groups already
--    cleaned).
--
-- NO unique constraint is added at the DB level. Reason: some legit
-- scenarios (same reception phone shared by two contacts at the same
-- company) need a soft duplicate to exist. Frontend dedup is enough
-- of a guard for daily use; this migration just cleans up the
-- historical mess.
--
-- Idempotent.
-- =====================================================================

-- ─── 1. View: phone-grouped duplicate lead sets ──────────────────────
CREATE OR REPLACE VIEW public.lead_phone_duplicates AS
WITH norm AS (
  SELECT
    l.id,
    l.name,
    l.company,
    l.phone,
    l.stage,
    l.assigned_to,
    l.created_by,
    l.created_at,
    regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g') AS digits
  FROM public.leads l
),
norm2 AS (
  SELECT
    n.*,
    CASE
      WHEN length(n.digits) = 10 THEN '91' || n.digits
      ELSE n.digits
    END AS phone_key
  FROM norm n
  WHERE length(n.digits) >= 10
),
groups AS (
  SELECT
    phone_key,
    count(*) AS dup_count,
    min(created_at) AS oldest_at
  FROM norm2
  GROUP BY phone_key
  HAVING count(*) > 1
)
SELECT
  g.phone_key,
  g.dup_count,
  g.oldest_at,
  n.id,
  n.name,
  n.company,
  n.phone,
  n.stage,
  n.assigned_to,
  n.created_by,
  n.created_at,
  (n.created_at = g.oldest_at) AS is_canonical
FROM groups g
JOIN norm2 n USING (phone_key)
ORDER BY g.dup_count DESC, g.phone_key, n.created_at ASC;

GRANT SELECT ON public.lead_phone_duplicates TO authenticated;


-- ─── 2. RPC: soft-clean a single phone group ─────────────────────────
CREATE OR REPLACE FUNCTION public.dedupe_phone_lead_group(p_phone text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits text := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  v_key    text;
  v_canon  uuid;
  v_cleaned int := 0;
BEGIN
  IF length(v_digits) < 10 THEN RETURN 0; END IF;
  v_key := CASE WHEN length(v_digits) = 10 THEN '91' || v_digits ELSE v_digits END;

  -- Pick canonical = oldest in the group.
  SELECT id
    INTO v_canon
    FROM public.leads
   WHERE regexp_replace(COALESCE(phone, ''), '\D', '', 'g')
         IN (v_digits, v_key)
   ORDER BY created_at ASC
   LIMIT 1;

  IF v_canon IS NULL THEN RETURN 0; END IF;

  -- Soft-merge all younger rows.
  UPDATE public.leads
     SET stage       = 'Lost',
         lost_reason = 'Duplicate',
         notes       = COALESCE(NULLIF(notes, ''), '') ||
                       CASE WHEN COALESCE(notes, '') = '' THEN '' ELSE E'\n' END
                       || '[Phase 34V] merged into canonical lead ' || v_canon::text
                       || ' on ' || to_char(now(), 'YYYY-MM-DD HH24:MI'),
         updated_at  = now()
   WHERE id <> v_canon
     AND regexp_replace(COALESCE(phone, ''), '\D', '', 'g')
         IN (v_digits, v_key)
     AND stage NOT IN ('Won', 'Lost');

  GET DIAGNOSTICS v_cleaned = ROW_COUNT;
  RETURN v_cleaned;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dedupe_phone_lead_group(text) TO authenticated;


-- ─── 3. RPC: clean every duplicate phone group in one call ───────────
CREATE OR REPLACE FUNCTION public.dedupe_all_phone_groups()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec        record;
  v_total    int := 0;
  v_per      int;
BEGIN
  FOR rec IN
    SELECT DISTINCT phone_key
      FROM public.lead_phone_duplicates
  LOOP
    v_per := public.dedupe_phone_lead_group(rec.phone_key);
    v_total := v_total + COALESCE(v_per, 0);
  END LOOP;
  RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dedupe_all_phone_groups() TO authenticated;


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────────
-- Admin runbook (run in this order):
--
-- 1) Preview what'll be merged:
--    SELECT phone_key, dup_count, name, company, stage,
--           created_at, is_canonical
--      FROM public.lead_phone_duplicates
--     ORDER BY dup_count DESC, phone_key, created_at ASC;
--
-- 2) When the list looks right, clean ALL groups in one call:
--    SELECT public.dedupe_all_phone_groups() AS leads_soft_merged;
--
-- 3) Re-run the view — should now be empty (or only contain
--    Won/Lost duplicates that the RPC intentionally skipped):
--    SELECT count(*) FROM public.lead_phone_duplicates;
--
-- This block just confirms the function + view exist after migration.
SELECT
  (SELECT count(*) FROM information_schema.views
    WHERE table_name='lead_phone_duplicates') AS view_exists,
  (SELECT count(*) FROM pg_proc
    WHERE proname='dedupe_phone_lead_group') AS per_group_rpc_exists,
  (SELECT count(*) FROM pg_proc
    WHERE proname='dedupe_all_phone_groups') AS bulk_rpc_exists;
