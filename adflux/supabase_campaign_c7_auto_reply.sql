-- =====================================================================
-- Campaign C7 — auto-reply config (instant ack when a new lead messages)
-- 2026-06-09
--
-- When a customer messages the campaign number for the FIRST time (a new
-- conversation), the webhook sends ONE free-form reply — allowed + free
-- because their inbound just opened the 24h service window (no template, no
-- payment). These two columns hold the per-number message + on/off switch.
--
-- SAFE (§45): additive columns on a NEW campaign table. The webhook reads them
-- via select('*') (tolerant if unrun) + only sends when auto_reply_enabled is
-- true — so nothing fires until this runs. Idempotent (ADD COLUMN IF NOT EXISTS).
--
-- Edit the wording anytime:
--   UPDATE public.whatsapp_accounts SET auto_reply_text = '<your text>'
--    WHERE phone_number_id = '122102627516008558';
-- Turn it off:
--   UPDATE public.whatsapp_accounts SET auto_reply_enabled = false WHERE ...;
-- =====================================================================

ALTER TABLE public.whatsapp_accounts ADD COLUMN IF NOT EXISTS auto_reply_text    text;
ALTER TABLE public.whatsapp_accounts ADD COLUMN IF NOT EXISTS auto_reply_enabled boolean NOT NULL DEFAULT false;

-- Turn it on for the live campaign number(s) with a default message — ONLY for
-- numbers not yet configured (blank text). A re-run won't clobber your wording
-- OR flip a number you deliberately turned off back on (both are preserved
-- once a text is set).
UPDATE public.whatsapp_accounts
   SET auto_reply_text = 'Thanks for reaching out to Untitled Advertising. Our team will call you shortly.',
       auto_reply_enabled = true
 WHERE is_active = true AND phone_number_id IS NOT NULL
   AND (auto_reply_text IS NULL OR auto_reply_text = '');

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY — active numbers now carry the message + switch ───────────
SELECT phone_number_id, display_number, auto_reply_enabled,
       left(COALESCE(auto_reply_text, ''), 48) AS auto_reply_preview
  FROM public.whatsapp_accounts
 WHERE is_active = true
 ORDER BY created_at;

SELECT 'Campaign C7 auto-reply config applied' AS status;
