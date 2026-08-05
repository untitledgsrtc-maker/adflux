-- =============================================================================
-- supabase_hr_recruit_p2_callsync.sql
-- Phase 284 — HR recruitment calls AUTO-FETCH from the device call log.
--
-- Owner: HR's phone call log should auto-sync into the candidate — every call to
-- a candidate's number (time + duration + direction) captured automatically, so
-- HR just taps Call and dials; no manual logging.
--
-- ADDITIVE + §45-safe: 2 columns on the existing hr_candidate_calls + a dedup
-- index. ZERO touch to the FROZEN sales/TC call pipeline (call_logs / lead_
-- activities / callHistoryIngest) — HR calls are matched to CANDIDATES, not leads,
-- and written only to hr_candidate_calls. HR's PERSONAL calls (numbers not in the
-- candidate list) are never stored.
--
-- §92 compliance: the sync matches a device call to a candidate BY NUMBER and
-- captures its duration — it does NOT gate anything on the OEM call-TYPE integer
-- (direction is stored informationally only). No per-brand type casing.
--
-- Idempotent (§8). One file (§154).
-- =============================================================================

-- 'device' = auto-captured from the phone call log; 'manual' = HR logged it in-app.
ALTER TABLE public.hr_candidate_calls
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','device'));

ALTER TABLE public.hr_candidate_calls
  ADD COLUMN IF NOT EXISTS direction text
    CHECK (direction IS NULL OR direction IN ('incoming','outgoing','missed'));

-- Dedup key for the device-scan upsert: one row per (candidate, physical call
-- start). The device timestamp is deterministic per call, so re-scans never dup.
-- Manual rows (call_at = now() at log time) can't collide with a device row's
-- call-start timestamp.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_hr_candidate_call_at
  ON public.hr_candidate_calls (candidate_id, call_at);

NOTIFY pgrst, 'reload schema';

-- ── VERIFY ── expect new_cols=2, dedup_index=1
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='hr_candidate_calls'
       AND column_name IN ('source','direction'))                                    AS new_cols,
  (SELECT count(*) FROM pg_indexes
     WHERE schemaname='public' AND indexname='uniq_hr_candidate_call_at')            AS dedup_index;
