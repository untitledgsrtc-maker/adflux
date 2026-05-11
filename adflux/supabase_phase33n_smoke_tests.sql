-- supabase_phase33n_smoke_tests.sql
--
-- Phase 33N — smoke tests for the critical SQL surface area.
--
-- Why plain DO blocks instead of pgTAP:
--   pgTAP requires CREATE EXTENSION which Supabase free tier blocks
--   on the public schema. Plain plpgsql + RAISE NOTICE / EXCEPTION
--   runs anywhere and gives the same pass/fail signal.
--
-- How it works:
--   The entire file runs in one transaction (BEGIN ... ROLLBACK at
--   the end). All test data inserts are discarded after the run, so
--   re-running is safe and the production DB stays untouched.
--
--   Each test is a DO block that:
--     1. Sets up its minimal data
--     2. Calls the function under test
--     3. Asserts the result via IF/RAISE EXCEPTION
--     4. RAISE NOTICE on success
--
-- How to run:
--   Paste this whole file into Supabase Studio SQL editor → Run.
--   Watch the NOTICES tab. Every test ends with 'PASS' or the
--   script halts with an EXCEPTION naming the failing test.
--   Final ROLLBACK reverts all test inserts.
--
-- Tested:
--   T1  haversine_km        — distance math
--   T2  detect_city         — coordinate → city lookup
--   T3  is_leave_day        — leave detection
--   T4  compute_daily_score — daily perf calc
--   T5  monthly_score       — month aggregation
--   T6  compute_daily_ta    — TA from GPS pings
--   T7  Won → payment FU trigger
--   T8  score_history       — 6-month series
--   T9  regen_payment_fu_notes — live O/S in note
--   T10 approve_leave       — pending → approved + recompute
--   T11 refresh_expired_quotes — derived expiry
--   T12 is_off_day          — sunday + holiday helper

BEGIN;

-- ─── Setup: test user we can clean up via FK cascade ────────────
DO $$
DECLARE
  v_uid uuid := '00000000-0000-0000-0000-000000000999';
BEGIN
  -- Skip if already in this transaction.
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_uid) THEN
    INSERT INTO users (id, name, email, role, segment_access, daily_targets, is_active)
    VALUES (v_uid, 'TEST_REP_SMOKE', 'smoke-test@untitledadvertising.local',
            'sales', 'PRIVATE', '{"meetings": 5}'::jsonb, true);
  END IF;
  -- Set up incentive profile so monthly_score has something to multiply.
  INSERT INTO staff_incentive_profiles (user_id, monthly_salary)
    VALUES (v_uid, 30000)
    ON CONFLICT (user_id) DO UPDATE SET monthly_salary = 30000;
  RAISE NOTICE 'SETUP: test user % seeded', v_uid;
END $$;

-- ─── T1: haversine_km accuracy ─────────────────────────────────
DO $$
DECLARE
  d numeric;
BEGIN
  -- Vadodara HQ (22.3072, 73.1812) to Surat (21.1702, 72.8311).
  -- Real-world distance: ~140 km.
  d := haversine_km(22.3072, 73.1812, 21.1702, 72.8311);
  IF d < 130 OR d > 155 THEN
    RAISE EXCEPTION 'T1 FAIL: haversine Vadodara→Surat returned % (expected 130-155)', d;
  END IF;

  -- Zero distance (same point).
  d := haversine_km(22.3072, 73.1812, 22.3072, 73.1812);
  IF d > 0.001 THEN
    RAISE EXCEPTION 'T1 FAIL: same-point haversine returned % (expected 0)', d;
  END IF;

  -- Null handling.
  d := haversine_km(NULL, 73.1812, 21.1702, 72.8311);
  IF d <> 0 THEN
    RAISE EXCEPTION 'T1 FAIL: null lat1 should return 0, got %', d;
  END IF;

  RAISE NOTICE 'T1 PASS: haversine_km accuracy';
END $$;

