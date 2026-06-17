-- supabase_phase166_call_logs_lead_dedup.sql
-- Phase 166 (2026-06-17) — fold a call recorded under a DIFFERENT NUMBER of
-- the SAME lead into one row. The last gap in the Phase 126 dedup.
--
-- ROOT (proved live, kirti 17 Jun): ONE 59s call to lead "Vimal Oil" produced
-- TWO call_logs rows —
--     tap-audit saved 9879104121   (the lead's stored number)
--     device scan saved 9879104122 (the number actually dialed)
-- The lead has two near-sequential office numbers; the two ingest paths
-- (callAudit.js tap + callHistoryIngest.js Phase 56l scan) each picked a
-- different one. Phase 126 merges on the PHONE (normalized last-10), so two
-- different numbers = two different keys = no merge → kirti's Qualified read
-- 4 when the real count was 3. Inflates the call COUNT (not pay).
--
-- FIX (additive — the phone-keyed merge is byte-unchanged): after the phone
-- match finds nothing, fold a non-missed row for the SAME (rep, lead_id)
-- within a tight +/-5 min window. A 5-minute same-lead pairing is one call /
-- an immediate re-dial — it honors the Phase 126 owner decision ("a rep who
-- re-called counts once", 8 Jun) WITHOUT collapsing distinct same-lead calls
-- spread across the day (the phone path keeps its own 30-min window). A real
-- MISSED INBOUND is still never folded. The new path fires ONLY when the
-- phone key found nothing AND NEW.lead_id is set.
--
-- TRADE-OFF (owner-aware): two genuinely-different calls to the SAME lead
-- inside 5 minutes now count as ONE. For a single-contact lead that is exactly
-- right (re-dial after no-answer). For a lead that is a company with two people
-- you ring back-to-back, the second folds into the first. At this org leads are
-- overwhelmingly single-contact, and this matches the Phase 126 "count once"
-- rule — widen/narrow the 5-min window if that ever bites.
--
-- §45 / no-slowdown: one extra scoped lookup, and ONLY when the phone path
-- already missed (user_id + lead_id + call_at window, uses idx_call_logs_user_at).
-- call_logs writes stay fire-and-forget (callAudit/callHistoryIngest destructure
-- only `error`); a BEFORE-trigger NULL is a silent skip, not an error, and a
-- skipped insert never fires the AFTER-INSERT counter bump → counts only get
-- more accurate. Idempotent (CREATE OR REPLACE; the heal leaves no dupes).
-- FROZEN call chain (§28) — guardian + audited.

-- ── 1. Extend the single-authority dedup with a same-lead fallback ──────
CREATE OR REPLACE FUNCTION public.call_logs_dedupe_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_phone text;
  v_id    uuid;
BEGIN
  v_phone := right(regexp_replace(COALESCE(NEW.client_phone, ''), '\D', '', 'g'), 10);

  -- Unknown / short number → can't correlate; keep the row as-is.
  -- (Phase 126 behaviour, unchanged. Both ingest paths always carry a real
  -- number, so the Phase 166 lead path below is still reached for live calls.)
  IF length(v_phone) < 10 THEN
    RETURN NEW;
  END IF;

  -- Real missed inbound = distinct event; never fold into a real call.
  -- Only collapse a byte-identical same-minute missed (scan race).
  IF NEW.direction = 'missed' THEN
    IF EXISTS (
      SELECT 1 FROM public.call_logs cl
       WHERE cl.user_id   = NEW.user_id
         AND cl.direction = 'missed'
         AND right(regexp_replace(COALESCE(cl.client_phone,''),'\D','','g'),10) = v_phone
         AND date_trunc('minute', cl.call_at) = date_trunc('minute', NEW.call_at)
    ) THEN
      RETURN NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- PHONE MERGE (Phase 126, byte-unchanged): earliest existing NON-missed row
  -- for this (rep, phone) within +/- 30 min becomes the survivor.
  SELECT cl.id INTO v_id
    FROM public.call_logs cl
   WHERE cl.user_id = NEW.user_id
     AND COALESCE(cl.direction,'') <> 'missed'
     AND right(regexp_replace(COALESCE(cl.client_phone,''),'\D','','g'),10) = v_phone
     AND cl.call_at BETWEEN NEW.call_at - INTERVAL '30 minutes'
                        AND NEW.call_at + INTERVAL '30 minutes'
   ORDER BY cl.call_at ASC, cl.id ASC
   LIMIT 1;

  -- PHASE 166 — SAME-LEAD fallback. The two ingest paths recorded this call
  -- under different numbers of one lead; the phone key above missed it. Fold a
  -- non-missed row for the SAME (rep, lead) within a tight +/-5 min window.
  IF v_id IS NULL AND NEW.lead_id IS NOT NULL THEN
    SELECT cl.id INTO v_id
      FROM public.call_logs cl
     WHERE cl.user_id = NEW.user_id
       AND cl.lead_id = NEW.lead_id
       AND COALESCE(cl.direction,'') <> 'missed'
       AND cl.call_at BETWEEN NEW.call_at - INTERVAL '5 minutes'
                          AND NEW.call_at + INTERVAL '5 minutes'
     ORDER BY cl.call_at ASC, cl.id ASC
     LIMIT 1;
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE public.call_logs cl SET
      call_at          = LEAST(cl.call_at, NEW.call_at),
      duration_seconds = GREATEST(COALESCE(cl.duration_seconds,0), COALESCE(NEW.duration_seconds,0)),
      outcome = CASE
                  WHEN NEW.outcome = 'connected' THEN 'connected'
                  WHEN cl.outcome  = 'connected' THEN cl.outcome
                  WHEN NEW.outcome IN ('callback_requested','sales_ready','already_client','not_interested')
                       AND cl.outcome IN ('no_answer','busy','wrong_number') THEN NEW.outcome
                  ELSE cl.outcome
                END,
      lead_id  = COALESCE(cl.lead_id, NEW.lead_id),
      language = COALESCE(cl.language, NEW.language)
    WHERE cl.id = v_id;
    RETURN NULL;  -- merged into the survivor → skip the insert
  END IF;

  RETURN NEW;
END
$function$;

-- Trigger already exists (Phase 126); re-bind defensively (idempotent).
DROP TRIGGER IF EXISTS trg_call_logs_dedupe ON public.call_logs;
CREATE TRIGGER trg_call_logs_dedupe
  BEFORE INSERT ON public.call_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.call_logs_dedupe_before_insert();

-- ── 2. One-time heal — collapse TODAY's existing same-lead dupes ────────
-- Greedy sliding window per (user, lead_id): keep the earliest non-missed row
-- as the anchor, merge every later row within 5 min into it, then delete the
-- later row. A row >5 min from the anchor starts a new anchor. Only lead-tied
-- rows (lead_id NOT NULL) — phone-only dupes are already handled by Phase 126.
DO $heal$
DECLARE
  r            record;
  v_anchor_id  uuid;
  v_anchor_at  timestamptz;
  v_key        text := '';
  v_merged     int  := 0;
BEGIN
  FOR r IN
    SELECT id, user_id, lead_id, call_at, duration_seconds, outcome, language
      FROM public.call_logs
     WHERE call_at::date = current_date
       AND COALESCE(direction,'') <> 'missed'
       AND lead_id IS NOT NULL
     ORDER BY user_id, lead_id, call_at ASC, id ASC
  LOOP
    IF (r.user_id::text || '|' || r.lead_id::text) <> v_key
       OR v_anchor_at IS NULL
       OR r.call_at > v_anchor_at + INTERVAL '5 minutes' THEN
      v_anchor_id := r.id;
      v_anchor_at := r.call_at;
      v_key       := r.user_id::text || '|' || r.lead_id::text;
    ELSE
      UPDATE public.call_logs cl SET
        duration_seconds = GREATEST(COALESCE(cl.duration_seconds,0), COALESCE(r.duration_seconds,0)),
        outcome = CASE
                    WHEN r.outcome  = 'connected' THEN 'connected'
                    WHEN cl.outcome = 'connected' THEN cl.outcome
                    WHEN r.outcome IN ('callback_requested','sales_ready','already_client','not_interested')
                         AND cl.outcome IN ('no_answer','busy','wrong_number') THEN r.outcome
                    ELSE cl.outcome
                  END,
        language = COALESCE(cl.language, r.language)
      WHERE cl.id = v_anchor_id;
      DELETE FROM public.call_logs WHERE id = r.id;
      v_merged := v_merged + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'Phase 166: merged % same-lead duplicate call_logs rows today', v_merged;
END
$heal$;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- VERIFY
-- =====================================================================
-- V1: trigger still present (expect 1 row).
SELECT tgname FROM pg_trigger
 WHERE tgrelid = 'public.call_logs'::regclass
   AND tgname  = 'trg_call_logs_dedupe';

-- V2: any (rep, lead) STILL has two non-missed rows WITHIN 5 min today
-- (expect 0 rows). Two non-missed same-lead calls >5 min apart are left as
-- separate by design.
SELECT u.name AS rep, a.lead_id, a.call_at AS first_at, b.call_at AS second_at
  FROM public.call_logs a
  JOIN public.call_logs b
    ON b.user_id = a.user_id
   AND b.lead_id = a.lead_id
   AND b.id <> a.id
   AND b.call_at >  a.call_at
   AND b.call_at <= a.call_at + INTERVAL '5 minutes'
  LEFT JOIN public.users u ON u.id = a.user_id
 WHERE a.call_at::date = current_date
   AND a.lead_id IS NOT NULL
   AND COALESCE(a.direction,'') <> 'missed'
   AND COALESCE(b.direction,'') <> 'missed'
 ORDER BY a.call_at
 LIMIT 10;

-- V3 (kirti smoke): his Vimal Oil pair (9879104121 + ...122) is now ONE row.
SELECT client_phone, call_at::time AS at, duration_seconds, outcome
  FROM public.call_logs
 WHERE call_at::date = current_date
   AND lead_id = '364739e6-11dc-40b6-8f35-f2311c37d0bc'
 ORDER BY call_at;

SELECT 'Phase 166 call_logs same-lead dedup applied' AS status;
