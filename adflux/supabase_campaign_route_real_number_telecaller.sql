-- =====================================================================
-- Campaign — route the real WhatsApp number's inbound chats to a telecaller
-- 2026-06-09
--
-- WHAT
--   Set whatsapp_accounts.default_telecaller_id for the LIVE campaign
--   number (95815 78261 · phone_number_id 122102627516008558 · WABA
--   122098901360016777) so every NEW inbound WhatsApp chat auto-creates a
--   lead OWNED by that telecaller — the C4.5 routing
--   (supabase_campaign_c45_inbound_to_lead.sql, already live).
--
--   Without this, C4.5 error-queues every inbound (it NEVER makes a
--   NULL-owner lead): chats land in the inbox but no lead is created.
--
-- SAFE (CLAUDE.md §45): a single-row config write on a NEW campaign table.
--   • No live-app table touched, no RLS / function / trigger change.
--   • No hot-path load — the C4.5 trigger is on whatsapp_conversations
--     (a new table), not on leads. A new WhatsApp lead is just a normal
--     additive leads INSERT (cadence_paused=true → no follow-up/push
--     cascade), landing in the telecaller's queue.
--   • Idempotent (re-run = same result).
--   • HARD-FAILS if the telecaller can't be resolved — never silently
--     sets the wrong owner.
--
-- NOTE: existing chats do NOT retro-create leads (the AFTER-INSERT
--   trigger already fired for them when no owner was set). Routing
--   applies to the NEXT new customer onward.
-- =====================================================================

DO $$
DECLARE
  v_owner  uuid;
  v_count  int;
  v_pnid   text := '122102627516008558';   -- 95815 78261 phone_number_id
  v_waba   text := '122098901360016777';   -- UNTITLED ADVERTISING WABA id
  v_number text := '919581578261';
BEGIN
  -- Resolve the telecaller by name. Hard-fail on 0 or >1 match.
  SELECT count(*) INTO v_count
    FROM public.users
   WHERE role = 'telecaller' AND name ILIKE '%rima%';

  IF v_count = 0 THEN
    RAISE EXCEPTION 'No telecaller matching "rima" found — paste this back, I will list the telecallers.';
  ELSIF v_count > 1 THEN
    RAISE EXCEPTION '% telecallers match "rima" — ambiguous, paste this back.', v_count;
  END IF;

  SELECT id INTO v_owner
    FROM public.users
   WHERE role = 'telecaller' AND name ILIKE '%rima%';

  -- Upsert the account row + set the default telecaller.
  IF EXISTS (SELECT 1 FROM public.whatsapp_accounts WHERE phone_number_id = v_pnid) THEN
    UPDATE public.whatsapp_accounts
       SET default_telecaller_id = v_owner,
           waba_id        = COALESCE(waba_id, v_waba),
           display_number = COALESCE(display_number, v_number),
           is_active      = true
     WHERE phone_number_id = v_pnid;
  ELSE
    INSERT INTO public.whatsapp_accounts
      (provider, phone_number_id, waba_id, display_number, default_telecaller_id, is_active)
    VALUES ('cloud_api', v_pnid, v_waba, v_number, v_owner, true);
  END IF;
END $$;

-- ─── VERIFY — confirm the routing is set to the right person ──────────
SELECT a.phone_number_id,
       a.display_number,
       a.default_telecaller_id,
       u.name AS telecaller_name,
       u.role AS telecaller_role
  FROM public.whatsapp_accounts a
  LEFT JOIN public.users u ON u.id = a.default_telecaller_id
 WHERE a.phone_number_id = '122102627516008558';
-- Expect ONE row: telecaller_name = Rima, telecaller_role = telecaller.

SELECT 'Campaign real-number routing applied' AS status;
