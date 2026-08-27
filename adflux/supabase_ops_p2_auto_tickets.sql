-- supabase_ops_p2_auto_tickets.sql
-- OPERATIONS Phase 2 — auto-ticket flow (spec: docs/superpowers/specs/2026-08-27-ops-auto-ticket-flow-design.md).
-- Offline screen -> one ticket per station -> assign the depot's tech -> guarded
-- lifecycle (open -> in_progress -> resolved -> approved; cancelled for auto-recovered blips).
-- Additive to the Operations module (§230). Idempotent, re-runnable. Owner runs in Studio.
-- Sections: 1 schema · 2 engine · 3 guard RPCs · 4 WhatsApp dispatch (Task 8).
-- ═════════════════════════════════════════════════════════════════════════

-- ==== SECTION 1 · schema ====================================================
-- status gains 'approved'; source gains 'auto_offline'; add approver + down_count.
ALTER TABLE public.ops_tickets DROP CONSTRAINT IF EXISTS ops_tickets_status_check;
ALTER TABLE public.ops_tickets ADD  CONSTRAINT ops_tickets_status_check
  CHECK (status IN ('open','in_progress','resolved','approved','cancelled'));

ALTER TABLE public.ops_tickets DROP CONSTRAINT IF EXISTS ops_tickets_source_check;
ALTER TABLE public.ops_tickets ADD  CONSTRAINT ops_tickets_source_check
  CHECK (source IN ('manual','api_webhook','sales_request','auto_offline'));

ALTER TABLE public.ops_tickets ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.ops_tickets ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.ops_tickets ADD COLUMN IF NOT EXISTS down_count  int;

NOTIFY pgrst, 'reload schema';

-- ==== SECTION 2 · engine ====================================================
-- Called at the end of every aiadflux sync run (api/ops/sync.js), the cron, and
-- the /ops-admin "Record uptime" button. Per depot: open ONE auto-ticket if it
-- has offline screens and no open auto-ticket; auto-cancel an UNTOUCHED (open)
-- auto-ticket once the depot is fully back online. Never touches in_progress /
-- resolved / approved / manual / sales_request tickets. EXCEPTION-wrapped so a
-- reconcile failure can never break the sync.
CREATE OR REPLACE FUNCTION public.ops_reconcile_offline_tickets()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  d           record;
  v_down      int;
  v_ticket    uuid;
  v_row       int;
  v_opened    int := 0;
  v_cancelled int := 0;
BEGIN
  FOR d IN SELECT id, name, assigned_to FROM public.ops_depots WHERE is_active LOOP
    -- serialize concurrent reconciles per depot (sync cron + Record-uptime button)
    PERFORM pg_advisory_xact_lock(hashtext('ops_reconcile:' || d.id::text));

    SELECT count(*) INTO v_down
      FROM public.ops_screens
     WHERE depot_id = d.id AND is_active AND status = 'offline';

    IF v_down > 0 THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.ops_tickets
         WHERE depot_id = d.id AND source = 'auto_offline'
           AND status IN ('open','in_progress')
      ) THEN
        INSERT INTO public.ops_tickets
          (type, source, status, depot_id, screen_id, issue_type_id,
           assigned_to, down_count, priority, opened_at)
        VALUES
          ('fault','auto_offline','open', d.id, NULL, NULL,
           d.assigned_to, v_down,
           CASE WHEN v_down >= 5 THEN 'high' ELSE 'normal' END, now())
        RETURNING id INTO v_ticket;
        v_opened := v_opened + 1;

        -- native push to the assigned tech (best-effort; enqueue_push is §96)
        IF d.assigned_to IS NOT NULL THEN
          BEGIN
            PERFORM public.enqueue_push(
              d.assigned_to,
              'New ticket',
              d.name || ' — ' || v_down || ' screen(s) offline',
              '/ops',
              'ops-ticket-' || v_ticket::text);
          EXCEPTION WHEN OTHERS THEN NULL; END;
        END IF;
      END IF;

    ELSE
      -- depot fully back online: cancel an UNTOUCHED auto-ticket (a blip)
      UPDATE public.ops_tickets
         SET status = 'cancelled',
             resolved_at = now(),
             notes = COALESCE(notes,'') || ' [auto-recovered]',
             updated_at = now()
       WHERE depot_id = d.id AND source = 'auto_offline' AND status = 'open';
      GET DIAGNOSTICS v_row = ROW_COUNT;
      v_cancelled := v_cancelled + v_row;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('opened', v_opened, 'cancelled', v_cancelled);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', SQLERRM);
END $$;

REVOKE ALL     ON FUNCTION public.ops_reconcile_offline_tickets() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ops_reconcile_offline_tickets() TO authenticated, service_role;

-- ==== SECTION 3 · guarded lifecycle RPCs ====================================
-- All SECURITY DEFINER, fail-closed on NULL role (§41), verify the FROM-state so
-- a stale UI can't skip steps. "Screens still offline" = a live check against
-- ops_screens for the ticket's depot.

