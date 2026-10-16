-- ============================================================
-- Investor deck — REAL private-LED economics from WON quotes
-- Read-only. Run in Supabase Studio, paste the result back.
-- Capacity per screen = 5,040 slots/day  (14h × 3600 ÷ 10-sec spots)
--                     = 151,200 slots/month
-- offered_rate = ₹ per screen per month  (campaign_total = rate × screens × months)
-- ============================================================

-- PART 1 — what LED media types exist in won quotes (so we pick the right one)
SELECT q.media_type,
       count(DISTINCT q.id)              AS won_quotes,
       count(qc.*)                       AS line_items,
       round(avg(qc.offered_rate))       AS avg_rate_screen_month,
       round(avg(qc.slots_per_day))      AS avg_slots_per_day,
       round(sum(qc.campaign_total)/100000.0, 2) AS won_value_lakh
FROM quotes q
JOIN quote_cities qc ON qc.quote_id = q.id
WHERE q.status = 'won'
GROUP BY q.media_type
ORDER BY won_value_lakh DESC NULLS LAST;

-- PART 2 — PRIVATE LED (LED_OTHER): the real rate + real occupancy
SELECT
  count(DISTINCT q.id)                                                    AS won_led_quotes,
  count(qc.*)                                                             AS led_line_items,
  round(avg(qc.offered_rate))                                            AS avg_rate_per_screen_month,
  round(avg(qc.slots_per_day))                                          AS avg_slots_per_day,
  round(avg(qc.slot_seconds), 1)                                        AS avg_slot_seconds,
  round(avg(qc.screens), 1)                                             AS avg_screens_per_deal,
  round(avg(qc.duration_months), 1)                                     AS avg_months,
  -- ₹ per 10-sec slot  =  rate per screen-month ÷ (slots/day × 30)
  round(avg(qc.offered_rate / NULLIF(qc.slots_per_day * 30, 0))::numeric, 2)  AS avg_rupee_per_slot,
  -- occupancy per sold screen  =  slots/day booked ÷ 5,040 capacity
  round(avg(qc.slots_per_day)::numeric / 5040 * 100, 2)                 AS avg_occupancy_pct,
  round(sum(qc.campaign_total)/100000.0, 2)                             AS total_won_led_value_lakh
FROM quotes q
JOIN quote_cities qc ON qc.quote_id = q.id
WHERE q.status = 'won'
  AND q.media_type = 'LED_OTHER';

-- If PART 1 shows LED bookings under a different media_type, tell me which
-- and I'll re-point PART 2.
