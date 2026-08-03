-- =====================================================================
-- WhatsApp spam-flag diagnostic  (READ-ONLY)  marketing number 98982 73686
-- WABA 2870129030006085 / phone_number_id 1209093615625212 / purpose='marketing'
-- Run each block in Supabase Studio. Nothing here writes. Days bucketed in IST.
-- Companion to CLAUDE.md §148 (Phase 275). The TRUE block/report rate lives only
-- in WhatsApp Manager → 98982 → Quality; these are the closest DB proxies.
-- =====================================================================

-- 0) Confirm which account is 'marketing' (should be one row, 919898273686).
SELECT id, display_number, phone_number_id, waba_id, purpose
FROM   public.whatsapp_accounts
WHERE  purpose = 'marketing';

-- 1) OUTBOUND per day by TYPE on the marketing number (the §133 lever).
--    Watch the 20 Jul ramp → 200-327/day plateau → 1 Aug flag.
--    'text' = AI auto-replies; 'template' = business-initiated (post-call/broadcast);
--    'image' = the (now-removed) auto welcome-poster + city-photo-on-request.
SELECT (m.at AT TIME ZONE 'Asia/Kolkata')::date AS day_ist,
       m.type,
       count(*) AS out_msgs
FROM   public.whatsapp_messages m
JOIN   public.whatsapp_conversations c ON c.id = m.conversation_id
JOIN   public.whatsapp_accounts a ON a.id = c.whatsapp_account_id
WHERE  a.purpose = 'marketing'
  AND  m.direction = 'out'
  AND  m.at >= timestamptz '2026-07-18'
GROUP  BY 1, 2
ORDER  BY 1, 2;

-- 2) INBOUND vs OUTBOUND per day (ratio). A healthy 2-way inbox is ~1:1.
--    A cold-scan funnel skews toward OUT (we reply to every scanner) → spam-shaped.
SELECT (m.at AT TIME ZONE 'Asia/Kolkata')::date AS day_ist,
       count(*) FILTER (WHERE m.direction = 'in')  AS inbound,
       count(*) FILTER (WHERE m.direction = 'out') AS outbound,
       round( count(*) FILTER (WHERE m.direction='out')::numeric
              / NULLIF(count(*) FILTER (WHERE m.direction='in'),0), 2) AS out_per_in
FROM   public.whatsapp_messages m
JOIN   public.whatsapp_conversations c ON c.id = m.conversation_id
JOIN   public.whatsapp_accounts a ON a.id = c.whatsapp_account_id
WHERE  a.purpose = 'marketing'
  AND  m.at >= timestamptz '2026-07-18'
GROUP  BY 1
ORDER  BY 1;

-- 3) FIRST-CONTACT auto-replies: conversations where WE sent an OUT message
--    within the SAME IST day the conversation was created (we auto-answered a
--    brand-new cold scanner). This is the block/report-generating population.
WITH conv AS (
  SELECT c.id,
         (c.created_at AT TIME ZONE 'Asia/Kolkata')::date AS conv_day
  FROM   public.whatsapp_conversations c
  JOIN   public.whatsapp_accounts a ON a.id = c.whatsapp_account_id
  WHERE  a.purpose = 'marketing'
    AND  c.created_at >= timestamptz '2026-07-18'
)
SELECT conv.conv_day,
       count(DISTINCT conv.id) AS new_convos,
       count(DISTINCT conv.id) FILTER (
         WHERE EXISTS (
           SELECT 1 FROM public.whatsapp_messages m
           WHERE m.conversation_id = conv.id
             AND m.direction = 'out'
             AND (m.at AT TIME ZONE 'Asia/Kolkata')::date = conv.conv_day
         )) AS auto_replied_same_day
FROM   conv
GROUP  BY 1
ORDER  BY 1;

-- 4) BUSINESS-INITIATED sends (templates) by day + template + failure count.
--    Templates are the only truly business-initiated type; text is scan-triggered.
SELECT (m.at AT TIME ZONE 'Asia/Kolkata')::date AS day_ist,
       coalesce(m.template_name,'(none)') AS template_name,
       count(*) AS sends,
       count(*) FILTER (WHERE m.status = 'failed') AS failed
FROM   public.whatsapp_messages m
JOIN   public.whatsapp_conversations c ON c.id = m.conversation_id
JOIN   public.whatsapp_accounts a ON a.id = c.whatsapp_account_id
WHERE  a.purpose = 'marketing'
  AND  m.direction = 'out'
  AND  m.type = 'template'
  AND  m.at >= timestamptz '2026-07-18'
GROUP  BY 1, 2
ORDER  BY 1, 3 DESC;

-- 5) Did we EVER run a broadcast? (§133 found 0/60d — confirm still 0.)
SELECT id, segment_name, template_name, status, total, sent, failed, created_at
FROM   public.campaign_broadcasts
WHERE  created_at >= timestamptz '2026-06-01'
ORDER  BY created_at DESC;
-- Expected: 0 rows. Any row = a real blast happened.

-- 6) Opt-in health: of marketing conversations we sent OUT to, how many had a prior
--    inbound (real opt-in) vs none (cold push)?
SELECT count(*) FILTER (WHERE c.last_inbound_at IS NOT NULL) AS convos_with_inbound,
       count(*) FILTER (WHERE c.last_inbound_at IS NULL)     AS convos_no_inbound,
       count(*) FILTER (WHERE c.last_inbound_at IS NULL
              AND EXISTS (SELECT 1 FROM public.whatsapp_messages m
                          WHERE m.conversation_id = c.id AND m.direction='out'))
              AS cold_no_inbound_but_we_sent
FROM   public.whatsapp_conversations c
JOIN   public.whatsapp_accounts a ON a.id = c.whatsapp_account_id
WHERE  a.purpose = 'marketing'
  AND  c.created_at >= timestamptz '2026-07-18';

-- 7) Headline: total outbound on marketing since the 20 Jul re-point.
SELECT count(*) AS total_out_since_2026_07_20
FROM   public.whatsapp_messages m
JOIN   public.whatsapp_conversations c ON c.id = m.conversation_id
JOIN   public.whatsapp_accounts a ON a.id = c.whatsapp_account_id
WHERE  a.purpose = 'marketing'
  AND  m.direction = 'out'
  AND  m.at >= timestamptz '2026-07-20';
