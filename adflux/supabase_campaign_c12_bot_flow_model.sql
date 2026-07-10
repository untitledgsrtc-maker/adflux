-- =====================================================================
-- Campaign — C12: chatbot FLOW MODEL (real branching bot builder, Phase A)
-- 2026-07-10
--
-- Owner directive 10 Jul 2026: build the REAL branching bot builder to match
-- _design_reference/campaign_module_mockup.html — draggable typed nodes,
-- connectable ports, buttons that wire to action nodes, Test + Publish.
-- This is Phase A: the storage model only. Phases B (canvas), C (runtime
-- engine in the webhook), D (Test/Publish) follow.
--
-- ONE flow per campaign number (whatsapp_account). The whole graph is stored
-- as JSON in react-flow's own {nodes,edges} shape, so the builder can
-- load/save it verbatim. Two copies:
--   • draft_flow     — what the admin edits in the builder.
--   • published_flow — the LIVE graph the runtime (Phase C) will read. NULL
--                      until the first Publish (Phase D). Until then the
--                      existing flat bot (campaign_bot_rules + auto_reply_*)
--                      keeps running unchanged — this table is inert.
--
-- §45-safe: ONE new additive table, admin-only, ZERO change to the live
-- webhook / bot runtime / any rep-facing flow. Nothing reads published_flow
-- yet (Phase C wires it). The existing greeting/keywords/buttons are NOT
-- touched or dropped — Phase B seeds the draft graph FROM them (JS) so
-- nothing is lost, and they remain the live source until Publish.
--
-- ─── GRAPH CONTRACT (draft_flow / published_flow shape) ───────────────
-- Phases B (builder) and C (runtime) BOTH depend on this exact shape:
--
--   {
--     "nodes": [
--       { "id": "<uuid>", "type": "<node type>",
--         "position": { "x": <num>, "y": <num> },
--         "data": { ...type-specific (below)... } }
--     ],
--     "edges": [
--       { "id": "<uuid>", "source": "<node id>",
--         "sourceHandle": "<port id or null>", "target": "<node id>" }
--     ]
--   }
--
-- Node types + their data (v1):
--   start    — entry. Fires on first inbound / QR scan. data: {}
--   message  — data: { text, media_url, media_type }   (media_type: image|video|document|null)
--   buttons  — data: { text, media_url, media_type, buttons: [{ label }] }
--              Each button i is an OUTPUT PORT; its edge uses sourceHandle "btn_<i>".
--              (WhatsApp: 1-3 buttons -> tap buttons; 4-10 -> list. Media rides
--               as a header only for <=3; for a list the runtime sends media as
--               a separate message first — see Phase C / the image-attach fix.)
--   keyword  — data: { keywords: [text, ...] }  match -> the single out-edge's target
--   action   — data: { kind: 'send_media'|'create_lead'|'handoff', text, media_url, media_type }
--   handoff  — stop the bot, hand to a telecaller. data: {}
--
-- Edge sourceHandle: null for single-output nodes (message/keyword/action),
--   "btn_<i>" for a buttons node's i-th button.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.campaign_bot_flows (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES public.whatsapp_accounts(id) ON DELETE CASCADE,
  draft_flow     jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,  -- edited in the builder
  published_flow jsonb,                                                     -- live graph (Phase C reads); NULL until first Publish
  is_published   boolean NOT NULL DEFAULT false,
  published_at   timestamptz,
  published_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id)
);

-- Admin / co_owner only (matches campaign_bot_rules). The Phase C runtime
-- reads published_flow via the SERVICE ROLE in the webhook, which bypasses
-- RLS — so no separate read policy is needed for the bot itself.
ALTER TABLE public.campaign_bot_flows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bot_flows_admin_all ON public.campaign_bot_flows;
CREATE POLICY bot_flows_admin_all ON public.campaign_bot_flows
  FOR ALL USING (public.get_my_role() IN ('admin', 'co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin', 'co_owner'));

-- Keep updated_at fresh on edit (reuse the standard touch trigger if present;
-- otherwise a tiny inline one — idempotent).
CREATE OR REPLACE FUNCTION public.tg_campaign_bot_flows_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_campaign_bot_flows_touch ON public.campaign_bot_flows;
CREATE TRIGGER trg_campaign_bot_flows_touch
  BEFORE UPDATE ON public.campaign_bot_flows
  FOR EACH ROW EXECUTE FUNCTION public.tg_campaign_bot_flows_touch();

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema='public' AND table_name='campaign_bot_flows')                       AS flow_table,   -- 1
  (SELECT count(*) FROM pg_policies
     WHERE schemaname='public' AND tablename='campaign_bot_flows')                          AS rls_policies, -- 1
  (SELECT count(*) FROM pg_trigger
     WHERE tgname='trg_campaign_bot_flows_touch' AND NOT tgisinternal)                      AS touch_trg;    -- 1

SELECT 'Campaign C12 bot flow model applied' AS status;
