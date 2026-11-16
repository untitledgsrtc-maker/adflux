-- =====================================================================
-- Phase 580 — partner share payouts (Rev split tab) (17 Nov 2026)
-- =====================================================================
-- Owner: record whether Vishal's share (default 35%) was paid. Each payout row
-- stores the date, amount, how it was paid, a note, the share % used, and the
-- WON deals it settles (quote_ids = the deals ticked on Rev split when it was
-- recorded). Rev split then marks those deals "Settled" and warns before the
-- same deal is paid twice.
-- Access: admin only. Rev split is hidden from co_owner and accounts (Phase 537);
-- Vishal (co_owner) does not see this table.
-- No update path: a wrong entry is deleted and entered again (keeps it simple
-- and leaves no silent edits).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.partner_payouts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner    text NOT NULL DEFAULT 'vishal' CHECK (partner IN ('vishal')),
  paid_on    date NOT NULL,
  amount     numeric(14,2) NOT NULL CHECK (amount > 0),
  method     text CHECK (method IN ('bank','upi','cash','cheque')),
  note       text,
  share_pct  numeric(5,2),
  quote_ids  uuid[] NOT NULL DEFAULT '{}',
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partner_payouts_paid_on ON public.partner_payouts (paid_on DESC);

ALTER TABLE public.partner_payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS partner_payouts_admin_select ON public.partner_payouts;
CREATE POLICY partner_payouts_admin_select ON public.partner_payouts FOR SELECT
  USING (COALESCE((SELECT get_my_role()) = 'admin', false));
DROP POLICY IF EXISTS partner_payouts_admin_insert ON public.partner_payouts;
CREATE POLICY partner_payouts_admin_insert ON public.partner_payouts FOR INSERT
  WITH CHECK (COALESCE((SELECT get_my_role()) = 'admin', false));
DROP POLICY IF EXISTS partner_payouts_admin_delete ON public.partner_payouts;
CREATE POLICY partner_payouts_admin_delete ON public.partner_payouts FOR DELETE
  USING (COALESCE((SELECT get_my_role()) = 'admin', false));
REVOKE ALL ON public.partner_payouts FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.partner_payouts TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY: table, RLS on, 3 admin policies, no UPDATE grant.
SELECT
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'partner_payouts') AS rls_on,
  (SELECT count(*) FROM pg_policies WHERE tablename = 'partner_payouts') AS policies,
  has_table_privilege('authenticated', 'public.partner_payouts', 'update') AS auth_update,
  has_table_privilege('anon', 'public.partner_payouts', 'select') AS anon_select;
