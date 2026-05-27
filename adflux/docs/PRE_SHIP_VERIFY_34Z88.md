# Pre-Ship Verification — Sales Module 34Z.88

**Goal:** Raise confidence from ~70% to ~95% before Sunday 17 May 2026 push.
**Run time:** ~30 min total (5 min SQL + 15 min phone + 10 min review).
**Date:** 16 May 2026.

---

## Part A — SQL state check (5 min)

Paste the block below into Supabase Studio → SQL Editor → Run.
Returns one row, all `OK` if everything is live. Any `MISSING` = paste the matching SQL file from the repo.

```sql
WITH checks AS (
  SELECT 'next_business_moment fn' AS item,
    CASE WHEN EXISTS(SELECT 1 FROM pg_proc WHERE proname='next_business_moment')
         THEN 'OK' ELSE 'MISSING (phase34_followup_consolidation.sql)' END AS status
  UNION ALL SELECT 'assign_lead_round_robin fn',
    CASE WHEN EXISTS(SELECT 1 FROM pg_proc WHERE proname='assign_lead_round_robin')
         THEN 'OK' ELSE 'MISSING (phase34_followup_consolidation.sql)' END
  UNION ALL SELECT 'lead_auto_assign trigger',
    CASE WHEN EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_leads_auto_assign')
         THEN 'OK' ELSE 'MISSING (phase34_followup_consolidation.sql)' END
  UNION ALL SELECT 'lead_activity_sync_followup trigger',
    CASE WHEN EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_lead_activity_sync_followup')
         THEN 'OK' ELSE 'MISSING (phase34_followup_consolidation.sql)' END
  UNION ALL SELECT 'enqueue_push fn',
    CASE WHEN EXISTS(SELECT 1 FROM pg_proc WHERE proname='enqueue_push')
         THEN 'OK' ELSE 'MISSING (phase34z69_push_audit_fixes.sql)' END
  UNION ALL SELECT 'push_log table',
    CASE WHEN to_regclass('public.push_log') IS NOT NULL
         THEN 'OK' ELSE 'MISSING (phase34z69_push_audit_fixes.sql)' END
  UNION ALL SELECT 'push_failures view',
    CASE WHEN to_regclass('public.push_failures') IS NOT NULL
         THEN 'OK' ELSE 'MISSING (phase34z70_audit_round2_fixes.sql)' END
  UNION ALL SELECT 'compute_daily_score fn',
    CASE WHEN EXISTS(SELECT 1 FROM pg_proc WHERE proname='compute_daily_score')
         THEN 'OK' ELSE 'MISSING (phase34z66_daily_performance_autocompute.sql)' END
  UNION ALL SELECT 'compute_daily_score trigger',
    CASE WHEN EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_lead_activities_compute_score')
         THEN 'OK' ELSE 'MISSING (phase34z66_daily_performance_autocompute.sql)' END
  UNION ALL SELECT 'compute_daily_ta fn',
    CASE WHEN EXISTS(SELECT 1 FROM pg_proc WHERE proname='compute_daily_ta')
         THEN 'OK' ELSE 'MISSING (phase34z67_daily_ta_autocompute.sql)' END
  UNION ALL SELECT 'compute_daily_ta trigger',
    CASE WHEN EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_gps_pings_compute_ta')
         THEN 'OK' ELSE 'MISSING (phase34z67_daily_ta_autocompute.sql)' END
  UNION ALL SELECT 'push_followup_digest fn',
    CASE WHEN EXISTS(SELECT 1 FROM pg_proc WHERE proname='push_followup_digest')
         THEN 'OK' ELSE 'MISSING (phase34z84_followup_digest_3x.sql)' END
  UNION ALL SELECT 'digest crons (3 expected)',
    CASE WHEN (SELECT count(*) FROM cron.job WHERE jobname LIKE 'untitled-digest-%') = 3
         THEN 'OK' ELSE 'WRONG COUNT — re-run phase34z84_followup_digest_3x.sql' END
  UNION ALL SELECT 'morning checkin cron',
    CASE WHEN EXISTS(SELECT 1 FROM cron.job WHERE jobname LIKE '%morning%' OR jobname LIKE '%checkin%')
         THEN 'OK' ELSE 'MISSING (phase34z61_morning_checkin_push.sql)' END
  UNION ALL SELECT 'old daily-reminders cron (should be gone)',
    CASE WHEN NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='untitled-daily-reminders')
         THEN 'OK' ELSE 'STILL PRESENT — phase34z84 should have unscheduled it' END
  UNION ALL SELECT 'per-task push triggers',
    CASE WHEN (SELECT count(*) FROM pg_trigger WHERE tgname IN
              ('trg_lead_tasks_push','trg_follow_ups_push')) >= 1
         THEN 'OK' ELSE 'MISSING (phase34z55_push_per_task_triggers.sql)' END
  UNION ALL SELECT 'quote->lead propagation triggers',
    CASE WHEN EXISTS(SELECT 1 FROM pg_trigger WHERE tgname LIKE '%quote%lead%' OR tgname LIKE '%lead%won%')
         THEN 'OK' ELSE 'MISSING (phase34z50_quote_lead_stage_consistency.sql or phase34q)' END
  UNION ALL SELECT 'lead stages enum values',
    CASE WHEN (SELECT count(DISTINCT stage) FROM leads
               WHERE stage IN ('New','Working','QuoteSent','Won','Lost','Nurture')) > 0
         THEN 'OK' ELSE 'NO leads exist — cannot verify' END
  UNION ALL SELECT 'cadence types in follow_ups',
    CASE WHEN (SELECT count(DISTINCT cadence_type) FROM follow_ups
               WHERE cadence_type IN ('lead_intro','quote_chase','nurture','lost_nurture')) >= 1
         THEN 'OK' ELSE 'NO follow_ups with valid cadence — Phase 33D.6 may not be live' END
  UNION ALL SELECT 'activity_type values for score',
    CASE WHEN (SELECT count(DISTINCT activity_type) FROM lead_activities
               WHERE activity_type IN ('call','meeting','site_visit')) >= 1
         THEN 'OK' ELSE 'NO scoring activities — Phase 34Z.66 may not be triggering' END
  UNION ALL SELECT 'ta_da_requests table',
    CASE WHEN to_regclass('public.ta_da_requests') IS NOT NULL
         THEN 'OK' ELSE 'MISSING (phase34z37_ta_da_requests.sql)' END
  UNION ALL SELECT 'dedupe_leads fn',
    CASE WHEN EXISTS(SELECT 1 FROM pg_proc WHERE proname IN ('dedupe_leads','merge_duplicate_leads'))
         THEN 'OK' ELSE 'OPTIONAL (phase34v_dedupe_leads.sql)' END
  UNION ALL SELECT 'block_duplicate_phone trigger',
    CASE WHEN EXISTS(SELECT 1 FROM pg_trigger WHERE tgname LIKE '%duplicate_phone%' OR tgname LIKE '%block_dup%')
         THEN 'OK' ELSE 'MISSING (phase34w_block_duplicate_phone_inserts.sql)' END
)
SELECT * FROM checks ORDER BY status DESC, item;
```

