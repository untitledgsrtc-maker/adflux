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
