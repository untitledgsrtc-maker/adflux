-- ============================================================================
-- Phase 356 - close the open follow-ups that already sit on WON leads (one-time heal)
-- ============================================================================
-- WHY (owner 2026-10-11, answer "Hide + stop making them"): a lead that is Won
-- carries no open lead-linked follow-up (section 134). Two rows were created AFTER
-- the win and are still open (Ajay's "a to z the home store" 'Not receive call' due
-- 12 Oct, Kirti's "Devam Enterprise-Tata" 'After call - Maybe' due 15 Oct).
-- db/functions/followup_block_on_lost_lead.sql now stops NEW ones; this clears the
-- existing ones. Scope = open + lead-linked + lead is Won + NOT a 'HOT -' task and NOT the
-- reassign landing task ('New lead handed to you ...', section 106).
-- Quote-linked payment-collection rows (lead_id NULL) are never touched.
--
-- SAFE: backup first (RLS on, no policies; KEEP 30 days then DROP TABLE). Closes with
-- the section 175 system marker so no report counts it as the rep's work. Aborts
-- if the scope is more than 10 rows (a surprise). Re-run = no-op (rows already closed).
-- UNDO: UPDATE public.follow_ups f SET is_done=false, done_at=NULL, done_note=NULL
--   FROM public._bak_followups_p356 b WHERE b.id=f.id AND f.done_note=b.new_note;
--   (run outside 09:00-21:00 IST - reopening fires the due push).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public._bak_followups_p356 AS
  SELECT f.*, now() AS bak_at, 'Auto-closed: lead is Won (Phase 356 heal)'::text AS new_note
    FROM public.follow_ups f WHERE false;
ALTER TABLE public._bak_followups_p356 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._bak_followups_p356 FROM PUBLIC, anon, authenticated;

DO $guard$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
    FROM public.follow_ups f JOIN public.leads l ON l.id = f.lead_id
   WHERE f.is_done = false AND l.stage = 'Won' AND COALESCE(f.note,'') NOT LIKE 'HOT —%'
   AND COALESCE(f.note,'') NOT LIKE 'New lead handed to you%';
  IF v_n > 10 THEN
    RAISE EXCEPTION 'Phase 356 aborted: % open follow-ups on Won leads (expected 0-10)', v_n;
  END IF;
END
$guard$;

INSERT INTO public._bak_followups_p356
SELECT f.*, now(), 'Auto-closed: lead is Won (Phase 356 heal)'
  FROM public.follow_ups f JOIN public.leads l ON l.id = f.lead_id
 WHERE f.is_done = false AND l.stage = 'Won' AND COALESCE(f.note,'') NOT LIKE 'HOT —%'
   AND COALESCE(f.note,'') NOT LIKE 'New lead handed to you%'
   AND NOT EXISTS (SELECT 1 FROM public._bak_followups_p356 b WHERE b.id = f.id);

UPDATE public.follow_ups f
   SET is_done   = true,
       done_at   = now(),
       done_note = 'Auto-closed: lead is Won (Phase 356 heal)'
  FROM public.leads l
 WHERE l.id = f.lead_id AND f.is_done = false AND l.stage = 'Won'
   AND COALESCE(f.note,'') NOT LIKE 'HOT —%'
   AND COALESCE(f.note,'') NOT LIKE 'New lead handed to you%';

-- VERIFY (read-only): still_open_on_won must be 0; backed_up = rows closed.
SELECT (SELECT count(*) FROM public._bak_followups_p356) AS backed_up,
       (SELECT count(*) FROM public.follow_ups f JOIN public.leads l ON l.id=f.lead_id
         WHERE f.is_done=false AND l.stage='Won' AND COALESCE(f.note,'') NOT LIKE 'HOT —%'
   AND COALESCE(f.note,'') NOT LIKE 'New lead handed to you%') AS still_open_on_won;
NOTIFY pgrst, 'reload schema';
