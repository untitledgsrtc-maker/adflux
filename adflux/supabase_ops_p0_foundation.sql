-- supabase_ops_p0_foundation.sql
-- OPERATIONS MODULE — Phase 0: roles · tables · RLS · storage · seed.
-- ─────────────────────────────────────────────────────────────────────────
-- Additive + §45-safe: adds TWO roles (operation_head, operation_executive),
-- SIX new ops_* tables, a private ops-photos bucket, and seed. Touches NO
-- existing table's DATA and edits NO existing (frozen) RLS policy — the only
-- edit to a shared object is users_role_check (drop+re-add WITH every current
-- role PLUS the two new ones), and the ops access on the reused gps_pings /
-- daily_ta tables is added as BRAND-NEW policies (RLS is permissive/OR, so a
-- new policy only ADDS access — the frozen sales policies are untouched).
--
-- work_sessions + call_logs need NO change: their _own / _manager policies are
-- NOT role-gated (user_id=auth.uid() / manager_id chain), so the ops roles get
-- attendance + call tracking for free (verified against phase12:469-503).
--
-- Idempotent (§8): re-runnable. One paste (§154). The compute_daily_score
-- uptime-pay branch is Phase 4 — this only creates the ops_uptime_daily table.
-- ═════════════════════════════════════════════════════════════════════════

-- ═══ 1 · ROLES ════════════════════════════════════════════════════════════
-- Re-add the CHECK with the full current set (phase97_e) + the two ops roles.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check CHECK (role = ANY (ARRAY[
    'admin'::text, 'sales'::text, 'co_owner'::text, 'agency'::text,
    'telecaller'::text, 'office_staff'::text, 'hr'::text, 'accounts'::text,
    'staff'::text,
    'operation_head'::text, 'operation_executive'::text   -- ← Operations module
  ]));
-- team_role CHECK is unchanged: the ops roles use `role` (matches get_my_role()
-- + the V2AppShell GPS gate + the gps_pings RLS), not team_role.

-- ═══ 2 · TABLES ═══════════════════════════════════════════════════════════

-- 2.1 depots (the 21 bus-stands). assigned_to = the OWNING field tech (the Head
--     reassigns it → moves the depot's work AND its uptime-pay attribution).
CREATE TABLE IF NOT EXISTS public.ops_depots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id      uuid REFERENCES public.cities(id) ON DELETE SET NULL,
  name         text NOT NULL,
  code         text,
  assigned_to  uuid REFERENCES public.users(id) ON DELETE SET NULL,  -- owning tech
  lat          numeric(10,7),
  lng          numeric(10,7),
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_id)
);
CREATE INDEX IF NOT EXISTS idx_ops_depots_assigned ON public.ops_depots(assigned_to);

