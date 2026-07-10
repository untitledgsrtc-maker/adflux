-- =====================================================================
-- Campaign — C14: MULTIPLE named chatbot flows per number (Phase E)
-- 2026-07-10
--
-- Owner directive 10 Jul: more than one chatbot on the same WhatsApp number,
-- switched by publishing whichever should be live. A WhatsApp number can only
-- run ONE bot at a time, so: many named DRAFT flows, exactly ONE published
-- (Live) per number. The builder picks which draft to edit; Publish makes one
-- Live (and un-publishes the others).
--
-- Changes campaign_bot_flows (C12) from one-row-per-account to many:
--   • + name (default 'Main' — the existing seeded flow keeps working).
--   • drop the UNIQUE(account_id) so a number can have several flows.
--   • UNIQUE(account_id, name) — names are unique per number.
--   • partial UNIQUE(account_id) WHERE is_published — at most ONE Live flow
--     per number (the runtime reads exactly this one).
--
-- §45-safe: the table is new (C12, only the owner's one seeded 'Main' row),
-- so this migration touches almost no data. The runtime still runs ONLY the
-- published flow (dormant until Publish) — unchanged safety. Ships together
-- with the matching webhook getFlow (reads is_published=true) + builder
-- (flow picker); all three must be deployed as one.
-- =====================================================================

ALTER TABLE public.campaign_bot_flows
  ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT 'Main';

-- Drop the single-flow-per-account UNIQUE (inline constraint auto-named
-- <table>_account_id_key) so a number can hold several flows.
ALTER TABLE public.campaign_bot_flows
  DROP CONSTRAINT IF EXISTS campaign_bot_flows_account_id_key;

-- Names unique per number.
CREATE UNIQUE INDEX IF NOT EXISTS campaign_bot_flows_account_name_uk
  ON public.campaign_bot_flows (account_id, name);

-- At most ONE Live (published) flow per number — the one the runtime runs.
CREATE UNIQUE INDEX IF NOT EXISTS campaign_bot_flows_one_published
  ON public.campaign_bot_flows (account_id) WHERE is_published;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='campaign_bot_flows' AND column_name='name')       AS name_col,        -- 1
  (SELECT count(*) FROM pg_constraint
     WHERE conname='campaign_bot_flows_account_id_key')                                            AS old_unique_gone, -- 0
  (SELECT count(*) FROM pg_indexes
     WHERE schemaname='public' AND indexname='campaign_bot_flows_account_name_uk')                 AS name_uk,         -- 1
  (SELECT count(*) FROM pg_indexes
     WHERE schemaname='public' AND indexname='campaign_bot_flows_one_published')                   AS one_published;   -- 1

SELECT 'Campaign C14 multi-flow applied' AS status;