**Pass criteria:** every row shows `OK`. If any shows `MISSING (filename)`, open that file in the repo and paste its contents into a new SQL Editor tab, run it (idempotent — safe to re-run), then re-run the check block above.

**Extra one-line spot checks** (run after the main block):

```sql
-- 1. push_log audit working (should return rows from last 24h)
SELECT count(*) AS pushes_last_24h FROM push_log
 WHERE sent_at > now() - interval '24 hours';

-- 2. enqueue_push body contains hardcoded anon key (NOT current_setting)
SELECT CASE WHEN pg_get_functiondef(oid) LIKE '%eyJhbGciOiJIUzI1NiIs%'
            THEN 'HARDCODED ANON OK'
            ELSE 'WRONG — using current_setting, Supabase will reject' END
  FROM pg_proc WHERE proname = 'enqueue_push';

-- 3. Cron count overall (expect at least 4: 3 digest + 1 morning)
SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;

-- 4. Last 5 push failures (if any)
SELECT * FROM push_failures ORDER BY occurred_at DESC LIMIT 5;

-- 5. Daily score table has rows for today (proves trigger fires)
SELECT count(*) AS scores_today FROM daily_score WHERE score_date = current_date;

-- 6. Daily TA table has rows for today (proves gps trigger fires)
SELECT count(*) AS ta_today FROM daily_ta WHERE ta_date = current_date;
```

---

## Part B — Phone smoke test (15 min, real device)

Run on your iPhone, in this order. Each step has an "expected" line — if reality differs, that's a bug to file.

### Setup (1 min)

- [ ] On phone: open `https://untitled-os-xxxx.vercel.app` (untitled-os branch URL)
- [ ] Log in as your sales rep test account (or your own co_owner account in rep mode)
- [ ] Wait 5 sec for service worker to update

### Test 1 — Drawer / bell z-index (the 34Z.88 fix, 1 min)

- [ ] On `/work`, tap hamburger (top-left) → drawer slides in from left.
- [ ] **Expected:** bell icon + red `11` badge are HIDDEN behind drawer overlay. No yellow circle bleeding through.
- [ ] **Fail look:** bell + badge visible on top of dark drawer overlay (the screenshot you sent).

### Test 2 — TodaySummaryCard 6-bucket grid (2 min)

- [ ] On `/work`, scroll to "today's load" 6-cell grid.
- [ ] **Expected:** 6 cells visible (Follow-up, Quote, Payment, Today, Scheduled, Renewal). All labels readable, no `…` truncation.
- [ ] Tap each non-zero cell → navigates to the right destination:
  - Follow-up → `/follow-ups`
  - Quote → `/follow-ups?filter=quote_chase`
  - Payment → `/follow-ups?filter=payment`
  - Today → `/work#day-status` (same page, scrolls)
  - Scheduled → `/follow-ups?filter=meetings`
  - Renewal → `/renewal-tools`
