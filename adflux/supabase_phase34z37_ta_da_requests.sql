-- =====================================================================
-- Phase 34Z.37 — ta_da_requests table for rep-side TA / DA claims
-- 15 May 2026
--
-- WHY
--
-- Owner directive (15 May 2026): "Both — one form, two tabs (Manual TA
-- km override / Manual DA night claim). It show him daily."
--
-- Current TA module (Phase 33H) is fully automatic: nightly job sums
-- gps_pings distance per rep per day, multiplies by city bike_per_km,
-- writes a daily_ta row. Admin approves in /admin/ta-payouts. The rep
-- has no manual surface today.
--
-- This adds a rep-submitted claim table. Two kinds:
--   • ta_override — rep claims `claim_km` for a date because GPS missed
--     a trip (low signal, phone died, etc). Admin approves → adds to
--     that day's TA total.
--   • da_night   — rep claims `claim_amount` for an out-of-station
--     overnight (hotel + food). Admin approves → adds to monthly payout.
--
-- RLS:
--   • Rep INSERT / SELECT own rows; can UPDATE only while still pending.
--   • Admin / co_owner full access (decide pending → approved/rejected).
--
-- Idempotent. Re-runnable.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.ta_da_requests (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  claim_date    date NOT NULL DEFAULT CURRENT_DATE,
  kind          text NOT NULL CHECK (kind IN ('ta_override','da_night')),
  claim_km      numeric,        -- ta_override: rep-asserted distance
  claim_amount  numeric,        -- da_night:   rep-asserted ₹ claim
  city          text,
  reason        text NOT NULL,
  receipt_url   text,           -- storage path (lead-photos bucket; reused)
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected')),
  admin_note    text,
  decided_at    timestamptz,
  decided_by    uuid REFERENCES public.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tda_requests_user_date
  ON public.ta_da_requests (user_id, claim_date DESC);
CREATE INDEX IF NOT EXISTS idx_tda_requests_status
  ON public.ta_da_requests (status)
  WHERE status = 'pending';

ALTER TABLE public.ta_da_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tda_self   ON public.ta_da_requests;
DROP POLICY IF EXISTS tda_admin  ON public.ta_da_requests;

-- Self: rep sees own rows and can INSERT new ones. UPDATE only while
-- status = 'pending' so a rep can't backdate / edit an approved claim.
CREATE POLICY tda_self ON public.ta_da_requests
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND status = 'pending');

-- Admin: full read + write across all rows.
CREATE POLICY tda_admin ON public.ta_da_requests
  FOR ALL
  USING  (public.get_my_role() IN ('admin','co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin','co_owner'));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tda_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_tda_updated_at ON public.ta_da_requests;
CREATE TRIGGER trg_tda_updated_at
  BEFORE UPDATE ON public.ta_da_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.tda_set_updated_at();

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name='ta_da_requests') AS table_exists,
  (SELECT count(*) FROM pg_policy
    WHERE polname IN ('tda_self','tda_admin'))                    AS policies_exist,
  (SELECT count(*) FROM pg_trigger
    WHERE tgname='trg_tda_updated_at')                            AS updated_trigger;
