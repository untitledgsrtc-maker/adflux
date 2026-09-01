-- ============================================================================
-- supabase_ops_p10_camera_tickets.sql — Camera-off auto-ticketing (§272/§255).
-- ============================================================================
-- Owner: a screen that is ONLINE but its camera is DEAD is a real fault — auto-
-- open a ticket for it, like the offline auto-tickets. Built FULLY ISOLATED so
-- nothing else is affected ("make sure current functions don't affect"):
--   • a SEPARATE function (ops_reconcile_camera_tickets) — the offline reconcile
--     (ops_reconcile_offline_tickets, §259) is BYTE-UNTOUCHED.
--   • a NEW ticket type 'camera_fault' + source 'auto_camera' — so the cockpit's
--     type='fault' counts (p6/p7) AND the offline auto-cancel (source='auto_offline',
--     §259) are UNAFFECTED. Auto tickets aren't rendered in OpsTicketsV2 (manual-only),
--     so the new type breaks no frontend.
--   • NEVER writes ops_uptime_daily → uptime PAY (§258) is untouched.
--   • NO WhatsApp (a dead camera is lower-urgency than a dark screen — the screen
--     still runs ads; avoids alert fatigue + no ticket-wa change).
--
-- Camera fault = a screen status='online' AND camera_active=false (screen up, camera
-- dead). An OFFLINE screen's camera is already covered by its offline ticket, and at
-- night screens are timer-off, so the WHOLE function is night-gated (7 AM–9 PM IST):
-- no camera assessment off-hours (also prevents a night false-cancel of a daytime
-- ticket). Per depot: one open 'auto_camera' ticket. Calendar-day auto-close (§259).
-- Idempotent. Owner runs it; then it fires from the sync (api/ops/sync.js, §262).
-- ============================================================================

-- ── extend the CHECKs (additive) ────────────────────────────────────────────
ALTER TABLE public.ops_tickets DROP CONSTRAINT IF EXISTS ops_tickets_type_check;
ALTER TABLE public.ops_tickets ADD  CONSTRAINT ops_tickets_type_check
  CHECK (type IN ('fault','photo_request','camera_fault'));

ALTER TABLE public.ops_tickets DROP CONSTRAINT IF EXISTS ops_tickets_source_check;
ALTER TABLE public.ops_tickets ADD  CONSTRAINT ops_tickets_source_check
  CHECK (source IN ('manual','api_webhook','sales_request','auto_offline','auto_camera'));

-- ── the camera reconcile (SEPARATE from ops_reconcile_offline_tickets) ───────
CREATE OR REPLACE FUNCTION public.ops_reconcile_camera_tickets()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  d           record;
  v_camoff    int;
  v_ticket    uuid;
  v_row       int;
  v_opened    int := 0;
  v_cancelled int := 0;
  v_hour      int := extract(hour FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int;
BEGIN
  -- WHOLE function night-gated (7 AM–9 PM IST): off-hours the screens are timer-off,
  -- so there is no online-but-camera-dead state to assess, and a night pass would
  -- false-cancel a daytime camera ticket. Matches opsHours.js + §254.1 + p4.
  IF v_hour < 7 OR v_hour >= 21 THEN
    RETURN jsonb_build_object('skipped', 'off-hours');
  END IF;

  FOR d IN SELECT id, name, assigned_to FROM public.ops_depots WHERE is_active LOOP
    -- serialize concurrent camera reconciles per depot (own lock key, so it never
    -- contends with the offline reconcile's 'ops_reconcile:' lock)
    PERFORM pg_advisory_xact_lock(hashtext('ops_cam_reconcile:' || d.id::text));

    -- camera fault = screen ONLINE but camera dead. Excludes offline screens
    -- (covered by the offline ticket) and null-camera screens (no camera at all).
    SELECT count(*) INTO v_camoff
      FROM public.ops_screens
     WHERE depot_id = d.id AND is_active
       AND status = 'online' AND camera_active = false;

    IF v_camoff > 0 THEN
      -- open ONE camera ticket per depot if none is open/in-progress yet
      IF NOT EXISTS (
        SELECT 1 FROM public.ops_tickets
         WHERE depot_id = d.id AND source = 'auto_camera'
           AND status IN ('open','in_progress')
      ) THEN
        INSERT INTO public.ops_tickets
          (type, source, status, depot_id, screen_id, issue_type_id,
           assigned_to, down_count, priority, opened_at)
        VALUES
          ('camera_fault','auto_camera','open', d.id, NULL, NULL,
           d.assigned_to, v_camoff, 'low', now())
        RETURNING id INTO v_ticket;
        v_opened := v_opened + 1;
      END IF;

    ELSE
      -- cameras all back on this depot → auto-cancel an UNTOUCHED camera ticket
      -- opened TODAY (IST) only. A previous-day camera fault STAYS open (§259 rule).
      UPDATE public.ops_tickets
         SET status = 'cancelled', resolved_at = now(),
             notes = COALESCE(notes,'') || ' [auto-recovered]', updated_at = now()
       WHERE depot_id = d.id AND source = 'auto_camera' AND status = 'open'
         AND (opened_at AT TIME ZONE 'Asia/Kolkata')::date
             = (now()   AT TIME ZONE 'Asia/Kolkata')::date;
      GET DIAGNOSTICS v_row = ROW_COUNT;
      v_cancelled := v_cancelled + v_row;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('opened', v_opened, 'cancelled', v_cancelled);
EXCEPTION WHEN OTHERS THEN
  -- best-effort — a camera-reconcile failure must never break the sync
  RETURN jsonb_build_object('error', SQLERRM);
END $$;

REVOKE ALL     ON FUNCTION public.ops_reconcile_camera_tickets() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ops_reconcile_camera_tickets() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT to_regprocedure('public.ops_reconcile_camera_tickets()') IS NOT NULL AS fn;
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ops_tickets_type_check';
--   -- want: CHECK (type = ANY (ARRAY['fault'::text,'photo_request'::text,'camera_fault'::text]))
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ops_tickets_source_check';
-- SELECT public.ops_reconcile_camera_tickets();   -- on-hours: {opened,cancelled}; off-hours: {skipped}
-- ============================================================================
