-- =====================================================
-- UNTITLED ADFLUX — CLIENTS MODULE (migration)
-- =====================================================
--
-- Adds a `clients` table that sits alongside `quotes`. Each quote still
-- carries its own denormalized client_* fields (name, phone, etc.) as a
-- historical snapshot — editing a client here does NOT rewrite past
-- quotes. Think of this table as the CRM view; quotes are the ledger.
--
-- Dedup key: (phone, created_by). Each salesperson gets their own
-- client list, so two reps talking to the same number keep separate
-- rows (prevents silent lead-stealing). Admin sees the whole set.
--
-- The app auto-upserts a row here whenever a quote is saved (see
-- src/hooks/useQuotes.js). This file also includes a one-time backfill
-- from the existing quotes table at the end.
--
-- Run in Supabase SQL Editor, top to bottom. Idempotent — can be run
-- again on a database that already has a partial clients table; each
-- statement guards with IF NOT EXISTS.
-- =====================================================

-- ──────────────────────────────────────────────────────
-- 1. Table
-- ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name               text NOT NULL,
  company            text,
  phone              text NOT NULL,
  email              text,
  gstin              text,
  address            text,
  notes              text,

  -- Owner — the sales rep who created the first quote for this client.
  -- RLS is keyed off this. NULL means "admin-created" (e.g. direct from
  -- the clients page) — those rows are visible to admins only.
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,

  -- Activity snapshot maintained by the app on each quote save.
  -- Denormalized so the clients list can render fast without joining
  -- quotes every render.
  first_quote_at     timestamptz,
  last_quote_at      timestamptz,
  quote_count        integer DEFAULT 0,
  total_won_amount   numeric DEFAULT 0,

  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

-- One row per (phone, owner). Two sales reps can each have their own
-- record for the same phone. Admin-created rows (created_by IS NULL)
-- also dedupe on phone — only one unassigned record per number.
CREATE UNIQUE INDEX IF NOT EXISTS clients_phone_owner_uk
  ON clients (phone, COALESCE(created_by::text, ''));

-- Helper indexes — search hits name/company a lot, and the list view
-- orders by last_quote_at DESC.
CREATE INDEX IF NOT EXISTS clients_name_idx         ON clients (lower(name));
CREATE INDEX IF NOT EXISTS clients_company_idx      ON clients (lower(company));
CREATE INDEX IF NOT EXISTS clients_last_quote_idx   ON clients (last_quote_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS clients_created_by_idx   ON clients (created_by);

-- ──────────────────────────────────────────────────────
-- 2. updated_at trigger
-- ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION clients_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS clients_touch_updated_at_trg ON clients;
CREATE TRIGGER clients_touch_updated_at_trg
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION clients_touch_updated_at();

-- ──────────────────────────────────────────────────────
-- 3. Row-level security
--   • Admin  → full access to every row
--   • Sales  → SELECT / UPDATE / INSERT rows they own (created_by = self)
--   • Nobody deletes through the API (handled by admin in SQL if ever
--     needed; clients are rarely truly deleted).
-- ──────────────────────────────────────────────────────
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clients_admin_all"        ON clients;
DROP POLICY IF EXISTS "clients_sales_select_own" ON clients;
DROP POLICY IF EXISTS "clients_sales_insert_own" ON clients;
DROP POLICY IF EXISTS "clients_sales_update_own" ON clients;

CREATE POLICY "clients_admin_all" ON clients
  FOR ALL USING (get_my_role() = 'admin');

CREATE POLICY "clients_sales_select_own" ON clients
  FOR SELECT USING (get_my_role() = 'sales' AND created_by = auth.uid());

CREATE POLICY "clients_sales_insert_own" ON clients
  FOR INSERT WITH CHECK (get_my_role() = 'sales' AND created_by = auth.uid());

CREATE POLICY "clients_sales_update_own" ON clients
  FOR UPDATE USING (get_my_role() = 'sales' AND created_by = auth.uid());

-- ──────────────────────────────────────────────────────
-- 4. Realtime — dashboard + clients list both subscribe
-- ──────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE clients;

-- ──────────────────────────────────────────────────────
-- 5. Backfill from existing quotes
--
-- For every unique (client_phone, created_by) in quotes, insert a
-- clients row with the latest name/company/etc. "Latest" is picked by
-- row_number() ordered by quote updated_at DESC so the most recently
-- worked quote wins. Aggregates (first_quote_at, last_quote_at,
-- quote_count, total_won_amount) are computed alongside.
--
-- ON CONFLICT DO NOTHING — safe to re-run; won't overwrite a clients
-- row you've already edited by hand.
-- ──────────────────────────────────────────────────────
WITH ranked AS (
  SELECT
    q.*,
    row_number() OVER (
      PARTITION BY q.client_phone, q.created_by
      ORDER BY COALESCE(q.updated_at, q.created_at) DESC
    ) AS rn
  FROM quotes q
  WHERE q.client_phone IS NOT NULL AND length(trim(q.client_phone)) > 0
),
latest AS (
  SELECT * FROM ranked WHERE rn = 1
),
aggs AS (
  SELECT
    client_phone,
    created_by,
    MIN(created_at)                                      AS first_quote_at,
    MAX(COALESCE(updated_at, created_at))                AS last_quote_at,
    COUNT(*)                                             AS quote_count,
    COALESCE(SUM(CASE WHEN status = 'won' THEN total_amount ELSE 0 END), 0) AS total_won
  FROM quotes
  WHERE client_phone IS NOT NULL AND length(trim(client_phone)) > 0
  GROUP BY client_phone, created_by
)
INSERT INTO clients (
  name, company, phone, email, gstin, address, notes,
  created_by, first_quote_at, last_quote_at, quote_count, total_won_amount
)
SELECT
  COALESCE(NULLIF(trim(l.client_name), ''), 'Unknown'),
  NULLIF(trim(l.client_company), ''),
  trim(l.client_phone),
  NULLIF(trim(l.client_email), ''),
  NULLIF(trim(l.client_gst), ''),
  NULLIF(trim(l.client_address), ''),
  NULLIF(trim(l.client_notes), ''),
  l.created_by,
  a.first_quote_at,
  a.last_quote_at,
  a.quote_count,
  a.total_won
FROM latest l
JOIN aggs a
  ON a.client_phone = l.client_phone
 AND a.created_by IS NOT DISTINCT FROM l.created_by
ON CONFLICT (phone, COALESCE(created_by::text, '')) DO NOTHING;

-- =====================================================
-- Done. Verify with:
--   SELECT count(*) FROM clients;
--   SELECT name, phone, quote_count, total_won_amount
--   FROM clients ORDER BY last_quote_at DESC LIMIT 10;
-- =====================================================
