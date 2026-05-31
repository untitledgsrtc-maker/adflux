-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 103.F SQL
-- admin_messages — persistent admin→rep push messages (re-readable in app)
-- 2026-05-31 (Brijesh Solanki)
-- =====================================================================
--
-- WHY:
--   Phase 103.E added admin compose-push from the Team Dashboard. But a
--   push only lands in the phone tray — nothing is stored, so once the
--   rep taps it (or it expires) the message is gone; tapping just opened
--   /work. Owner: tapping should open a SAVED message the rep can
--   re-read.
--
--   This table is that store. AdminPushModal inserts a row per send
--   (so the message persists even if the push itself fails — e.g. no
--   device). The rep reads them on /messages; the bell surfaces unread.
--
-- WHAT THIS DOES (idempotent, re-runnable):
--   • admin_messages table (recipient = the rep, sender = the admin).
--   • RLS: rep reads own; admin/co_owner insert + read-all + delete.
--   • Recipients may only flip read_at — a BEFORE UPDATE trigger freezes
--     every content column so a rep can't rewrite an admin message they
--     received (audit integrity).
--   • Adds the table to the supabase_realtime publication so /messages
--     + the bell update live (matches Phase 88.6 pattern).
--
-- WHAT THIS DOES NOT TOUCH:
--   • No existing table, trigger, RLS, or the push pipeline. Purely
--     additive. notify-rep (Phase 103.E) is unchanged — the modal just
--     also writes here.
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- (1) Table
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sender_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  title        text NOT NULL,
  body         text,
  url          text DEFAULT '/messages',
  created_at   timestamptz NOT NULL DEFAULT now(),
  read_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_admin_messages_recipient
  ON public.admin_messages (recipient_id, created_at DESC);

-- Fast unread lookups for the bell badge.
CREATE INDEX IF NOT EXISTS idx_admin_messages_unread
  ON public.admin_messages (recipient_id)
  WHERE read_at IS NULL;


-- ─────────────────────────────────────────────────────────────────────
-- (2) RLS
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.admin_messages ENABLE ROW LEVEL SECURITY;

-- Rep reads own messages; admin / co_owner read all (to audit / re-send).
DROP POLICY IF EXISTS am_recipient_read ON public.admin_messages;
CREATE POLICY am_recipient_read ON public.admin_messages
  FOR SELECT TO authenticated
  USING (
    recipient_id = auth.uid()
    OR public.get_my_role() IN ('admin', 'co_owner')
  );

-- Rep may UPDATE only own rows (and the freeze trigger below limits the
-- update to read_at). Admins don't need UPDATE (they insert).
DROP POLICY IF EXISTS am_recipient_mark_read ON public.admin_messages;
CREATE POLICY am_recipient_mark_read ON public.admin_messages
  FOR UPDATE TO authenticated
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

-- Only admin / co_owner may create messages.
DROP POLICY IF EXISTS am_admin_insert ON public.admin_messages;
CREATE POLICY am_admin_insert ON public.admin_messages
  FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() IN ('admin', 'co_owner'));

-- Only admin / co_owner may delete (cleanup).
DROP POLICY IF EXISTS am_admin_delete ON public.admin_messages;
CREATE POLICY am_admin_delete ON public.admin_messages
  FOR DELETE TO authenticated
  USING (public.get_my_role() IN ('admin', 'co_owner'));


-- ─────────────────────────────────────────────────────────────────────
-- (3) Freeze content on UPDATE — recipients may flip read_at only
-- ─────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER + pinned search_path. Forces every content column
-- back to its OLD value on UPDATE, so the only field a recipient can
-- actually change is read_at. Prevents a rep from rewriting an admin
-- message they received.
CREATE OR REPLACE FUNCTION public.admin_messages_freeze_content()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.title        := OLD.title;
  NEW.body         := OLD.body;
  NEW.url          := OLD.url;
  NEW.recipient_id := OLD.recipient_id;
  NEW.sender_id    := OLD.sender_id;
  NEW.created_at   := OLD.created_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_messages_freeze ON public.admin_messages;
CREATE TRIGGER trg_admin_messages_freeze
  BEFORE UPDATE ON public.admin_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.admin_messages_freeze_content();


-- ─────────────────────────────────────────────────────────────────────
-- (4) Realtime — so /messages + the bell update live
-- ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_messages;
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- already in the publication
  WHEN undefined_object THEN NULL;  -- publication missing (unlikely)
END $$;


NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- VERIFY (paste after applying)
-- =====================================================================
--
-- V1: table + columns
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='admin_messages'
--    ORDER BY ordinal_position;
--   Expected: id, recipient_id, sender_id, title, body, url, created_at, read_at
--
-- V2: 4 policies present
--   SELECT polname FROM pg_policy
--    WHERE polrelid='public.admin_messages'::regclass ORDER BY polname;
--   Expected: am_admin_delete, am_admin_insert, am_recipient_mark_read,
--             am_recipient_read
--
-- V3: freeze trigger present
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid='public.admin_messages'::regclass AND NOT tgisinternal;
--   Expected: trg_admin_messages_freeze
--
-- V4: in realtime publication
--   SELECT 1 FROM pg_publication_tables
--    WHERE pubname='supabase_realtime' AND schemaname='public'
--      AND tablename='admin_messages';
--   Expected: 1 row.
--
-- =====================================================================
-- ROLLBACK (paste only if needed)
-- =====================================================================
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.admin_messages;
--   DROP TRIGGER IF EXISTS trg_admin_messages_freeze ON public.admin_messages;
--   DROP FUNCTION IF EXISTS public.admin_messages_freeze_content();
--   DROP TABLE IF EXISTS public.admin_messages;
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
