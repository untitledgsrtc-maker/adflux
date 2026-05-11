-- supabase_phase33w_push_triggers.sql
--
-- Phase 33W — auto-fire push notifications on real events.
-- Now that the manual test push works (Phase 33S → 33V), wire the
-- five real triggers so reps get notifications without admin needing
-- to tap a button.
--
-- Events covered:
--   1. New lead assigned to a rep         → INSERT trigger on leads
--   2. Lead reassigned to a different rep → UPDATE trigger on leads
--   3. Payment received (approved)        → UPDATE trigger on payments
--   4. Quote flipped to Won                → already covered by
--      Phase 33G.7 payment-FU trigger (creates follow-ups). Adding
--      a direct push to the assigned rep here.
--   5. Daily reminder cron (9:00 AM IST)  → calls a function that
--      pushes to every rep with overdue follow-ups OR 3-day-miss
--      streak. Cron schedule via pg_cron.
--
-- Plumbing:
--   • SQL function `enqueue_push(user_id, title, body, url, tag)`
--     wraps an HTTP POST to the notify-rep Edge Function via pg_net.
--   • Each event trigger calls enqueue_push() with the right copy.
--   • Errors swallowed silently — push failure shouldn't roll back
--     the underlying business event (lead assignment, payment, etc).
--
-- Prerequisites already in place:
--   • Phase 33R: push_subscriptions table + RLS
--   • Phase 33S: notify-rep Edge Function deployed
--   • Phase 33Q: consecutive_missed_days(user_id) RPC
--
-- Idempotent: CREATE OR REPLACE on every function, DROP IF EXISTS
-- before CREATE TRIGGER.

-- ─── 1. Extensions ────────────────────────────────────────────────
-- pg_net for outbound HTTP from triggers. Available on Supabase.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- pg_cron for the daily reminder. Already enabled on most Supabase
-- projects; CREATE EXTENSION IF NOT EXISTS is safe either way.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- ─── 2. enqueue_push helper ──────────────────────────────────────
-- Hard-coded project URL + anon key. Anon key is safe to embed
-- inside the DB — it's already public-by-design (every client uses
-- it). The Edge Function uses its own service-role to bypass RLS.
--
-- Setting these via current_setting('app.supabase_url') would be
-- nicer but Supabase doesn't expose those by default. Hardcoded
-- string keeps this self-contained.
CREATE OR REPLACE FUNCTION public.enqueue_push(
  p_user_id  uuid,
  p_title    text,
  p_body     text,
  p_url      text DEFAULT '/work',
  p_tag      text DEFAULT 'untitled'
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_request_id bigint;
  v_url  text := 'https://kompjctmisnitjpbjalh.supabase.co/functions/v1/notify-rep';
  v_anon text := current_setting('app.settings.anon_key', true);
BEGIN
  -- Fall back to a sentinel if no setting is configured. Owner can
  -- ALTER DATABASE SET app.settings.anon_key once + restart, OR just
  -- replace this literal. For now hardcode allowed since anon keys
  -- are public-by-design.
  IF v_anon IS NULL OR v_anon = '' THEN
    -- Sentinel — keeps function valid but pushes fail loudly until
    -- owner sets the anon key. Replace the next line with the real
    -- anon key string OR run:
    --   ALTER DATABASE postgres SET app.settings.anon_key = 'eyJ...';
    v_anon := 'SET_ANON_KEY_VIA_app.settings.anon_key';
  END IF;

  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_anon,
      'Authorization', 'Bearer ' || v_anon
    ),
    body := jsonb_build_object(
      'user_id', p_user_id,
      'title',   p_title,
      'body',    p_body,
      'url',     p_url,
      'tag',     p_tag
    )
  ) INTO v_request_id;
  RETURN v_request_id;
END $$;

GRANT EXECUTE ON FUNCTION public.enqueue_push(uuid, text, text, text, text) TO authenticated;

-- ─── 3. Trigger: new lead assigned ───────────────────────────────
-- Fires when:
--   • A new lead row is INSERTed with assigned_to set, OR
--   • An existing lead's assigned_to column is changed (reassign)
-- Pushes to the NEW assignee.
CREATE OR REPLACE FUNCTION public.tg_push_on_lead_assign()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_title text;
  v_body  text;
