-- supabase_phase282_whatsapp_backfill.sql
-- Phase 282 — map existing UNMAPPED field reps to whatsapp_number so they get the
-- morning greet-gate + daily WhatsApp assistant (§197/§198/§281). Going forward,
-- admin_create_user auto-maps on creation (db/functions/admin_create_user.sql);
-- this one-time file catches reps created BEFORE that.
--
-- Source of the number = users.signature_mobile (the "Mobile/Phone" collected on
-- Add-Member / convert-to-user — the rep's own mobile). Stored as the LAST 10
-- digits (matches the webhook's last-10 rep-vs-customer match + the §197 seed).
--
-- SAFE: field roles only (sales/telecaller — agency EXCLUDED per §281, admin/
-- co_owner already seeded). Only rows whose whatsapp_number is NULL. Skips a
-- number that is already taken by ANOTHER user (uq_users_whatsapp_number) or has
-- <10 digits. Idempotent — re-run maps 0 new rows. Run the whole file once:
-- PART 1 previews, PART 2 applies, PART 3 verifies.
-- ⚠ signature_mobile MUST be the rep's own WhatsApp; a wrong number would route
--   their greeting into the customer funnel (§197). Eyeball PART 1 before trusting.

-- ── PART 1 · PREVIEW — who will be mapped, and to what ────────────────────────
SELECT u.name, u.role, u.signature_mobile,
       right(regexp_replace(COALESCE(u.signature_mobile, ''), '\D', '', 'g'), 10) AS will_map_to,
       (length(regexp_replace(COALESCE(u.signature_mobile, ''), '\D', '', 'g')) >= 10) AS has_valid_mobile,
       EXISTS (
         SELECT 1 FROM public.users x
         WHERE x.id <> u.id
           AND x.whatsapp_number = right(regexp_replace(COALESCE(u.signature_mobile, ''), '\D', '', 'g'), 10)
       ) AS clashes_existing,
       -- P2-1: two UNMAPPED reps sharing a mobile → PART 2 (one atomic UPDATE)
       -- would try to set both to the same last-10 → uq_users_whatsapp_number
       -- violation → the WHOLE update rolls back (0 mapped). If any row below is
       -- TRUE, fix the shared/duplicate number BEFORE running PART 2.
       EXISTS (
         SELECT 1 FROM public.users y
         WHERE y.id <> u.id AND y.is_active AND y.role IN ('sales', 'telecaller')
           AND y.whatsapp_number IS NULL
           AND length(regexp_replace(COALESCE(u.signature_mobile, ''), '\D', '', 'g')) >= 10
           AND right(regexp_replace(COALESCE(y.signature_mobile, ''), '\D', '', 'g'), 10)
             = right(regexp_replace(COALESCE(u.signature_mobile, ''), '\D', '', 'g'), 10)
       ) AS shares_with_another_unmapped
FROM public.users u
WHERE u.is_active
  AND u.role IN ('sales', 'telecaller')
  AND u.whatsapp_number IS NULL
ORDER BY has_valid_mobile DESC, u.name;

-- P3-2 (optional, run once): confirm no legacy whatsapp_number is stored in a
-- non-last-10 format (would evade the clash check + collide in the webhook map).
-- SELECT id, name, whatsapp_number FROM public.users
--  WHERE whatsapp_number IS NOT NULL
--    AND length(regexp_replace(whatsapp_number, '\D', '', 'g')) <> 10;   -- expect 0 rows

-- ── PART 2 · APPLY — map the valid, non-clashing ones ─────────────────────────
UPDATE public.users u
   SET whatsapp_number = right(regexp_replace(u.signature_mobile, '\D', '', 'g'), 10)
 WHERE u.is_active
   AND u.role IN ('sales', 'telecaller')
   AND u.whatsapp_number IS NULL
   AND length(regexp_replace(COALESCE(u.signature_mobile, ''), '\D', '', 'g')) >= 10
   AND NOT EXISTS (
     SELECT 1 FROM public.users x
     WHERE x.id <> u.id
       AND x.whatsapp_number = right(regexp_replace(u.signature_mobile, '\D', '', 'g'), 10)
   );

-- ── PART 3 · VERIFY — still-unmapped field reps (no valid mobile on file) ──────
-- These need their WhatsApp mobile set (edit the member, add Mobile, save — the
-- app now auto-maps it) OR a manual UPDATE with the correct number.
SELECT u.name, u.role, u.signature_mobile
FROM public.users u
WHERE u.is_active
  AND u.role IN ('sales', 'telecaller')
  AND u.whatsapp_number IS NULL
ORDER BY u.name;
