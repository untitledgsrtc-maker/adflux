-- Phase 396 - point all 22 hoarding QR boards at the marketing number 98982 73686 (owner decision 18 Oct 2026).
-- Reverses section 298 (boards on 95815). Printed QR codes do not change: they encode /api/q/<code>.
-- UNDO: swap the two numbers in the replace().
-- WATCH: 98982 was rated Low in Sept (sections 297/298); check WhatsApp Manager quality after a few days.
UPDATE public.campaign_locations
   SET qr_text = replace(qr_text, '919581578261', '919898273686')
 WHERE qr_text LIKE '%919581578261%' AND client_name IS NULL;
-- VERIFY: expect 22 on 98982, 0 on 95815.
SELECT sum((qr_text LIKE '%919898273686%')::int) AS on_98982,
       sum((qr_text LIKE '%919581578261%')::int) AS on_95815
  FROM public.campaign_locations WHERE client_name IS NULL;
