-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 11e
-- Split "sample Work Order" vs "Awarded Work Order"
-- =====================================================================
--
-- WHY (owner spec, 4 May 2026):
--   Two different work-order documents flow through a govt proposal
--   and they must NOT be conflated:
--
--     1. Sample Work Order (reference)
--        — A previously-issued WO from ANOTHER department, attached
--          to the proposal as evidence of past awards. Helps the
--          recipient see "this is the kind of work order we're asking
--          you to issue." Optional, lives in the proposal-phase
--          checklist, may be paired with the OC copy on Mark Sent.
--
--     2. Awarded Work Order (THIS proposal)
--        — The formal Work Order issued by the recipient department
--          AGAINST this proposal. Proof that the deal is closed.
--          REQUIRED to mark the quote Won.
--
--   Phase 11 wired the Mark-Won gate against any "po copy" or "work
--   order" label, which incorrectly accepted the sample WO. This
--   migration adds a separate attachment_template row whose label is
--   distinct enough that the gate can match it precisely.
--
-- DESIGN:
--   • Keep the existing "PO copy" and "Sample Work Order" rows (don't
--     break old proposals).
--   • Add a new row "Awarded Work Order" with display_order 8 (after
--     OC copy at 7) for both AUTO_HOOD and GSRTC_LED.
--   • Frontend gate change (handleWonModalPoUpload, findUploadedByLabel)
--     ships in the same commit and matches "awarded work order" only.
--
-- IDEMPOTENT.
-- =====================================================================


-- 1) Rename existing generic "Work Order" / "PO copy" rows to make
--    their proposal-phase role explicit. Only renames if the label is
--    still the default — a customised label is left alone.
UPDATE public.attachment_templates
   SET label = 'Sample Work Order (reference)'
 WHERE segment = 'GOVERNMENT'
   AND label IN ('Work Order', 'Work Order copy')
   AND is_active = true;


-- 2) Insert the "Awarded Work Order" row for both media types.
--    Required = true, so the checklist UI marks it red until uploaded.
--    Phase-11d frontend gate keys off the label substring "awarded
--    work order" (case-insensitive), which only matches this row.
INSERT INTO public.attachment_templates (
  segment, media_type, display_order, label, is_required, is_active
)
SELECT 'GOVERNMENT', mt, 8,
       'Awarded Work Order (from this department)',
       true, true
  FROM (VALUES ('AUTO_HOOD'), ('GSRTC_LED')) AS m(mt)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.attachment_templates a
    WHERE a.segment = 'GOVERNMENT'
      AND a.media_type = m.mt
      AND lower(a.label) LIKE '%awarded work order%'
      AND a.is_active = true
 );


-- =====================================================================
-- VERIFY:
--   SELECT segment, media_type, display_order, label, is_required
--     FROM public.attachment_templates
--    WHERE segment = 'GOVERNMENT' AND is_active = true
--    ORDER BY media_type, display_order;
--
--   Expected: each media_type has both
--     - "PO copy" / "Sample Work Order (reference)"     (existing)
--     - "Awarded Work Order (from this department)"     (new, required)
-- =====================================================================
