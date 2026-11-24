-- supabase_phase668_presentation_unlink_on_lead_delete.sql (24-11-2026)
-- Owner approved 24-11-2026 ("keep n unlink"). Deleting a lead failed with
-- "violates foreign key constraint presentation_sessions_lead_id_fkey" whenever the lead
-- had a presentation timed. The link had no delete rule (every other lead link cascades
-- or unlinks). Now a lead delete keeps its presentation records and clears their lead
-- link, so the rep's presentation-time stats do not drop. lead_id is already nullable.

ALTER TABLE public.presentation_sessions DROP CONSTRAINT IF EXISTS presentation_sessions_lead_id_fkey;
ALTER TABLE public.presentation_sessions
  ADD CONSTRAINT presentation_sessions_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';

-- VERIFY: expect on_delete = 'n' (SET NULL)
SELECT confdeltype AS on_delete FROM pg_constraint WHERE conname = 'presentation_sessions_lead_id_fkey';