-- ─── T2: detect_city ────────────────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  -- Vadodara HQ centroid should detect as Vadodara, is_home=true.
  SELECT * INTO r FROM detect_city(22.3072, 73.1812);
  IF r.city_name <> 'Vadodara' OR r.is_home <> true THEN
    RAISE EXCEPTION 'T2 FAIL: Vadodara HQ detected as % (home=%)', r.city_name, r.is_home;
  END IF;

  -- Surat centroid → Surat (City), Category A.
  SELECT * INTO r FROM detect_city(21.1702, 72.8311);
  IF r.city_name <> 'Surat (City)' OR r.category <> 'A' THEN
    RAISE EXCEPTION 'T2 FAIL: Surat centroid detected as % (cat=%)', r.city_name, r.category;
  END IF;

  -- New York → no row (outside Gujarat).
  SELECT * INTO r FROM detect_city(40.7128, -74.0060);
  IF r.city_name IS NOT NULL THEN
    RAISE EXCEPTION 'T2 FAIL: New York unexpectedly matched city %', r.city_name;
  END IF;

  RAISE NOTICE 'T2 PASS: detect_city';
END $$;

-- ─── T3: is_leave_day ───────────────────────────────────────────
DO $$
DECLARE
  v_uid uuid := '00000000-0000-0000-0000-000000000999';
  v_date date := '2026-04-15';
  r record;
BEGIN
  -- Initial: no leave row → function returns no row.
  SELECT * INTO r FROM is_leave_day(v_uid, v_date);
  IF r.is_leave IS NOT NULL THEN
    RAISE EXCEPTION 'T3 FAIL: is_leave_day on unmarked day returned %', r.is_leave;
  END IF;

  -- Insert approved leave.
  INSERT INTO leaves (user_id, leave_date, leave_type, reason, status)
    VALUES (v_uid, v_date, 'sick', 'Fever', 'approved');

  -- Now should return is_leave=true with reason from the row.
  SELECT * INTO r FROM is_leave_day(v_uid, v_date);
  IF r.is_leave <> true OR r.reason <> 'Fever' THEN
    RAISE EXCEPTION 'T3 FAIL: is_leave_day post-insert returned is_leave=%, reason=%', r.is_leave, r.reason;
  END IF;

  -- Pending leave should NOT be detected.
  UPDATE leaves SET status = 'pending' WHERE user_id = v_uid AND leave_date = v_date;
  SELECT * INTO r FROM is_leave_day(v_uid, v_date);
  IF r.is_leave IS NOT NULL THEN
    RAISE EXCEPTION 'T3 FAIL: pending leave detected when only approved should';
  END IF;

  -- Flip back to approved for later tests.
  UPDATE leaves SET status = 'approved' WHERE user_id = v_uid AND leave_date = v_date;

  RAISE NOTICE 'T3 PASS: is_leave_day';
END $$;

-- ─── T4: compute_daily_score ───────────────────────────────────
DO $$
DECLARE
  v_uid uuid := '00000000-0000-0000-0000-000000000999';
  v_date date := '2026-04-16';  -- Thursday
  r record;
BEGIN
  -- Seed a work_session: 3 meetings done out of 5 target.
  INSERT INTO work_sessions (user_id, work_date, daily_counters, is_off_day)
    VALUES (v_uid, v_date, '{"meetings": 3}'::jsonb, false)
    ON CONFLICT (user_id, work_date) DO UPDATE
      SET daily_counters = '{"meetings": 3}'::jsonb, is_off_day = false;

  PERFORM compute_daily_score(v_uid, v_date);

  SELECT * INTO r FROM daily_performance
    WHERE user_id = v_uid AND work_date = v_date;
  IF r.meetings_done <> 3 OR r.score_pct <> 60 OR r.is_excluded <> false THEN
    RAISE EXCEPTION 'T4 FAIL: expected 3/5=60%%, got done=%, pct=%, excluded=%',
      r.meetings_done, r.score_pct, r.is_excluded;
  END IF;

  -- Sunday should be excluded.
  PERFORM compute_daily_score(v_uid, '2026-04-19');  -- Sunday
  SELECT * INTO r FROM daily_performance
    WHERE user_id = v_uid AND work_date = '2026-04-19';
  IF r.is_excluded <> true OR r.excluded_reason <> 'Sunday' THEN
    RAISE EXCEPTION 'T4 FAIL: Sunday not excluded — got excluded=%, reason=%',
      r.is_excluded, r.excluded_reason;
  END IF;

  RAISE NOTICE 'T4 PASS: compute_daily_score';
