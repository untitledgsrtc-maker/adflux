-- =====================================================================
-- FINANCE MODULE — Phase 1: foundation (tables + RLS + seeds)
-- 2026-08-03 · spec: docs/FINANCE_MODULE_SPEC.md
--
-- ADDITIVE ONLY (§45): brand-new finance_* tables. Touches NOTHING in the live
-- sales/leads/quotes/payroll flow. Safe to run on the live DB.
-- RLS follows the §42/§152/§153 doctrine: admin + accounts = full; co_owner
-- (Vishal, government_partner) = GOVERNMENT-segment READ only on transactions,
-- NOTHING on the org-wide config tables; reps/agency/telecaller/hr = none.
-- Idempotent (§8): IF NOT EXISTS / DROP POLICY IF EXISTS / ON CONFLICT DO NOTHING.
-- Run this ONE file; the VERIFY block at the bottom proves it.
-- =====================================================================

-- ==== part 1/8 · expense heads master ====
CREATE TABLE IF NOT EXISTS public.finance_expense_heads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text UNIQUE NOT NULL,
  kind          text NOT NULL DEFAULT 'operating',   -- operating | tax | other
  display_order int  NOT NULL DEFAULT 100,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.finance_expense_heads (name, kind, display_order) VALUES
  ('Staff Salaries & Benefits','operating',10),
  ('Vendor Payment','operating',20),
  ('Marketing & Promotion','operating',30),
  ('Rent & Utilities','operating',40),
  ('Travel & Conveyance','operating',50),
  ('Vehicle Expense','operating',55),
  ('Refreshments','operating',60),
  ('Office Expense','operating',65),
  ('Labour charges','operating',70),
  ('Duties & Taxes','tax',80),
  ('Other','operating',999)
ON CONFLICT (name) DO NOTHING;

-- ==== part 2/8 · bank accounts ====
CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text UNIQUE NOT NULL,           -- Adflux / HDFC / Cosmos / Axis
  bank               text,
  account_no_masked  text,
  default_company    text,                            -- default entity for this account
  segment_hint       text,                            -- GOVERNMENT | PRIVATE | null
  display_order      int NOT NULL DEFAULT 100,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.bank_accounts (name, bank, default_company, segment_hint, display_order) VALUES
  ('Adflux','Adflux (Untitled Adflux Pvt Ltd)','Untitled Adflux Pvt Ltd','PRIVATE',10),
  ('HDFC','HDFC Bank','Untitled Advertising',NULL,20),
  ('Cosmos','Cosmos Bank','Untitled Advertising',NULL,30),
  ('Axis','Axis Bank','Untitled Advertising',NULL,40)
ON CONFLICT (name) DO NOTHING;

-- ==== part 3/8 · import batches (audit) ====
CREATE TABLE IF NOT EXISTS public.finance_import_batches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id  uuid REFERENCES public.bank_accounts(id),
  filename         text,
  period           text,
  row_count        int  NOT NULL DEFAULT 0,
  dup_skipped      int  NOT NULL DEFAULT 0,
  imported_by      uuid,
  imported_at      timestamptz NOT NULL DEFAULT now()
);

-- ==== part 4/8 · transactions (core) ====
CREATE TABLE IF NOT EXISTS public.finance_transactions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id    uuid NOT NULL REFERENCES public.bank_accounts(id),
  txn_date           date NOT NULL,
  ref_no             text,
  description        text,
  amount             numeric(14,2) NOT NULL,
  direction          text NOT NULL CHECK (direction IN ('in','out')),
  bucket             text NOT NULL DEFAULT 'review' CHECK (bucket IN
                       ('income','direct_cost','common_expense','owner_drawings',
                        'investment','asset','loan_in','loan_out','internal_transfer',
                        'tax','review')),
  company            text CHECK (company IS NULL OR company IN
                       ('Untitled Advertising','Untitled Adflux Pvt Ltd','Trade Venture')),
  segment            text CHECK (segment IS NULL OR segment IN ('GOVERNMENT','PRIVATE')),
  media_type         text,                              -- reuses §4 axis (AUTO_HOOD/GSRTC_LED/…)
  expense_head_id    uuid REFERENCES public.finance_expense_heads(id),
  matched_payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,  -- reconcile
  raw_tag            text,                              -- accountant's original tag, preserved
  source             text NOT NULL DEFAULT 'import',    -- import | manual
  import_batch_id    uuid REFERENCES public.finance_import_batches(id),
  dedupe_key         text UNIQUE NOT NULL,              -- bank||date||ref||amount → blocks re-import dupes
  note               text,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_finance_txn_date    ON public.finance_transactions (txn_date);
CREATE INDEX IF NOT EXISTS idx_finance_txn_bucket  ON public.finance_transactions (bucket);
CREATE INDEX IF NOT EXISTS idx_finance_txn_segment ON public.finance_transactions (segment);
CREATE INDEX IF NOT EXISTS idx_finance_txn_bank    ON public.finance_transactions (bank_account_id);

