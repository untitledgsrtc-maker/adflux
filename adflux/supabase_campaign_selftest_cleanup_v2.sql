-- =====================================================================
-- Campaign — clean up self-test chats before real go-live (PREVIEW FIRST)
-- 2026-06-09
--
-- Removes the test WhatsApp chats + the synthetic "WhatsApp lead" rows so the
-- Inbox + the telecaller queue start clean for real customers.
--
-- SAFE: SCOPED to the known TEST sender numbers only. A real customer (any
-- other number) is never touched. Read-first: a test lead is deleted ONLY if
-- it has no quote. The campaign tables are NEW (§45) — no live-app data here;
-- the only `leads` deletes are phone-scoped to the test list + quote-guarded.
--
-- HOW TO RUN
--   1) Run SECTION 1 (preview, no changes). Confirm it lists only test rows.
--   2) Then run SECTION 2 (the deletes).
--   3) SECTION 3 (verify) should return 0 / 0.
--
-- The test-number list (edit if you tested from another number):
--   919428273686  (owner's phone)
--   919812345678 919900112233 919933445566 919955667788  (C4 self-test)
-- =====================================================================

-- ─── SECTION 1 · PREVIEW (no changes) ───────────────────────────────
SELECT 'conversation' AS what, customer_wa_id, lead_id, last_inbound_at
  FROM public.whatsapp_conversations
 WHERE regexp_replace(COALESCE(customer_wa_id, ''), '\D', '', 'g') IN
       ('919428273686','919812345678','919900112233','919933445566','919955667788')
 ORDER BY customer_wa_id;

SELECT 'test lead' AS what, l.id, l.name, l.phone, l.source,
       EXISTS (SELECT 1 FROM public.quotes q WHERE q.lead_id = l.id) AS has_quote
  FROM public.leads l
 WHERE l.source = 'WhatsApp' AND l.name = 'WhatsApp lead'
   AND regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g') IN
       ('919428273686','919812345678','919900112233','919933445566','919955667788')
 ORDER BY l.phone;

-- ─── SECTION 2 · DELETE (run after the preview looks right) ──────────
-- 2a. messages of the test conversations (FK child first)
DELETE FROM public.whatsapp_messages
 WHERE conversation_id IN (
   SELECT id FROM public.whatsapp_conversations
    WHERE regexp_replace(COALESCE(customer_wa_id, ''), '\D', '', 'g') IN
          ('919428273686','919812345678','919900112233','919933445566','919955667788'));

-- 2b. the test conversations
DELETE FROM public.whatsapp_conversations
 WHERE regexp_replace(COALESCE(customer_wa_id, ''), '\D', '', 'g') IN
       ('919428273686','919812345678','919900112233','919933445566','919955667788');

-- 2c. the synthetic "WhatsApp lead" rows — ONLY when they carry no quote
DELETE FROM public.leads l
 WHERE l.source = 'WhatsApp' AND l.name = 'WhatsApp lead'
   AND regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g') IN
       ('919428273686','919812345678','919900112233','919933445566','919955667788')
   AND NOT EXISTS (SELECT 1 FROM public.quotes q WHERE q.lead_id = l.id);

-- 2d. inbound_leads audit rows for the test senders (housekeeping)
DELETE FROM public.inbound_leads
 WHERE regexp_replace(COALESCE(norm_phone, ''), '\D', '', 'g') IN
       ('919428273686','919812345678','919900112233','919933445566','919955667788');

-- ─── SECTION 3 · VERIFY (expect 0 and 0) ────────────────────────────
SELECT
  (SELECT count(*) FROM public.whatsapp_conversations
     WHERE regexp_replace(COALESCE(customer_wa_id, ''), '\D', '', 'g') IN
           ('919428273686','919812345678','919900112233','919933445566','919955667788')) AS test_convos_left,
  (SELECT count(*) FROM public.leads l
     WHERE l.source = 'WhatsApp' AND l.name = 'WhatsApp lead'
       AND regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g') IN
           ('919428273686','919812345678','919900112233','919933445566','919955667788')
       AND NOT EXISTS (SELECT 1 FROM public.quotes q WHERE q.lead_id = l.id)) AS test_leads_left;

SELECT 'Campaign self-test cleanup done' AS status;
