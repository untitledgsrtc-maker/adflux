-- =====================================================================
-- PHASE 142 — leads.segment (Private / Government tagging)
-- 2026-06-12
--
-- Owner wants the All/Private/Government toggle on the Leads page +
-- pipeline, not just Quotes. Leads had NO segment field, so this adds
-- one + backfills the existing leads so the toggle has data on day one.
--
-- §45-safe:
--   • ADD COLUMN ... text  with NO default → metadata-only, INSTANT, no
--     table rewrite, no lock on the hot leads table.
--   • Nullable → no existing code reads/writes it until Batch B ships;
--     every current query is byte-unaffected.
--   • The backfill is a ONE-TIME UPDATE (not a trigger) — no hot-path
--     latency. Re-running is a no-op (only fills WHERE segment IS NULL).
--   • No RLS change (existing leads RLS already covers the new column).
-- =====================================================================


-- ─── 1. additive nullable column + gu/govt CHECK ────────────────────
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS segment text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_segment_check') THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_segment_check
      CHECK (segment IS NULL OR segment IN ('GOVERNMENT', 'PRIVATE'));
  END IF;
END $$;


-- ─── 2. Backfill #1 — from the lead's most-recent quote (real deal) ──
-- A lead that already produced a quote inherits that quote's segment.
-- DISTINCT ON picks the newest quote per lead.
UPDATE public.leads l
   SET segment = q.segment
  FROM (
    SELECT DISTINCT ON (lead_id) lead_id, segment
      FROM public.quotes
     WHERE lead_id IS NOT NULL AND segment IS NOT NULL
     ORDER BY lead_id, updated_at DESC
  ) q
 WHERE q.lead_id = l.id
   AND l.segment IS NULL;


-- ─── 3. Backfill #2 — infer from the owning rep's segment_access ─────
-- For still-untagged leads, use the assigned rep's / telecaller's
-- segment_access when it's a specific segment (the 5 existing private
-- reps are segment_access='PRIVATE', so their leads tag PRIVATE; future
-- govt hires tag GOVERNMENT). Owner = assigned_to OR telecaller_id
-- (Phase 137 dual-owner rule). ALL-access owners leave the lead NULL.
UPDATE public.leads l
   SET segment = u.segment_access
  FROM public.users u
 WHERE l.segment IS NULL
   AND u.id = COALESCE(l.assigned_to, l.telecaller_id)
   AND u.segment_access IN ('PRIVATE', 'GOVERNMENT');

-- Anything still NULL = genuinely untagged (no quote, ALL-access owner).
-- It shows under "All" only; the rep tags it on next edit (Batch B).


-- self-register
DO $$
BEGIN
  IF to_regclass('public.applied_migrations') IS NOT NULL THEN
    INSERT INTO public.applied_migrations (name, note)
    VALUES ('supabase_phase142_leads_segment.sql',
            'leads.segment (Private/Government) additive column + backfill from quotes then rep segment_access')
    ON CONFLICT (name) DO NOTHING;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';


-- ─── VERIFY — expect col=1, and a sensible Private/Govt/untagged split
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name='leads' AND column_name='segment')   AS col_present,
  (SELECT count(*) FROM public.leads WHERE segment='PRIVATE')    AS private_leads,
  (SELECT count(*) FROM public.leads WHERE segment='GOVERNMENT') AS govt_leads,
  (SELECT count(*) FROM public.leads WHERE segment IS NULL)      AS untagged_leads;

SELECT 'Phase 142 leads.segment applied' AS status;
