-- supabase_phase669_hr_remaining.sql (24-11-2026)
-- Owner approved 24-11-2026 ("fix the remaining hr issues").
-- 1. HR / Accounts / Office Admin cannot approve or reject their OWN leave (it goes to the
--    owner / co-owner), and cannot add an already-approved leave for themselves. Before, the app hid the button for others but not for them, and the
--    database allowed it.
-- 2. Exit checklist: goes to the HR set in work_rule_settings 'hr_tasks_assignee' only while
--    that person is active; otherwise to any active HR, then the owner - so a new HR still
--    gets it. The "deactivating does not stop sign-in" step was wrong since Phase 428
--    (deactivating now blocks sign-in); reworded to a check. Supersedes the function in
--    supabase_phase426_hr_tasks.sql.

-- 1 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.leaves_no_self_decision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NEW.user_id = auth.uid()
     AND ((TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status)
          OR (TG_OP = 'INSERT' AND COALESCE(NEW.status, 'pending') <> 'pending'))
     AND public.get_my_role() IN ('hr', 'accounts', 'office_admin') THEN
    RAISE EXCEPTION '%', CASE WHEN TG_OP = 'INSERT'
      THEN 'You cannot add an approved leave for yourself - request it, the owner decides it.'
      ELSE 'You cannot approve or reject your own leave - the owner decides it.' END
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.leaves_no_self_decision() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_leaves_no_self_decision ON public.leaves;
CREATE TRIGGER trg_leaves_no_self_decision
  BEFORE INSERT OR UPDATE OF status ON public.leaves
  FOR EACH ROW EXECUTE FUNCTION public.leaves_no_self_decision();

-- 2 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hr_exit_tasks()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date; v_hr uuid; v_cr uuid; p text;
BEGIN
  SELECT s.user_id INTO v_hr FROM public.work_rule_settings s
    JOIN public.users u ON u.id = s.user_id AND u.is_active
   WHERE s.key = 'hr_tasks_assignee';
  SELECT id INTO v_cr FROM public.users WHERE role='admin' AND is_active ORDER BY created_at LIMIT 1;
  IF v_hr IS NULL THEN
    SELECT id INTO v_hr FROM public.users WHERE role='hr' AND is_active AND id <> NEW.id ORDER BY created_at LIMIT 1;
  END IF;
  v_hr := COALESCE(v_hr, v_cr);
  IF v_hr IS NULL OR NEW.role = 'agency' THEN RETURN NEW; END IF;
  p := 'Exit: ' || left(NEW.name, 60) || ' - ';
  PERFORM public.work__plain_task(p || 'handover of work and tasks', v_today, v_hr, v_cr);
  PERFORM public.work__plain_task(p || 'collect assets: phone, laptop, ID card, SIM', v_today, v_hr, v_cr);
  PERFORM public.work__plain_task(p || 'final settlement: salary, leaves and any advances', v_today + 1, v_hr, v_cr);
  PERFORM public.work__plain_task(p || 'exit interview', v_today, v_hr, v_cr);
  PERFORM public.work__plain_task(p || 'confirm they can no longer sign in (blocked automatically on deactivate)', v_today, v_hr, v_cr);
  PERFORM public.work__plain_task(p || 'remove the WhatsApp number mapping', v_today, v_hr, v_cr);
  PERFORM public.work_push(v_hr, 'Exit: ' || left(NEW.name, 50), '6 exit tasks added to your list', '/my-work', 'work-exit-' || NEW.id::text);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $function$;

-- 3 -------------------------------------------------------------------------
-- One-time link of older offers to their Recruit card (offers sent from the Hiring page
-- never carried candidate_id). Match by email, only when exactly one candidate has it.
UPDATE public.hr_offers o
   SET candidate_id = c.id
  FROM public.hr_candidates c
 WHERE o.candidate_id IS NULL
   AND lower(btrim(c.email)) = lower(btrim(o.candidate_email))
   AND (SELECT count(*) FROM public.hr_candidates c2
         WHERE lower(btrim(c2.email)) = lower(btrim(o.candidate_email))) = 1;
-- Candidates whose linked offer already became a login: mark them hired + linked.
UPDATE public.hr_candidates c
   SET converted_user_id = o.converted_user_id, stage = 'hired'
  FROM public.hr_offers o
 WHERE o.candidate_id = c.id
   AND o.converted_user_id IS NOT NULL
   AND c.converted_user_id IS NULL;

NOTIFY pgrst, 'reload schema';

-- VERIFY: expect self_guard=1, exit_fallback=true
SELECT
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_leaves_no_self_decision') AS self_guard,
  (SELECT pg_get_functiondef(oid) LIKE '%role=''hr'' AND is_active%' FROM pg_proc WHERE proname = 'hr_exit_tasks') AS exit_fallback;