END $$;

-- ─── T5: monthly_score ─────────────────────────────────────────
DO $$
DECLARE
  v_uid uuid := '00000000-0000-0000-0000-000000000999';
  r record;
  v_expected_var numeric;
BEGIN
  -- Only T4's 60% row is in April. Sunday is excluded, leave day excluded.
  SELECT * INTO r FROM monthly_score(v_uid, '2026-04-01');
  IF r.working_days <> 1 THEN
    RAISE EXCEPTION 'T5 FAIL: expected 1 working day, got %', r.working_days;
  END IF;
  IF r.avg_score_pct <> 60 THEN
    RAISE EXCEPTION 'T5 FAIL: avg expected 60%%, got %', r.avg_score_pct;
  END IF;
  -- 30000 monthly × 0.30 var cap = 9000. 60% × 9000 = 5400.
  v_expected_var := 5400;
  IF r.variable_earned <> v_expected_var THEN
    RAISE EXCEPTION 'T5 FAIL: variable expected %, got %', v_expected_var, r.variable_earned;
  END IF;
  -- Base = 70% × 30000 = 21000. Total = 21000 + 5400 = 26400.
  IF r.total_payable <> 26400 THEN
    RAISE EXCEPTION 'T5 FAIL: total expected 26400, got %', r.total_payable;
  END IF;
  RAISE NOTICE 'T5 PASS: monthly_score';
END $$;

-- ─── T6: compute_daily_ta ──────────────────────────────────────
DO $$
DECLARE
  v_uid uuid := '00000000-0000-0000-0000-000000000999';
  v_date date := '2026-04-17';
  v_base timestamptz := '2026-04-17 09:00:00+00';
  r record;
BEGIN
  -- 5 pings in Surat (centroid 21.1702, 72.8311) over 4 hours.
  -- Small lat/lng walks → small total km (couple hundred meters).
  INSERT INTO gps_pings (user_id, captured_at, lat, lng, accuracy_m, source) VALUES
    (v_uid, v_base + INTERVAL '0 min',  21.1702, 72.8311, 20, 'checkin'),
    (v_uid, v_base + INTERVAL '60 min', 21.1710, 72.8320, 25, 'interval'),
    (v_uid, v_base + INTERVAL '120 min',21.1715, 72.8325, 30, 'interval'),
    (v_uid, v_base + INTERVAL '180 min',21.1718, 72.8328, 20, 'interval'),
    (v_uid, v_base + INTERVAL '240 min',21.1702, 72.8311, 15, 'checkout');

  PERFORM compute_daily_ta(v_uid, v_date);

  SELECT * INTO r FROM daily_ta
    WHERE user_id = v_uid AND ta_date = v_date;
  IF r.primary_city <> 'Surat (City)' THEN
    RAISE EXCEPTION 'T6 FAIL: expected Surat primary, got %', r.primary_city;
  END IF;
  IF r.da_amount <> 200 THEN
    RAISE EXCEPTION 'T6 FAIL: DA expected 200, got %', r.da_amount;
  END IF;
  IF r.bike_amount < 0 OR r.bike_amount > 50 THEN
    RAISE EXCEPTION 'T6 FAIL: bike amount unreasonable: %', r.bike_amount;
  END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'T6 FAIL: status expected pending, got %', r.status;
  END IF;

  -- Vadodara home: DA=0, bike>0 (Phase 33I rule).
  INSERT INTO gps_pings (user_id, captured_at, lat, lng, accuracy_m, source) VALUES
    (v_uid, '2026-04-18 09:00:00+00', 22.3072, 73.1812, 20, 'checkin'),
    (v_uid, '2026-04-18 12:00:00+00', 22.3150, 73.1900, 25, 'interval'),
    (v_uid, '2026-04-18 15:00:00+00', 22.3072, 73.1812, 15, 'checkout');
  PERFORM compute_daily_ta(v_uid, '2026-04-18');
  SELECT * INTO r FROM daily_ta
    WHERE user_id = v_uid AND ta_date = '2026-04-18';
  IF r.primary_city <> 'Vadodara' OR r.da_amount <> 0 THEN
    RAISE EXCEPTION 'T6 FAIL: Vadodara local — expected DA=0 in Vadodara, got city=%, DA=%',
      r.primary_city, r.da_amount;
  END IF;
  IF r.bike_amount <= 0 THEN
    RAISE EXCEPTION 'T6 FAIL: Vadodara local bike should be > 0, got %', r.bike_amount;
  END IF;
  RAISE NOTICE 'T6 PASS: compute_daily_ta';
