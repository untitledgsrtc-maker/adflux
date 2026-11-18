-- Phase 619 — per-rep "uses WhatsApp Business" switch (owner 19-11-2026).
-- The APK quote-PDF share (ShareDirect.java) is hard-wired to regular WhatsApp (com.whatsapp).
-- A rep with this ON gets the phone's share sheet instead (PDF attached) so they can pick
-- WhatsApp Business. Web-only change; no APK rebuild. Admin sets it in Team > edit member.
-- ADDITIVE: one boolean column, default false (nothing changes for anyone until switched on).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS wa_business boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.users.wa_business IS 'Phase 619: quote PDF share opens the share sheet (pick WhatsApp Business) instead of regular WhatsApp directly';

NOTIFY pgrst, 'reload schema';

-- VERIFY: column present, nobody switched on yet
SELECT count(*) FILTER (WHERE wa_business) AS on_count, count(*) AS total FROM public.users;
