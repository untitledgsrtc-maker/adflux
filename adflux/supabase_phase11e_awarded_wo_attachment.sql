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
--   • Add a new row "Awarded Work Order (from this department)" with
--     display_order = MAX(display_order) + 1 per media_type so we
--     don't collide with whatever's already at the next slot.
--   • Frontend gate change (handleWonModalPoUpload, findUploadedByLabel)
--     ships in the same commit and matches "awarded work order" only.
--
--   First version of this file hardcoded display_order = 8 and hit the
--   unique constraint (segment, media_type, display_order). This rev
--   computes the next free slot dynamically.
--
-- IDEMPOTENT — re-running has no effect once the row exists.
-- =====================================================================


-- 1) Rename generic Work Order rows to make their proposal-phase
--    role explicit. Only renames default labels; custom labels untouched.
UPDATE public.attachment_templates
   SET label = 'Sample Work Order (reference)'
 WHERE segment = 'GOVERNMENT'
   AND label IN ('Work Order', 'Work Order copy')
   AND is_active = true;


-- 2) Insert "Awarded Work Order" for AUTO_HOOD at the next free
--    display_order. The HAVING clause guards against re-inserting on
--    a second run; the SELECT inside the INSERT picks MAX+1 so we
--    don't collide with whatever's already at the original target slot.
INSERT INTO public.attachment_templates (
  segment, media_type, display_order, label, is_required, is_active
)
SELECT 'GOVERNMENT',
       'AUTO_HOOD',
       COALESCE(MAX(display_order), 0) + 1,
       'Awarded Work Order (from this department)',
       true,
       true
  FROM public.attachment_templates
 WHERE segment = 'GOVERNMENT' AND media_type = 'AUTO_HOOD'
HAVING NOT EXISTS (
  SELECT 1 FROM public.attachment_templates a
   WHERE a.segment = 'GOVERNMENT'
     AND a.media_type = 'AUTO_HOOD'
     AND lower(a.label) LIKE '%awarded work order%'
     AND a.is_active = true
);


-- 3) Same for GSRTC_LED.
INSERT INTO public.attachment_templates (
  segment, media_type, display_order, label, is_required, is_active
)
SELECT 'GOVERNMENT',
       'GSRTC_LED',
       COALESCE(MAX(display_order), 0) + 1,
       'Awarded Work Order (from this department)',
       true,
       true
  FROM public.attachment_templates
 WHERE segment = 'GOVERNMENT' AND media_type = 'GSRTC_LED'
HAVING NOT EXISTS (
  SELECT 1 FROM public.attachment_templates a
   WHERE a.segment = 'GOVERNMENT'
     AND a.media_type = 'GSRTC_LED'
     AND lower(a.label) LIKE '%awarded work order%'
     AND a.is_active = true
);


-- =====================================================================
-- VERIFY:
--
--   SELECT segment, media_type, display_order, label, is_required
--     FROM public.attachment_templates
--    WHERE segment = 'GOVERNMENT' AND is_active = true
--    ORDER BY media_type, display_order;
--
--   Each media_type should now show an "Awarded Work Order (from this
--   department)" row at the highest display_order, with is_required = true.
-- =====================================================================
