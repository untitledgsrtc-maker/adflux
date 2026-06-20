-- supabase_phase173_call_dedup_canonical.sql
-- Phase 173 (2026-06-20) — CANONICAL call-dedup. ONE direction-aware rule,
-- the SAME one the JS device scan now obeys, locked by a self-test.
--
-- ENDS the incoming-folded-into-outgoing mislabel. Owner screenshot 20 Jun:
-- 7874260770 was Incoming 21s @15:17 + Outgoing 17s @15:15 (two real calls);
-- the CRM showed ONE row "OUTGOING 21s @15:15" — the incoming got merged into
-- the outgoing tap and kept the outgoing label.
--
-- WHY THIS KEEPS BREAKING (§33 whack-a-mole, "solved ~100 times"):
--   the "is this the same call?" rule is written in TWO live places —
--     1. the JS device scan  src/utils/callHistoryIngest.js
--     2. this DB trigger      call_logs_dedupe_before_insert()
--   plus superseded SQL (Phase 126, 166). They all deduped by PHONE + TIME and
--   IGNORED DIRECTION, so an incoming + an outgoing to the same number inside
--   the window merged. Every past fix patched ONE copy; the others re-broke it.
--
-- THE CANONICAL CONTRACT — both the JS scan (Phase 173 JS change) and this
-- trigger now enforce these five rules. Do not change one without the other,
-- and re-run the self-test below:
--   R1. A 'tel-tap audit%' row is OUTGOING-INTENT (rep pressed Call). Only an
--       OUTGOING real call may fold into a tap.
--   R2. Two rows merge ONLY if same direction (or the target is an unpatched
--       tap, which is outgoing-intent). INCOMING and OUTGOING never merge.
--   R3. A real INCOMING call always lands as its own row.
--   R4. Missed inbound = distinct "call me back" events; only a byte-identical
--       same-minute missed collapses (scan race).
--   R5. Two real SAME-DIRECTION calls to the same lead BOTH survive (Rima's
--       repeat outgoing calls) — they only fold into an UNPATCHED tap; once one
--       folds + patches, the rest insert.
--
-- Forward-only: rows ALREADY merged in history cannot be un-merged. The next
-- device scan re-ingests and, under this rule, re-inserts wrongly-merged
-- incoming calls as their own rows. Idempotent (CREATE OR REPLACE). §33 frozen
-- meeting/call contracts untouched. One scoped lookup per INSERT (idx_call_logs_user_at).

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
  IF length(v_phone) < 10 THEN
    RETURN NEW;
  END IF;

  -- R4 — real missed inbound is a distinct event; collapse only a
  -- byte-identical same-minute missed (scan race).
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

  -- R1 + R2 + R3 — ONLY an OUTGOING call may fold into a tap. An incoming (or
  -- any non-outgoing) real call NEVER folds → it falls straight through to the
  -- INSERT below and lands as its own row. This is the single line that ends
  -- the cross-direction mislabel.
  IF NEW.direction = 'outgoing' THEN
    -- Fold into an UNPATCHED tel-tap audit row (our own placeholder for this
    -- same physical outgoing call). Match by phone within 60s, OR (cross-number
    -- same lead — Vimal Oil ...121 vs ...122) within 5 min.
    SELECT cl.id INTO v_id
      FROM public.call_logs cl
     WHERE cl.user_id = NEW.user_id
       AND COALESCE(cl.direction,'') <> 'missed'
       AND (cl.duration_seconds IS NULL OR cl.duration_seconds = 0)   -- UNPATCHED
       AND cl.notes LIKE 'tel-tap audit%'                             -- a tap (outgoing-intent)
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
      -- Fold THIS outgoing call into the tap: keep earliest stamp, real
      -- duration, promote outcome, and STAMP direction = 'outgoing' (the tap
      -- carried NULL direction — fixing that is part of the contract).
      UPDATE public.call_logs cl SET
        call_at          = LEAST(cl.call_at, NEW.call_at),
        duration_seconds = GREATEST(COALESCE(cl.duration_seconds,0), COALESCE(NEW.duration_seconds,0)),
        direction        = 'outgoing',
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
  END IF;

  -- R3 / R5 — incoming real call, OR outgoing with no tap → INSERT (mirror the
  -- phone). Two real same-direction calls to the same lead both reach here.
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_call_logs_dedupe ON public.call_logs;
CREATE TRIGGER trg_call_logs_dedupe
  BEFORE INSERT ON public.call_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.call_logs_dedupe_before_insert();

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- VERIFY (read-only — safe to run on the live DB any time)
-- =====================================================================
-- V1: trigger present.
SELECT tgname FROM pg_trigger
 WHERE tgrelid = 'public.call_logs'::regclass AND tgname = 'trg_call_logs_dedupe';

-- V2: the function now guards on direction (expect t).
SELECT pg_get_functiondef('public.call_logs_dedupe_before_insert()'::regprocedure)
       ILIKE '%IF NEW.direction = ''outgoing'' THEN%' AS direction_guarded;

-- V3: the BEHAVIOUR is locked by the self-test in
-- supabase_phase173_TEST_call_dedup.sql — it inserts synthetic rows inside a
-- transaction, asserts all five rules (R1-R5), then ROLLS BACK (changes
-- nothing). Run that file to see PASS; re-run it after ANY future change to the
-- call-dedup rule. V2 above is the cheap guard: if it ever returns f, an older
-- call SQL (Phase 126/166/170) has been re-run and stripped the direction guard.

SELECT 'Phase 173 canonical direction-aware call dedup applied' AS status;
