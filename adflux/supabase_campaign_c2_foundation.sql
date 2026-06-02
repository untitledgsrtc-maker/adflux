-- supabase_campaign_c2_foundation.sql
-- Campaign Module — Phase C2 (FOUNDATION TABLES ONLY). ADDITIVE.
--
-- HARD RULE (CLAUDE.md §45 / spec §0): does NOT touch any existing flow, file,
-- trigger, RLS policy, or hot path. NO trigger added to leads / lead_activities.
-- The only change to an existing table is ONE nullable column (leads.campaign_id)
-- read by NO existing code. Reps see no change. Idempotent (safe to re-run).
--
-- Locked contracts encoded:
--   • idempotency UNIQUE keys (webhook retry-safety): inbound_leads(provider,event),
--     whatsapp_messages(wamid), whatsapp_conversations(account,customer).
--   • whatsapp_conversations owns assigned_to (pre-lead inbox visibility).
--   • provider column on whatsapp_accounts (§4B future-proof: add/swap account = a row).
--
-- DOES NOT INCLUDE (deferred per spec): broadcasts, segments, chatbot tables,
--   message_suppression, campaign_sources, campaign_routing_rules,
--   lead_source_events, integration_errors, leads.location_code.
--
-- Run in Supabase Studio (untitled-os / staging). Run the VERIFY block at the end.

-- ═══════════════ 1. whatsapp_accounts (config — one row per number) ═══════════════
CREATE TABLE IF NOT EXISTS public.whatsapp_accounts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider              text NOT NULL DEFAULT 'cloud_api',   -- cloud_api | bsp:<name>  (§4B)
  phone_number_id       text,                                -- Meta phone_number_id (send selector)
  display_number        text,
  waba_id               text,
  quality_rating        text,
  messaging_tier        text,
  default_telecaller_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_accounts_phone_number_id
  ON public.whatsapp_accounts (phone_number_id) WHERE phone_number_id IS NOT NULL;

