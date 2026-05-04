-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 8D
-- proposal_templates: add version + header/footer html for the
--                     Master.Documents in-app editor
-- =====================================================================
--
-- WHAT THIS DOES:
--   Adds three columns to proposal_templates so the Master.Documents
--   tab can manage versioned drafts:
--     • version       integer NOT NULL DEFAULT 1
--     • header_html   text NULL  (above-letter content, optional)
--     • footer_html   text NULL  (below-letter content, optional)
--
--   Existing rows get version=1.
--
-- WHY:
--   Master.Documents flow is "edit → save as new draft (v+1) →
--   activate". Without a version column, every edit silently
--   overwrites the active template — risky. With version + the
--   draft / activate workflow we already have in MasterV2.jsx, edits
--   are explicit promotions.
--
--   header_html / footer_html let admin add things like a top
--   stationery banner or a bottom legal disclaimer without touching
--   the body. body_html stays the source of truth for the letter
--   itself.
--
-- IDEMPOTENT.
-- =====================================================================

ALTER TABLE public.proposal_templates
  ADD COLUMN IF NOT EXISTS version       integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS header_html   text,
  ADD COLUMN IF NOT EXISTS footer_html   text;


-- =====================================================================
-- VERIFY:
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'proposal_templates'
--      AND column_name IN ('version', 'header_html', 'footer_html');
--
--   -- Expected: 3 rows.
--
--   SELECT segment, media_type, language, version, is_active
--     FROM public.proposal_templates
--    ORDER BY segment, media_type, version DESC;
--
--   -- Expected: existing rows now have version=1, is_active=true.
--
-- =====================================================================
