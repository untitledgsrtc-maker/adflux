-- =====================================================================
-- PHASE 12 — M1 (Sales Activity & Lead) + M7 (Telecaller Handoff) FOUNDATION
-- =====================================================================
--
-- This is the single migration that lays the data layer for Phase 1.
-- Read top-to-bottom; sections are independent enough that any half-run
-- will be safe to re-run (everything is IF NOT EXISTS / DROP+CREATE).
--
-- Sections:
--   §1  users hierarchy (manager_id, city, team_role, daily_targets)
--   §2  holidays table + national-holiday seed + is_off_day() function
--   §3  leads table
--   §4  lead_activities table
--   §5  lead_imports table
--   §6  work_sessions table
--   §7  call_logs table
--   §8  triggers + helper functions
--   §9  RLS policies for all new tables
--   §10 schema cache reload
--
-- Owner-approved master spec: UNTITLED_OS_MASTER_SPEC.md v2
-- Phase plan: PHASE1_DESIGN.md
-- =====================================================================


-- =====================================================================
-- §1. USERS hierarchy
-- =====================================================================
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS manager_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS city          text,
  ADD COLUMN IF NOT EXISTS team_role     text,
  ADD COLUMN IF NOT EXISTS daily_targets jsonb DEFAULT '{"meetings":5,"calls":20,"new_leads":10}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_users_manager_id ON public.users (manager_id);
CREATE INDEX IF NOT EXISTS idx_users_city       ON public.users (city);
CREATE INDEX IF NOT EXISTS idx_users_team_role  ON public.users (team_role);

-- Backfill team_role from auth role for existing users so RLS still works.
UPDATE public.users SET team_role = 'admin'              WHERE role = 'admin'    AND team_role IS NULL;
UPDATE public.users SET team_role = 'government_partner' WHERE role = 'co_owner' AND team_role IS NULL;
UPDATE public.users SET team_role = 'sales'              WHERE role = 'sales'    AND team_role IS NULL;
UPDATE public.users SET team_role = 'agency'             WHERE role = 'agency'   AND team_role IS NULL;

-- Constrain to known team_role values. Add new roles as the team grows.
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_team_role_check;
ALTER TABLE public.users
  ADD  CONSTRAINT users_team_role_check
  CHECK (team_role IS NULL OR team_role IN (
    'admin','owner','government_partner','sales_manager','sales',
    'telecaller','creative_lead','designer','video_editor',
    'ops_execution','accounts','hr','admin_staff','office_boy','agency'
  ));


-- =====================================================================
-- §2. HOLIDAYS table + national-holiday seed
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.holidays (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date  date NOT NULL,
  name          text NOT NULL,
  type          text NOT NULL CHECK (type IN ('national','gujarat_festival','company_off')),
  is_recurring  boolean DEFAULT false,
  is_active     boolean DEFAULT true,
  notes         text,
  created_by    uuid REFERENCES public.users(id),
  created_at    timestamptz DEFAULT now(),
  UNIQUE (holiday_date, name)
);
CREATE INDEX IF NOT EXISTS idx_holidays_date ON public.holidays (holiday_date) WHERE is_active = true;

-- Fixed-date national holidays (verified). Gujarat festivals lunar-dependent
-- and must be added by admin via Master → Holidays page (Phase 1 wk 2).
INSERT INTO public.holidays (holiday_date, name, type, is_recurring) VALUES
  ('2026-01-26', 'Republic Day',        'national', true),
  ('2026-08-15', 'Independence Day',    'national', true),
  ('2026-10-02', 'Gandhi Jayanti',      'national', true),
  ('2026-12-25', 'Christmas',           'national', true),
  ('2027-01-26', 'Republic Day',        'national', true),
  ('2027-08-15', 'Independence Day',    'national', true),
  ('2027-10-02', 'Gandhi Jayanti',      'national', true),
  ('2027-12-25', 'Christmas',           'national', true)
ON CONFLICT (holiday_date, name) DO NOTHING;

-- is_off_day(date) — returns true for Sundays + active holidays.
-- Used by daily target calculations + dashboard filters.
CREATE OR REPLACE FUNCTION public.is_off_day(check_date date)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT
    EXTRACT(DOW FROM check_date) = 0
    OR EXISTS (
      SELECT 1 FROM public.holidays
       WHERE holiday_date = check_date
         AND is_active = true
    );