-- ==== part 5/8 · auto-tag rules ====
CREATE TABLE IF NOT EXISTS public.finance_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  priority    int NOT NULL DEFAULT 100,
  match_type  text NOT NULL DEFAULT 'contains' CHECK (match_type IN ('contains','regex')),
  pattern     text NOT NULL,
  set_bucket  text,
  set_company text,
  set_segment text,
  set_head    text,                                    -- resolved to head id at apply time
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pattern)
);
INSERT INTO public.finance_rules (priority, pattern, set_bucket, set_head) VALUES
  (10,'SALARY','common_expense','Staff Salaries & Benefits'),
  (10,'FACEBOOK','common_expense','Marketing & Promotion'),
  (10,'GOOGLE','common_expense','Marketing & Promotion'),
  (20,'TORRENT POWER','direct_cost','Rent & Utilities'),
  (20,'EMI','owner_drawings',NULL),
  (30,'SWEEP','internal_transfer',NULL)
ON CONFLICT (pattern) DO NOTHING;
INSERT INTO public.finance_rules (priority, pattern, set_bucket, set_segment) VALUES
  (15,'G S R T C','direct_cost','GOVERNMENT'),
  (15,'GSRTC','direct_cost','GOVERNMENT')
ON CONFLICT (pattern) DO NOTHING;

-- ==== part 6/8 · accounts tasks / reminders ====
CREATE TABLE IF NOT EXISTS public.finance_tasks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text UNIQUE NOT NULL,
  frequency        text NOT NULL DEFAULT 'oneoff' CHECK (frequency IN ('daily','weekly','monthly','oneoff')),
  next_due         date,
  reminder_channel text NOT NULL DEFAULT 'push' CHECK (reminder_channel IN ('push','push_wa')),
  status           text NOT NULL DEFAULT 'open',
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.finance_tasks (title, frequency, reminder_channel) VALUES
  ('Approve pending payments','daily','push'),
  ('Import bank statement','weekly','push'),
  ('Tag REVIEW entries','weekly','push'),
  ('Send outstanding reminders','weekly','push'),
  ('Run payroll','monthly','push_wa'),
  ('Pay TDS','monthly','push_wa'),
  ('File GSTR-1','monthly','push'),
  ('File GSTR-3B','monthly','push'),
  ('Pay vendor dues','monthly','push')
ON CONFLICT (title) DO NOTHING;

-- ==== part 7/8 · grants + RLS (admin + accounts full; Vishal govt-read on txns only) ====
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['finance_expense_heads','bank_accounts','finance_import_batches',
                           'finance_transactions','finance_rules','finance_tasks'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated;', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    -- admin + accounts full
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t||'_admin_accounts', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR ALL
                      USING (public.get_my_role() = ANY (ARRAY['admin','accounts']));$p$,
                   t||'_admin_accounts', t);
  END LOOP;
END $$;

-- Vishal (government_partner co_owner) — GOVERNMENT-segment READ on transactions ONLY
DROP POLICY IF EXISTS finance_txn_govt_partner_read ON public.finance_transactions;
CREATE POLICY finance_txn_govt_partner_read ON public.finance_transactions FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.users u
             WHERE u.id = auth.uid() AND u.team_role = 'government_partner')
    AND segment = 'GOVERNMENT'
  );

NOTIFY pgrst, 'reload schema';

-- ==== part 8/8 · VERIFY ====
-- Expect: 6 finance/bank tables present; seeds loaded; RLS enabled on all 6;
-- finance_transactions has the admin_accounts policy + the govt_partner_read policy.
SELECT 'tables' AS check,
       (SELECT count(*) FROM information_schema.tables
         WHERE table_schema='public'
           AND table_name IN ('finance_expense_heads','bank_accounts','finance_import_batches',
                              'finance_transactions','finance_rules','finance_tasks')) AS n_expect_6
UNION ALL SELECT 'expense_heads_seed', (SELECT count(*) FROM public.finance_expense_heads)
UNION ALL SELECT 'bank_accounts_seed', (SELECT count(*) FROM public.bank_accounts)
UNION ALL SELECT 'rules_seed',         (SELECT count(*) FROM public.finance_rules)
UNION ALL SELECT 'tasks_seed',         (SELECT count(*) FROM public.finance_tasks)
UNION ALL SELECT 'rls_enabled',
       (SELECT count(*) FROM pg_tables
         WHERE schemaname='public' AND rowsecurity=true
           AND tablename IN ('finance_expense_heads','bank_accounts','finance_import_batches',
                            'finance_transactions','finance_rules','finance_tasks'));
-- And the transactions policies (expect finance_transactions_admin_accounts + finance_txn_govt_partner_read):
SELECT policyname, cmd FROM pg_policies
 WHERE schemaname='public' AND tablename='finance_transactions' ORDER BY policyname;
