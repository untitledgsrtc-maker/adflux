-- =====================================================================
-- PHASE 131 — close the stale AUTO follow-up backlog the 130 heal surfaced
-- 2026-06-12
--
-- Phase 130 §2 one-time heal correctly moved every open follow_up to its
-- lead's CURRENT owner — which dumped a backlog of auto-spawned touches
-- (legacy 33D.4 "follow up with new lead" NULL-cadence rows + a few
-- cadence rows) that had been stranded on previous owners onto the
-- leads' new owners. A TC who clears their daily work saw ~140 overdue
-- appear overnight (confirmed: 142/142 on reassigned-in leads, all
-- auto_generated, oldest 2 Jun).
--
-- These are SYSTEM noise, not rep-promised work. Close every
-- auto_generated follow-up that is ALREADY OVERDUE (date passed, never
-- worked) AND is the "new lead" intro kind — cadence_type IS NULL (legacy
-- 33D.4) OR 'lead_intro'. Rep-typed (auto_generated=false) UNTOUCHED.
-- Today/future UNTOUCHED. The cadence engine keeps each lead alive via
-- stage/heat; Phase 130 §2 trigger transfers future FUs on reassign so
-- this backlog can't re-form.
--
-- DELIBERATELY EXCLUDED (guardian flag) — quote_chase + nurture/lost_nurture:
--  - quote_chase = a LIVE deal chase (quote sent, client not closed); real
--    money in flight, the owner works these, NOT noise. Bonus: excluding it
--    avoids the followup_after_done side-effect where closing an overdue
--    seq-3 quote_chase on a QuoteSent lead would silently park that lead to
--    Nurture (Truth-1 P0-A due gate). By not touching quote_chase, ZERO
--    stage changes happen.
--  - nurture / lost_nurture = cadence-managed by Phase 128.3 / 129; leave them.
--
-- Safe cascade: the close-UPDATE fires followup_after_done (UPDATE OF
-- is_done) — NULL + lead_intro hit NO respawn branch (only quote_chase
-- seq-3 / nurture / lost_nurture do, all excluded here) → no stage change,
-- no respawn. No push (tg_push_followup_due early-returns on is_done=true).
-- No frozen contract, function, enum, or trigger changed — data heal only.
-- =====================================================================

-- ── BEFORE — per-rep blast radius by cadence (eyeball first) ─────────
-- NULL + lead_intro rows = what WILL close. quote_chase rows shown for
-- awareness but NOT closed (live deal chases).
SELECT COALESCE(u.name, fu.assigned_to::text) AS rep,
       COALESCE(fu.cadence_type, '(new-lead/null)') AS cadence_type,
       count(*) AS open_overdue_auto,
       count(*) FILTER (WHERE fu.cadence_type IS NULL OR fu.cadence_type = 'lead_intro') AS will_close
  FROM public.follow_ups fu
  LEFT JOIN public.users u ON u.id = fu.assigned_to
 WHERE fu.is_done = false
   AND fu.auto_generated = true
   AND fu.follow_up_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
 GROUP BY 1, 2
 ORDER BY 3 DESC;

-- ── THE CLOSE — overdue "new lead" intro auto rows only ──────────────
UPDATE public.follow_ups fu
   SET is_done   = true,
       done_at   = COALESCE(fu.done_at, now()),
       done_note = COALESCE(fu.done_note, 'Auto-closed: stale auto follow-up backlog (Phase 131)')
 WHERE fu.is_done = false
   AND fu.auto_generated = true
   AND fu.follow_up_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
   AND (fu.cadence_type IS NULL OR fu.cadence_type = 'lead_intro');

-- self-register
DO $$
BEGIN
  IF to_regclass('public.applied_migrations') IS NOT NULL THEN
    INSERT INTO public.applied_migrations (name, note)
    VALUES ('supabase_phase131_close_stale_auto_followups.sql',
            'One-time close of overdue auto follow-ups surfaced by the Phase 130 reassign heal')
    ON CONFLICT (name) DO NOTHING;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ── VERIFY — expect intro_left=0 (quote_chase intentionally remains) ─
SELECT
  (SELECT count(*) FROM public.follow_ups fu
    WHERE fu.is_done = false AND fu.auto_generated = true
      AND fu.follow_up_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
      AND (fu.cadence_type IS NULL OR fu.cadence_type = 'lead_intro'))  AS intro_left,
  (SELECT count(*) FROM public.follow_ups fu
    WHERE fu.is_done = false AND fu.auto_generated = true
      AND fu.follow_up_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
      AND fu.cadence_type = 'quote_chase')                             AS quote_chase_kept;

SELECT 'Phase 131 stale auto follow-up backlog closed' AS status;
