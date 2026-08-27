-- supabase_ops_p3_ticket_calls.sql
-- OPERATIONS — link a fix-it call to its ticket so an ops call records "like a
-- sales call" but attaches to the ticket (spec 2026-08-27-ops-exec-ticket-dashboard).
-- ONE additive nullable column on call_logs. Sales rows keep it NULL → zero impact
-- on the sales call flow, the §92 STOP-rule, or the §170/§173 dedup. Idempotent.
-- Owner runs in Studio.

ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS ops_ticket_id uuid
  REFERENCES public.ops_tickets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_call_logs_ops_ticket
  ON public.call_logs (ops_ticket_id) WHERE ops_ticket_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ==== VERIFY (run in Studio after the file) =================================
-- Expect: has_col = 1, has_index = 1.
-- SELECT
--   (SELECT count(*) FROM information_schema.columns
--      WHERE table_schema='public' AND table_name='call_logs' AND column_name='ops_ticket_id') AS has_col,
--   (SELECT count(*) FROM pg_indexes
--      WHERE schemaname='public' AND indexname='idx_call_logs_ops_ticket') AS has_index;