END $$;

-- ─── T7: Won → payment FU trigger ──────────────────────────────
DO $$
DECLARE
  v_uid uuid := '00000000-0000-0000-0000-000000000999';
  v_qid uuid;
  v_fu_count int;
BEGIN
  -- Create a draft quote.
  INSERT INTO quotes (quote_number, client_name, client_company, total_amount,
                      subtotal, status, created_by)
    VALUES ('SMOKE-001', 'Test Client', 'Test Co', 100000, 100000, 'draft', v_uid)
    RETURNING id INTO v_qid;

  -- Confirm no payment FUs yet.
  SELECT COUNT(*) INTO v_fu_count FROM follow_ups
    WHERE quote_id = v_qid AND note LIKE 'Payment collection%';
  IF v_fu_count <> 0 THEN
    RAISE EXCEPTION 'T7 FAIL: payment FUs existed pre-Won (count=%)', v_fu_count;
  END IF;

  -- Phase 11b trigger blocks direct draft → won transitions. Must
  -- step through 'sent' first (draft → sent is allowed, sent → won
  -- is allowed). Real-world reps follow this path naturally via
  -- Mark Sent → Mark Won.
  UPDATE quotes SET status = 'sent' WHERE id = v_qid;
  UPDATE quotes SET status = 'won' WHERE id = v_qid;

  SELECT COUNT(*) INTO v_fu_count FROM follow_ups
    WHERE quote_id = v_qid AND note LIKE 'Payment collection%';
  IF v_fu_count <> 3 THEN
    RAISE EXCEPTION 'T7 FAIL: expected 3 payment FUs, got %', v_fu_count;
  END IF;

  RAISE NOTICE 'T7 PASS: Won trigger creates 3 payment FUs';
END $$;

-- ─── T8: score_history ─────────────────────────────────────────
DO $$
DECLARE
  v_uid uuid := '00000000-0000-0000-0000-000000000999';
  v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count FROM score_history(v_uid, 6);
  IF v_count <> 6 THEN
    RAISE EXCEPTION 'T8 FAIL: expected 6 history rows, got %', v_count;
  END IF;
  RAISE NOTICE 'T8 PASS: score_history returns 6 rows';
END $$;

-- ─── T9: regen_payment_fu_notes ────────────────────────────────
DO $$
DECLARE
  v_uid uuid := '00000000-0000-0000-0000-000000000999';
  v_qid uuid;
  v_note text;
  v_updated int;
BEGIN
  SELECT id INTO v_qid FROM quotes WHERE quote_number = 'SMOKE-001';

  -- Add an approved payment for ₹40,000. Outstanding = 60,000.
  -- Note: schema column is received_by, NOT recorded_by (JSX uses
  -- both names; only received_by actually exists on the table).
  INSERT INTO payments (quote_id, amount_received, approval_status, received_by)
    VALUES (v_qid, 40000, 'approved', v_uid);

  v_updated := regen_payment_fu_notes(v_qid);
  IF v_updated <> 3 THEN
    RAISE EXCEPTION 'T9 FAIL: regen updated % rows, expected 3', v_updated;
  END IF;

  SELECT note INTO v_note FROM follow_ups
    WHERE quote_id = v_qid
      AND note LIKE 'Payment collection%'
      AND note NOT LIKE '%2nd reminder%'
      AND note NOT LIKE '%final reminder%'
    LIMIT 1;
  IF v_note NOT LIKE '%60,000%' THEN
    RAISE EXCEPTION 'T9 FAIL: expected ₹60,000 in note, got: %', v_note;
  END IF;
  RAISE NOTICE 'T9 PASS: regen_payment_fu_notes shows live O/S';
