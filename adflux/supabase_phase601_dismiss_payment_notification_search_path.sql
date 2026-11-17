-- Phase 601 — Supabase security advisor follow-up (2026-11-18)
-- The 14 Nov "Table publicly accessible" alert was already closed by Phase 566/573
-- (0 public tables without RLS on 18 Nov). Remaining definer function with no fixed
-- search_path: dismiss_payment_notification (SECURITY DEFINER). Pin it, and keep
-- logged-out (anon) callers out. Body unchanged (it only touches the caller's own
-- rejected payments via auth.uid()).

ALTER FUNCTION public.dismiss_payment_notification(uuid) SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.dismiss_payment_notification(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_payment_notification(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT proconfig FROM pg_proc WHERE proname='dismiss_payment_notification';  -- {search_path=public, pg_temp}
-- SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--  WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity;  -- 0
