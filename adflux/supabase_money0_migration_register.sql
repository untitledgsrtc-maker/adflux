-- =====================================================================
-- MONEY TRUTH 0 — migration run-register (which SQL has actually run)
-- 2026-06-10
--
-- THE PROBLEM: 232 hand-pasted SQL files, no record of which ran on the
-- live DB. One payroll function is defined in 9 different files — re-running
-- an old one silently un-fixes it (has happened 3 times, §33).
--
-- THE FIX (forward-looking): a tiny register table. Every NEW SQL file ends
-- with a self-registration INSERT, so "what has run + when" is answerable
-- with one SELECT. Past files aren't backfilled (unknowable) — the register
-- starts truthful from today.
--
-- SAFE (§45): one NEW table, nothing else touched. Idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.applied_migrations (
  name       text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  note       text
);

ALTER TABLE public.applied_migrations ENABLE ROW LEVEL SECURITY;

-- Read for any signed-in user (harmless metadata); writes only via the
-- owner's Studio paste (service role) — no app-side write policy.
DROP POLICY IF EXISTS applied_migrations_read ON public.applied_migrations;
CREATE POLICY applied_migrations_read ON public.applied_migrations
  FOR SELECT USING (auth.role() = 'authenticated');

INSERT INTO public.applied_migrations (name, note)
VALUES ('supabase_money0_migration_register.sql', 'Money Truth sprint - register table itself')
ON CONFLICT (name) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'applied_migrations') AS table_present,  -- 1
  (SELECT count(*) FROM public.applied_migrations)                        AS rows_registered; -- >= 1

SELECT 'Money 0 migration register applied' AS status;