-- ═══════════════ 2. campaigns ═══════════════
CREATE TABLE IF NOT EXISTS public.campaigns (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL,
  source_type            text NOT NULL DEFAULT 'whatsapp',   -- meta | justdial | whatsapp | manual
  offer                  text,
  segment                text CHECK (segment IN ('PRIVATE','GOVERNMENT')) DEFAULT 'PRIVATE',  -- P0-2
  whatsapp_account_id    uuid REFERENCES public.whatsapp_accounts(id) ON DELETE SET NULL,
  auto_reply_template_id uuid,                               -- → whatsapp_templates (loose; no hard FK)
  default_telecaller_id  uuid REFERENCES public.users(id) ON DELETE SET NULL,  -- P0-2 TC-first
  is_active              boolean NOT NULL DEFAULT true,
  created_by             uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- ═══════════════ 3. campaign_locations (per-board QR) ═══════════════
CREATE TABLE IF NOT EXISTS public.campaign_locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE CASCADE,
  code        text NOT NULL,             -- e.g. RR-AHM-01 (the QR tag)
  label       text,
  city        text,
  lat         numeric(10,7),
  lng         numeric(10,7),
  qr_text     text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_locations_code
  ON public.campaign_locations (code);

-- ═══════════════ 4. whatsapp_conversations (owns assigned_to — pre-lead visibility) ═══════════════
CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_account_id uuid REFERENCES public.whatsapp_accounts(id) ON DELETE SET NULL,
  lead_id             uuid REFERENCES public.leads(id) ON DELETE SET NULL,  -- nullable: convo can predate a lead
  campaign_id         uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  customer_wa_id      text NOT NULL,
  assigned_to         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  window_expires_at   timestamptz,
  last_inbound_at     timestamptz,
  first_response_at   timestamptz,
  status              text NOT NULL DEFAULT 'open',
  bot_state           text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_conv_account_customer
  ON public.whatsapp_conversations (whatsapp_account_id, customer_wa_id);
CREATE INDEX IF NOT EXISTS idx_wa_conv_lead     ON public.whatsapp_conversations (lead_id);
CREATE INDEX IF NOT EXISTS idx_wa_conv_assigned ON public.whatsapp_conversations (assigned_to);

-- ═══════════════ 5. whatsapp_messages (wamid UNIQUE — status-retry dedupe) ═══════════════
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  wamid           text,
  direction       text NOT NULL,                 -- in | out
  type            text NOT NULL DEFAULT 'text',
  body            text,
  template_name   text,
  status          text,                          -- sent | delivered | read | failed
  error           text,
  at              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_messages_wamid
  ON public.whatsapp_messages (wamid) WHERE wamid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wa_messages_conv ON public.whatsapp_messages (conversation_id, at);

-- ═══════════════ 6. inbound_leads (staging; (provider,event) UNIQUE idempotency) ═══════════════
CREATE TABLE IF NOT EXISTS public.inbound_leads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          text NOT NULL,             -- meta | justdial | whatsapp
  external_event_id text NOT NULL,             -- leadgen_id | wamid | email msg-id
  raw_payload       jsonb,
  norm_phone        text,
  norm_name         text,
  norm_city         text,
  dedupe_phone      text,
  campaign_id       uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  location_id       uuid REFERENCES public.campaign_locations(id) ON DELETE SET NULL,
  lead_id           uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'new',  -- new | converted | duplicate | error
  received_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inbound_provider_event
  ON public.inbound_leads (provider, external_event_id);
CREATE INDEX IF NOT EXISTS idx_inbound_status       ON public.inbound_leads (status);
CREATE INDEX IF NOT EXISTS idx_inbound_dedupe_phone ON public.inbound_leads (dedupe_phone);

-- ═══════════════ 7. webhook_event_log (PII-stripped audit) ═══════════════
CREATE TABLE IF NOT EXISTS public.webhook_event_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     text NOT NULL,
  event_id     text,
  signature_ok boolean,
  http_status  int,
  note         text,        -- NO raw phone / message body here (PII minimization)
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_log_provider_at ON public.webhook_event_log (provider, at);

-- ═══════════════ 8. leads.campaign_id — ONLY change to an existing table ═══════════════
--   nullable, no default, no trigger; read by no existing code. (location_id → C8.)
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS campaign_id uuid
  REFERENCES public.campaigns(id) ON DELETE SET NULL;

-- ═══════════════ 9. extend whatsapp_templates (additive; Phase 47.1 table) ═══════════════
ALTER TABLE public.whatsapp_templates ADD COLUMN IF NOT EXISTS provider_name   text;
ALTER TABLE public.whatsapp_templates ADD COLUMN IF NOT EXISTS category        text;   -- UTILITY|MARKETING|AUTHENTICATION
ALTER TABLE public.whatsapp_templates ADD COLUMN IF NOT EXISTS language        text DEFAULT 'en';
ALTER TABLE public.whatsapp_templates ADD COLUMN IF NOT EXISTS approval_status text DEFAULT 'draft'; -- draft|pending|approved|rejected

-- ═══════════════ RLS ═══════════════
ALTER TABLE public.whatsapp_accounts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_locations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_leads          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_event_log      ENABLE ROW LEVEL SECURITY;

-- config tables: admin/co_owner write; authenticated read (a rep's lead can show campaign/number/board name)
DROP POLICY IF EXISTS wa_accounts_admin_write ON public.whatsapp_accounts;
CREATE POLICY wa_accounts_admin_write ON public.whatsapp_accounts FOR ALL
  USING (public.get_my_role() IN ('admin','co_owner')) WITH CHECK (public.get_my_role() IN ('admin','co_owner'));
DROP POLICY IF EXISTS wa_accounts_read_all ON public.whatsapp_accounts;
CREATE POLICY wa_accounts_read_all ON public.whatsapp_accounts FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS campaigns_admin_write ON public.campaigns;
CREATE POLICY campaigns_admin_write ON public.campaigns FOR ALL
  USING (public.get_my_role() IN ('admin','co_owner')) WITH CHECK (public.get_my_role() IN ('admin','co_owner'));
DROP POLICY IF EXISTS campaigns_read_all ON public.campaigns;
CREATE POLICY campaigns_read_all ON public.campaigns FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS camp_loc_admin_write ON public.campaign_locations;
CREATE POLICY camp_loc_admin_write ON public.campaign_locations FOR ALL
  USING (public.get_my_role() IN ('admin','co_owner')) WITH CHECK (public.get_my_role() IN ('admin','co_owner'));
DROP POLICY IF EXISTS camp_loc_read_all ON public.campaign_locations;
CREATE POLICY camp_loc_read_all ON public.campaign_locations FOR SELECT TO authenticated USING (true);

-- NOTE: reps get SELECT-only here. All WRITES (ingest + send) are service-role
-- (webhooks / Edge functions) which bypass RLS — so reps cannot write today, by design.
-- When rep-side reply ships (C5), ADD a FOR UPDATE/INSERT policy WITH CHECK
-- (assigned_to = auth.uid()) — do not widen these SELECT policies to ALL.
-- Owner decision 2026-06-02: a rep who can see the LEAD may read its WhatsApp thread
-- (the `OR lead_id ...` branch) — matches how they already see the lead's calls/meetings.

-- conversations: admin/co_owner all; assigned rep; OR via a lead the rep can already see
DROP POLICY IF EXISTS wa_conv_admin ON public.whatsapp_conversations;
CREATE POLICY wa_conv_admin ON public.whatsapp_conversations FOR ALL
  USING (public.get_my_role() IN ('admin','co_owner')) WITH CHECK (public.get_my_role() IN ('admin','co_owner'));
DROP POLICY IF EXISTS wa_conv_self_or_lead ON public.whatsapp_conversations;
CREATE POLICY wa_conv_self_or_lead ON public.whatsapp_conversations FOR SELECT TO authenticated
  USING (assigned_to = auth.uid()
         OR (lead_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = whatsapp_conversations.lead_id)));

-- messages: inherit visibility from the conversation (RLS chains through the subquery)
DROP POLICY IF EXISTS wa_msg_admin ON public.whatsapp_messages;
CREATE POLICY wa_msg_admin ON public.whatsapp_messages FOR ALL
  USING (public.get_my_role() IN ('admin','co_owner')) WITH CHECK (public.get_my_role() IN ('admin','co_owner'));
DROP POLICY IF EXISTS wa_msg_via_conv ON public.whatsapp_messages;
CREATE POLICY wa_msg_via_conv ON public.whatsapp_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.whatsapp_conversations c WHERE c.id = whatsapp_messages.conversation_id));