$$;


-- =====================================================================
-- §3. LEADS table — Cronberry replacement
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.leads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source          text NOT NULL,
  name            text NOT NULL,
  company         text,
  phone           text,
  email           text,
  city            text,
  segment         text CHECK (segment IN ('PRIVATE','GOVERNMENT')),
  industry        text,
  expected_value  numeric,
  heat            text CHECK (heat IN ('hot','warm','cold')) DEFAULT 'cold',
  stage           text NOT NULL DEFAULT 'New' CHECK (stage IN (
                    'New','Contacted','Qualified','SalesReady','MeetingScheduled',
                    'QuoteSent','Negotiating','Won','Lost','Nurture')),
  lost_reason     text CHECK (lost_reason IS NULL OR lost_reason IN (
                    'Price','Timing','Competitor','NoNeed','NoResponse','WrongContact','Stale')),
  nurture_revisit_date date,
  assigned_to     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  telecaller_id   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  qualified_at    timestamptz,
  sales_ready_at  timestamptz,
  handoff_sla_due_at timestamptz,
  contact_attempts_count int DEFAULT 0,
  last_contact_at timestamptz,
  notes           text,
  notes_legacy_telecaller text,
  quote_id        uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  import_id       uuid,
  created_by      uuid NOT NULL REFERENCES public.users(id),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_stage              ON public.leads (stage);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to        ON public.leads (assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_telecaller_id      ON public.leads (telecaller_id);
CREATE INDEX IF NOT EXISTS idx_leads_handoff_sla_due_at ON public.leads (handoff_sla_due_at) WHERE stage = 'SalesReady';
CREATE INDEX IF NOT EXISTS idx_leads_segment_city       ON public.leads (segment, city);
CREATE INDEX IF NOT EXISTS idx_leads_phone              ON public.leads (phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_last_contact       ON public.leads (last_contact_at DESC NULLS LAST);


-- =====================================================================
-- §4. LEAD_ACTIVITIES table — every touch on a lead
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.lead_activities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  activity_type   text NOT NULL CHECK (activity_type IN (
                    'call','whatsapp','email','meeting','site_visit','note','status_change')),
  outcome         text CHECK (outcome IS NULL OR outcome IN ('positive','neutral','negative')),
  notes           text,
  next_action     text,
  next_action_date date,
  duration_seconds int,
  gps_lat         numeric(9,6),
  gps_lng         numeric(9,6),
  gps_accuracy_m  int,
  created_by      uuid NOT NULL REFERENCES public.users(id),
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_activities_lead_id     ON public.lead_activities (lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_activities_created_by  ON public.lead_activities (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_activities_next_action ON public.lead_activities (next_action_date) WHERE next_action_date IS NOT NULL;


-- =====================================================================
-- §5. LEAD_IMPORTS table — Excel upload audit trail
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.lead_imports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name       text NOT NULL,
  uploaded_by     uuid NOT NULL REFERENCES public.users(id),
  total_rows      int,
  imported_count  int DEFAULT 0,
  skipped_count   int DEFAULT 0,
  duplicate_count int DEFAULT 0,
  errors          jsonb,
  status          text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','completed','failed')),
  default_assignee_id uuid REFERENCES public.users(id),
  default_segment text,
  created_at      timestamptz DEFAULT now(),
  completed_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_lead_imports_uploaded_by ON public.lead_imports (uploaded_by, created_at DESC);


-- =====================================================================
-- §6. WORK_SESSIONS table — daily attendance + activity rollup
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.work_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  work_date       date NOT NULL,
  plan_submitted_at timestamptz,
  planned_meetings    jsonb,
  planned_calls       int,
  planned_leads       int,
  check_in_at     timestamptz,
  check_in_gps_lat  numeric(9,6),
  check_in_gps_lng  numeric(9,6),
  check_out_at    timestamptz,
  check_out_gps_lat numeric(9,6),
  check_out_gps_lng numeric(9,6),
  evening_report_submitted_at timestamptz,
  evening_summary jsonb,
  daily_counters  jsonb DEFAULT '{"meetings":0,"calls":0,"new_leads":0}'::jsonb,
  is_off_day      boolean DEFAULT false,
  off_reason      text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (user_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_work_sessions_user_date  ON public.work_sessions (user_id, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_work_sessions_no_checkin ON public.work_sessions (work_date) WHERE check_in_at IS NULL AND is_off_day = false;


-- =====================================================================
-- §7. CALL_LOGS table — telecaller + sales call tracking
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.call_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  lead_id         uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  client_id       uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  client_phone    text,
  call_at         timestamptz NOT NULL DEFAULT now(),
  duration_seconds int,
  outcome         text NOT NULL CHECK (outcome IN (
                    'connected','no_answer','busy','wrong_number',
                    'callback_requested','not_interested','sales_ready','already_client')),
  notes           text,
  next_action     text,
  next_action_date date,
  recording_url   text,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_logs_user_at ON public.call_logs (user_id, call_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_logs_lead    ON public.call_logs (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_call_logs_phone   ON public.call_logs (client_phone) WHERE client_phone IS NOT NULL;


-- =====================================================================
-- §8. Triggers + helper functions
-- =====================================================================

-- 8.1 Set handoff_sla_due_at = sales_ready_at + 24h when stage flips to SalesReady.
CREATE OR REPLACE FUNCTION public.lead_set_handoff_sla()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stage = 'SalesReady' AND (OLD.stage IS DISTINCT FROM 'SalesReady') THEN
    NEW.sales_ready_at     := COALESCE(NEW.sales_ready_at, now());
    NEW.handoff_sla_due_at := NEW.sales_ready_at + interval '24 hours';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_set_handoff_sla ON public.leads;
CREATE TRIGGER trg_leads_set_handoff_sla
  BEFORE UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.lead_set_handoff_sla();

-- 8.2 On lead_activities insert, bump contact_attempts_count + last_contact_at,
--     auto-Lost on 3 attempts with no positive outcome.
CREATE OR REPLACE FUNCTION public.lead_activity_after_insert()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_attempts int;
BEGIN
  IF NEW.activity_type IN ('call','whatsapp','email','meeting','site_visit') THEN
    UPDATE public.leads
       SET contact_attempts_count = contact_attempts_count + 1,
           last_contact_at        = COALESCE(NEW.created_at, now()),
           updated_at             = now()
     WHERE id = NEW.lead_id
     RETURNING contact_attempts_count INTO v_attempts;

    IF v_attempts >= 3 AND (NEW.outcome IS NULL OR NEW.outcome IN ('neutral','negative')) THEN
      UPDATE public.leads
         SET stage       = 'Lost',
             lost_reason = 'NoResponse',
             updated_at  = now()
       WHERE id = NEW.lead_id
         AND stage NOT IN ('Won','Lost','Nurture');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_activity_after_insert ON public.lead_activities;
CREATE TRIGGER trg_lead_activity_after_insert
  AFTER INSERT ON public.lead_activities
  FOR EACH ROW
  EXECUTE FUNCTION public.lead_activity_after_insert();

-- 8.3 Daily counter increment on lead_activities + call_logs insert.
CREATE OR REPLACE FUNCTION public.bump_daily_counter(
  p_user_id uuid,
  p_counter text,
  p_amount  int
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.work_sessions (user_id, work_date, daily_counters)
  VALUES (
    p_user_id, current_date,
    jsonb_build_object(p_counter, p_amount)
  )
  ON CONFLICT (user_id, work_date) DO UPDATE SET
    daily_counters = jsonb_set(
      COALESCE(public.work_sessions.daily_counters, '{}'::jsonb),
      ARRAY[p_counter],
      to_jsonb(
        COALESCE((public.work_sessions.daily_counters ->> p_counter)::int, 0) + p_amount
      ),
      true
    ),
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.lead_activity_bump_counter()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.activity_type = 'call' THEN
    PERFORM public.bump_daily_counter(NEW.created_by, 'calls', 1);
  ELSIF NEW.activity_type = 'meeting' THEN
    PERFORM public.bump_daily_counter(NEW.created_by, 'meetings', 1);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_activity_bump_counter ON public.lead_activities;
CREATE TRIGGER trg_lead_activity_bump_counter
  AFTER INSERT ON public.lead_activities
  FOR EACH ROW
  EXECUTE FUNCTION public.lead_activity_bump_counter();

CREATE OR REPLACE FUNCTION public.call_log_bump_counter()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.bump_daily_counter(NEW.user_id, 'calls', 1);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_call_log_bump_counter ON public.call_logs;
CREATE TRIGGER trg_call_log_bump_counter
  AFTER INSERT ON public.call_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.call_log_bump_counter();

-- 8.4 New-lead counter on leads insert.
CREATE OR REPLACE FUNCTION public.lead_after_insert_bump_counter()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.bump_daily_counter(NEW.created_by, 'new_leads', 1);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_after_insert_bump_counter ON public.leads;
CREATE TRIGGER trg_lead_after_insert_bump_counter
  AFTER INSERT ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.lead_after_insert_bump_counter();

-- 8.5 work_sessions.updated_at touch.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_work_sessions_touch ON public.work_sessions;
CREATE TRIGGER trg_work_sessions_touch
  BEFORE UPDATE ON public.work_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

-- 8.6 leads.updated_at touch (separate from §8.1 which handles SLA).
DROP TRIGGER IF EXISTS trg_leads_touch ON public.leads;
-- (Already covered by §8.1 trg_leads_set_handoff_sla which sets updated_at.)


-- =====================================================================
-- §9. RLS — enable + policies for all new tables
-- =====================================================================

ALTER TABLE public.leads           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_imports    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays        ENABLE ROW LEVEL SECURITY;

-- 9.1 LEADS policies
DROP POLICY IF EXISTS "leads_admin_all"           ON public.leads;
DROP POLICY IF EXISTS "leads_govt_partner_read"   ON public.leads;
DROP POLICY IF EXISTS "leads_govt_partner_write"  ON public.leads;
DROP POLICY IF EXISTS "leads_sales_own"           ON public.leads;
DROP POLICY IF EXISTS "leads_telecaller_own"      ON public.leads;
DROP POLICY IF EXISTS "leads_manager_team"        ON public.leads;

CREATE POLICY "leads_admin_all" ON public.leads FOR ALL
  USING (public.get_my_role() = 'admin');

CREATE POLICY "leads_govt_partner_read" ON public.leads FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.users u
             WHERE u.id = auth.uid() AND u.team_role = 'government_partner')
    AND segment = 'GOVERNMENT'
  );

CREATE POLICY "leads_govt_partner_write" ON public.leads FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.users u
             WHERE u.id = auth.uid() AND u.team_role = 'government_partner')
    AND segment = 'GOVERNMENT'
  );

CREATE POLICY "leads_sales_own" ON public.leads FOR ALL
  USING (
    public.get_my_role() IN ('sales','agency')
    AND assigned_to = auth.uid()
  );

CREATE POLICY "leads_telecaller_own" ON public.leads FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.users u
             WHERE u.id = auth.uid() AND u.team_role = 'telecaller')
    AND (telecaller_id = auth.uid() OR assigned_to = auth.uid())
  );

-- Sales manager sees their direct reports' leads.
CREATE POLICY "leads_manager_team" ON public.leads FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.users u
             WHERE u.id = auth.uid() AND u.team_role = 'sales_manager')
    AND (
      assigned_to IN (SELECT id FROM public.users WHERE manager_id = auth.uid())
      OR telecaller_id IN (SELECT id FROM public.users WHERE manager_id = auth.uid())
      OR assigned_to = auth.uid()
      OR telecaller_id = auth.uid()
    )
  );

-- 9.2 LEAD_ACTIVITIES — visible if you can see the parent lead.
DROP POLICY IF EXISTS "lead_activities_admin_all" ON public.lead_activities;
DROP POLICY IF EXISTS "lead_activities_via_lead"  ON public.lead_activities;

CREATE POLICY "lead_activities_admin_all" ON public.lead_activities FOR ALL
  USING (public.get_my_role() = 'admin');

CREATE POLICY "lead_activities_via_lead" ON public.lead_activities FOR ALL
  USING (
    lead_id IN (SELECT id FROM public.leads)
  );

-- 9.3 LEAD_IMPORTS — admin manage; uploader read own.
DROP POLICY IF EXISTS "lead_imports_admin_all"  ON public.lead_imports;
DROP POLICY IF EXISTS "lead_imports_own_read"   ON public.lead_imports;
DROP POLICY IF EXISTS "lead_imports_own_insert" ON public.lead_imports;

CREATE POLICY "lead_imports_admin_all" ON public.lead_imports FOR ALL
  USING (public.get_my_role() = 'admin');

CREATE POLICY "lead_imports_own_read" ON public.lead_imports FOR SELECT
  USING (uploaded_by = auth.uid());

CREATE POLICY "lead_imports_own_insert" ON public.lead_imports FOR INSERT
  WITH CHECK (uploaded_by = auth.uid());

-- 9.4 WORK_SESSIONS — own + admin/manager visibility.
DROP POLICY IF EXISTS "work_sessions_admin_all"   ON public.work_sessions;
DROP POLICY IF EXISTS "work_sessions_own"         ON public.work_sessions;
DROP POLICY IF EXISTS "work_sessions_manager"     ON public.work_sessions;
DROP POLICY IF EXISTS "work_sessions_govt_partner" ON public.work_sessions;

CREATE POLICY "work_sessions_admin_all" ON public.work_sessions FOR ALL
  USING (public.get_my_role() = 'admin');

CREATE POLICY "work_sessions_own" ON public.work_sessions FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "work_sessions_manager" ON public.work_sessions FOR SELECT
  USING (
    user_id IN (SELECT id FROM public.users WHERE manager_id = auth.uid())
  );

CREATE POLICY "work_sessions_govt_partner" ON public.work_sessions FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.users u
             WHERE u.id = auth.uid() AND u.team_role = 'government_partner')
    AND user_id IN (
      SELECT id FROM public.users WHERE team_role IN ('sales','telecaller','agency')
    )
  );

