-- =====================================================================
-- supabase_phase345_clients_auto_merge.sql
-- Phase 345 (2026-10-06): ONE client per phone number, merged automatically.
-- Owner: "always auto merge the client" (looking at /clients "Find duplicate clients").
--
-- RUN ORDER:  db/functions/client_auto_merge.sql  FIRST (the functions), then THIS file.
--
-- WHAT IT DOES (ONE atomic transaction):
--   0. aborts unless the Phase 345 functions exist;
--   1. backs up every client row that sits in a duplicate group (public._bak_clients_p345);
--   2. installs the two guard triggers (new rows fold into the existing client; editing a
--      phone onto another client merges or refuses) - from this moment no new duplicate can form;
--   3. merges the existing duplicate groups: counters ADD, dates widen, blank fields fill, call
--      history is re-pointed, the extra row is deleted, the merged client goes to the owner of the
--      open lead (else the latest quote's creator). Pinned: aborts unless exactly the 6 groups /
--      6 extra rows the owner approved are found, and checks that no counter changed in total;
--   4. adds the UNIQUE index on the phone key (the hard guarantee).
--
-- SAFETY
--   * quotes are NEVER touched (quotes.created_by drives incentive); only the CRM clients table.
--   * Backup first. KEEP 30 days, then DROP TABLE public._bak_clients_p345.
--   * Idempotent: a re-run finds no duplicate group and changes nothing.
--   * UNDO (restores the 6 extra rows + the 6 kept rows exactly as they were):
--       ALTER TABLE public.clients DISABLE TRIGGER trg_clients_absorb_duplicate;
--       ALTER TABLE public.clients DISABLE TRIGGER trg_clients_phone_guard;
--       DROP INDEX IF EXISTS public.clients_phone_key_uk;
--       INSERT INTO public.clients
--         SELECT id,name,company,phone,email,gstin,address,notes,created_by,first_quote_at,last_quote_at,
--                quote_count,total_won_amount,created_at,updated_at
--           FROM public._bak_clients_p345 b WHERE b.bak_action = 'dup_group'
--            AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = b.id);
--       UPDATE public.clients c SET name=b.name, company=b.company, phone=b.phone, email=b.email, gstin=b.gstin,
--              address=b.address, notes=b.notes, created_by=b.created_by, first_quote_at=b.first_quote_at,
--              last_quote_at=b.last_quote_at, quote_count=b.quote_count, total_won_amount=b.total_won_amount
--         FROM public._bak_clients_p345 b WHERE b.id = c.id AND b.bak_action = 'dup_group';
--       ALTER TABLE public.clients ENABLE TRIGGER trg_clients_absorb_duplicate;
--       ALTER TABLE public.clients ENABLE TRIGGER trg_clients_phone_guard;
--     (then DROP the two triggers + the unique index + public.sync_client_from_quote(uuid,text) if you
--      want the old per-owner behaviour back; see the ROLLBACK note in db/functions/client_auto_merge.sql).
-- =====================================================================
BEGIN;
SET LOCAL lock_timeout = '3s';     -- never queue behind a long transaction and stall every client read

-- ===== PART 0 - the functions must exist =====
DO $$
BEGIN
  IF to_regprocedure('public.client_phone_key(text)') IS NULL
     OR to_regprocedure('public._client_fold(uuid,uuid,boolean)') IS NULL
     OR to_regprocedure('public._client_owner_for_key(text,uuid)') IS NULL
     OR to_regprocedure('public.clients_absorb_duplicate()') IS NULL
     OR to_regprocedure('public.clients_phone_change_guard()') IS NULL THEN
    RAISE EXCEPTION 'Phase 345: run db/functions/client_auto_merge.sql FIRST (functions missing)';
  END IF;
END $$;

-- ===== PART 1 - backup every client row that sits in a duplicate group =====
CREATE TABLE IF NOT EXISTS public._bak_clients_p345 AS
  SELECT c.*, ''::text AS bak_action, now() AS bak_at
    FROM public.clients c
   WHERE false;
ALTER TABLE public._bak_clients_p345 ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS _bak_clients_p345_id_action
    ON public._bak_clients_p345 (id, bak_action);

INSERT INTO public._bak_clients_p345
SELECT c.*, 'dup_group', now()
  FROM public.clients c
 WHERE public.client_phone_key(c.phone) IN (
         SELECT public.client_phone_key(phone)
           FROM public.clients
          WHERE public.client_phone_key(phone) IS NOT NULL
          GROUP BY 1 HAVING count(*) > 1)
   AND NOT EXISTS (SELECT 1 FROM public._bak_clients_p345 x
                    WHERE x.id = c.id AND x.bak_action = 'dup_group');

