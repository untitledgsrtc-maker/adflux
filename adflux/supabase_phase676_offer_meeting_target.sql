-- supabase_phase676_offer_meeting_target.sql (24-11-2026)
-- Owner 24-11-2026 ("why sales has still old details" on Send offer). Offers now carry the sales
-- meeting target like Add Member (Phase 665); Convert copies it to daily_targets.min_meetings.
ALTER TABLE public.hr_offers ADD COLUMN IF NOT EXISTS min_meetings int;

NOTIFY pgrst, 'reload schema';

-- VERIFY: expect min_meetings_col = 1
SELECT count(*) AS min_meetings_col FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'hr_offers' AND column_name = 'min_meetings';
