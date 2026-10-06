-- ============================================================================
-- db/functions/tg_push_on_lead_assign.sql — CANONICAL HOME (CLAUDE.md §71 / §72)
-- ============================================================================
--
-- ⭐ The ONE place tg_push_on_lead_assign lives. EDIT THIS FILE to change it; never
--    re-paste it into a new phaseN file. It lived in 2 files (33W original, 98.A quiet
--    hours). Phase 335 consolidates it here AND adds the telecaller "new lead" push.
--
-- WHAT IT DOES: row trigger function behind  tg_push_lead_assign  on public.leads
--    (AFTER INSERT OR UPDATE OF assigned_to, WHEN (NOT lead_is_self_import(...)) — Phase 330).
--    It pings the lead's owner with "New lead: <name>" through enqueue_push (§28 frozen push
--    pipeline), inside the 09:00-20:59 IST quiet-hours window (is_push_allowed_now, Phase 98.A).
--
-- BRANCH 1 — assigned_to path (SALES, and WhatsApp/Meta/QR leads that set BOTH columns).
--    BYTE-IDENTICAL to the Phase 98.A body that was live on 2026-10-06. FROZEN: do not edit.
--    INSERT with assigned_to set, or UPDATE that changes assigned_to -> push assigned_to,
--    tag 'lead-<lead id>', url '/leads/<lead id>'.
--
-- BRANCH 2 — telecaller-only path (Phase 335, owner decision 2026-10-06 "telecallers should get a
--    new-lead notification"). A telecaller-owned lead has assigned_to NULL and the owner in
--    telecaller_id (§99.C), so branch 1 never saw it (~746 leads / 30 days: admin CSV imports
--    712 + hand-offs 34). INSERT only; the UPDATE/reassign path is NOT touched (Phase 100.E
--    _reassign_lead_apply already pings the new owner through the follow-up landing task).
--      * single lead (import_id NULL)  -> push telecaller_id, same title/body/url/tag as branch 1
--      * bulk import  (import_id set)  -> ONE push per (import, telecaller):
--            tag 'lead-batch-<import_id>', url '/leads', serialised by an advisory lock and
--            skipped when push_log already holds that tag for that user within 24 h.
--            (admin import of 189 leads for Sneha = 1 push, not 189.)
--      * created_by = telecaller_id    -> silent (you do not need a ping for a lead you just typed)
--      * quiet hours                   -> silent (and nothing is logged, so no half-state)
--      * the whole branch sits in its own BEGIN..EXCEPTION block: a push problem can NEVER
--        fail the lead insert (§45). Branch 1 stays un-wrapped exactly as it was live.
--    Never fires for: WhatsApp / Meta / QR leads (both columns set -> branch 1; their separate
--    'wa-lead-<conv>' push is tg_push_on_wa_inbound_lead), Phase 330 self-imports (the trigger WHEN
--    clause keeps them out), reassigns, or leads with no telecaller.
--
-- TRIGGER WIRING stays in supabase_phase330_csv_upload_quiet_imports.sql (it owns the WHEN clause).
--    This canonical owns the FUNCTION BODY only. Do NOT change the trigger's event list
--    (INSERT OR UPDATE OF assigned_to): branch 2 relies on INSERT already being in it.
--
-- NO OVERLAP / NO DOUBLE-PING (checked live 2026-10-06):
--    * tg_push_on_wa_inbound_lead   fires on whatsapp_conversations.lead_id NULL->set; those leads
--      carry BOTH owner columns -> branch 1 only. Branch 2 never sees them.
--    * tg_push_on_followup_due      an auto follow-up is due TOMORROW (no push at INSERT).
--    * _reassign_lead_apply (100.E) UPDATE only; branch 2 is INSERT only.
--
-- SUPERSEDES (Phase 335 replaces the function body in each with a pointer; siblings kept):
--      supabase_phase33w_push_triggers.sql              (keeps the other 3 push functions)
--      supabase_phase98_a_quiet_hours_3_triggers.sql    (keeps tg_push_on_payment_approved + tg_push_on_quote_won)
--
-- REVERT: re-run this file with branch 2 removed (the Phase 98.A body), or
--    DROP-free: CREATE OR REPLACE with the BRANCH 1 block only. TRIPWIRE: VERIFY block at the bottom.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_push_on_lead_assign()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_title text;
  v_body  text;
  v_tag   text;
BEGIN
  -- INSERT with assignee, OR UPDATE to a different assignee.
  IF (TG_OP = 'INSERT' AND NEW.assigned_to IS NOT NULL)
     OR (TG_OP = 'UPDATE'
         AND NEW.assigned_to IS NOT NULL
         AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to) THEN
    v_title := 'New lead: ' || COALESCE(NEW.name, NEW.company, 'unnamed');
    v_body  := COALESCE(NEW.company, '') ||
               CASE WHEN NEW.phone IS NOT NULL THEN ' · ' || NEW.phone ELSE '' END;
    -- Phase 98.A — quiet-hours gate.
    IF public.is_push_allowed_now() THEN
      PERFORM public.enqueue_push(
        NEW.assigned_to,
        v_title,
        v_body,
        '/leads/' || NEW.id::text,
        'lead-' || NEW.id::text
      );
    END IF;
  END IF;

  -- Phase 335 — TELECALLER-ONLY lead (assigned_to NULL, owner in telecaller_id). INSERT only.
  -- Own subtransaction: a failure here can never fail the lead insert.
  IF TG_OP = 'INSERT'
     AND NEW.assigned_to IS NULL
     AND NEW.telecaller_id IS NOT NULL
     AND NEW.created_by IS DISTINCT FROM NEW.telecaller_id THEN
    BEGIN
      IF public.is_push_allowed_now() THEN
        IF NEW.import_id IS NULL THEN
          -- One lead added by hand / an API: same message + tag convention as branch 1.
          v_title := 'New lead: ' || COALESCE(NEW.name, NEW.company, 'unnamed');
          v_body  := COALESCE(NEW.company, '') ||
                     CASE WHEN NEW.phone IS NOT NULL THEN ' · ' || NEW.phone ELSE '' END;
          PERFORM public.enqueue_push(
            NEW.telecaller_id,
            v_title,
            v_body,
            '/leads/' || NEW.id::text,
            'lead-' || NEW.id::text
          );
        ELSE
          -- Bulk import: ONE push per (import, telecaller). The advisory lock makes two
          -- parallel chunks of the same import wait for each other, so the EXISTS check below
          -- sees the first chunk's push_log row.
          v_tag := 'lead-batch-' || NEW.import_id::text;
          PERFORM pg_advisory_xact_lock(
            hashtextextended('tg_push_on_lead_assign:' || NEW.telecaller_id::text || ':' || v_tag, 0));
          IF NOT EXISTS (
            SELECT 1 FROM public.push_log pl
             WHERE pl.user_id = NEW.telecaller_id
               AND pl.tag = v_tag
               AND pl.enqueued_at > now() - interval '1 day'
          ) THEN
            PERFORM public.enqueue_push(
              NEW.telecaller_id,
              'New leads: ' || COALESCE(NEW.name, NEW.company, 'unnamed') || ' and more',
              'A batch of new leads was added to your list',
              '/leads',
              v_tag
            );
          END IF;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- A push must NEVER break the lead insert (CLAUDE.md §45).
      RAISE WARNING '[tg_push_on_lead_assign] telecaller push skipped for lead %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END $function$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY / TRIPWIRE — read-only, run any time. All 8 columns must be TRUE.
-- Any FALSE = an old phase file was re-run (or the body drifted) -> re-run THIS file.
-- ============================================================================
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%IF public.is_push_allowed_now() THEN%'              AS quiet_hours_gate,
--   pg_get_functiondef(p.oid) LIKE '%NEW.assigned_to IS DISTINCT FROM OLD.assigned_to%'   AS branch1_reassign_path,
--   pg_get_functiondef(p.oid) LIKE '%AND NEW.telecaller_id IS NOT NULL%'                  AS branch2_tc_only,
--   pg_get_functiondef(p.oid) LIKE '%lead-batch-%'                                        AS branch2_batch_tag,
--   pg_get_functiondef(p.oid) LIKE '%pg_advisory_xact_lock%'                              AS branch2_lock,
--   pg_get_functiondef(p.oid) LIKE '%EXCEPTION WHEN OTHERS%'                              AS branch2_never_breaks_insert,
--   p.prosecdef AND p.proconfig::text LIKE '%search_path=public%'                         AS definer_search_path,
--   (SELECT pg_get_triggerdef(t.oid) LIKE '%WHEN ((NOT lead_is_self_import(%'
--       AND pg_get_triggerdef(t.oid) LIKE '%AFTER INSERT OR UPDATE OF assigned_to%'
--      FROM pg_trigger t WHERE t.tgname = 'tg_push_lead_assign' AND NOT t.tgisinternal)   AS trigger_wiring_p330
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'tg_push_on_lead_assign';
