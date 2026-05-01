-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 8C
-- Attachment Master — reusable default files per template
-- =====================================================================
--
-- WHAT THIS DOES:
--   Adds two columns to attachment_templates:
--     • default_file_url      — storage path inside quote-attachments
--                               of a reusable file the team uploads
--                               ONCE at the master level. Auto-attached
--                               to every new proposal of that segment+
--                               media_type.
--     • default_file_uploaded_at  — when the master file was last
--                                   replaced. Useful to surface "your
--                                   DAVP letter is 6 months old" later.
--
-- WHY:
--   Owner spec, 1 May 2026 — "all attachment, media, auto, led should
--   be in master so its shows in one place every time, don't need to
--   upload everything." Today the team re-attaches the same DAVP
--   letter / Advisory / 198-page list / Latest campaign on every
--   proposal. That's 4 manual uploads per proposal × dozens of
--   proposals/month = wasted time.
--
--   With this column populated by the new Master page, the checklist
--   merge in GovtProposalDetailV2 falls back to template default
--   when no per-quote upload exists. Per-quote items (OC copy,
--   PO copy / Work Order) still upload per-quote.
--
-- STORAGE PATH CONVENTION:
--   Master files live in the same `quote-attachments` bucket but
--   under a `_master/` prefix to distinguish from per-quote files:
--     _master/<segment>/<media_type>/<display_order>-<slug>.<ext>
--
--   The leading underscore keeps these out of any future per-quote
--   listing that lists by quote_id (uuid prefix).
--
-- IDEMPOTENT.
-- =====================================================================

ALTER TABLE public.attachment_templates
  ADD COLUMN IF NOT EXISTS default_file_url           text,
  ADD COLUMN IF NOT EXISTS default_file_uploaded_at   timestamptz;


-- =====================================================================
-- VERIFY:
--
--   SELECT segment, media_type, display_order, label, default_file_url
--     FROM public.attachment_templates
--    WHERE segment = 'GOVERNMENT'
--    ORDER BY media_type, display_order;
--
--   -- Expected: 14 rows, default_file_url null until Master page uploads.
--
-- =====================================================================
