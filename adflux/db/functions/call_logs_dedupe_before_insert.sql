-- ============================================================================
-- db/functions/call_logs_dedupe_before_insert.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
--
-- ⭐ The ONE place call_logs_dedupe_before_insert is allowed to live. EDIT THIS
--    FILE to change it; never re-paste it into a new phaseN file (§71). It lived
--    in 5 files (113.5, 126, 166, 170, 173) — the call-dedup saga.
--
-- WHAT IT DOES: BEFORE-INSERT trigger on call_logs. Implements the §170/§173
--    "MIRROR THE PHONE CALL LOG" contract: the app's call_logs should match the
--    rep's actual phone dialer log. Folds a duplicate ONLY into an UNPATCHED
--    tel-tap-audit placeholder; two genuine repeat-calls BOTH survive. Feeds the
--    call count + the §49 ">=10s = a call" rule → frozen-adjacent (§28), guardian
--    before any change.
--
-- PROVENANCE: captured byte-for-byte from the LIVE DB 2026-06-23 via
--    pg_get_functiondef. Single signature (trigger fn). The live body is the
--    PHASE 173 direction-aware version (the §69.1/§71 canonical). Running this
--    file is a NO-OP.
--
-- ⚠ §69.1 REVERT LANDMINE — Phase 126 + Phase 166 had a BROAD merge (same-phone
--    30 min / same-lead 5 min) that wrongly merged real repeat-calls. Phase 170
--    then 173 REVERSED that to mirror the phone. Re-running phase126/166 used to
--    revert it. Phase 178 removed their function BODY → re-running them can no
--    longer revert the mirror-phone. DO NOT recreate the broad-merge logic.
--
-- ⚠ §173 LOCKSTEP — the direction-aware dedup is mirrored in the FRONTEND:
--    src/utils/callHistoryIngest.js PRIMARY dedup. Change the direction rule
--    here → change it there too (incoming/outgoing never merge).
--
-- TRIGGER WIRING (trg_call_logs_dedupe) lives in the phase files (idempotent
--    re-creates) — NOT here. This canonical owns the function body only. The
--    phase173 self-test (supabase_phase173_TEST_call_dedup.sql) still validates it.
--
-- SUPERSEDES (Phase 178 removed the body from each; triggers stay):
--      supabase_phase113_5_call_logs_dedup_trigger.sql
--      supabase_phase126_call_logs_aggressive_dedup.sql      (broad merge — DEAD)
--      supabase_phase166_call_logs_lead_dedup.sql            (broad merge — DEAD)
--      supabase_phase170_call_logs_mirror_phone.sql
--      supabase_phase173_call_dedup_canonical.sql            (the live body)
--
-- LOCKED CONTRACTS (a diff that breaks any is a BLOCK, §170/§173):
--    • R4 — real missed inbound is distinct; only a same-minute missed collapses.
--    • R1-R3 — ONLY an OUTGOING call folds; incoming NEVER folds.
--    • fold target = an UNPATCHED tel-tap audit row only (duration NULL/0 +
--      notes LIKE 'tel-tap audit%' + not missed) → a real/patched row can NEVER
--      be a fold target → two genuine repeat-calls BOTH survive (mirror phone).
--    • windows: same-phone 60s OR same-lead 5 min.
--
-- REVERT: re-run this file. TRIPWIRE: VERIFY block at the bottom.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.call_logs_dedupe_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_phone text;
  v_id    uuid;
BEGIN
  v_phone := right(regexp_replace(COALESCE(NEW.client_phone, ''), '\D', '', 'g'), 10);

  IF length(v_phone) < 10 THEN
    RETURN NEW;
  END IF;

  -- R4 — real missed inbound is distinct; collapse only same-minute missed.
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

  -- R1+R2+R3 — ONLY an OUTGOING call may fold into a tap. Incoming never folds.
  IF NEW.direction = 'outgoing' THEN
    SELECT cl.id INTO v_id
      FROM public.call_logs cl
     WHERE cl.user_id = NEW.user_id
       AND COALESCE(cl.direction,'') <> 'missed'
       AND (cl.duration_seconds IS NULL OR cl.duration_seconds = 0)
       AND cl.notes LIKE 'tel-tap audit%'
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
      RETURN NULL;
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY / TRIPWIRE — read-only, run any time. All six must be TRUE.
-- A FALSE = an older copy (e.g. phase126/166 broad-merge) was re-run → re-run this.
-- ============================================================================
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%tel-tap audit%'                       AS folds_only_into_tap,
--   pg_get_functiondef(p.oid) LIKE '%NEW.direction = ''outgoing''%'        AS only_outgoing_folds,
--   pg_get_functiondef(p.oid) LIKE '%NEW.direction = ''missed''%'          AS r4_missed_branch,
--   pg_get_functiondef(p.oid) LIKE '%60 seconds%'                          AS phone_window_60s,
--   pg_get_functiondef(p.oid) LIKE '%5 minutes%'                           AS lead_window_5min,
--   pg_get_functiondef(p.oid) LIKE '%duration_seconds = 0%'                AS unpatched_target_only
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'call_logs_dedupe_before_insert';
