-- ═════════════════════════════════════════════════════════════════════════
-- AI QUOTE FOLLOW-UP — auto-chase a customer who got an AI quote and went silent
-- ═════════════════════════════════════════════════════════════════════════
-- Owner ask (2026-08-20): "does the AI follow up with the customer?" → No, it
-- only answers inbound. Owner: "yes … i just want closer." So: a once-a-day cron
-- sends an APPROVED Utility template (reply-first, Gujarati, NO price / NO pitch)
-- to a lead who received an AI quote (quotes.source='ai_quote', §210) and has NOT
-- replied since. The moment the customer replies, the existing reactive AI
-- closer (§115/§246) takes over — this only RE-OPENS the 24h window.
--
-- ⚠ SPAM DISCIPLINE (98982 was Meta-flagged TWICE — §133/§148). Built ultra-
-- conservative so a 3rd flag (→ block/lock) can't come from this:
--   • GLOBAL OFF by default — whatsapp_accounts.ai_followup_enabled (DEFAULT
--     false). Inert until the owner flips it AFTER the template is Active. §246.
--     KILL SWITCH = flip it false.
--   • MAX 2 touches per lead, lifetime (day-2 then day-6, ≥3-day gap).
--   • Opt-in inherent — an AI-quote lead messaged us first. Hard-respects
--     wa_opt_out + do_not_call. Skips Won/Lost. Skips the moment they reply.
--   • Quiet hours 09:30–19:30 IST + skips Sunday (re-checked in the endpoint).
--   • Every send logged to whatsapp_messages → block/report rate is measurable.
--
-- §45-safe: additive only — 1 new nullable column on whatsapp_accounts (no
-- existing code writes it), 1 new table, 1 new wa_outcome_templates row, 3 new
-- SECURITY DEFINER fns (service-role-only), 1 new cron. Zero touch to the sales
-- hot path / leads writes / the customer bot. §154: ONE combined paste-safe file.
--
-- DEPLOY ORDER (safe either way; the OFF flag is the real gate):
--   1. Push api/wa/ai-followup.js (Edge; reuses AI_REPLY_SECRET — no new env).
--   2. Run THIS file (replace <AI_REPLY_SECRET> with the SAME value already in
--      Vercel env AI_REPLY_SECRET + the §246 wa_ai_reply_dispatch trigger).
--   3. Run scripts/create-quote-followup-template.py → wait for the Meta
--      template `ai_quote_followup` to show Active in WhatsApp Manager.
--   4. Turn it on: UPDATE whatsapp_accounts SET ai_followup_enabled=true
--      WHERE purpose='marketing';   (and/or the service number if you like)
--   Nothing sends until BOTH the template is Active AND the flag is true.
-- ═════════════════════════════════════════════════════════════════════════

-- ── 1. Global on/off per WhatsApp account (kill switch) ──────────────────────
ALTER TABLE public.whatsapp_accounts
  ADD COLUMN IF NOT EXISTS ai_followup_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.whatsapp_accounts.ai_followup_enabled IS
  'AI auto-follow-up for silent AI-quote leads. DEFAULT false = inert. Flip false to kill instantly.';

-- ── 2. Per-lead throttle / audit (service-role + DEFINER fns only) ───────────
CREATE TABLE IF NOT EXISTS public.ai_quote_followups (
  lead_id         uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  conversation_id uuid,
  sent_count      int  NOT NULL DEFAULT 0,
  first_sent_at   timestamptz DEFAULT now(),
  last_sent_at    timestamptz
);
ALTER TABLE public.ai_quote_followups ENABLE ROW LEVEL SECURITY;
-- Admin/accounts read for measurement; NO client write (only the DEFINER fns +
-- the service role touch it). NULL role → false → fail-closed (§41 RLS form).
DROP POLICY IF EXISTS ai_quote_followups_read ON public.ai_quote_followups;
CREATE POLICY ai_quote_followups_read ON public.ai_quote_followups
  FOR SELECT USING (public.get_my_role() IN ('admin','co_owner','accounts'));

-- ── 3. The Utility template row (§125.1 preview_body lockstep) ───────────────
-- Extend the CHECK to admit 'quote_followup' + keep the existing set + the §322
-- meeting_done (superset — safe whether or not phase249_3 ran).
ALTER TABLE public.wa_outcome_templates
  DROP CONSTRAINT IF EXISTS wa_outcome_templates_outcome_check;
ALTER TABLE public.wa_outcome_templates
  ADD CONSTRAINT wa_outcome_templates_outcome_check
  CHECK (outcome IN ('positive','neutral','callback','nurture','negative',
                     'meeting','meeting_done','quote_followup'));