- [ ] **Fail look:** any cell goes to wrong page, or counts mismatch the lists.

### Test 3 — PostCallOutcomeModal chain (4 min, critical path)

This is the heart of the sales module — if this breaks, everything breaks.

- [ ] Pick any active lead with phone number → open lead detail.
- [ ] Tap "Call" button.
- [ ] **Expected:** native dialer opens within 0.5 sec. Hang up immediately.
- [ ] **Expected:** ~1.5 sec after returning to browser, PostCallOutcomeModal appears automatically.
- [ ] In modal: tap outcome = "Interested". Tap "Save".
- [ ] **Expected:** modal closes. Lead page refreshes. Activity log shows new "call" entry.
- [ ] Check: any pre-existing open follow-up for this lead is now marked done (green tick).
- [ ] Check: a NEW follow-up exists for tomorrow (default next action).
- [ ] **Fail look:** modal doesn't appear, OR save errors silently, OR follow-up doesn't close.

### Test 4 — Save outcome with "Lost" → stage flip (2 min)

- [ ] Open another lead (or use same one if not yet WON).
- [ ] Tap Call → hang up → modal appears.
- [ ] Outcome = "Not interested". Save.
- [ ] **Expected:** lead stage flips to `Lost`. Soft-auto-Lost dismissed (if banner was showing).
- [ ] **Expected:** no new follow-up created (Lost = terminal).

### Test 5 — Voice intent (2 min)

- [ ] Open lead detail → tap mic icon (voice button).
- [ ] **Expected:** browser asks for mic permission first time. Allow.
- [ ] Say: "Set follow up tomorrow morning at 10"
- [ ] **Expected:** voice transcribes → modal pre-fills `tomorrow 10:00 AM`.
- [ ] Save.
- [ ] **Expected:** follow-up row inserted with correct date+time.
- [ ] **Fail look:** "Auth session missing" error → Phase 34Z.78 fix didn't ship / failed.

### Test 6 — Push notification delivery (2 min)

- [ ] Phone settings: ensure notifications enabled for the PWA.
- [ ] Open `/push-debug`.
- [ ] Tap "Send test push to me".
- [ ] **Expected:** within 10 sec, notification arrives on phone lock screen.
- [ ] Tap notification → app opens to `/follow-ups`.
- [ ] **Fail look:** no notification (Android battery whitelist issue — check 5-step guide on the same page).

### Test 7 — Auto-refresh on tab resume (1 min)

- [ ] On `/follow-ups`, note the number of pending items.
- [ ] Switch to another browser tab (Safari → Chrome or any) for 5 sec.
- [ ] Switch back to the PWA.
- [ ] **Expected:** list re-fetches automatically (you may see a brief loading state).
- [ ] **Fail look:** stale list — `useAutoRefresh` not firing on visibilitychange.

### Test 8 — Renewal Tools (1 min, co_owner only)

- [ ] As co_owner, open `/renewal-tools`.
- [ ] **Expected:** see ALL reps' renewing quotes within 60 days (not just your own).
- [ ] As a sales rep account, open same URL.
- [ ] **Expected:** see only that rep's quotes.

---

## Part C — Outcome reporting (10 min)

If any test fails:

1. Screenshot the failure screen.
2. Note the test number + exact step that broke.
3. Open browser DevTools (if on desktop) → Console tab → screenshot any red error.
4. Paste back to Claude with format:

```
Test #4 failed at step "Lost outcome".
Expected: stage flips to Lost.
Actual: stage stayed Working, no toast.
Console: PATCH /rest/v1/leads 400 — "column completed_at not found"
```

### Pass criteria

- All 22 SQL items in Part A return `OK`
- All 8 phone tests in Part B return Expected behavior
- Push notification arrives within 10 sec (Test 6)
- No silent failures (every action either succeeds with feedback or shows a toast)

**If all green** → push 34Z.88 + ship.
**If any red** → reply with the failing test number + paste the console error.

---

## Part D — Optional deep checks (skip if time is tight)

These catch low-probability bugs but take longer to run:

- **RLS verification per role.** Log in as each role (admin / co_owner / sales / agency / telecaller) and confirm sidebar entries + page access match §8 spec. ~10 min.
- **100-lead pagination.** Filter `/leads` to a rep with 100+ leads, scroll to bottom, confirm no rendering lag. ~3 min.
- **Slow 3G simulation.** Chrome DevTools → Network → Slow 3G → save a follow-up. Confirm no double-save on retry. ~3 min.
- **Service worker upgrade.** On a previously-installed PWA, hard-refresh + check `chrome://serviceworker-internals/` (Android) or DevTools → Application → Service Workers (iOS Safari). Confirm new version registered. ~5 min.
- **Govt wizard end-to-end.** Create one AUTO_HOOD quote + one GSRTC_LED quote, confirm refs follow new format (`UA/AUTO/2026-27/NNNN`). ~5 min.

---

**Done.** Reply with **"all green"** if Part A + B pass, or paste the failure detail and I'll diagnose.
