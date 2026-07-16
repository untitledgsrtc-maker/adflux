-- supabase_phase240_email_footers.sql
--
-- Phase 240 — per-rep email SIGNATURE banner + kirti's real reply inbox.
--
-- 1. users.email_footer_url — each rep's signature PNG (photo + name + title +
--    mobile + email), hosted at app.untitledad.in/email-footers/<slug>.png
--    (committed in public/email-footers/). api/email/send.js appends it as an
--    <img> to every quote/offer email, tied to the AUTHENTICATED sender.
-- 2. kirti's contact_email (the reply-to/BCC real Gmail) — was missing from the
--    §102 mapping.
--
-- Additive, idempotent, §45-safe: one new nullable column no existing code
-- reads/writes + data. Reps matched by name (ILIKE) — the VERIFY block lists
-- every match so a mis-spelled name is caught.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email_footer_url text;

COMMENT ON COLUMN public.users.email_footer_url IS
  'Per-rep email signature banner PNG (app.untitledad.in/email-footers/<slug>.png). Appended to app-sent emails by the sender.';

UPDATE public.users SET email_footer_url = 'https://app.untitledad.in/email-footers/mayur.png'  WHERE name ILIKE '%mayur%';
UPDATE public.users SET email_footer_url = 'https://app.untitledad.in/email-footers/viral.png'  WHERE name ILIKE '%viral%';
UPDATE public.users SET email_footer_url = 'https://app.untitledad.in/email-footers/avkash.png' WHERE name ILIKE '%avkash%';
UPDATE public.users SET email_footer_url = 'https://app.untitledad.in/email-footers/kirti.png'  WHERE name ILIKE '%kirti%';
UPDATE public.users SET email_footer_url = 'https://app.untitledad.in/email-footers/dipak.png'  WHERE name ILIKE '%dipak%';
UPDATE public.users SET email_footer_url = 'https://app.untitledad.in/email-footers/jayna.png'  WHERE name ILIKE '%jayna%';
UPDATE public.users SET email_footer_url = 'https://app.untitledad.in/email-footers/rima.png'   WHERE name ILIKE '%rima%';
UPDATE public.users SET email_footer_url = 'https://app.untitledad.in/email-footers/dhara.png'  WHERE name ILIKE '%dhara%';
UPDATE public.users SET email_footer_url = 'https://app.untitledad.in/email-footers/riya.png'   WHERE name ILIKE '%riya%';
UPDATE public.users SET email_footer_url = 'https://app.untitledad.in/email-footers/kamina.png' WHERE name ILIKE '%kamina%';
UPDATE public.users SET email_footer_url = 'https://app.untitledad.in/email-footers/diya.png'   WHERE name ILIKE '%diya%';

-- kirti's reply/BCC real Gmail (§102 mapping — she was missing).
UPDATE public.users SET contact_email = 'untitledadvertisinggandhinagar@gmail.com' WHERE lower(email) = 'kirti@untitledad.in';

NOTIFY pgrst, 'reload schema';

-- VERIFY — who got a footer (11 expected) + confirm the right person matched:
--   SELECT name, email, email_footer_url FROM public.users WHERE email_footer_url IS NOT NULL ORDER BY email_footer_url;
-- VERIFY kirti's inbox:
--   SELECT name, email, contact_email FROM public.users WHERE lower(email) = 'kirti@untitledad.in';