-- 2.2 screens — CHILD of cities (cities stays the station master; this holds the
--     individual screens tickets attach to). external_id = the aiadflux UUID.
CREATE TABLE IF NOT EXISTS public.ops_screens (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id      text UNIQUE,                                  -- aiadflux screen UUID (sync)
  depot_id         uuid REFERENCES public.ops_depots(id) ON DELETE CASCADE,
  city_id          uuid REFERENCES public.cities(id) ON DELETE SET NULL,
  name             text NOT NULL,
  status           text NOT NULL DEFAULT 'unknown'
                     CHECK (status IN ('online','offline','unknown')),
  last_response_at timestamptz,
  orientation      text,
  lat              numeric(10,7),
  lng              numeric(10,7),
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ops_screens_depot  ON public.ops_screens(depot_id);
CREATE INDEX IF NOT EXISTS idx_ops_screens_status ON public.ops_screens(status);

-- 2.3 issue types → who-to-call (bilingual gu/en).
CREATE TABLE IF NOT EXISTS public.ops_issue_types (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_en      text NOT NULL UNIQUE,
  issue_gu      text,
  solution_en   text,
  solution_gu   text,
  display_order int NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 2.4 per-depot contacts (bilingual role label).
CREATE TABLE IF NOT EXISTS public.ops_depot_contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  depot_id      uuid NOT NULL REFERENCES public.ops_depots(id) ON DELETE CASCADE,
  role_en       text,
  role_gu       text,
  name          text,
  phone         text,
  display_order int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ops_contacts_depot ON public.ops_depot_contacts(depot_id);

-- 2.5 tickets — fault OR photo-request. assigned_to defaults to the depot owner;
--     the Head can reassign it (or the whole depot). requested_by = the sales rep
--     on a photo request; quote_id links the live campaign.
CREATE TABLE IF NOT EXISTS public.ops_tickets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type          text NOT NULL DEFAULT 'fault'
                  CHECK (type IN ('fault','photo_request')),
  screen_id     uuid REFERENCES public.ops_screens(id) ON DELETE SET NULL,
  depot_id      uuid REFERENCES public.ops_depots(id) ON DELETE SET NULL,
  issue_type_id uuid REFERENCES public.ops_issue_types(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','in_progress','resolved','cancelled')),
  priority      text NOT NULL DEFAULT 'normal'
                  CHECK (priority IN ('low','normal','high')),
  assigned_to   uuid REFERENCES public.users(id) ON DELETE SET NULL,   -- the tech
  requested_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,   -- sales rep (photo req)
  quote_id      uuid REFERENCES public.quotes(id) ON DELETE SET NULL,  -- the live campaign
  source        text NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual','api_webhook','sales_request')),
  opened_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  sla_due_at    timestamptz,
  cause         text,
  notes         text,
  photo_path    text,                                                  -- ops-photos storage key
  created_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ops_tickets_assigned ON public.ops_tickets(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_ops_tickets_depot    ON public.ops_tickets(depot_id, status);
CREATE INDEX IF NOT EXISTS idx_ops_tickets_reqby    ON public.ops_tickets(requested_by) WHERE requested_by IS NOT NULL;

-- 2.6 daily uptime per tech (the Phase-4 pay signal; created here, written later).
CREATE TABLE IF NOT EXISTS public.ops_uptime_daily (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  work_date     date NOT NULL,
  screens_total int  NOT NULL DEFAULT 0,
  screens_up    int  NOT NULL DEFAULT 0,
  uptime_pct    numeric(5,2) NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, work_date)
);

-- ═══ 3 · RLS ══════════════════════════════════════════════════════════════
-- ops_* tables: admin/co_owner + operation_head manage the network; the
-- operation_executive reads the masters + owns their tickets; a sales rep may
-- raise a photo-request + see it come back.

ALTER TABLE public.ops_depots         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_screens        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_issue_types    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_depot_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_tickets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_uptime_daily   ENABLE ROW LEVEL SECURITY;

-- 3.1 masters (depots / screens / issue_types / contacts): head+admin FOR ALL,
--     ops_executive SELECT.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ops_depots','ops_screens','ops_issue_types','ops_depot_contacts']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_manage', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_read',   t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR ALL
      USING (public.get_my_role() IN ('admin','co_owner','operation_head'))
      WITH CHECK (public.get_my_role() IN ('admin','co_owner','operation_head'))$p$, t||'_manage', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT
      USING (public.get_my_role() = 'operation_executive')$p$, t||'_read', t);
  END LOOP;
END $$;

-- 3.2 ops_tickets — head/admin FOR ALL; exec owns their tickets; sales raises photo-requests.
DROP POLICY IF EXISTS ops_tickets_manage       ON public.ops_tickets;
DROP POLICY IF EXISTS ops_tickets_exec_read     ON public.ops_tickets;
DROP POLICY IF EXISTS ops_tickets_exec_update   ON public.ops_tickets;
DROP POLICY IF EXISTS ops_tickets_exec_insert   ON public.ops_tickets;
DROP POLICY IF EXISTS ops_tickets_sales_request ON public.ops_tickets;
DROP POLICY IF EXISTS ops_tickets_sales_read    ON public.ops_tickets;

CREATE POLICY ops_tickets_manage ON public.ops_tickets FOR ALL
  USING (public.get_my_role() IN ('admin','co_owner','operation_head'))
  WITH CHECK (public.get_my_role() IN ('admin','co_owner','operation_head'));

CREATE POLICY ops_tickets_exec_read ON public.ops_tickets FOR SELECT
  USING (public.get_my_role() = 'operation_executive' AND assigned_to = auth.uid());

CREATE POLICY ops_tickets_exec_update ON public.ops_tickets FOR UPDATE
  USING (public.get_my_role() = 'operation_executive' AND assigned_to = auth.uid())
  WITH CHECK (public.get_my_role() = 'operation_executive' AND assigned_to = auth.uid());

CREATE POLICY ops_tickets_exec_insert ON public.ops_tickets FOR INSERT
  WITH CHECK (public.get_my_role() = 'operation_executive' AND created_by = auth.uid());

-- a sales/agency/telecaller rep raises a PHOTO REQUEST for a live campaign… (the
-- head already has _manage FOR ALL, so it is intentionally NOT listed here). The
-- INSERT is pinned to a photo_request the rep themselves requested + created.
CREATE POLICY ops_tickets_sales_request ON public.ops_tickets FOR INSERT
  WITH CHECK (
    public.get_my_role() IN ('sales','agency','telecaller')
    AND type = 'photo_request' AND requested_by = auth.uid() AND created_by = auth.uid()
  );
-- …and sees their own requests come back.
CREATE POLICY ops_tickets_sales_read ON public.ops_tickets FOR SELECT
  USING (requested_by = auth.uid());

-- 3.3 ops_uptime_daily — head/admin all; exec reads own.
DROP POLICY IF EXISTS ops_uptime_manage   ON public.ops_uptime_daily;
DROP POLICY IF EXISTS ops_uptime_exec_read ON public.ops_uptime_daily;
CREATE POLICY ops_uptime_manage ON public.ops_uptime_daily FOR ALL
  USING (public.get_my_role() IN ('admin','co_owner','operation_head'))
  WITH CHECK (public.get_my_role() IN ('admin','co_owner','operation_head'));
CREATE POLICY ops_uptime_exec_read ON public.ops_uptime_daily FOR SELECT
  USING (public.get_my_role() = 'operation_executive' AND user_id = auth.uid());

-- 3.4 ADDITIVE ops policies on the REUSED tracking tables (never edits the
--     frozen sales policies — new permissive policies only ADD access).
-- gps_pings: the field tech reads+inserts OWN pings (else background GPS 42501s);
--            the head reads the whole ops-exec team's pings for the live map.
DROP POLICY IF EXISTS gps_pings_ops_read_own   ON public.gps_pings;
DROP POLICY IF EXISTS gps_pings_ops_insert_own ON public.gps_pings;
DROP POLICY IF EXISTS gps_pings_ops_head       ON public.gps_pings;
CREATE POLICY gps_pings_ops_read_own ON public.gps_pings FOR SELECT
  USING (public.get_my_role() = 'operation_executive' AND user_id = auth.uid());
CREATE POLICY gps_pings_ops_insert_own ON public.gps_pings FOR INSERT
  WITH CHECK (public.get_my_role() = 'operation_executive' AND user_id = auth.uid());
CREATE POLICY gps_pings_ops_head ON public.gps_pings FOR SELECT
  USING (public.get_my_role() = 'operation_head'
         AND user_id IN (SELECT id FROM public.users WHERE role = 'operation_executive'));

-- daily_ta: the head reads the ops-exec team's TA (ta_self_read already covers
--           the exec's own; there is no manager policy on daily_ta today).
DROP POLICY IF EXISTS ta_ops_head ON public.daily_ta;
CREATE POLICY ta_ops_head ON public.daily_ta FOR SELECT
  USING (public.get_my_role() = 'operation_head'
         AND user_id IN (SELECT id FROM public.users WHERE role = 'operation_executive'));

-- ═══ 4 · STORAGE — private ops-photos bucket (fix-proof + live-campaign photos) ═══
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('ops-photos', 'ops-photos', false, 10485760)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS ops_photos_read   ON storage.objects;
DROP POLICY IF EXISTS ops_photos_insert ON storage.objects;
-- Read scoped to the ops team only (private-bucket convention, §8/Phase-11). A
-- requesting sales rep does NOT get blanket bucket read — the app hands them THEIR
-- photo via a short-lived signed URL after checking they own that ticket (Phase 3).
CREATE POLICY ops_photos_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ops-photos'
         AND public.get_my_role() IN ('admin','co_owner','operation_head','operation_executive'));
CREATE POLICY ops_photos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ops-photos'
              AND public.get_my_role() IN ('operation_executive','operation_head','admin','co_owner'));

