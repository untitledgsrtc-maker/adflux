-- supabase_phase173_TEST_call_dedup.sql
-- SELF-TEST for the canonical call-dedup (Phase 173). This is the lock that
-- stops the §33 whack-a-mole: it inserts synthetic call_logs rows, lets the
-- LIVE trigger run, asserts the right result for each rule, then ROLLS BACK so
-- NOTHING persists. If any rule regresses it RAISEs and aborts (still rolls
-- back). Run the WHOLE file as one block. Re-run it after ANY future change to
-- the call-dedup rule (trigger OR the JS scan) — green = the rule still holds.
--
-- Safe on the live DB: everything is inside BEGIN ... ROLLBACK. Synthetic
-- phones 9990000001/2 won't collide with real leads; lead_id is NULL.

BEGIN;

DO $test$
DECLARE
  u    uuid;
  base timestamptz := now();
  n1   text := '9990000001';
  n2   text := '9990000002';
  c    int;
  d_out int;
  d_in  int;
BEGIN
  SELECT id INTO u FROM public.users LIMIT 1;
  IF u IS NULL THEN RAISE EXCEPTION 'no users to test with'; END IF;

  -- ── R1 + R5: a tap (outgoing-intent, NULL direction) then the real OUTGOING
  --    call 20s later → folds to ONE outgoing row. ──────────────────────────
  -- tap OMITS `direction` (mirrors callAudit.js — the column is NOT NULL with a
  -- default; the real tap never sets it explicitly).
  INSERT INTO public.call_logs(user_id, client_phone, duration_seconds, outcome, notes, call_at)
    VALUES (u, n1, NULL, 'no_answer', 'tel-tap audit (p173 test)', base);
  INSERT INTO public.call_logs(user_id, client_phone, direction, duration_seconds, outcome, notes, call_at)
    VALUES (u, n1, 'outgoing', 17, 'connected', 'device scan (p173 test)', base + INTERVAL '20 seconds');

  SELECT count(*) INTO c FROM public.call_logs WHERE user_id = u AND client_phone = n1;
  IF c <> 1 THEN RAISE EXCEPTION 'R1 FAIL: tap + outgoing should fold to 1 row, got %', c; END IF;
  PERFORM 1 FROM public.call_logs WHERE user_id = u AND client_phone = n1 AND direction = 'outgoing' AND duration_seconds = 17;
  IF NOT FOUND THEN RAISE EXCEPTION 'R1 FAIL: folded row should be outgoing/17s'; END IF;

  -- ── R2 + R3 (THE BUG): a real INCOMING call to the same number 2 min later
  --    must NOT merge into the outgoing row. Expect 2 rows: 1 out, 1 in. ─────
  INSERT INTO public.call_logs(user_id, client_phone, direction, duration_seconds, outcome, notes, call_at)
    VALUES (u, n1, 'incoming', 21, 'connected', 'device scan (p173 test)', base + INTERVAL '2 minutes');

  SELECT count(*) FILTER (WHERE direction = 'outgoing'),
         count(*) FILTER (WHERE direction = 'incoming')
    INTO d_out, d_in
    FROM public.call_logs WHERE user_id = u AND client_phone = n1;
  IF d_out <> 1 OR d_in <> 1 THEN
    RAISE EXCEPTION 'R2/R3 FAIL (the 7874260770 bug): expected 1 outgoing + 1 incoming, got % out / % in', d_out, d_in;
  END IF;

  -- ── R5 (Rima): two real OUTGOING repeat calls to the same number, no tap →
  --    BOTH survive. ─────────────────────────────────────────────────────────
  INSERT INTO public.call_logs(user_id, client_phone, direction, duration_seconds, outcome, notes, call_at)
    VALUES (u, n2, 'outgoing', 30, 'connected', 'device scan (p173 test)', base);
  INSERT INTO public.call_logs(user_id, client_phone, direction, duration_seconds, outcome, notes, call_at)
    VALUES (u, n2, 'outgoing', 45, 'connected', 'device scan (p173 test)', base + INTERVAL '3 minutes');

  SELECT count(*) INTO c FROM public.call_logs WHERE user_id = u AND client_phone = n2;
  IF c <> 2 THEN RAISE EXCEPTION 'R5 FAIL (Rima): two real outgoing repeats should be 2 rows, got %', c; END IF;

  RAISE NOTICE 'Phase 173 self-test PASS - fold=1, incoming stays separate (no cross-merge), repeat-outgoing=2';
END
$test$;

ROLLBACK;
