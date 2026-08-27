-- supabase_ops_assign_stations.sql — bulk-assign ops stations to a tech.
-- Fixes the "ops exec sees no data" gap: every ops-exec screen is scoped to
-- the stations assigned to them (ops_depots.assigned_to). Nothing auto-assigns
-- it, so until a station is assigned the exec sees nothing.
--
-- Non-destructive: assigned_to is a re-assignable pointer. Re-runnable. The
-- WHERE guard means a wrong/missing email assigns NOTHING (never nulls anyone).
-- To split stations across several techs later, re-assign per station in the
-- Head console (Live console -> Screens by station -> Assigned tech), or use
-- OPTION B below.

-- ── First, see who the execs are (pick the email to use) ───────────────────
SELECT id, name, email, role
  FROM public.users
 WHERE role IN ('operation_executive','operation_head')
 ORDER BY role, name;

-- ── OPTION A · assign EVERY active station to ONE tech ─────────────────────
-- Replace <TECH EMAIL> with the exec's email from the query above, then run.
UPDATE public.ops_depots
   SET assigned_to = (SELECT id FROM public.users
                       WHERE lower(email) = lower('<TECH EMAIL>')
                         AND role = 'operation_executive'),
       updated_at = now()
 WHERE is_active
   AND (SELECT id FROM public.users
         WHERE lower(email) = lower('<TECH EMAIL>')
           AND role = 'operation_executive') IS NOT NULL;

-- ── VERIFY ─────────────────────────────────────────────────────────────────
SELECT COALESCE(u.name, u.email, '(( UNASSIGNED ))') AS tech,
       count(*) AS active_stations
  FROM public.ops_depots d
  LEFT JOIN public.users u ON u.id = d.assigned_to
 WHERE d.is_active
 GROUP BY 1 ORDER BY active_stations DESC;

-- ── OPTION B · split by station (uncomment + repeat per group) ─────────────
-- UPDATE public.ops_depots
--    SET assigned_to = (SELECT id FROM public.users WHERE lower(email)=lower('<TECH A EMAIL>')),
--        updated_at = now()
--  WHERE is_active AND name ILIKE ANY (ARRAY['%Valsad%','%Botad%','%Bhavnagar%']);