-- open -> in_progress (assigned tech OR head/admin)
CREATE OR REPLACE FUNCTION public.ops_ticket_start(p_ticket uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text := public.get_my_role(); v_assigned uuid; v_status text;
BEGIN
  SELECT assigned_to, status INTO v_assigned, v_status FROM public.ops_tickets WHERE id = p_ticket;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket not found'; END IF;
  IF v_role IS NULL OR NOT (v_role IN ('admin','co_owner','operation_head') OR (v_assigned IS NOT NULL AND v_assigned = auth.uid())) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF v_status <> 'open' THEN RAISE EXCEPTION 'ticket is not open'; END IF;
  UPDATE public.ops_tickets SET status = 'in_progress', updated_at = now() WHERE id = p_ticket;
END $$;

-- in_progress -> resolved (assigned tech OR head/admin) — BLOCKED while offline
CREATE OR REPLACE FUNCTION public.ops_ticket_resolve(p_ticket uuid, p_cause text DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text := public.get_my_role(); v_assigned uuid; v_status text; v_depot uuid;
BEGIN
  SELECT assigned_to, status, depot_id INTO v_assigned, v_status, v_depot FROM public.ops_tickets WHERE id = p_ticket;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket not found'; END IF;
  IF v_role IS NULL OR NOT (v_role IN ('admin','co_owner','operation_head') OR (v_assigned IS NOT NULL AND v_assigned = auth.uid())) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF v_status <> 'in_progress' THEN RAISE EXCEPTION 'ticket must be in progress to close'; END IF;
  IF EXISTS (SELECT 1 FROM public.ops_screens WHERE depot_id = v_depot AND is_active AND status = 'offline') THEN
    RAISE EXCEPTION 'screens still offline — cannot close yet';
  END IF;
  UPDATE public.ops_tickets
     SET status = 'resolved', resolved_at = now(),
         cause = COALESCE(NULLIF(btrim(p_cause), ''), cause),
         notes = COALESCE(NULLIF(btrim(p_notes), ''), notes),
         updated_at = now()
   WHERE id = p_ticket;
END $$;

-- resolved -> approved (HEAD/admin only) — BLOCKED while offline
CREATE OR REPLACE FUNCTION public.ops_ticket_approve(p_ticket uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text := public.get_my_role(); v_status text; v_depot uuid;
BEGIN
  SELECT status, depot_id INTO v_status, v_depot FROM public.ops_tickets WHERE id = p_ticket;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket not found'; END IF;
  IF v_role IS NULL OR v_role NOT IN ('admin','co_owner','operation_head') THEN RAISE EXCEPTION 'head only'; END IF;
  IF v_status <> 'resolved' THEN RAISE EXCEPTION 'ticket must be resolved to approve'; END IF;
  IF EXISTS (SELECT 1 FROM public.ops_screens WHERE depot_id = v_depot AND is_active AND status = 'offline') THEN
    RAISE EXCEPTION 'screens still offline — cannot approve';
  END IF;
  UPDATE public.ops_tickets SET status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now() WHERE id = p_ticket;
END $$;

-- resolved -> in_progress (HEAD/admin only) — send back to the tech
CREATE OR REPLACE FUNCTION public.ops_ticket_reject(p_ticket uuid, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text := public.get_my_role(); v_status text;
BEGIN
  SELECT status INTO v_status FROM public.ops_tickets WHERE id = p_ticket;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket not found'; END IF;
  IF v_role IS NULL OR v_role NOT IN ('admin','co_owner','operation_head') THEN RAISE EXCEPTION 'head only'; END IF;
  IF v_status <> 'resolved' THEN RAISE EXCEPTION 'ticket must be resolved to reject'; END IF;
  UPDATE public.ops_tickets
     SET status = 'in_progress',
         notes = COALESCE(notes,'') || CASE WHEN p_reason IS NOT NULL AND btrim(p_reason) <> ''
                   THEN ' [rejected: ' || btrim(p_reason) || ']' ELSE ' [rejected]' END,
         updated_at = now()
   WHERE id = p_ticket;
END $$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'ops_ticket_start(uuid)','ops_ticket_resolve(uuid,text,text)',
    'ops_ticket_approve(uuid)','ops_ticket_reject(uuid,text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ==== VERIFY (run this SELECT in Studio after the file) =====================
-- Expect: five_fns = 5 · statuses/sources include the new values · all four RPCs prosecdef=true.
-- SELECT
--   (SELECT count(*) FROM pg_proc WHERE proname IN
--      ('ops_reconcile_offline_tickets','ops_ticket_start','ops_ticket_resolve','ops_ticket_approve','ops_ticket_reject')) AS five_fns,
--   (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='ops_tickets_status_check') AS status_check,
--   (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='ops_tickets_source_check') AS source_check;