BEGIN
  -- INSERT with assignee, OR UPDATE to a different assignee.
  IF (TG_OP = 'INSERT' AND NEW.assigned_to IS NOT NULL)
     OR (TG_OP = 'UPDATE'
         AND NEW.assigned_to IS NOT NULL
         AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to) THEN
    v_title := 'New lead: ' || COALESCE(NEW.name, NEW.company, 'unnamed');
    v_body  := COALESCE(NEW.company, '') ||
               CASE WHEN NEW.phone IS NOT NULL THEN ' · ' || NEW.phone ELSE '' END;
    PERFORM public.enqueue_push(
      NEW.assigned_to,
      v_title,
      v_body,
      '/leads/' || NEW.id::text,
      'lead-' || NEW.id::text
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_push_lead_assign ON leads;
CREATE TRIGGER tg_push_lead_assign
  AFTER INSERT OR UPDATE OF assigned_to ON leads
  FOR EACH ROW EXECUTE FUNCTION public.tg_push_on_lead_assign();

-- ─── 4. Trigger: payment approved ────────────────────────────────
-- Fires when a payment row transitions to approval_status = 'approved'.
-- Pushes the quote creator with the amount + client.
CREATE OR REPLACE FUNCTION public.tg_push_on_payment_approved()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_quote record;
  v_title text;
  v_body  text;
BEGIN
  IF NEW.approval_status <> 'approved' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.approval_status = 'approved' THEN RETURN NEW; END IF;

  SELECT created_by, client_company, client_name, total_amount,
         COALESCE(quote_number, id::text) AS label
    INTO v_quote
    FROM quotes WHERE id = NEW.quote_id;
  IF NOT FOUND OR v_quote.created_by IS NULL THEN RETURN NEW; END IF;

  v_title := 'Payment received · ₹' || to_char(NEW.amount_received, 'FM99,99,99,999');
  v_body  := COALESCE(v_quote.client_company, v_quote.client_name, '') ||
             ' · ' || v_quote.label;
  PERFORM public.enqueue_push(
    v_quote.created_by,
    v_title,
    v_body,
    '/quotes/' || NEW.quote_id::text,
    'payment-' || NEW.id::text
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_push_payment_approved ON payments;
CREATE TRIGGER tg_push_payment_approved
  AFTER INSERT OR UPDATE OF approval_status ON payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_push_on_payment_approved();

-- ─── 5. Trigger: quote → Won ─────────────────────────────────────
-- Fires alongside Phase 33G.7's payment-FU trigger. Pushes the rep
-- to celebrate + signal it's time to collect.
CREATE OR REPLACE FUNCTION public.tg_push_on_quote_won()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status <> 'won' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'won' THEN RETURN NEW; END IF;
  IF NEW.created_by IS NULL THEN RETURN NEW; END IF;

  PERFORM public.enqueue_push(
    NEW.created_by,
    'Quote Won · ₹' || to_char(NEW.total_amount, 'FM99,99,99,999'),
    COALESCE(NEW.client_company, NEW.client_name, '') || ' · ' ||
      COALESCE(NEW.quote_number, NEW.id::text) || ' — collect next',
    '/quotes/' || NEW.id::text,
    'won-' || NEW.id::text
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_push_quote_won ON quotes;
CREATE TRIGGER tg_push_quote_won
  AFTER INSERT OR UPDATE OF status ON quotes
  FOR EACH ROW EXECUTE FUNCTION public.tg_push_on_quote_won();

-- ─── 6. Daily reminders (9:00 AM IST = 03:30 UTC) ────────────────
-- One function that:
--   • Pushes overdue follow-ups to each rep
--   • Pushes 3-day-miss warning to reps with consecutive_missed_days >= 3
CREATE OR REPLACE FUNCTION public.push_daily_reminders()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count    int := 0;
  v_overdue  record;
  v_streak   record;
BEGIN
  -- 6a. Overdue follow-ups — one push per rep with at-least-one due.
  FOR v_overdue IN
    SELECT assigned_to AS user_id,
           COUNT(*)   AS due_count
      FROM follow_ups
     WHERE is_done = false
       AND follow_up_date <= CURRENT_DATE
       AND assigned_to IS NOT NULL
     GROUP BY assigned_to
  LOOP
    PERFORM public.enqueue_push(
      v_overdue.user_id,
      v_overdue.due_count || ' follow-up' ||
        CASE WHEN v_overdue.due_count > 1 THEN 's' ELSE '' END || ' due today',
      'Open the Untitled app to see who to call.',
      '/follow-ups',
      'daily-followups'
    );
    v_count := v_count + 1;
  END LOOP;

  -- 6b. 3-day-miss streaks — push to active sales/agency reps.
  FOR v_streak IN
    SELECT id AS user_id, name
      FROM users
     WHERE role IN ('sales', 'agency')
       AND is_active = true
  LOOP
    IF public.consecutive_missed_days(v_streak.user_id) >= 3 THEN
      PERFORM public.enqueue_push(
        v_streak.user_id,
        '3 days below target — variable salary at risk',
        'Hit your meeting target today to pull the month back.',
        '/my-performance',
        'miss-streak'
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.push_daily_reminders() TO authenticated;

-- ─── 7. Schedule the daily cron ──────────────────────────────────
-- 9:00 AM IST = 03:30 UTC. pg_cron uses UTC.
-- Re-run safely — unschedule any prior version of the same job
-- before scheduling.
DO $$
BEGIN
  PERFORM cron.unschedule('untitled-daily-reminders');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'untitled-daily-reminders',
  '30 3 * * *',  -- 03:30 UTC daily = 09:00 IST
  $$ SELECT public.push_daily_reminders(); $$
);

NOTIFY pgrst, 'reload schema';

-- ─── 8. Anon key setup (one-time owner action) ───────────────────
-- After running this file, set the project anon key so enqueue_push
-- can authenticate to the Edge Function:
--
--   1. Get the anon key from Supabase Project Settings → API.
--      It starts with `eyJ...` OR `sb_publishable_...`.
--   2. Run in SQL Editor (replace the placeholder):
--        ALTER DATABASE postgres
--          SET app.settings.anon_key = 'eyJxxxxx...';
--   3. Disconnect+reconnect any sessions, or wait a moment.
--      enqueue_push() will pick up the new setting on next call.
--
-- VERIFY:
--   SELECT current_setting('app.settings.anon_key', true);
--     -> should print the key prefix
--   SELECT public.enqueue_push(auth.uid(), 'Trigger test', 'From SQL');
--     -> returns a request_id; check phone for notification within 5s

NOTIFY pgrst, 'reload schema';