-- ===== PART 2 - the guard triggers (from now on no new duplicate can be created) =====
DROP TRIGGER IF EXISTS trg_clients_absorb_duplicate ON public.clients;
CREATE TRIGGER trg_clients_absorb_duplicate
  BEFORE INSERT ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.clients_absorb_duplicate();

DROP TRIGGER IF EXISTS trg_clients_phone_guard ON public.clients;
CREATE TRIGGER trg_clients_phone_guard
  BEFORE UPDATE OF phone ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.clients_phone_change_guard();

-- ===== PART 3 - merge the existing duplicate groups (pinned + totals-checked) =====
DO $$
DECLARE
  g          record;
  r          record;
  v_keep     uuid;
  v_groups   int := 0;
  v_dropped  int := 0;
  v_cnt_b    bigint;  v_won_b numeric;
  v_cnt_a    bigint;  v_won_a numeric;
BEGIN
  -- totals over the clients that sit in a group, BEFORE
  SELECT COALESCE(sum(quote_count),0), COALESCE(sum(total_won_amount),0)
    INTO v_cnt_b, v_won_b
    FROM public._bak_clients_p345 WHERE bak_action = 'dup_group';

  FOR g IN
    SELECT public.client_phone_key(phone) AS k
      FROM public.clients
     WHERE public.client_phone_key(phone) IS NOT NULL
     GROUP BY 1 HAVING count(*) > 1
     ORDER BY 1
  LOOP
    v_groups := v_groups + 1;
    PERFORM pg_advisory_xact_lock(hashtextextended('client_phone:' || g.k, 0));   -- same lock the app paths take
    SELECT c.id INTO v_keep
      FROM public.clients c
     WHERE public.client_phone_key(c.phone) = g.k
     ORDER BY c.last_quote_at DESC NULLS LAST, c.created_at DESC
     LIMIT 1;
    FOR r IN SELECT c.id FROM public.clients c
              WHERE public.client_phone_key(c.phone) = g.k AND c.id <> v_keep LOOP
      PERFORM public._client_fold(v_keep, r.id, false);
      v_dropped := v_dropped + 1;
    END LOOP;
    BEGIN
      UPDATE public.clients
         SET created_by = COALESCE(public._client_owner_for_key(g.k, created_by), created_by)
       WHERE id = v_keep;
    EXCEPTION WHEN unique_violation THEN
      NULL;                       -- legacy exact-phone twin: keep the current owner
    END;
  END LOOP;

  -- pinned to what the owner approved on 2026-10-06 (6 duplicate groups = 6 extra rows).
  -- On a re-run (already merged) both are 0 and nothing is done.
  IF NOT ((v_groups = 6 AND v_dropped = 6) OR (v_groups = 0 AND v_dropped = 0)) THEN
    RAISE EXCEPTION 'Phase 345 aborted: expected 6 duplicate groups / 6 extra rows, found % / %. Nothing was changed.',
      v_groups, v_dropped;
  END IF;

  -- no counter may change in total: the kept rows must hold the SAME sums as the group had
  IF v_groups > 0 THEN
    SELECT COALESCE(sum(c.quote_count),0), COALESCE(sum(c.total_won_amount),0)
      INTO v_cnt_a, v_won_a
      FROM public.clients c
     WHERE c.id IN (SELECT id FROM public._bak_clients_p345 WHERE bak_action = 'dup_group');
    IF v_cnt_a <> v_cnt_b OR v_won_a <> v_won_b THEN
      RAISE EXCEPTION 'Phase 345 aborted: counters changed in total (quote_count % -> %, won % -> %). Nothing was changed.',
        v_cnt_b, v_cnt_a, v_won_b, v_won_a;
    END IF;
  END IF;
END $$;

-- ===== PART 4 - the hard guarantee: ONE client per phone key =====
CREATE UNIQUE INDEX IF NOT EXISTS clients_phone_key_uk
  ON public.clients (public.client_phone_key(phone))
  WHERE public.client_phone_key(phone) IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ===== VERIFY (read-only; run after the commit) =====
-- SELECT
--   (SELECT count(*) FROM (SELECT public.client_phone_key(phone) FROM public.clients
--      WHERE public.client_phone_key(phone) IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d)  AS dup_groups_left,   -- 0
--   (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.clients'::regclass
--      AND tgname IN ('trg_clients_absorb_duplicate','trg_clients_phone_guard') AND NOT tgisinternal) AS triggers, -- 2
--   (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='clients_phone_key_uk') AS unique_idx, -- 1
--   (SELECT count(*) FROM public._bak_clients_p345 WHERE bak_action='dup_group') AS backed_up;                      -- 12