END $$;

-- ─── T10: approve_leave ────────────────────────────────────────
DO $$
DECLARE
  v_uid uuid := '00000000-0000-0000-0000-000000000999';
  v_lid uuid;
  v_status text;
BEGIN
  INSERT INTO leaves (user_id, leave_date, leave_type, reason, status)
    VALUES (v_uid, '2026-04-20', 'personal', 'Family event', 'pending')
    RETURNING id INTO v_lid;

  PERFORM approve_leave(v_lid);

  SELECT status INTO v_status FROM leaves WHERE id = v_lid;
  IF v_status <> 'approved' THEN
    RAISE EXCEPTION 'T10 FAIL: leave not approved, status=%', v_status;
  END IF;
  RAISE NOTICE 'T10 PASS: approve_leave';
END $$;

-- ─── T11: refresh_expired_quotes ───────────────────────────────
DO $$
DECLARE
  v_uid uuid := '00000000-0000-0000-0000-000000000999';
  v_qid uuid;
  v_flagged int;
  v_is_expired boolean;
BEGIN
  -- Backdate created_at to 35 days ago, status=draft.
  INSERT INTO quotes (quote_number, client_name, total_amount,
                      subtotal, status, created_by, created_at)
    VALUES ('SMOKE-002', 'Stale Client', 50000, 50000, 'draft', v_uid,
            CURRENT_DATE - INTERVAL '35 days')
    RETURNING id INTO v_qid;

  v_flagged := refresh_expired_quotes();

  SELECT is_expired INTO v_is_expired FROM quotes WHERE id = v_qid;
  IF v_is_expired <> true THEN
    RAISE EXCEPTION 'T11 FAIL: stale draft not flagged expired';
  END IF;

  -- Move to won → un-flag. Step through 'sent' (Phase 11b one-way trigger).
  UPDATE quotes SET status = 'sent' WHERE id = v_qid;
  UPDATE quotes SET status = 'won' WHERE id = v_qid;
  PERFORM refresh_expired_quotes();
  SELECT is_expired INTO v_is_expired FROM quotes WHERE id = v_qid;
  IF v_is_expired <> false THEN
    RAISE EXCEPTION 'T11 FAIL: won quote still flagged expired';
  END IF;
  RAISE NOTICE 'T11 PASS: refresh_expired_quotes';
END $$;

-- ─── T12: is_off_day (Phase 12 helper) ─────────────────────────
DO $$
DECLARE
  v_result boolean;
BEGIN
  -- Pick a Sunday. 2026-04-19 was a Sunday.
  v_result := is_off_day('2026-04-19');
  IF v_result <> true THEN
    RAISE EXCEPTION 'T12 FAIL: 2026-04-19 (Sunday) returned %', v_result;
  END IF;

  -- Pick a weekday with no holiday.
  v_result := is_off_day('2026-04-15');  -- Wednesday
  IF v_result <> false THEN
    RAISE EXCEPTION 'T12 FAIL: 2026-04-15 (Wed) returned %', v_result;
  END IF;
  RAISE NOTICE 'T12 PASS: is_off_day';
END $$;

-- ─── ALL TESTS COMPLETE ────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════';
  RAISE NOTICE '  ALL 12 SMOKE TESTS PASSED';
  RAISE NOTICE '════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

-- Discard all test data (test user + cascaded rows).
ROLLBACK;

-- NOTE: NO production data is touched. The entire test runs in a
-- single transaction that ends with ROLLBACK. If you ever want to
-- inspect what got created during a test run, replace ROLLBACK
-- with COMMIT — but then you'd need to manually clean up the
-- TEST_REP_SMOKE user afterward.