-- intake + audit: admin/co_owner only (raw PII — tightest)
DROP POLICY IF EXISTS inbound_admin ON public.inbound_leads;
CREATE POLICY inbound_admin ON public.inbound_leads FOR ALL
  USING (public.get_my_role() IN ('admin','co_owner')) WITH CHECK (public.get_my_role() IN ('admin','co_owner'));

DROP POLICY IF EXISTS webhook_log_admin ON public.webhook_event_log;
CREATE POLICY webhook_log_admin ON public.webhook_event_log FOR ALL
  USING (public.get_my_role() IN ('admin','co_owner')) WITH CHECK (public.get_my_role() IN ('admin','co_owner'));

NOTIFY pgrst, 'reload schema';

-- ═══════════════ VERIFY (run after; all counts must match) ═══════════════
-- 7 new tables:
SELECT count(*) AS new_tables FROM information_schema.tables WHERE table_schema='public'
  AND table_name IN ('whatsapp_accounts','campaigns','campaign_locations',
    'whatsapp_conversations','whatsapp_messages','inbound_leads','webhook_event_log');  -- → 7

-- leads.campaign_id present:
SELECT count(*) AS leads_campaign_id FROM information_schema.columns WHERE table_schema='public'
  AND table_name='leads' AND column_name='campaign_id';  -- → 1

-- whatsapp_templates extended (4 new cols):
SELECT count(*) AS tmpl_new_cols FROM information_schema.columns WHERE table_schema='public'
  AND table_name='whatsapp_templates' AND column_name IN ('category','approval_status','language','provider_name');  -- → 4

-- RLS enabled on the 7:
SELECT count(*) AS rls_on FROM pg_class WHERE relnamespace='public'::regnamespace
  AND relname IN ('whatsapp_accounts','campaigns','campaign_locations',
    'whatsapp_conversations','whatsapp_messages','inbound_leads','webhook_event_log')
  AND relrowsecurity = true;  -- → 7

-- idempotency keys present:
SELECT count(*) AS idem_keys FROM pg_indexes WHERE schemaname='public'
  AND indexname IN ('uq_inbound_provider_event','uq_wa_messages_wamid','uq_wa_conv_account_customer');  -- → 3

-- leads.campaign_id FK must be ON DELETE SET NULL (confdeltype 'n') — never CASCADE:
SELECT confdeltype AS campaign_id_fk_ondelete FROM pg_constraint
  WHERE conrelid='public.leads'::regclass AND confrelid='public.campaigns'::regclass;  -- → 'n'

-- CONFIRM no trigger was added to leads by THIS file (campaign module adds none):
-- (informational — lists existing leads triggers; campaign C2 must add 0 new ones)
SELECT tgname FROM pg_trigger WHERE tgrelid='public.leads'::regclass AND NOT tgisinternal ORDER BY tgname;