-- ⚠ is_active=true here means "this ROW is the live one" — it is NOT proof the
-- Meta template is Approved. Nothing sends until the account flag is flipped AND
-- Meta shows `ai_quote_followup` Active (a premature flip only yields Graph
-- rejections, no send). Kept strictly transactional (NO "book" verb, no price,
-- no attachment) so a Meta reviewer keeps it UTILITY (§120).
INSERT INTO public.wa_outcome_templates
  (outcome, meta_template_name, language, header_doc_url, header_doc_name, preview_body, is_active)
VALUES
  ('quote_followup', 'ai_quote_followup', 'gu', NULL, NULL,
   'નમસ્તે {{1}} 👋 તમને GSRTC LED સ્ક્રીન નું *ભાવપત્રક* મળ્યું? કોઈ પ્રશ્ન હોય તો આ મેસેજ પર *જવાબ* આપો — અમે મદદ કરીશું.',
   true)
ON CONFLICT (outcome) DO UPDATE
  SET meta_template_name = EXCLUDED.meta_template_name,
      language           = EXCLUDED.language,
      header_doc_url      = EXCLUDED.header_doc_url,
      header_doc_name     = EXCLUDED.header_doc_name,
      preview_body        = EXCLUDED.preview_body,
      is_active          = true;
-- Body var {{1}} = customer first name. NO price / NO pitch / NO document header
-- → strictly Utility (§120). Reply-first (bold જવાબ = "reply"). One emoji is a
-- §33 WhatsApp waiver. ⚠ LOCKSTEP: edit the Meta template body → edit preview_body.

