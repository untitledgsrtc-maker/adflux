-- =========================================================================
-- Adflux — Quote number generator fix (race-free via SEQUENCE)
-- =========================================================================
-- WHAT WAS WRONG:
--   The old generate_quote_number() trigger did SELECT MAX(...) + 1.
--   Under concurrent inserts, two sessions could both read MAX = N and
--   both try to insert N+1 → one fails with a duplicate-key error.
--
-- WHAT WE DO NOW:
--   Use a Postgres SEQUENCE. nextval() is atomic — each call returns a
--   unique number, even if two sessions call it in the same millisecond.
--   Format stays the same: UA-YYYY-####   (YYYY = current year)
--
--   NOTE: numbers no longer reset to 0001 on Jan 1. The counter keeps
--   climbing across years, e.g. UA-2026-0312 → UA-2027-0313. This is
--   the cost of going race-free with a single sequence, and for an
--   internal tool it's a fair trade: numbers stay globally unique and
--   monotonically increasing forever, which is actually cleaner for
--   audit / filing / search.
--
-- SAFE TO RUN ON LIVE:
--   - Idempotent (CREATE SEQUENCE IF NOT EXISTS, CREATE OR REPLACE FUNCTION)
--   - Sequence is seeded to the current MAX suffix across ALL existing
--     quotes, so the next quote created is MAX+1 — no collisions with
--     existing rows.
--   - Trigger name quotes_quote_number stays the same; only the function
--     body changes.
-- =========================================================================

-- 1) Create the sequence (once, idempotent)
CREATE SEQUENCE IF NOT EXISTS public.quote_number_seq
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

-- 2) Seed the sequence to the max numeric suffix across all existing
--    quotes, so the next nextval() call returns a number that doesn't
--    already exist on any row.
--
--    Works for any row whose quote_number matches 'UA-####-####...' —
--    the last dash-delimited segment is cast to int and we take the max.
SELECT setval(
  'public.quote_number_seq',
  GREATEST(
    COALESCE((
      SELECT MAX(
        CAST(
          regexp_replace(quote_number, '^.*-', '') AS INTEGER
        )
      )
      FROM public.quotes
      WHERE quote_number ~ '^UA-\d{4}-\d+$'
    ), 0),
    1   -- never let setval go below 1
  ),
  true  -- is_called = true → next nextval() returns this + 1
);

-- 3) Replace the trigger function. The trigger itself (quotes_quote_number,
--    BEFORE INSERT on quotes) already points at this function by name, so
--    we don't need to drop/recreate the trigger.
CREATE OR REPLACE FUNCTION public.generate_quote_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Always stamp a fresh server-side number; ignore whatever the client sent.
  NEW.quote_number :=
    'UA-'
    || TO_CHAR(CURRENT_DATE, 'YYYY')
    || '-'
    || LPAD(nextval('public.quote_number_seq')::text, 4, '0');
  RETURN NEW;
END;
$$;

-- 4) Sanity check (optional — safe to run, just shows current state).
--    Uncomment to view in SQL editor:
-- SELECT last_value, is_called FROM public.quote_number_seq;
-- SELECT MAX(quote_number) FROM public.quotes;
