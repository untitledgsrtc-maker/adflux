-- supabase_phase402_meta_form_campaign.sql
-- Phase 402 (owner 16 Oct 2026): leads from the AIadflux ad account's INSTANT FORMS go to Aayushi.
-- api/meta/leadgen.js routes a form lead to the NEWEST ACTIVE campaign with source_type='meta' -> its default_telecaller_id.
-- This adds that campaign (Aayushi). The older "Social media" campaign (Dhara) stays but is no longer the newest, so it is not used
-- for form leads. meta_ad_ids is left EMPTY on purpose, so Click-to-WhatsApp chat routing (Phase 266, ad-id based) is unchanged.
-- To change the person later: UPDATE campaigns SET default_telecaller_id = '<user id>' WHERE name = 'AIadflux lead forms';
-- Idempotent.
INSERT INTO public.campaigns (name, source_type, segment, is_active, default_telecaller_id, created_by)
SELECT 'AIadflux lead forms', 'meta', 'PRIVATE', true,
       (SELECT id FROM public.users WHERE name ILIKE 'aayushi%' AND is_active AND role = 'telecaller' LIMIT 1),
       (SELECT id FROM public.users WHERE role = 'admin' AND is_active ORDER BY created_at LIMIT 1)
 WHERE NOT EXISTS (SELECT 1 FROM public.campaigns WHERE name = 'AIadflux lead forms')
   AND EXISTS (SELECT 1 FROM public.users WHERE name ILIKE 'aayushi%' AND is_active AND role = 'telecaller');
NOTIFY pgrst, 'reload schema';
-- VERIFY: the newest active meta campaign must be this one, owned by Aayushi
-- SELECT name, (SELECT name FROM users WHERE id = default_telecaller_id) AS person FROM campaigns
--  WHERE source_type = 'meta' AND is_active ORDER BY created_at DESC LIMIT 1;   -- AIadflux lead forms / Aayushi parmar
