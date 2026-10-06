-- =====================================================================
-- supabase_ops_p11_exec_contacts.sql
-- Operations: the OPERATION EXECUTIVE may ADD "Who to call" numbers for the
-- stations he owns, and remove the numbers HE added. (Owner 2026-10-06:
-- "operation person not able to contact - I want they can add the details".)
--
-- WHY: ops_depot_contacts was head/admin-only for writes (Phase 0, one blanket
-- policy loop). The exec could READ the numbers but not add or fix one, and the
-- Station board showed him add/edit boxes that silently did nothing.
--
-- WHAT THIS DOES (additive; nothing existing is changed):
--   * ops_depot_contacts.created_by  (who added the row; the 95 existing rows stay NULL
--                                     = owner-verified, so an exec can never delete them)
--   * exec INSERT  : only on an ACTIVE depot he owns (ops_depots.assigned_to = him), he must be an
--                    active user, created_by must be himself, phone exactly 10 digits, text <= 60 chars,
--                    max 20 numbers per station; a trigger puts his number LAST (display_order = max+1).
--   * exec DELETE  : only a row HE added (created_by = him).
--   * NO exec UPDATE (a wrong number = delete + add again; keeps the audit trail honest).
--   Head / admin / co_owner keep the existing ops_depot_contacts_manage FOR ALL policy
--   and the exec read policy is untouched. Sales / telecaller / agency / everyone else:
--   still zero access (no policy matches them).
--
-- IDEMPOTENT. Safe to re-run. ~Instant (no table rewrite; policy DDL only).
-- Owner runs in Supabase Studio; frontend deploys separately (it tolerates this not
-- being run yet - the Add button then shows a "ask your head" message).
-- =====================================================================

-- ===== DDL =====
ALTER TABLE public.ops_depot_contacts
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
-- Default set AFTER the add so the existing rows stay NULL (owner-verified seed rows).
ALTER TABLE public.ops_depot_contacts ALTER COLUMN created_by SET DEFAULT auth.uid();

DROP POLICY IF EXISTS ops_depot_contacts_exec_insert ON public.ops_depot_contacts;
CREATE POLICY ops_depot_contacts_exec_insert ON public.ops_depot_contacts
  FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'operation_executive'          -- NULL role => NULL => denied (fail-closed)
    AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_active)   -- a deactivated exec adds nothing
    AND created_by = auth.uid()
    AND phone ~ '^[0-9]{10}$'                              -- stored form is exactly 10 digits (the app normalises before saving)
    AND char_length(coalesce(role_en, '')) <= 60
    AND char_length(coalesce(role_gu, '')) <= 60
    AND char_length(coalesce(name, ''))    <= 60
    AND (SELECT count(*) FROM public.ops_depot_contacts c WHERE c.depot_id = ops_depot_contacts.depot_id) < 20
    AND EXISTS (SELECT 1 FROM public.ops_depots d
                 WHERE d.id = ops_depot_contacts.depot_id
                   AND d.assigned_to = auth.uid()
                   AND d.is_active)
  );

DROP POLICY IF EXISTS ops_depot_contacts_exec_delete ON public.ops_depot_contacts;
CREATE POLICY ops_depot_contacts_exec_delete ON public.ops_depot_contacts
  FOR DELETE
  USING (
    public.get_my_role() = 'operation_executive'
    AND created_by = auth.uid()
  );

-- An exec-added number always goes to the END of the list and carries today's date, so he can never
-- push himself in front of the owner-verified numbers (cs[0] is the primary number the app dials).
-- Head/admin/service inserts are untouched (the role check below).
CREATE OR REPLACE FUNCTION public.ops_depot_contacts_exec_order()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF public.get_my_role() = 'operation_executive' THEN
    NEW.display_order := COALESCE((SELECT max(c.display_order) FROM public.ops_depot_contacts c WHERE c.depot_id = NEW.depot_id), 0) + 1;
    NEW.created_at := now();
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS trg_ops_depot_contacts_exec_order ON public.ops_depot_contacts;
CREATE TRIGGER trg_ops_depot_contacts_exec_order BEFORE INSERT ON public.ops_depot_contacts
  FOR EACH ROW EXECUTE FUNCTION public.ops_depot_contacts_exec_order();
-- ===== END DDL =====

NOTIFY pgrst, 'reload schema';

-- VERIFY (expect 4 policies + trigger trg_ops_depot_contacts_exec_order: manage ALL, read SELECT, exec_insert INSERT, exec_delete DELETE; created_by col = 1):
-- SELECT policyname, cmd FROM pg_policies WHERE schemaname='public' AND tablename='ops_depot_contacts' ORDER BY policyname;
-- SELECT count(*) AS created_by_col FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='ops_depot_contacts' AND column_name='created_by';
-- SELECT count(*) AS seed_rows_untouched FROM public.ops_depot_contacts WHERE created_by IS NULL;  -- = all existing rows
-- SELECT tgname FROM pg_trigger WHERE tgrelid='public.ops_depot_contacts'::regclass AND NOT tgisinternal;  -- = trg_ops_depot_contacts_exec_order
