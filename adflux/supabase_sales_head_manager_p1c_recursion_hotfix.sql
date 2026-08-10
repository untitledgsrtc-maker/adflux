-- =====================================================================
-- HOTFIX — Sales Head P1c quote-edit RLS caused "infinite recursion detected
-- in policy for relation quotes" (2026-08-10). RUN IMMEDIATELY.
-- =====================================================================
-- CAUSE: quotes_sales_head_edit's WITH CHECK had a CORRELATED self-subquery
--   `<col> IS NOT DISTINCT FROM (SELECT q.<col> FROM public.quotes q WHERE q.id = quotes.id)`.
--   A correlated read of the SAME table inside its own policy trips Postgres's
--   RLS recursion guard on EVERY quotes UPDATE (mark-won, edit) for EVERY role —
--   it broke the live quote flow. (The users_self_update_avatar pin does NOT
--   recurse because its subquery filters on a CONSTANT `auth.uid()`, not the
--   correlated outer row.)
-- FIX: read the OLD row inside a SECURITY DEFINER function (bypasses RLS → the
--   inner read is not policy-evaluated → no recursion), comparing the NEW values
--   passed as args. Same security (pins created_by/segment/media/lead/number,
--   blocks won), zero self-reference.
-- =====================================================================

-- (1) DEFINER pin-checker — reads the OLD quote bypassing RLS, returns whether
--     every immutable NEW value matches the stored one. NULL row (new/absent) → true.
CREATE OR REPLACE FUNCTION public.sh_quote_unchanged(
  p_id uuid, p_created_by uuid, p_segment text, p_media text, p_lead uuid, p_qnum text
) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE((
    SELECT p_created_by IS NOT DISTINCT FROM q.created_by
       AND p_segment    IS NOT DISTINCT FROM q.segment
       AND p_media      IS NOT DISTINCT FROM q.media_type
       AND p_lead       IS NOT DISTINCT FROM q.lead_id
       AND p_qnum       IS NOT DISTINCT FROM q.quote_number
    FROM public.quotes q WHERE q.id = p_id
  ), true)
$$;
GRANT EXECUTE ON FUNCTION public.sh_quote_unchanged(uuid,uuid,text,text,uuid,text) TO authenticated;

-- (2) Re-create the edit policy WITHOUT the self-subquery (no recursion). Same
--     guards: only a Sales Head, non-won only (USING), can't set won + can't
--     change owner/segment/media/lead/number (the DEFINER checker).
DROP POLICY IF EXISTS quotes_sales_head_edit ON public.quotes;
CREATE POLICY quotes_sales_head_edit ON public.quotes
  FOR UPDATE
  USING (public.is_sales_head() AND status <> 'won')
  WITH CHECK (
    public.is_sales_head()
    AND status <> 'won'
    AND public.sh_quote_unchanged(id, created_by, segment, media_type, lead_id, quote_number)
  );

NOTIFY pgrst, 'reload schema';

-- VERIFY: policy present + NO self-reference to quotes in its WITH CHECK + the
-- helper exists. edit_no_self_ref must be TRUE.
SELECT
  (SELECT to_regprocedure('public.sh_quote_unchanged(uuid,uuid,text,text,uuid,text)') IS NOT NULL) AS helper_present,
  (SELECT count(*) FROM pg_policies WHERE tablename='quotes' AND policyname='quotes_sales_head_edit') AS edit_present,
  (SELECT position('FROM public.quotes' in with_check) = 0 AND position('sh_quote_unchanged' in with_check) > 0
     FROM pg_policies WHERE tablename='quotes' AND policyname='quotes_sales_head_edit')            AS edit_no_self_ref;
