-- supabase_phase20_voice.sql
--
-- Phase 20 — Voice-First V1
--
-- A rep records a voice note, the audio gets transcribed (Whisper) and
-- classified (Claude) by a single edge function, and a lead_activities
-- row is inserted. This table is the audit trail of those sessions —
-- the raw transcript, the language detected, what Claude classified
-- it as, and a foreign key to the activity that was created. If
-- something looks wrong on the lead timeline, you trace it back here.
--
-- Audio itself is NOT persisted in V1. The edge function holds the
-- byte buffer in-memory only, runs Whisper, then drops it. We can add
-- a storage bucket in V2 if reps want to play back what they said.

------------------------------------------------------------------
-- Table
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.voice_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id             uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  user_id             uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  duration_seconds    int,
  language_detected   text,                    -- "gu" | "hi" | "en" from Whisper
  transcript          text,                    -- raw Whisper output
  classified          jsonb,                   -- { activity_type, outcome, notes, next_action, next_action_date, summary }
  activity_id         uuid REFERENCES public.lead_activities(id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'pending',
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  CONSTRAINT voice_logs_status_chk CHECK (status IN (
    'pending', 'transcribing', 'classifying', 'completed', 'failed'
  ))
);

CREATE INDEX IF NOT EXISTS idx_voice_logs_user_created
  ON public.voice_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_logs_lead
  ON public.voice_logs (lead_id, created_at DESC)
  WHERE lead_id IS NOT NULL;

------------------------------------------------------------------
-- RLS — rep sees own; sales_manager sees direct reports;
-- admin/co_owner see all.
------------------------------------------------------------------
ALTER TABLE public.voice_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS voice_logs_select_self_or_chain ON public.voice_logs;
CREATE POLICY voice_logs_select_self_or_chain
ON public.voice_logs
FOR SELECT
USING (
  user_id = auth.uid()
  OR public.get_my_role() IN ('admin', 'co_owner')
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = voice_logs.user_id AND u.manager_id = auth.uid()
  )
);

-- Inserts go through the edge function (SECURITY DEFINER service role).
-- Direct API inserts are blocked except for the rep themselves writing
-- their own row, which keeps client-side fallbacks working.
DROP POLICY IF EXISTS voice_logs_insert_self ON public.voice_logs;
CREATE POLICY voice_logs_insert_self
ON public.voice_logs
FOR INSERT
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS voice_logs_update_self ON public.voice_logs;
CREATE POLICY voice_logs_update_self
ON public.voice_logs
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

------------------------------------------------------------------
-- Realtime — keep the /voice page reactive while the edge function
-- pushes status updates.
------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.voice_logs;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

------------------------------------------------------------------
-- PostgREST schema reload
------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

------------------------------------------------------------------
-- VERIFY
------------------------------------------------------------------
-- 1. Table exists with expected columns:
--    SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'voice_logs' ORDER BY ordinal_position;
--
-- 2. RLS on:
--    SELECT relrowsecurity FROM pg_class WHERE relname = 'voice_logs';
--
-- 3. Quick insert test (replace UUIDs):
--    INSERT INTO voice_logs (user_id, transcript, status)
--    VALUES (auth.uid(), 'test', 'pending') RETURNING id;
