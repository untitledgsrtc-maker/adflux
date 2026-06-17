-- supabase_phase170_call_logs_mirror_phone.sql
-- Phase 170 (2026-06-17) — call_logs MIRRORS THE PHONE CALL LOG. One row per
-- real call. The ONLY dedup is removing OUR OWN double-entry (the in-app tap
-- audit row vs the same call read by the device scan). Two REAL calls — even
-- to the same number/lead — are NEVER merged.
--
-- OWNER DECISION (17 Jun 2026, REVERSES the Phase 126 "a rep who re-called
-- counts once" rule): "mirror of call log — yes exactly." Rima's app showed
-- 234, her other CRM (which mirrors the phone) showed 243 — 9 MORE. The 9 were
-- her legitimate repeat-calls to the same lead, which Phase 126 (same-phone
-- 30-min merge) + Phase 166 (same-lead 5-min merge) collapsed. Those broad
-- merges are WRONG for a telecaller who calls a lead several times a session.
--
-- THE PRINCIPLE (single source of truth = the phone call log):
--   The device call log has each real call exactly once. The scan
--   (callHistoryIngest.js) reads it. The ONLY extra row we create is the
--   tel-tap audit (callAudit.js writes it the instant Call is pressed:
--   duration NULL, outcome 'no_answer', notes 'tel-tap audit%'). So the only
--   thing to dedup is: fold a call INTO an UNPATCHED tap-audit row (our own
--   placeholder for this same physical call). If there is no unpatched tap to
--   fold into, the row is a REAL call → INSERT it (mirror the phone).
--
--   • Tap then scan (same call): scan folds into the tap → 1 row. ✓
--   • Double-tap (ghost-click, same minute): 2nd tap folds into the 1st
--     unpatched tap → 1 row. ✓
--   • Cross-number same call (Vimal Oil: app ...121, device ...122): the JS
--     scan (Phase 167) folds by lead+time; this trigger also folds a tap by
--     lead within 5 min. → 1 row. ✓
--   • Two REAL repeat-calls to the same lead/number: neither folds into an
--     unpatched tap (the earlier one is already a real/patched row) → BOTH
--     insert. → matches the phone. ✓  (This is the 9 Rima was missing.)
--
-- This REPLACES the Phase 126 + 166 broad time-window merges. The §28 frozen
-- call chain: guardian-audited. Forward-looking — rows ALREADY merged by 126/
-- 166 can't be un-merged (deleted), but the next device-log scan re-ingests
-- and, under this rule, re-inserts the wrongly-merged repeat-calls.
--
-- §45 / no-slowdown: ONE scoped lookup per call_logs INSERT (user + tap +
-- window), uses idx_call_logs_user_at. call_logs writers destructure only
-- `error`; a BEFORE-trigger NULL is a silent skip. Idempotent (CREATE OR
-- REPLACE). Pairs with the JS scan reconcile (Phase 167) — same principle,
-- both fold the scan into the tap, neither merges two real calls.

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

  -- Unknown / short number → can't correlate to a tap; keep the row as-is.
  IF length(v_phone) < 10 THEN
    RETURN NEW;
  END IF;

  -- Real missed inbound = a distinct "call me back" event; never fold into a
  -- real call. Only collapse a byte-identical same-minute missed (scan race).
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

  -- MIRROR THE PHONE — fold ONLY into an UNPATCHED tel-tap-audit row (our own
  -- placeholder for this same physical call). NEVER merge into a real/patched
  -- row, so two genuine repeat-calls both survive. Match the tap by phone
  -- within 60s, OR (cross-number same lead) within 5 min.
  SELECT cl.id INTO v_id
    FROM public.call_logs cl
   WHERE cl.user_id = NEW.user_id
     AND COALESCE(cl.direction,'') <> 'missed'
     AND (cl.duration_seconds IS NULL OR cl.duration_seconds = 0)   -- UNPATCHED
     AND cl.notes LIKE 'tel-tap audit%'                             -- a tap row
     AND (
           ( right(regexp_replace(COALESCE(cl.client_phone,''),'\D','','g'),10) = v_phone
             AND cl.call_at BETWEEN NEW.call_at - INTERVAL '60 seconds'
                                AND NEW.call_at + INTERVAL '60 seconds' )
        OR ( NEW.lead_id IS NOT NULL AND cl.lead_id = NEW.lead_id
             AND cl.call_at BETWEEN NEW.call_at - INTERVAL '5 minutes'
                                AND NEW.call_at + INTERVAL '5 minutes' )
         )
   ORDER BY cl.call_at ASC, cl.id ASC
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    -- Fold THIS call into the tap placeholder: keep the earliest stamp, take
    -- the real duration, promote the outcome, keep the lead/language.
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
    RETURN NULL;  -- folded into the tap → skip the insert
  END IF;

  RETURN NEW;  -- a REAL call with no tap placeholder → insert it (mirror the phone)
END
$function$;

DROP TRIGGER IF EXISTS trg_call_logs_dedupe ON public.call_logs;
CREATE TRIGGER trg_call_logs_dedupe
  BEFORE INSERT ON public.call_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.call_logs_dedupe_before_insert();

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- VERIFY
-- =====================================================================
-- V1: trigger present.
SELECT tgname FROM pg_trigger
 WHERE tgrelid = 'public.call_logs'::regclass AND tgname = 'trg_call_logs_dedupe';

-- V2: the function no longer does a broad same-phone/lead time merge — it only
-- folds into an unpatched tap (expect t).
SELECT pg_get_functiondef('public.call_logs_dedupe_before_insert()'::regprocedure)
       ILIKE '%UNPATCHED%'  AS mirrors_phone;

-- V3 (today, after the next device scan): a telecaller's row count should
-- climb toward the phone's number as real repeat-calls re-insert. Spot a rep:
SELECT u.name, count(*) AS rows_today,
       count(*) FILTER (WHERE cl.duration_seconds >= 10) AS ge10s
  FROM public.call_logs cl JOIN public.users u ON u.id = cl.user_id
 WHERE (cl.call_at AT TIME ZONE 'Asia/Kolkata')::date = current_date
 GROUP BY u.name ORDER BY rows_today DESC LIMIT 10;

SELECT 'Phase 170 call_logs mirror-phone dedup applied' AS status;
