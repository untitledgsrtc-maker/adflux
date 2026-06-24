-- ============================================================================
-- db/functions/push_followup_due_reminders.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
--
-- ⭐ The ONE place push_followup_due_reminders is allowed to live. EDIT THIS FILE
--    to change it; never re-paste it into a new phaseN file (§71). It lived in 3
--    phase files (phase130_push_hygiene, phase93_8_notification_cleanup,
--    phase97_a400_fu_due_unique_tag).
--
-- WHAT IT DOES: a CRON function (runs ~every 5 min). Finds follow_ups that became
--    due in the last 5 minutes (today, with a time, assigned, not done, not yet
--    reminded) and fires a "Follow-up due now" push via enqueue_push, then stamps
--    reminder_sent_at so each FU is reminded exactly once.
--
-- 🔒 LOCKED CONTRACTS (a diff that breaks any is a BLOCK):
--    • §130 — quiet-hours gate FIRST: IF NOT is_push_allowed_now() THEN RETURN 0.
--      No pushes outside allowed hours (dropped windows roll into the 9:30 IST
--      morning digest).
--    • §97.A400 — PER-ROW unique tag 'fu-due-' || r.id. Two FUs due in the same
--      5-min window must land as TWO tray entries, not collapse into one (a
--      constant tag would dedupe them in the tray).
--    • reminder_sent_at dedup — only FUs with reminder_sent_at IS NULL are picked,
--      and each is stamped reminder_sent_at = now() after pushing. Never re-pushed.
--    • SECURITY DEFINER + search_path public,extensions — needed to call
--      enqueue_push (which is REVOKED from authenticated, §97.A2). This fn is
--      cron-owned, so it runs as the owner and reaches enqueue_push.
--
-- PROVENANCE: captured byte-for-byte from the LIVE DB 2026-06-23 (the phase130
--    version). Single signature (no args). Running this file is a NO-OP.
--
-- SUPERSEDES (Phase 178 removed the body from each; phase130 keeps its 2 other
--    push functions):
--      supabase_phase130_push_hygiene.sql
--      supabase_phase93_8_notification_cleanup.sql
--      supabase_phase97_a400_fu_due_unique_tag.sql
--
-- REVERT: re-run this file. TRIPWIRE: VERIFY block at the bottom.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.push_followup_due_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_today_ist     date;
  v_now_ist       timestamp;
  v_window_lower  timestamp;
  v_window_upper  timestamp;
  v_count         int := 0;
  r               record;
BEGIN
  -- PHASE-130 (3) — quiet-hours gate, same helper as Phase 61.4 / 98.A.
  IF NOT public.is_push_allowed_now() THEN
    RETURN 0;
  END IF;

  v_now_ist      := (now() AT TIME ZONE 'Asia/Kolkata')::timestamp;
  v_today_ist    := v_now_ist::date;
  v_window_lower := v_now_ist - interval '5 minutes';
  v_window_upper := v_now_ist;

  FOR r IN
    SELECT fu.id, fu.assigned_to, fu.lead_id, fu.note, fu.follow_up_time,
           l.name AS lead_name, l.company AS lead_company
      FROM public.follow_ups fu
      LEFT JOIN public.leads l ON l.id = fu.lead_id
     WHERE fu.is_done           = false
       AND fu.reminder_sent_at  IS NULL
       AND fu.follow_up_date    = v_today_ist
       AND fu.follow_up_time    IS NOT NULL
       AND (v_today_ist::timestamp + fu.follow_up_time::interval) >= v_window_lower
       AND (v_today_ist::timestamp + fu.follow_up_time::interval) <= v_window_upper
       AND fu.assigned_to       IS NOT NULL
  LOOP
    PERFORM public.enqueue_push(
      r.assigned_to,
      'Follow-up due now',
      COALESCE(r.lead_name, r.lead_company, 'Lead')
        || ' · ' || to_char(r.follow_up_time, 'HH24:MI')
        || COALESCE(' · ' || r.note, ''),
      CASE WHEN r.lead_id IS NOT NULL
           THEN '/leads/' || r.lead_id::text
           ELSE '/follow-ups'
      END,
      'fu-due-' || r.id::text   -- Phase 97.A400 tag preserved
    );
    UPDATE public.follow_ups SET reminder_sent_at = now() WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

-- Matches the live grant state (the 3 phase files all granted this to authenticated).
-- It's a SECURITY DEFINER cron fn; the real security gate is the REVOKE on enqueue_push
-- (§97.A2), and a rep calling this only fires the LEGIT due reminders once each (the
-- reminder_sent_at stamp + quiet-hours gate bound it). Could be tightened to
-- service_role-only later (owner call, like enqueue_push got) — NOT changed here.
GRANT EXECUTE ON FUNCTION public.push_followup_due_reminders() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY / TRIPWIRE — read-only, run any time. All six must be TRUE.
-- ============================================================================
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%is_push_allowed_now%'       AS quiet_hours_gate,
--   pg_get_functiondef(p.oid) LIKE '%fu-due-%'                   AS per_row_unique_tag,
--   pg_get_functiondef(p.oid) LIKE '%reminder_sent_at  IS NULL%' AS dedup_filter,
--   pg_get_functiondef(p.oid) LIKE '%SET reminder_sent_at = now()%' AS dedup_stamp,
--   pg_get_functiondef(p.oid) LIKE '%enqueue_push%'             AS calls_enqueue_push,
--   pg_get_functiondef(p.oid) LIKE '%interval ''5 minutes''%'    AS window_5min
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'push_followup_due_reminders';
