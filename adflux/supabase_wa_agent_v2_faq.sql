-- =====================================================================
-- WhatsApp Agent v2 — Batch 2: AI FAQ knowledge base (2026-08-23, §225)
-- Owner-editable Q&A the WhatsApp AI injects into its prompt (like the
-- §257.7 coverage list) so it answers real closing questions from
-- grounded, owner-approved answers instead of guessing or handing off.
-- Additive, §45-safe: a NEW table only; the AI reads it best-effort
-- (a missing table degrades to no FAQ injection). No live flow touched.
-- Run this whole file once in Supabase Studio.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.ai_faq (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question      text NOT NULL,
  answer        text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  display_order int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_faq ENABLE ROW LEVEL SECURITY;

-- read: any signed-in user (for the future admin UI). The AI reads via the
-- service role and bypasses RLS, so it always sees the active rows.
DROP POLICY IF EXISTS ai_faq_read ON public.ai_faq;
CREATE POLICY ai_faq_read ON public.ai_faq
  FOR SELECT TO authenticated USING (true);

-- write: admin / co_owner only (the owner edits the FAQ).
DROP POLICY IF EXISTS ai_faq_admin ON public.ai_faq;
CREATE POLICY ai_faq_admin ON public.ai_faq
  FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin','co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin','co_owner'));

-- ── seed a few ACCURATE answers from the known network facts ──
-- (Only seeds when the table is empty, so a re-run never duplicates.)
INSERT INTO public.ai_faq (question, answer, display_order)
SELECT * FROM (VALUES
  ('Are the views real or estimated?',
   'Real — every view is AI-verified (actual eyes and dwell time, not guessed). Each screen also shows a QR, so a scan becomes a tracked lead. You get a per-screen dashboard of scans and leads.', 10),
  ('How many hours a day does my ad run?',
   'About 14 hours every day of your booking, on high-brightness LED screens that stay clear even in daylight.', 20),
  ('How do I share my ad creative?',
   'Just share your image or video with our team and we set it live — they will confirm the exact size and format that looks best on the screens.', 30),
  ('Is GST included or extra?',
   'Rates are exclusive of GST; 18% GST is added and shown clearly on your quote and invoice.', 40)
) AS v(question, answer, display_order)
WHERE NOT EXISTS (SELECT 1 FROM public.ai_faq);

-- ── OWNER: add your business-specific FAQs here (I do not have the exact
-- terms — fill these in Supabase Studio, or via the Master UI when it ships).
-- Examples to edit + run:
-- INSERT INTO public.ai_faq (question, answer, display_order) VALUES
--   ('What are the payment terms?',              '<your terms>',      50),
--   ('How soon can my ad go live?',              '<your go-live>',    60),
--   ('Can I change my creative mid-campaign?',   '<your policy>',     70),
--   ('What is the minimum booking duration?',    '<your minimum>',    80),
--   ('Do you offer a cancellation / refund?',    '<your policy>',     90);

NOTIFY pgrst, 'reload schema';

-- ── VERIFY ──
SELECT count(*) AS faq_rows, count(*) FILTER (WHERE is_active) AS active_rows FROM public.ai_faq;
