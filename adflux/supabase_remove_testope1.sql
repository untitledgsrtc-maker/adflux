-- REMOVE testope1@untitledad.in COMPLETELY (test ops-exec "Ankit").
-- ⚠ HARD DELETE = IRREVERSIBLE. Run PART 1 first, review the counts, THEN
--    uncomment + run PART 2. A zero-risk alternative is at the bottom (deactivate).

-- ==== PART 1 · BLAST RADIUS (read-only) — what references this user ====
-- The id:
SELECT id, name, email, role, is_active FROM public.users WHERE email = 'testope1@untitledad.in';

-- Every table/column that FK-references public.users, with THIS user's row count.
-- (Rows shown here are what PART 2 will DELETE. Confirm they're all test data —
--  especially watch for any real leads / quotes / payments.)
DO $$
DECLARE r record; uid uuid; c bigint;
BEGIN
  SELECT id INTO uid FROM public.users WHERE email = 'testope1@untitledad.in';
  IF uid IS NULL THEN RAISE NOTICE 'user not found'; RETURN; END IF;
  FOR r IN
    SELECT tc.table_schema AS s, tc.table_name AS t, kcu.column_name AS col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_schema = 'public' AND ccu.table_name = 'users' AND ccu.column_name = 'id'
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I = $1', r.s, r.t, r.col) INTO c USING uid;
    IF c > 0 THEN RAISE NOTICE 'REFERENCES: %.% (%) = % rows', r.s, r.t, r.col, c; END IF;
  END LOOP;
END $$;
-- ↑ read the NOTICES (Studio → "Messages" tab) before proceeding.


-- ==== PART 2 · DESTRUCTIVE DELETE — uncomment ONLY after reviewing PART 1 ====
-- Deletes every child row referencing the user, then the user, then the auth login.
/*
DO $$
DECLARE r record; uid uuid;
BEGIN
  SELECT id INTO uid FROM public.users WHERE email = 'testope1@untitledad.in';
  IF uid IS NULL THEN RAISE NOTICE 'already gone'; RETURN; END IF;
  FOR r IN
    SELECT tc.table_schema AS s, tc.table_name AS t, kcu.column_name AS col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_schema = 'public' AND ccu.table_name = 'users' AND ccu.column_name = 'id'
  LOOP
    EXECUTE format('DELETE FROM %I.%I WHERE %I = $1', r.s, r.t, r.col) USING uid;
  END LOOP;
  DELETE FROM public.users WHERE id = uid;
  DELETE FROM auth.users  WHERE id = uid;   -- removes the login
  RAISE NOTICE 'testope1 removed completely';
END $$;
*/

-- ==== SAFE ALTERNATIVE (reversible) — hides the user everywhere, keeps data ====
-- UPDATE public.users SET is_active = false WHERE email = 'testope1@untitledad.in';
