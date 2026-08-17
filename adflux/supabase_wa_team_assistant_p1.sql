-- supabase_wa_team_assistant_p1.sql
-- WhatsApp Internal Team Assistant — Phase 1 (identity + "hi → your day").
-- Spec: docs/WHATSAPP_INTERNAL_ASSISTANT_SPEC.md
--
-- A rep texts the 95 number (95 815 78261) → they get their own day back
-- (today's follow-ups, overdue, renewals due, calls vs target). No Claude in P1
-- — the Edge fn `api/wa/team-assistant.js` just formats the rep's scoped data
-- and sends it. Customer flow on 95 is 100% untouched.
--
-- HOW IT ROUTES: the webhook (api/wa/webhook.js) recognises a message FROM a
-- known rep number (users.whatsapp_number) and inserts ONE row here instead of
-- storing a customer conversation/lead. A pg_net trigger fires the Edge fn.
-- So NO lead, NO customer AI, NO customer inbox for a rep message.
--
-- §45-safe: additive column + a NEW table + a trigger only on the NEW table.
-- Zero change to leads / quotes / whatsapp_conversations / the customer bot.
-- DEPLOY ORDER: safe either way — until this runs, users.whatsapp_number does
-- not exist, so the webhook's rep-map query returns empty and the fork is inert
-- (every message falls through to the existing customer flow, unchanged).

-- ── 1. identity: map each rep's WhatsApp number → their user ────────────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS whatsapp_number text;
-- No two users may share a number: a bad ILIKE match that hits 2 people FAILS
-- LOUDLY on the seed below instead of silently cross-mapping one rep's private
-- snapshot to another (security P2). Partial so NULLs are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_whatsapp_number
  ON public.users (whatsapp_number) WHERE whatsapp_number IS NOT NULL;

-- Seed the 7 reps (owner-supplied 2026-08-17). Stored as the 10-digit number;
-- the webhook matches on the last 10 digits, so 91-prefixed inbound still maps.
-- Matched by first name (ILIKE) — VERIFY block below shows exactly who got set.
UPDATE public.users SET whatsapp_number = '9974973686' WHERE name ILIKE '%jayna%'  AND is_active;
UPDATE public.users SET whatsapp_number = '9409152255' WHERE name ILIKE '%dhara%'  AND is_active;
UPDATE public.users SET whatsapp_number = '8866273686' WHERE name ILIKE '%rima%'   AND is_active;
UPDATE public.users SET whatsapp_number = '9974073686' WHERE name ILIKE '%kirti%'  AND is_active;
UPDATE public.users SET whatsapp_number = '9974173686' WHERE name ILIKE '%viral%'  AND is_active;
UPDATE public.users SET whatsapp_number = '9601673686' WHERE name ILIKE '%mayur%'  AND is_active;
UPDATE public.users SET whatsapp_number = '9898173686' WHERE name ILIKE '%kamina%' AND is_active;

-- ── 2. request queue (the webhook writes here; the Edge fn drains it) ────────
CREATE TABLE IF NOT EXISTS public.team_assistant_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  user_id         uuid REFERENCES public.users(id) ON DELETE CASCADE,
  account_id      uuid,
  wa_from         text,          -- the rep's WhatsApp number (Meta wa_id)
  phone_number_id text,          -- the receiving business number (to reply from)
  message_text    text,
  message_type    text,
  wamid           text,
  status          text DEFAULT 'new',   -- new | handled | error
  handled_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_team_assistant_requests_user_date
  ON public.team_assistant_requests (user_id, created_at DESC);
-- Dedup Meta re-deliveries: a repeated inbound (same wamid) must not queue twice
-- → the webhook upserts ON CONFLICT (wamid) DO NOTHING. NON-partial so PostgREST
-- upsert can target it (a partial index would 42P10, §55); Postgres treats the
-- many NULL wamids as distinct, so message types without a wamid are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_assistant_requests_wamid
  ON public.team_assistant_requests (wamid);

ALTER TABLE public.team_assistant_requests ENABLE ROW LEVEL SECURITY;
-- Reps must NOT read the request log. Only admin/co_owner/accounts read; the
-- webhook + Edge fn use the service role (bypasses RLS), so no INSERT/UPDATE
-- policy is needed. Anyone else gets nothing (fail-closed — RLS default deny).
DROP POLICY IF EXISTS tar_admin_read ON public.team_assistant_requests;
CREATE POLICY tar_admin_read ON public.team_assistant_requests
  FOR SELECT USING (public.get_my_role() IN ('admin','co_owner','accounts'));

-- ── 3. dispatch: fire the Edge fn async on each new request ──────────────────
-- Mirrors wa_ai_reply_dispatch (§246): pg_net, secret header, EXCEPTION-wrapped
-- so a dispatch failure can NEVER break the webhook's insert (§45/§46).
-- ⚠ Replace <TEAM_ASSISTANT_SECRET> with a long random string BEFORE running,
--   and set the SAME value as Vercel env TEAM_ASSISTANT_SECRET.
CREATE OR REPLACE FUNCTION public.team_assistant_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  BEGIN
    PERFORM net.http_post(
      url     := 'https://app.untitledad.in/api/wa/team-assistant',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-ta-secret', '<TEAM_ASSISTANT_SECRET>'),
      body    := jsonb_build_object('request_id', NEW.id),
      timeout_milliseconds := 5000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'team_assistant_dispatch failed for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_team_assistant_dispatch ON public.team_assistant_requests;
CREATE TRIGGER trg_team_assistant_dispatch
  AFTER INSERT ON public.team_assistant_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.team_assistant_dispatch();

NOTIFY pgrst, 'reload schema';

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Expect: 7 reps mapped, table + policy + trigger present.
-- SELECT name, whatsapp_number FROM public.users WHERE whatsapp_number IS NOT NULL ORDER BY name;   -- 7 rows
-- SELECT count(*) FROM pg_tables   WHERE tablename = 'team_assistant_requests';                     -- 1
-- SELECT count(*) FROM pg_policies WHERE tablename = 'team_assistant_requests';                     -- 1
-- SELECT count(*) FROM pg_trigger  WHERE tgname   = 'trg_team_assistant_dispatch';                  -- 1
