-- supabase_phase85_pdf_share_tokens.sql
--
-- Phase 85.1 — quote PDF signed-URL flow.
--
-- Audit 24 May 2026 (P0): the `quote-pdfs` bucket is public-read +
-- the file path follows sequential `UA-2026-NNNN.pdf`. Anyone with
-- the URL pattern can enumerate every quote PDF (rates, clients,
-- GST numbers).
--
-- New flow:
--   1. uploadQuotePDFHtml() inserts a `pdf_share_tokens` row with a
--      random URL-safe token + 90-day expiry.
--   2. Returns `https://app.untitledad.in/pdf/<ref>?t=<token>`.
--   3. The new `/api/pdf/[ref]` Vercel function looks up the token,
--      validates expiry, issues a 60-second signed URL via service
--      role, 302 redirects.
--   4. Without a valid `?t=TOKEN`, the route 401s. Anonymous quote
--      enumeration is blocked.
--
-- Migration safety:
--   * Bucket stays public-read for now → old shortlinks keep
--     working. Phase 85.1b will flip the bucket to private + run
--     a final sweep after 30 days.
--   * is.gd shortlinks generated pre-Phase-85.1 still resolve since
--     the long URL (raw Supabase) is still reachable.
--   * is.gd shortlinks generated post-Phase-85.1 point at the new
--     /pdf/<ref>?t=... URL, which requires the token. Tokens are
--     90-day so a client who saved the link in WhatsApp has 90
--     days to read it.

CREATE TABLE IF NOT EXISTS public.pdf_share_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id    uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  -- URL-safe token. 32 bytes of crypto-random → 43 chars base64url.
  -- Unique constraint prevents accidental collisions.
  token       text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  created_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Hot-path lookups: by token. The UNIQUE constraint on `token`
-- already creates a btree index; no extra partial index needed.
-- (Original attempt used `WHERE expires_at > now()` but PG rejects
-- non-IMMUTABLE functions in index predicates with
-- ERROR 42P17 — same class as the timestamptz date_trunc issue we
-- hit on Phase 76.1.)

-- Quote-side lookups (e.g. "regenerate all tokens for this quote").
CREATE INDEX IF NOT EXISTS pdf_share_tokens_quote_idx
  ON public.pdf_share_tokens (quote_id, created_at DESC);

ALTER TABLE public.pdf_share_tokens ENABLE ROW LEVEL SECURITY;

-- Admin / co_owner — full read/write for debugging + admin
-- "regenerate token" actions later.
DROP POLICY IF EXISTS pdf_share_tokens_admin_all ON public.pdf_share_tokens;
CREATE POLICY pdf_share_tokens_admin_all ON public.pdf_share_tokens
  FOR ALL
  USING      (public.get_my_role() IN ('admin', 'co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin', 'co_owner'));

-- Reps insert tokens for quotes they own (so the WhatsApp Send
-- flow works without bumping privilege).
DROP POLICY IF EXISTS pdf_share_tokens_self_insert ON public.pdf_share_tokens;
CREATE POLICY pdf_share_tokens_self_insert ON public.pdf_share_tokens
  FOR INSERT
  WITH CHECK (
    public.get_my_role() IN ('sales','agency','telecaller','sales_manager')
    AND created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.quotes q
       WHERE q.id = pdf_share_tokens.quote_id
         AND q.created_by = auth.uid()
    )
  );

-- Reps read their own quote tokens (so they can re-share or rotate).
DROP POLICY IF EXISTS pdf_share_tokens_self_read ON public.pdf_share_tokens;
CREATE POLICY pdf_share_tokens_self_read ON public.pdf_share_tokens
  FOR SELECT
  USING (
    public.get_my_role() IN ('sales','agency','telecaller','sales_manager')
    AND created_by = auth.uid()
  );

NOTIFY pgrst, 'reload schema';

-- VERIFY
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema='public' AND table_name='pdf_share_tokens';
--     → 1 row.
--
-- SELECT polname, polcmd FROM pg_policy
--   WHERE polrelid = 'public.pdf_share_tokens'::regclass;
--     → 3 rows (admin_all, self_insert, self_read).
--
-- SELECT indexname FROM pg_indexes
--   WHERE schemaname='public' AND tablename='pdf_share_tokens';
--     → 3 rows:
--         pdf_share_tokens_pkey       (id PK)
--         pdf_share_tokens_token_key  (UNIQUE on token, auto)
--         pdf_share_tokens_quote_idx  (quote_id, created_at DESC)
