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
