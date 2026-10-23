-- Phase 476: a READ-ONLY log of the team's WhatsApp chat with the assistant (admin + co_owner see it in
-- Campaigns -> Team). Before this, a staff message never showed anywhere (the webhook sends it to the assistant,
-- not to the customer inbox) and the assistant's replies were not stored at all.
-- IN  rows: written by trigger from team_assistant_requests (single source).
-- OUT rows: written by api/wa/team-assistant.js + api/wa/team-nudge.js; delivery status (sent/delivered/read/failed
--           + Meta's reason) is updated by the webhook status handler by wamid.
-- UNDO: DROP TRIGGER trg_team_wa_in ON team_assistant_requests; DROP FUNCTION team_wa_log_in(); DROP TABLE team_wa_messages;
CREATE TABLE IF NOT EXISTS public.team_wa_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  direction       text NOT NULL CHECK (direction IN ('in','out')),
  body            text,
  wamid           text,
  status          text,
  error           text,
  kind            text,
  phone_number_id text,
  at              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS team_wa_messages_wamid_uk ON public.team_wa_messages(wamid) WHERE wamid IS NOT NULL;
CREATE INDEX IF NOT EXISTS team_wa_messages_user_at ON public.team_wa_messages(user_id, at DESC);
ALTER TABLE public.team_wa_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_wa_messages_admin_read ON public.team_wa_messages;
CREATE POLICY team_wa_messages_admin_read ON public.team_wa_messages FOR SELECT TO authenticated
  USING (COALESCE(public.get_my_role() IN ('admin','co_owner'), false));
REVOKE ALL ON public.team_wa_messages FROM anon, authenticated;
GRANT SELECT ON public.team_wa_messages TO authenticated;

CREATE OR REPLACE FUNCTION public.team_wa_log_in() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.wamid IS NOT NULL AND NEW.wamid LIKE 'resend-%' THEN RETURN NEW; END IF;  -- my test resends are not real chat
  INSERT INTO public.team_wa_messages(user_id, direction, body, wamid, status, kind, phone_number_id, at)
  VALUES (NEW.user_id, 'in', COALESCE(NEW.message_text, '[' || COALESCE(NEW.message_type,'message') || ']'), NEW.wamid, 'received', 'chat', NEW.phone_number_id, NEW.created_at)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;   -- logging must never block the assistant
END $$;
REVOKE ALL ON FUNCTION public.team_wa_log_in() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_team_wa_in ON public.team_assistant_requests;
CREATE TRIGGER trg_team_wa_in AFTER INSERT ON public.team_assistant_requests
  FOR EACH ROW EXECUTE FUNCTION public.team_wa_log_in();

-- backfill the incoming side from the last 30 days
INSERT INTO public.team_wa_messages(user_id, direction, body, wamid, status, kind, phone_number_id, at)
SELECT t.user_id, 'in', COALESCE(t.message_text, '[' || COALESCE(t.message_type,'message') || ']'), t.wamid, 'received', 'chat', t.phone_number_id, t.created_at
FROM public.team_assistant_requests t
WHERE t.created_at > now() - interval '30 days' AND (t.wamid IS NULL OR t.wamid NOT LIKE 'resend-%')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
-- VERIFY:
SELECT (SELECT count(*) FROM public.team_wa_messages) AS rows_in_log,
       (SELECT count(*) FROM pg_trigger WHERE tgname='trg_team_wa_in') AS trigger_present,
       NOT has_table_privilege('anon','public.team_wa_messages','SELECT') AS anon_blocked,
       NOT has_function_privilege('authenticated','public.team_wa_log_in()','EXECUTE') AS fn_locked;
