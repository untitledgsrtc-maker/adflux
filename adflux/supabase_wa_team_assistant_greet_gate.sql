-- supabase_wa_team_assistant_greet_gate.sql
-- WhatsApp Internal Team Assistant — Phase 314 (message-first check-in gate).
-- Spec: docs/WHATSAPP_INTERNAL_ASSISTANT_SPEC.md · §197/§198
--
-- The app needs to know "has THIS rep messaged the assistant today?" so the
-- morning check-in gate (MorningGreetGate.jsx) can require a greeting before
-- start-of-day — which opens the 24h WhatsApp window so the P3 every-2h nudge
-- can reach them.
--
-- Reps must NOT read team_assistant_requests directly (RLS tar_admin_read =
-- admin/co_owner/accounts only, §197). So this is a SECURITY DEFINER function
-- that returns ONLY a boolean, and ONLY for the caller's own rows (auth.uid()).
-- No message content, no other rep's data, no row IDs — just "did I greet today".
--
-- "Today" = since IST midnight, so a fresh morning message keeps the 24h window
-- open across the whole 9-19 IST workday (the nudge slots). A message from
-- yesterday does NOT count → the gate re-shows each morning.
--
-- §45-safe: additive, read-only, own-scoped. Zero touch to any existing flow.

CREATE OR REPLACE FUNCTION public.assistant_greeted_today()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_assistant_requests
    WHERE user_id = auth.uid()
      -- since IST (Asia/Kolkata) midnight today, as a UTC instant
      AND created_at >= (date_trunc('day', (now() AT TIME ZONE 'Asia/Kolkata')) AT TIME ZONE 'Asia/Kolkata')
  );
$$;

-- Own-scoped bool read → safe for any signed-in rep. anon has no auth.uid() →
-- always false, harmless; still revoke to keep the surface tidy (§211 posture).
REVOKE ALL ON FUNCTION public.assistant_greeted_today() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assistant_greeted_today() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Expect: function present, executable by authenticated, NOT by anon.
-- SELECT to_regprocedure('public.assistant_greeted_today()') IS NOT NULL;                            -- t
-- SELECT has_function_privilege('authenticated', 'public.assistant_greeted_today()', 'EXECUTE');     -- t
-- SELECT has_function_privilege('anon',          'public.assistant_greeted_today()', 'EXECUTE');     -- f
-- As a signed-in rep who has NOT messaged today: SELECT public.assistant_greeted_today();            -- f
-- After they message the 95 number:                SELECT public.assistant_greeted_today();          -- t