-- ═══ 5 · SEED (idempotent) ════════════════════════════════════════════════

-- 5.1 issue types → who-to-call (bilingual). Owner can refine the Gujarati.
INSERT INTO public.ops_issue_types (issue_en, issue_gu, solution_en, solution_gu, display_order) VALUES
 ('Ethernet / Internet Issue','ઇન્ટરનેટ / ઇથરનેટ સમસ્યા','Contact Network Technician','નેટવર્ક ટેકનિશિયનનો સંપર્ક કરો',1),
 ('Screen Damage','સ્ક્રીન નુકસાન','Contact Screen Service Team','સ્ક્રીન સર્વિસ ટીમનો સંપર્ક કરો',2),
 ('Timer Issue','ટાઈમર સમસ્યા','Contact Electrician','ઇલેક્ટ્રિશિયનનો સંપર્ક કરો',3),
 ('Switch Problem','સ્વિચ સમસ્યા','Check / Replace Switch','સ્વિચ તપાસો / બદલો',4),
 ('Power Cut','વીજ કાપ','Contact Depot Manager / Electrician','ડેપો મેનેજર / ઇલેક્ટ્રિશિયનનો સંપર્ક કરો',5),
 ('Software Issue','સોફ્ટવેર સમસ્યા','Contact Software Support','સોફ્ટવેર સપોર્ટનો સંપર્ક કરો',6),
 ('Wiring Problem','વાયરિંગ સમસ્યા','Contact Electrician','ઇલેક્ટ્રિશિયનનો સંપર્ક કરો',7),
 ('Screen Blank','સ્ક્રીન કોરી (બ્લેન્ક)','Check Power + Ethernet + Software','પાવર + ઇથરનેટ + સોફ્ટવેર તપાસો',8),
 ('Display Problem','ડિસ્પ્લે સમસ્યા','Contact Screen Service Team','સ્ક્રીન સર્વિસ ટીમનો સંપર્ક કરો',9),
 ('Cleaning Required','સફાઈ જરૂરી','Contact Cleaning Staff','સફાઈ સ્ટાફનો સંપર્ક કરો',10),
 ('Light Bill Not Paid','વીજ બિલ બાકી','Contact Accountant','એકાઉન્ટન્ટનો સંપર્ક કરો',11)
