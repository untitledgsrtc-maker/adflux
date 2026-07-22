-- supabase_phase253_wa_error_detail.sql — run NOW (safe any time)
--
-- Phase 253 — keep Meta's failure REASON on a failed WhatsApp send.
-- The status webhook already flips whatsapp_messages.status to 'failed'
-- (§55) but Meta's errors[] payload (code · title · message) was thrown
-- away, so "why did it fail" needed guesswork (3 fails on 22 Jul — likely
-- numbers not on WhatsApp, but unprovable). The webhook now writes the
-- reason here via a tolerant, separate update: before this column exists
-- that update just no-ops — the tick pipeline is untouched (§45).

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS error_detail text;

COMMENT ON COLUMN public.whatsapp_messages.error_detail IS
  'Meta failure reason (code · title · message) captured by the status '
  'webhook when a send fails. Display-only; shown on the inbox bubble.';

NOTIFY pgrst, 'reload schema';

-- VERIFY — expect 1 row:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'whatsapp_messages' AND column_name = 'error_detail';
