-- supabase_phase126_call_logs_aggressive_dedup.sql
-- Phase 126 (2026-06-08) — ONE real call per (rep, phone) per 30-min window.
--
-- OWNER DECISION (8 Jun 2026): "1 — merge aggressively (kills dupes, a rep who
-- re-called counts once). Make it future-proof, it should not make it again."
--
-- ROOT ROT (proved from live data, kirti/Rima 8 Jun):
--   call_logs has TWO writers — the tel-tap audit (callAudit.js, a row the
--   instant Call is pressed) and the phone-history scan (callHistoryIngest.js,
--   Phase 56l, reads the Android call log every 5 min). They only reconcile
--   when they land within 60s AND same direction. Real calls land MINUTES
--   apart / opposite direction:
--     Davat   — tap 05:15 (out) · scan 05:26 (IN) · tap 05:29 (out)  → 3 rows
--     VP Foods— tap 06:00 (out) · scan 06:38 (out)                   → 2 rows
--   The Phase 113.5 trigger killed only EXACT matches (same direction + minute
--   + duration) so every new mismatch shape leaked. And because all the dupe
--   rows are >=10s, they INFLATE the rep's call count + score (not cosmetic).
--
-- THE FUTURE-PROOF FIX — make the DB trigger the SINGLE AUTHORITY:
--   widen `call_logs_dedupe_before_insert` so that, for a NON-missed call,
--   if ANY existing non-missed row for the same (user, normalized phone) sits
--   within +/- 30 min, the new row's best data is MERGED into that survivor
--   and the insert is skipped — regardless of source (tap vs scan) or
--   direction. No JS writer can produce a duplicate anymore; the DB collapses
--   every shape. A skipped insert also never fires the AFTER-INSERT calls
--   counter bump, so the counter only gets more accurate.
--
-- KEPT DISTINCT ON PURPOSE:
--   • A real MISSED INBOUND (direction='missed') is an actionable "call me
--     back" event and never counts toward the >=10s target, so it is NEVER
--     folded into a real call (only a byte-identical same-minute missed is
--     collapsed, to stop scan-race stacking).
--   • The phone match is NORMALIZED to last-10 digits (+91 / 91 / bare-10 all
--     equal). The guard is on DIRECTION, not outcome — a fresh tap-audit
--     defaults to outcome='no_answer', so an outcome-based guard would (wrongly)
--     exempt every tap.
--
-- §45 / no-slowdown: per call_logs INSERT the trigger runs ONE scoped lookup —
--   user_id + call_at window use idx_call_logs_user_at; the normalized-phone
--   match is then applied to that small per-user/per-hour set. call_logs writes
--   are fire-and-forget (callAudit/callHistoryIngest destructure only `error`,
--   no .select()); a BEFORE-trigger NULL is a silent skip, not an error. No
--   app-writer change needed; no rep-path latency. Idempotent (CREATE OR
--   REPLACE FUNCTION; the heal leaves no dupes so it is safe to re-run).
--
-- FROZEN call chain (§28) — owner-approved, guardian + security audited.

-- ── 1. The single-authority dedup function (replaces Phase 113.5 body) ──
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

  -- AGGRESSIVE MERGE: earliest existing NON-missed row for this (rep, phone)
  -- within +/- 30 min becomes the survivor.
  SELECT cl.id INTO v_id
    FROM public.call_logs cl
   WHERE cl.user_id = NEW.user_id
     AND COALESCE(cl.direction,'') <> 'missed'
     AND right(regexp_replace(COALESCE(cl.client_phone,''),'\D','','g'),10) = v_phone
     AND cl.call_at BETWEEN NEW.call_at - INTERVAL '30 minutes'
                        AND NEW.call_at + INTERVAL '30 minutes'
   ORDER BY cl.call_at ASC, cl.id ASC
   LIMIT 1;

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

DROP TRIGGER IF EXISTS trg_call_logs_dedupe ON public.call_logs;
CREATE TRIGGER trg_call_logs_dedupe
  BEFORE INSERT ON public.call_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.call_logs_dedupe_before_insert();

-- ── 2. One-time heal — collapse TODAY's existing non-missed dupes ───────
-- Greedy sliding window: keep the earliest row per (user, phone) as the
-- anchor, merge every later row within 30 min into it, then delete the later
-- row. A row >30 min from the anchor starts a new anchor.
DO $heal$
DECLARE
  r            record;
  v_ph         text;
  v_anchor_id  uuid;
  v_anchor_at  timestamptz;
  v_key        text := '';
  v_merged     int  := 0;
BEGIN
  FOR r IN
    SELECT id, user_id, client_phone,
           call_at, duration_seconds, outcome, lead_id, language
      FROM public.call_logs
     WHERE call_at::date = current_date
       AND COALESCE(direction,'') <> 'missed'
       AND length(right(regexp_replace(COALESCE(client_phone,''),'\D','','g'),10)) = 10
     ORDER BY user_id,
              right(regexp_replace(COALESCE(client_phone,''),'\D','','g'),10),
              call_at ASC, id ASC
  LOOP
    v_ph := right(regexp_replace(COALESCE(r.client_phone,''),'\D','','g'),10);
    IF (r.user_id::text || '|' || v_ph) <> v_key
       OR v_anchor_at IS NULL
       OR r.call_at > v_anchor_at + INTERVAL '30 minutes' THEN
      v_anchor_id := r.id;
      v_anchor_at := r.call_at;
      v_key       := r.user_id::text || '|' || v_ph;
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
        lead_id  = COALESCE(cl.lead_id, r.lead_id),
        language = COALESCE(cl.language, r.language)
      WHERE cl.id = v_anchor_id;
      DELETE FROM public.call_logs WHERE id = r.id;
      v_merged := v_merged + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'Phase 126: merged % duplicate call_logs rows today', v_merged;
END
$heal$;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- VERIFY
-- =====================================================================
-- V1: trigger present (expect 1 row).
SELECT tgname FROM pg_trigger
 WHERE tgrelid = 'public.call_logs'::regclass
   AND tgname  = 'trg_call_logs_dedupe';

-- V2: any (rep, phone) STILL has two non-missed rows WITHIN 30 min today
-- (expect 0 rows). Two non-missed calls >30 min apart are legitimately
-- separate calls and correctly survive — so this checks the 30-min window,
-- not a blanket COUNT.
SELECT u.name AS rep, a.client_phone, a.call_at AS first_at, b.call_at AS second_at
  FROM public.call_logs a
  JOIN public.call_logs b
    ON b.user_id = a.user_id
   AND b.id <> a.id
   AND right(regexp_replace(COALESCE(b.client_phone,''),'\D','','g'),10)
     = right(regexp_replace(COALESCE(a.client_phone,''),'\D','','g'),10)
   AND b.call_at >  a.call_at
   AND b.call_at <= a.call_at + INTERVAL '30 minutes'
  LEFT JOIN public.users u ON u.id = a.user_id
 WHERE a.call_at::date = current_date
   AND COALESCE(a.direction,'') <> 'missed'
   AND COALESCE(b.direction,'') <> 'missed'
   AND length(right(regexp_replace(COALESCE(a.client_phone,''),'\D','','g'),10)) = 10
 ORDER BY a.call_at
 LIMIT 10;

-- V3 (manual smoke): insert a tap row (outgoing, no_answer, 0s) for a lead,
-- then a scan row (incoming, connected, 88s, same phone, +10 min) → only ONE
-- row survives, carrying duration 88 + outcome 'connected'. A 'missed' inbound
-- for the same phone +5 min later stays a SEPARATE row.

SELECT 'Phase 126 call_logs aggressive dedup applied' AS status;