ON CONFLICT (issue_en) DO NOTHING;

-- 5.2 depots from the cities station master (one depot per active city).
INSERT INTO public.ops_depots (city_id, name, is_active)
SELECT c.id, COALESCE(NULLIF(c.station_name,''), c.name || ' GSRTC Bus Stand'), true
  FROM public.cities c
 WHERE c.is_active = true
   AND NOT EXISTS (SELECT 1 FROM public.ops_depots d WHERE d.city_id = c.id);

-- 5.3 screens generated from cities.screens (manual registry until the aiadflux
--     sync fills real per-screen rows by external_id). Re-run-safe: only seeds a
--     depot that has no screens yet.
INSERT INTO public.ops_screens (depot_id, city_id, name, is_active)
SELECT d.id, d.city_id, c.name || ' ' || g.n, true
  FROM public.ops_depots d
  JOIN public.cities c ON c.id = d.city_id
  CROSS JOIN LATERAL generate_series(1, GREATEST(COALESCE(c.screens,0),0)) AS g(n)
 WHERE NOT EXISTS (SELECT 1 FROM public.ops_screens s WHERE s.depot_id = d.id);

NOTIFY pgrst, 'reload schema';

-- ═══ VERIFY — expect: roles_ok true · 6 tables · rls all t · bucket 1 · seed>0 ═══
-- SELECT
--   (SELECT true FROM pg_constraint WHERE conname='users_role_check'
--      AND pg_get_constraintdef(oid) LIKE '%operation_executive%')                       AS roles_ok,
--   (SELECT count(*) FROM information_schema.tables
--      WHERE table_schema='public' AND table_name LIKE 'ops\_%')                          AS ops_tables,
--   (SELECT count(*) FROM public.ops_issue_types)                                         AS issue_types,
--   (SELECT count(*) FROM public.ops_depots)                                              AS depots,
--   (SELECT count(*) FROM public.ops_screens)                                             AS screens,
--   (SELECT count(*) FROM storage.buckets WHERE id='ops-photos')                          AS bucket;
