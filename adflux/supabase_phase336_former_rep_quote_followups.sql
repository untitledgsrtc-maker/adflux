-- =====================================================================
-- supabase_phase336_former_rep_quote_followups.sql
-- Phase 336 - quotes left with FORMER (inactive) reps: close the 11 dead follow-ups, give the live ones a real owner.
--
-- WHY (live data, 2026-10-06):
--   * 11 open 'Auto follow-up after quote sent' rows sit on 4 INACTIVE users (Dipak 5, Abhinav 3, Avkashbhai 2, Jignesh 1),
--     all overdue since July. They are QUOTE-linked (lead_id NULL). The lead owner (Dhara) cannot read those quotes
--     (quotes_sales_own RLS = created_by only), so re-pointing them to her would show "Unknown client" + "no phone" - the same
--     family as the Phase 333 "Unknown lead" bug. So they are CLOSED, not re-pointed.
--   * Their 26 quotes (all 'sent', Rs 41.4 lakh, 0 payments) are NOT all live: 13 leads are already Lost (client said no), 10 are
--     Nurture (Dhara/Jani already hold nurture + after-call rows), 1 is Won, only 2 are QuoteSent. Only those 2 get a new row.
--
-- WHAT THIS DOES (row updates + 2 audit tables only; no function/trigger changes; safe any time, but run 09:00-21:00 IST so
-- the new row's single "due today" push to the owner is not swallowed by quiet hours):
--   PART 1   read-only preview (run it alone first - Studio shows only the LAST result of a pasted file).
--   PART 1b  backups: _bak_followups_p336 (rows about to be closed) + _bak_followups_p336_new (rows this file creates).
--   PART 2   INSERT one LEAD-linked follow-up per quote that: is sent/negotiating, was made by an inactive user, is unpaid,
--            has a lead in New/Working/QuoteSent owned by an ACTIVE user, and has no quote-chase row open yet.
--            assigned_to = COALESCE(lead.assigned_to, lead.telecaller_id) (Phase 333/334 owner of record), due today IST,
--            follow_up_time NULL (section 106 foot-gun), auto_generated=false, cadence_type NULL = a rep task that no cadence
--            function (cancel_lead_cadence / pause-close / Phase 333-334 heals) will touch.
--   PART 3   CLOSE the stale quote-linked rows held by inactive users (marker = section 175 system-close, not rep work).
--   PART 5   OPTIONAL, commented out: mark the quotes of already-Lost leads as 'lost' (owner's call, one-way).
-- Idempotent: after the run PART 2 and PART 3 match nothing; a second run inserts nothing (also not after a row is done).
-- =====================================================================

-- ===== PART 1 - PREVIEW (read-only) =====
WITH base AS (
  SELECT q.id AS quote_id, q.quote_number, q.total_amount, cu.name AS former_rep, q.segment, l.stage,
         o.name AS owner_name, (o.id IS NOT NULL AND o.is_active) AS owner_active,
         (l.id IS NULL) AS no_lead,
         EXISTS (SELECT 1 FROM public.follow_ups f JOIN public.users h ON h.id = f.assigned_to AND h.is_active
                  WHERE f.is_done = false AND (f.lead_id = l.id OR f.quote_id = q.id)
                    AND (f.cadence_type = 'quote_chase' OR f.note LIKE 'Quote chase:%'
                         OR f.note LIKE 'Auto follow-up after quote sent%' OR f.note LIKE 'Payment collection%')) AS already_chased,
         EXISTS (SELECT 1 FROM public.follow_ups f JOIN public.users h ON h.id = f.assigned_to AND h.is_active = false
                  WHERE f.is_done = false AND f.quote_id = q.id AND f.lead_id IS NULL
                    AND f.note = 'Auto follow-up after quote sent') AS has_stale_row
    FROM public.quotes q
    JOIN public.users cu ON cu.id = q.created_by AND cu.is_active = false
    LEFT JOIN public.leads l ON l.id = q.lead_id
    LEFT JOIN public.users o ON o.id = COALESCE(l.assigned_to, l.telecaller_id)
   WHERE q.status IN ('sent', 'negotiating')
     AND COALESCE((SELECT sum(p.amount_received) FROM public.payments p
                    WHERE p.quote_id = q.id AND (p.approval_status IS NULL OR p.approval_status IN ('', 'approved'))), 0)
         < COALESCE(q.total_amount, 0)
)
SELECT CASE
         WHEN no_lead OR owner_name IS NULL OR NOT owner_active THEN '4 DECISION - no lead / no active owner'
         WHEN stage = 'Lost'    THEN '3 NO ACTION - lead is Lost (client said no)'
         WHEN stage = 'Won'     THEN '4 DECISION - lead Won but quote still sent'
         WHEN stage = 'Nurture' THEN '3 NO ACTION - Nurture (owner already holds nurture rows)'
         WHEN already_chased    THEN '2 NO ACTION - quote-chase row already open'
         WHEN stage IN ('New', 'Working', 'QuoteSent') THEN '1 ADD chase row for owner'
         ELSE '4 DECISION - other stage'
       END AS action,
       coalesce(owner_name, '-') AS lead_owner, count(*) AS quotes, sum(total_amount)::bigint AS rs,
       count(*) FILTER (WHERE has_stale_row) AS stale_rows_to_close
  FROM base GROUP BY 1, 2 ORDER BY 1, 2;

-- ===== PART 1b - BACKUPS =====
CREATE TABLE IF NOT EXISTS public._bak_followups_p336 AS
SELECT fu.id, fu.quote_id, fu.lead_id, fu.assigned_to AS old_assigned_to, fu.is_done AS old_is_done,
       fu.done_at AS old_done_at, fu.done_note AS old_done_note, fu.follow_up_date, fu.note,
       now() AS backed_up_at
  FROM public.follow_ups fu WHERE false;                     -- structure only, first run
INSERT INTO public._bak_followups_p336
SELECT fu.id, fu.quote_id, fu.lead_id, fu.assigned_to, fu.is_done, fu.done_at, fu.done_note, fu.follow_up_date, fu.note, now()
  FROM public.follow_ups fu JOIN public.users u ON u.id = fu.assigned_to AND u.is_active = false
 WHERE fu.is_done = false AND fu.quote_id IS NOT NULL AND fu.lead_id IS NULL
   AND fu.note = 'Auto follow-up after quote sent'
   AND NOT EXISTS (SELECT 1 FROM public._bak_followups_p336 b WHERE b.id = fu.id);
ALTER TABLE public._bak_followups_p336 ENABLE ROW LEVEL SECURITY;   -- no policy = admin SQL only

CREATE TABLE IF NOT EXISTS public._bak_followups_p336_new (
  id uuid PRIMARY KEY, lead_id uuid, assigned_to uuid, note text, created_at timestamptz DEFAULT now());
ALTER TABLE public._bak_followups_p336_new ENABLE ROW LEVEL SECURITY;
-- UNDO (only if ever needed):
--   re-open the closed rows (fires tg_push_followup_due only for lead-linked rows; these are quote-linked -> no push):
--     UPDATE public.follow_ups f SET assigned_to=b.old_assigned_to, is_done=b.old_is_done, done_at=b.old_done_at, done_note=b.old_done_note
--       FROM public._bak_followups_p336 b WHERE b.id = f.id;
--   remove the rows this file created:
--     DELETE FROM public.follow_ups WHERE id IN (SELECT id FROM public._bak_followups_p336_new);

-- ===== PART 2 - one fresh lead-linked chase row per live quote (owner of record, due today IST) =====
WITH ins AS (
  INSERT INTO public.follow_ups (lead_id, assigned_to, follow_up_date, follow_up_time, note, auto_generated)
  SELECT l.id,
         COALESCE(l.assigned_to, l.telecaller_id),
         (now() AT TIME ZONE 'Asia/Kolkata')::date,
         NULL,
         'Quote chase: ' || q.quote_number || ' - '
           || COALESCE(NULLIF(btrim(q.client_company), ''), NULLIF(btrim(q.client_name), ''),
                       NULLIF(btrim(l.company), ''), NULLIF(btrim(l.name), ''), 'client')
           || ' - Rs ' || to_char(q.total_amount, 'FM99,99,99,999')
           || ' (was with ' || cu.name || ')',
         false
    FROM public.quotes q
    JOIN public.users cu ON cu.id = q.created_by AND cu.is_active = false
    JOIN public.leads l  ON l.id = q.lead_id
    JOIN public.users o  ON o.id = COALESCE(l.assigned_to, l.telecaller_id) AND o.is_active = true
   WHERE q.status IN ('sent', 'negotiating')
     AND l.stage IN ('New', 'Working', 'QuoteSent')
     AND COALESCE((SELECT sum(p.amount_received) FROM public.payments p
                    WHERE p.quote_id = q.id AND (p.approval_status IS NULL OR p.approval_status IN ('', 'approved'))), 0)
         < COALESCE(q.total_amount, 0)
     AND NOT EXISTS (SELECT 1 FROM public.follow_ups f JOIN public.users h ON h.id = f.assigned_to AND h.is_active
                      WHERE f.is_done = false AND (f.lead_id = l.id OR f.quote_id = q.id)
                        AND (f.cadence_type = 'quote_chase' OR f.note LIKE 'Quote chase:%'
                             OR f.note LIKE 'Auto follow-up after quote sent%' OR f.note LIKE 'Payment collection%'))
     AND NOT EXISTS (SELECT 1 FROM public.follow_ups f WHERE f.note LIKE 'Quote chase: ' || q.quote_number || ' - %')  -- re-run guard, even after it was done
  RETURNING id, lead_id, assigned_to, note
)
INSERT INTO public._bak_followups_p336_new (id, lead_id, assigned_to, note)
SELECT id, lead_id, assigned_to, note FROM ins;

-- ===== PART 3 - close the stale quote-linked rows held by inactive users =====
UPDATE public.follow_ups fu
   SET is_done   = true,
       done_at   = COALESCE(fu.done_at, now()),
       done_note = COALESCE(fu.done_note, '[closed: auto - follow-up held by a former rep (inactive user); quote handled separately (Phase 336)]')
  FROM public.users u
 WHERE u.id = fu.assigned_to AND u.is_active = false
   AND fu.is_done = false AND fu.quote_id IS NOT NULL AND fu.lead_id IS NULL
   AND fu.note = 'Auto follow-up after quote sent';

-- ===== PART 5 - OPTIONAL, owner decision, ONE-WAY (status can never go back without admin SQL). Leave commented unless he says yes. =====
-- Marks the quotes whose lead is already Lost as 'lost' so Rs 36.7 lakh stops looking like open pipeline. The existing Phase 134 /
-- quote-propagate triggers do the housekeeping (close any quote-tied rows, lead already Lost = no change). Back up first.
-- CREATE TABLE IF NOT EXISTS public._bak_quotes_p336 AS SELECT id, status, updated_at, now() AS backed_up_at FROM public.quotes WHERE false;
-- INSERT INTO public._bak_quotes_p336
-- SELECT q.id, q.status, q.updated_at, now() FROM public.quotes q
--   JOIN public.users cu ON cu.id = q.created_by AND cu.is_active = false JOIN public.leads l ON l.id = q.lead_id
--  WHERE q.status = 'sent' AND l.stage = 'Lost' AND NOT EXISTS (SELECT 1 FROM public._bak_quotes_p336 b WHERE b.id = q.id);
-- UPDATE public.quotes q SET status = 'lost'
--   FROM public.users cu, public.leads l
--  WHERE cu.id = q.created_by AND cu.is_active = false AND l.id = q.lead_id
--    AND q.status = 'sent' AND l.stage = 'Lost';

NOTIFY pgrst, 'reload schema';

-- ===== VERIFY (expect 0 / 0 / 2 / 0) =====
SELECT
  (SELECT count(*) FROM public.follow_ups fu JOIN public.users u ON u.id = fu.assigned_to
    WHERE fu.is_done = false AND u.is_active = false)                                        AS open_rows_on_inactive_users,   -- 0
  (SELECT count(*) FROM public.follow_ups fu JOIN public.users u ON u.id = fu.assigned_to AND u.is_active = false
    WHERE fu.is_done = false AND fu.quote_id IS NOT NULL AND fu.lead_id IS NULL)             AS stale_quote_rows_left,         -- 0
  (SELECT count(*) FROM public.follow_ups
    WHERE is_done = false AND note LIKE 'Quote chase:%' AND auto_generated = false
      AND follow_up_time IS NULL AND cadence_type IS NULL AND quote_id IS NULL)              AS new_chase_rows_open,           -- 2 (0127 + 0139, both Dhara)
  (SELECT count(*) FROM public.follow_ups f JOIN public.leads l ON l.id = f.lead_id
    WHERE f.note LIKE 'Quote chase:%' AND f.is_done AND f.done_note LIKE 'Auto-closed: lead is Lost%') AS born_closed_by_lost_guard; -- 0
