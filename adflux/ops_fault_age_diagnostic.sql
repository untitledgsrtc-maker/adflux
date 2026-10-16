-- ============================================================================
-- ops_fault_age_diagnostic.sql  —  READ-ONLY. Nothing is changed.
-- Answers: the /ops-home fault list shows stations "down 59 / 72 / 152 days".
-- Is that REAL (screens genuinely dark for months) or a STALE timestamp
-- (ops_screens.last_response_at never updates)?
--
-- The discriminator = query 1. Compare ONLINE vs OFFLINE last_response_at:
--   • ONLINE screens fresh (avg_days_old ≈ 0)  → the sync DOES update the
--     stamp → an OFFLINE screen showing 152 days is REAL: it genuinely last
--     responded 152 days ago = a real months-long outage (lost ad revenue).
--   • ONLINE screens ALSO old (avg_days_old large) → the sync is NOT writing
--     last_response_at → the field is dead → the "age" on the app is garbage
--     and the frontend should stop showing it / use a different signal.
-- ============================================================================

-- ── 1 · THE ANSWER: is the timestamp alive? (online vs offline freshness) ──
SELECT
  status,
  count(*)                                                              AS screens,
  count(last_response_at)                                              AS have_a_stamp,
  count(*) - count(last_response_at)                                   AS stamp_is_null,
  round(min(extract(epoch FROM (now() - last_response_at)))/86400)::int AS freshest_days_old,
  round(avg(extract(epoch FROM (now() - last_response_at)))/86400)::int AS avg_days_old,
  round(max(extract(epoch FROM (now() - last_response_at)))/86400)::int AS oldest_days_old
FROM public.ops_screens
WHERE is_active
GROUP BY status
ORDER BY status;

-- ── 2 · the actual "months down" offenders (oldest offline first) ──
SELECT d.name                                    AS station,
       s.name                                    AS screen,
       s.last_response_at,
       round(extract(epoch FROM (now() - s.last_response_at))/86400)::int AS days_since_last_response
FROM public.ops_screens s
JOIN public.ops_depots  d ON d.id = s.depot_id
WHERE s.is_active AND s.status = 'offline'
ORDER BY s.last_response_at ASC NULLS FIRST
LIMIT 15;

-- ── 3 · sanity: does ANY screen have a stamp from the last hour? ──
-- If this returns rows, the sync writes fresh last_response_at → the old
-- offline ages in query 2 are real outages, not a dead field.
SELECT count(*) AS screens_stamped_within_last_hour
FROM public.ops_screens
WHERE is_active AND last_response_at > now() - interval '1 hour';