-- ── 4. Candidate query — the ONE place the qualifying rule lives (§71) ───────
-- Returns the leads DUE for a follow-up RIGHT NOW. Timing:
--   touch 1: quote 2–4 days old, none sent yet.
--   touch 2: quote 6–9 days old, exactly 1 sent, ≥3 days since that send.
-- "silent since the quote" = the conversation has no inbound AFTER the quote —
-- so a reply to the quote OR to touch-1 both disqualify (one check does both).
DROP FUNCTION IF EXISTS public.ai_quote_followup_candidates();
CREATE FUNCTION public.ai_quote_followup_candidates()
RETURNS TABLE (
  lead_id uuid, conversation_id uuid, whatsapp_account_id uuid,
  phone_number_id text, customer_wa_id text, lead_name text, touch_number int
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH latest_q AS (
    SELECT DISTINCT ON (q.lead_id) q.lead_id, q.created_at
    FROM public.quotes q
    WHERE q.source = 'ai_quote' AND q.lead_id IS NOT NULL
      AND q.created_at > now() - interval '10 days'
    ORDER BY q.lead_id, q.created_at DESC
  ),
  conv AS (
    SELECT DISTINCT ON (c.lead_id)
           c.id AS conversation_id, c.lead_id, c.whatsapp_account_id,
           c.customer_wa_id, c.last_inbound_at, c.ai_paused
    FROM public.whatsapp_conversations c
    WHERE c.lead_id IS NOT NULL
    ORDER BY c.lead_id, c.last_message_at DESC NULLS LAST
  )
  SELECT lq.lead_id, cv.conversation_id, a.id,
         a.phone_number_id, cv.customer_wa_id,
         COALESCE(NULLIF(btrim(l.name), ''), '') AS lead_name,
         COALESCE(f.sent_count, 0) + 1 AS touch_number
  FROM latest_q lq
  JOIN public.leads l              ON l.id = lq.lead_id
  JOIN conv cv                     ON cv.lead_id = lq.lead_id
  JOIN public.whatsapp_accounts a  ON a.id = cv.whatsapp_account_id
  LEFT JOIN public.ai_quote_followups f ON f.lead_id = lq.lead_id
  WHERE a.ai_followup_enabled = true
    AND a.phone_number_id IS NOT NULL
    AND cv.customer_wa_id ~ '^[0-9]{10,15}$'
    AND COALESCE(l.stage, '')        NOT IN ('Won', 'Lost')
    AND COALESCE(l.wa_opt_out, false) = false
    AND COALESCE(l.do_not_call, false) = false
    AND COALESCE(cv.ai_paused, false) = false      -- a rep took the thread → don't auto-chase (§P2)
    AND (cv.last_inbound_at IS NULL OR cv.last_inbound_at <= lq.created_at)
    AND COALESCE(f.sent_count, 0) < 2
    -- INDEPENDENT anti-double-send guard (P1): even if the mark write is ever
    -- lost, a template already sent to this thread in the last 3 days blocks a
    -- re-fire. Also stops piling onto a customer a rep just templated (§120).
    -- The ≥3-day gap between touch-1 and touch-2 clears this window in time.
    AND NOT EXISTS (
      SELECT 1 FROM public.whatsapp_messages m
      WHERE m.conversation_id = cv.conversation_id
        AND m.direction = 'out'
        AND m.type = 'template'
        AND m.at > now() - interval '3 days'
    )
    AND (
         (COALESCE(f.sent_count, 0) = 0
            AND lq.created_at <= now() - interval '2 days'
            AND lq.created_at >= now() - interval '4 days')
      OR (f.sent_count = 1
            AND lq.created_at <= now() - interval '6 days'
            AND lq.created_at >= now() - interval '9 days'
            AND f.last_sent_at <= now() - interval '3 days')
    )
  LIMIT 200;
$$;

-- Called by the endpoint after a successful send. Idempotent per lead.
CREATE OR REPLACE FUNCTION public.ai_quote_followup_mark(p_lead_id uuid, p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.ai_quote_followups (lead_id, conversation_id, sent_count, first_sent_at, last_sent_at)
  VALUES (p_lead_id, p_conversation_id, 1, now(), now())
  ON CONFLICT (lead_id) DO UPDATE
    SET sent_count      = ai_quote_followups.sent_count + 1,
        last_sent_at    = now(),
        conversation_id = COALESCE(EXCLUDED.conversation_id, ai_quote_followups.conversation_id);
END;
$$;

-- Both are service-role-only (the endpoint reaches them via the service key).
REVOKE ALL ON FUNCTION public.ai_quote_followup_candidates()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_quote_followup_mark(uuid, uuid)  FROM PUBLIC, anon, authenticated;
-- Explicit service_role grant (matches enqueue_push/ai_build_quote; without it a
-- from-PUBLIC revoke usually leaves service_role's default privilege intact, but
-- be explicit so the endpoint can't silently 401 → {due:0} forever).
GRANT EXECUTE ON FUNCTION public.ai_quote_followup_candidates()     TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_quote_followup_mark(uuid, uuid) TO service_role;

-- ── 5. Cron dispatch → the Edge endpoint (§197 pattern) ─────────────────────
-- ⚠ Replace <AI_REPLY_SECRET> with the SAME value in Vercel env AI_REPLY_SECRET
-- (the one §246 / §210 use). Fires a WhatsApp send → REVOKEd from client roles
-- (the cron runs as postgres → executes regardless). EXCEPTION-wrapped.
CREATE OR REPLACE FUNCTION public.ai_quote_followup_dispatch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  PERFORM net.http_post(
    url     := 'https://app.untitledad.in/api/wa/ai-followup',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-ai-secret', '<AI_REPLY_SECRET>'),
    body    := '{}'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  -- never let a dispatch hiccup surface / break the cron
  NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_quote_followup_dispatch() FROM PUBLIC, anon, authenticated;

-- pg_cron is UTC. 05:30 UTC = 11:00 IST (mid-morning, in-hours). Mon–Sat (skip
-- Sunday at the cron level too, not just in the endpoint). Once a day.
SELECT cron.unschedule('ai-quote-followup')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai-quote-followup');
SELECT cron.schedule('ai-quote-followup', '30 5 * * 1-6',
  $$SELECT public.ai_quote_followup_dispatch();$$);

NOTIFY pgrst, 'reload schema';

-- ── VERIFY (all should be TRUE / present) ───────────────────────────────────
--  SELECT
--    (SELECT count(*) FROM information_schema.columns
--       WHERE table_schema='public' AND table_name='whatsapp_accounts'
--         AND column_name='ai_followup_enabled')                       AS flag_col,      -- 1
--    to_regclass('public.ai_quote_followups') IS NOT NULL              AS table_present, -- t
--    (SELECT count(*) FROM public.wa_outcome_templates
--       WHERE outcome='quote_followup' AND meta_template_name='ai_quote_followup'
--         AND language='gu' AND preview_body IS NOT NULL)              AS tpl_row,       -- 1
--    to_regprocedure('public.ai_quote_followup_candidates()') IS NOT NULL AS cand_fn,    -- t
--    (SELECT has_function_privilege('authenticated',
--       'public.ai_quote_followup_candidates()','EXECUTE'))            AS auth_can,      -- f
--    (SELECT count(*) FROM cron.job WHERE jobname='ai-quote-followup') AS cron_job,      -- 1
--    (SELECT count(*) FROM public.whatsapp_accounts WHERE ai_followup_enabled) AS enabled_accts; -- 0 (off until you flip it)
