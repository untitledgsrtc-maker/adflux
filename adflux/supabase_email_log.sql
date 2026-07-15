-- =====================================================================
-- Phase 235 — email_log (Resend send audit)  ·  CLAUDE.md §99
--
-- WHAT
--   One row per email the app sends via Resend (api/email/send.js): HR offer
--   emails + client quote emails. Additive table, read-only from the app; the
--   send endpoint INSERTs via the SERVICE ROLE (bypasses RLS). No live-table
--   touch, no trigger, no hot-path cost (§45).
--
-- RLS
--   • admin / co_owner / hr / accounts read ALL.
--   • the sender reads their OWN rows (sent_by = auth.uid()).
--   • INSERT is service-role only (the Edge fn) — no authenticated INSERT policy,
--     so a rep cannot forge log rows.
--
-- Idempotent (§8): CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS + NOTIFY.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.email_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sent_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  to_email    text NOT NULL,
  subject     text,
  kind        text,               -- 'offer' | 'quote'
  related_id  text,               -- quote_id / user_id / lead_id (free-form)
  resend_id   text,               -- Resend message id
  status      text NOT NULL DEFAULT 'sent',   -- 'sent' | 'failed'
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_log_sent_by_idx  ON public.email_log (sent_by, created_at DESC);
CREATE INDEX IF NOT EXISTS email_log_related_idx  ON public.email_log (related_id);

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

-- admin / co_owner / hr / accounts read all
DROP POLICY IF EXISTS email_log_admin_read ON public.email_log;
CREATE POLICY email_log_admin_read ON public.email_log
  FOR SELECT
  USING (public.get_my_role() IN ('admin', 'co_owner', 'hr', 'accounts'));

-- sender reads their own
DROP POLICY IF EXISTS email_log_self_read ON public.email_log;
CREATE POLICY email_log_self_read ON public.email_log
  FOR SELECT
  USING (sent_by = auth.uid());

-- No INSERT/UPDATE/DELETE policy → only the service role (the send endpoint)
-- can write. Reps cannot forge or alter log rows.

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.tables
    WHERE table_name = 'email_log')                                   AS table_present,   -- 1
  (SELECT count(*) FROM pg_policies
    WHERE tablename = 'email_log')                                    AS policy_count;     -- 2

SELECT 'email_log ready' AS status;