-- 9.5 CALL_LOGS — own + admin/manager.
DROP POLICY IF EXISTS "call_logs_admin_all" ON public.call_logs;
DROP POLICY IF EXISTS "call_logs_own"       ON public.call_logs;
DROP POLICY IF EXISTS "call_logs_manager"   ON public.call_logs;

CREATE POLICY "call_logs_admin_all" ON public.call_logs FOR ALL
  USING (public.get_my_role() = 'admin');

CREATE POLICY "call_logs_own" ON public.call_logs FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "call_logs_manager" ON public.call_logs FOR SELECT
  USING (
    user_id IN (SELECT id FROM public.users WHERE manager_id = auth.uid())
  );

-- 9.6 HOLIDAYS — admin manages, everyone reads.
DROP POLICY IF EXISTS "holidays_admin_all" ON public.holidays;
DROP POLICY IF EXISTS "holidays_read_all"  ON public.holidays;

CREATE POLICY "holidays_admin_all" ON public.holidays FOR ALL
  USING (public.get_my_role() = 'admin');

CREATE POLICY "holidays_read_all" ON public.holidays FOR SELECT
  USING (auth.uid() IS NOT NULL);


-- =====================================================================
-- §10. Realtime + schema cache reload
-- =====================================================================
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.leads;           EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_activities; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.work_sessions;   EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.call_logs;       EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- VERIFY (run separately after the above succeeds):
--
--   SELECT count(*) FROM public.holidays;
--   -- expect: 8 (4 in 2026, 4 in 2027)
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'users' AND column_name IN ('manager_id','city','team_role','daily_targets');
--   -- expect: 4 rows
--
--   SELECT tablename FROM pg_tables WHERE schemaname='public'
--     AND tablename IN ('leads','lead_activities','lead_imports','work_sessions','call_logs','holidays');
--   -- expect: 6 rows
--
--   SELECT polname FROM pg_policy WHERE polrelid = 'public.leads'::regclass ORDER BY polname;
--   -- expect: leads_admin_all, leads_govt_partner_read, leads_govt_partner_write,
--   --         leads_manager_team, leads_sales_own, leads_telecaller_own (6 policies)
--
--   SELECT public.is_off_day('2026-08-15');  -- expect: true (Independence Day)
--   SELECT public.is_off_day('2026-05-06');  -- expect: false (Wednesday)
--   SELECT public.is_off_day('2026-05-10');  -- expect: true (Sunday)
-- =====================================================================
