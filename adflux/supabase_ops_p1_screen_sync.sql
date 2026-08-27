-- supabase_ops_p1_screen_sync.sql
-- OPERATIONS Phase 1 (REAL DATA): link ops_depots to the aiadflux CMS "group" id
-- so api/ops/sync.js can UPSERT real screens + depots by external id.
-- ─────────────────────────────────────────────────────────────────────────
-- Additive + §45-safe: ONE nullable column on ops_depots + a partial-unique
-- index. Touches NO existing data, no frozen surface. Idempotent (§8). One paste.
--
-- WHY: aiadflux returns each screen with a `group` (its bus-stand depot). To map a
-- screen to OUR ops_depot without fragile name-string matching on every sync, the
-- sync stamps the aiadflux group id onto the matching depot ONCE (fuzzy name match
-- on the first run), then every later sync links by this exact id.
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE public.ops_depots
  ADD COLUMN IF NOT EXISTS external_group_id text;   -- aiadflux group UUID (sync)

-- one aiadflux group maps to at most one depot row (NULLs allowed = unlinked depot)
CREATE UNIQUE INDEX IF NOT EXISTS ux_ops_depots_external_group
  ON public.ops_depots(external_group_id)
  WHERE external_group_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ═══ VERIFY — expect: column_present = 1 · index_present = 1 ═══
-- SELECT
--   (SELECT count(*) FROM information_schema.columns
--      WHERE table_schema='public' AND table_name='ops_depots'
--        AND column_name='external_group_id')                                     AS column_present,
--   (SELECT count(*) FROM pg_indexes
--      WHERE schemaname='public' AND indexname='ux_ops_depots_external_group')    AS index_present;
