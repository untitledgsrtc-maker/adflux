-- supabase_users_contact_email.sql
-- Phase 235.1 — per-rep REAL reply/BCC inbox for app-sent email (CLAUDE.md §101 / §99).
--
-- WHY: the app sends client quotes from quotes@untitledad.in and HR offers from
-- hr@untitledad.in. Those @untitledad.in from-addresses are SEND-ONLY aliases —
-- so are the reps' own @untitledad.in LOGINS (they are not real mailboxes). A
-- reply-to or a copy sent to a login address would bounce. This maps each rep's
-- login to their REAL Gmail; api/email/send.js reads it (by the caller's uid) for
-- reply-to + BCC, so a client Reply and the rep's own copy actually arrive.
--
-- Additive, idempotent, §45-safe: one new nullable column NO existing code
-- reads/writes + a data seed. No live-flow / hot-path / RLS touch.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS contact_email text;

COMMENT ON COLUMN public.users.contact_email IS
  'Real deliverable inbox (e.g. Gmail) for reply-to + BCC on app-sent email. The @untitledad.in login is a send-only alias.';

-- Seed the reps the owner shared (match the login case-insensitively).
UPDATE public.users SET contact_email = 'untitledadvertising1@gmail.com' WHERE lower(email) = 'dhara@untitledad.in';
UPDATE public.users SET contact_email = 'mayur.salesuntitled@gmail.com'  WHERE lower(email) = 'mayur@untitledad.in';
UPDATE public.users SET contact_email = 'untitled.ad2@gmail.com'         WHERE lower(email) = 'rima@untitledad.in';
UPDATE public.users SET contact_email = 'untitleddesigning@gmail.com'    WHERE lower(email) = 'dixita@untitledad.in';
UPDATE public.users SET contact_email = 'hr.untitledad@gmail.com'        WHERE lower(email) IN ('riya@untitledad.in', 'hr@untitledad.in');

NOTIFY pgrst, 'reload schema';

-- VERIFY 1 — who now has a real reply inbox (expect 6 logins → 5 distinct inboxes):
-- SELECT name, email, contact_email FROM public.users WHERE contact_email IS NOT NULL ORDER BY email;

-- VERIFY 2 — any expected login that did NOT match a users row (should return 0 rows;
-- a row here means that login is spelled differently in the DB — tell Claude):
-- SELECT expected FROM unnest(ARRAY[
--   'dhara@untitledad.in','mayur@untitledad.in','rima@untitledad.in',
--   'dixita@untitledad.in','riya@untitledad.in','hr@untitledad.in'
-- ]) AS expected
-- EXCEPT
-- SELECT lower(email) FROM public.users WHERE contact_email IS NOT NULL;
