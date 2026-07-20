-- supabase_campaign_marketing_number.sql
--
-- Phase A (campaign marketing) — register the MARKETING number (98982 73686,
-- WABA 2870129030006085) + mark accounts by purpose so the app knows which
-- number is the inbox (service) and which is the outbound marketing channel.
--
-- 2026-07-20 MIGRATION: 98982 73686 was moved OFF WABA 4261024264172185
-- (Cronberry / Jio Things Limited credit line) ONTO WABA 2870129030006085,
-- which bills to the owner's own card. Old WABA now reads "Transferred".
-- phone_number_id CHANGED 864573796748171 → 1209093615625212. Do NOT use the
-- old ids anywhere.
--
--   • 95815 78261 (current)  → purpose='service'  (the live 2-way inbox, §54)
--   • 98982 73686 (new)      → purpose='marketing' (templates / broadcast)
--
-- api/wa/send-template.js sends from the purpose='marketing' account's
-- phone_number_id. Additive, idempotent, §45-safe (new column defaults 'service'
-- so nothing existing changes behavior).

ALTER TABLE public.whatsapp_accounts ADD COLUMN IF NOT EXISTS purpose text DEFAULT 'service';
COMMENT ON COLUMN public.whatsapp_accounts.purpose IS
  'service = inbox / 2-way conversations · marketing = outbound templates + broadcast';

-- phone_number_id 1209093615625212 = the 98982 73686 registration on WABA
-- 2870129030006085 (verified Connected · High in WhatsApp Manager, 20 Jul 2026).
INSERT INTO public.whatsapp_accounts (provider, phone_number_id, display_number, waba_id, purpose)
VALUES ('cloud_api', '1209093615625212', '919898273686', '2870129030006085', 'marketing')
ON CONFLICT (phone_number_id) WHERE phone_number_id IS NOT NULL
  DO UPDATE SET purpose = 'marketing',
                waba_id = EXCLUDED.waba_id,
                display_number = EXCLUDED.display_number;

-- Keep the existing inbox number tagged as service (harmless if already set).
UPDATE public.whatsapp_accounts SET purpose = 'service'
 WHERE display_number IN ('919581578261', '95815 78261') AND (purpose IS NULL OR purpose = 'service');

NOTIFY pgrst, 'reload schema';

-- VERIFY — both accounts + their purpose:
--   SELECT display_number, phone_number_id, waba_id, purpose FROM public.whatsapp_accounts ORDER BY purpose;
--   → expect one 'marketing' (98982 73686, with a phone_number_id) + one 'service' (95815 78261).
