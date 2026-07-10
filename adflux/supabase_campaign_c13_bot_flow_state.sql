-- =====================================================================
-- Campaign — C13: chatbot flow RUNTIME state (Phase C)
-- 2026-07-10
--
-- The flow engine (in api/wa/webhook.js) needs to remember WHERE each
-- customer is in the published graph between messages — specifically, which
-- "buttons" node the bot is currently waiting at (so a typed/tapped reply is
-- interpreted against that node's buttons), or the sentinel '__handoff__'
-- once the flow handed the chat to a human.
--
-- ONE additive nullable column on whatsapp_conversations. NULL = not mid-flow
-- (fresh / at start). The webhook reads/writes it tolerantly, so if this SQL
-- isn't run the flow simply degrades (never "waits" at a buttons node) rather
-- than breaking — and with no PUBLISHED flow the runtime doesn't touch it at
-- all (the flat bot is unchanged). §45-safe: additive, no index, no trigger,
-- no hot-path cost.
-- =====================================================================

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS bot_node_id text;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY (expect 1) ───────────────────────────────────────────────
SELECT count(*) AS bot_node_id_col
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'whatsapp_conversations'
  AND column_name = 'bot_node_id';

SELECT 'Campaign C13 bot flow state applied' AS status;
