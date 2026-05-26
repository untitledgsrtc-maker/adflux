# Sales module audit — 26 May 2026

Read-only audit per owner directive 26 May 2026. Scope: full sales
module from rep tap to DB, including TC parallel surfaces.

**Baseline**: branch `untitled-os` post-commit `cbf49df` (Phase 93.17).
Two SQL fixes shipped earlier same day pending owner-side run:
- `supabase_phase93_7_1_counter_dedup.sql` (counter + dup score trigger)
- (live trigger landscape diagnosis done 25-26 May)

**Method**: walked the §28 frozen file list + DB trigger inventory +
cross-role spot-check. Findings categorised by severity. Fix shape
included where obvious — no code changed.

---

## P0 — bleeds today (KPI / data integrity / blocking UX)

### P0-1. IST date helper anti-pattern in 25+ sites

**Symptom**: At midnight to 5:30 AM IST, dashboards query the WRONG
date. Rep sees yesterday's data or empty "today" tile.

**Cause**: `new Date().toISOString().slice(0, 10)` returns UTC date.
IST is UTC+5:30 — before 5:30 AM IST, UTC clock is still on previous
day → all "today" queries miss real today's rows.

Phase 47.9 shipped `src/utils/istDate.js` with `istTodayISO()`,
`istTodayPlusDays()`, `istNowPlusHoursDateTime()`. About 25 sites
were never migrated.

**Highest-impact offenders** (touch sales-rep KPIs):
- `src/pages/v2/SalesDashboard.jsx:72` — filters follow_ups by today
- `src/pages/v2/SalesDashboardDesktop.jsx:70, 84` — same
- `src/pages/v2/FollowUpsV2.jsx:41` — `TODAY_ISO` helper baked into the page
- `src/pages/v2/AdminDashboardDesktop.jsx:371` — `todayIso`
- `src/pages/v2/CheckInV2.jsx:112` — check-in date boundary
- `src/pages/v2/EveningVoiceV2.jsx:33` — evening summary scoping
- `src/hooks/useLeadTasks.js:24-29` — `todayIST()` formula uses the
  +5.5h shift trick (works by coincidence — keep but consider migrating
  for consistency)

Lower-risk (cosmetic only):
- `LeadsV2.jsx:304` — CSV filename
- `GpsTrackV2.jsx:96, 703, 704` — date picker bounds
- `HRNewUserV2.jsx` / `HROfferLetterV2.jsx` — join_date prefill

**Fix shape**: import `istTodayISO` from `src/utils/istDate.js` and
replace. About 25 mechanical edits + visual diff per page.

**Sprint estimate**: 2 hours including parse + guardian audit.

---

### P0-2. Push delivery on phone — unresolved

**Symptom**: Push notifications fire server-side (push_log status 200)
but don't render on device.

**Cause**: Unknown. Best guesses:
1. `untitled_default` channel not created in APK manifest
2. Battery optimization killing FCM listener
3. Capacitor `PushNotifications` plugin not wired to receive in background

**Evidence**:
- Phase 34Z.69 wired enqueue_push with 5s timeout + push_log audit
- Owner confirmed push_log shows 200 on server
- Owner-installed 0.94.1 APK has new channel-creation path (Phase 76.2
  TrackingPlugin) but device-side smoke test never confirmed channel
  exists in Settings → Apps → Untitled OS

**Fix path**:
1. Owner pulls phone Settings → Apps → Untitled OS → Notifications.
   Confirm `untitled_default` channel present.
2. If absent: Java side `MainActivity` needs `createNotificationChannel`
   call OR new APK rebuild.
3. If present: test push via `/push-debug` self-test. Show server log
   + device-side timing.

Blocks Phase 92d (evening reminder push) + Phase 93.8e (follow-up
due-time push). Both have SQL cron scheduled but no observable delivery.

**Sprint estimate**: 30 min phone-side + Java fix if needed.

---

### P0-3. pg_cron worker firing — unconfirmed on owner's Supabase plan

**Symptom**: Phase 92c 20:00 IST auto-close cron, Phase 93.8e follow-up
due reminder cron, Phase 34Z.61 9:30 IST morning push — all scheduled
via `cron.schedule()`. Evidence of firing is missing for 92c (owner
saw 4 open sessions still open past 20:00 IST after the SQL was applied).

**Cause uncertainty**: 
1. Supabase pg_cron extension may require Pro plan worker
2. OR cron fires but specific function silently errors
3. OR cron.job_run_details table not populated on owner's plan

**Fix path**:
```sql
SELECT * FROM cron.job_run_details
WHERE jobid IN (
  SELECT jobid FROM cron.job
  WHERE jobname IN ('untitled-auto-close-2000',
                    'untitled-followup-due-reminders',
                    'untitled-morning-checkin'))
ORDER BY start_time DESC
LIMIT 20;
```

If 0 rows → cron worker dead. Workaround: Vercel cron OR external
scheduler (cron-job.org) ping a Supabase edge function that calls the
RPC.

**Sprint estimate**: 1 hr diagnose + 3 hr Vercel cron fallback if needed.

---

## P1 — data drift / silent failures

### P1-1. Bulk reassign skips `lead_activities` timeline row

**Symptom**: Single-lead reassign (Phase 76.2.2) writes a
`status_change` activity row before the leads UPDATE. Bulk reassign
(`useLeads.js:69 reassignBulk`) just `.update().in('id', ids)`. No
audit trail per lead.

**Impact**: Admin can't tell which leads were bulk-reassigned vs
manually changed. Reps can't see "Reassigned from X to Y" in lead
timeline after a bulk move.

**Fix shape**: extend `reassignBulk` to:
1. INSERT N activity rows in one statement (`from('lead_activities').insert(rowsArray)`)
2. THEN UPDATE leads

**Sprint estimate**: 30 min.

---

### P1-2. Whatsapp activity not counted in score formula

**Symptom**: `lead_activities.activity_type='whatsapp'` rows don't
contribute to daily score. Phase 34Z.66 trigger formula counts only
`meeting | call | site_visit`.

**Impact**: TC who works heavily via WhatsApp (common for cold
outreach) gets zero score credit. Doesn't affect Kirti/Rima current
KPI since their primary metric is call count, but Renuka (TC lead)
will run into this if WhatsApp campaigns become primary tool.

**Status per §28**: "frozen DB contract — activity_type for score:
meeting | call | site_visit only. WhatsApp + notes intentionally
excluded." So this is BY DESIGN, not a bug.

**Edge**: if owner reverses the call later, score trigger needs update.

**Sprint estimate**: N/A (design choice).

---

### P1-3. Bell badge dismissals are per-device, not synced

**Symptom**: Rep dismisses 20 notifications on phone APK. Opens web on
laptop — same 20 notifications still show.

**Cause**: Phase 93.8c stored dismissed set in `localStorage`. Owner
on web sees raw queue.

**Impact**: Admin views are device-fragmented. Per-rep view consistent
but cross-device confusing.

**Fix shape** (deferred per §28 — no `notifications` table exists):
- Add `notifications_dismissed` JSONB column on `users` table
- Migrate localStorage logic to read/write that column
- ~3 hr including RLS

**Sprint estimate**: 3 hr. Not blocking.

---

### P1-4. Quote→lead Won propagation skips lost→sent rollback

**Symptom**: Quote was flipped to `lost` → lead.stage flipped to `Lost`.
Later quote is rolled back to `sent` (rare but possible via admin).
Lead.stage stays `Lost`.

**Cause**: `quote_status_propagate_to_lead()` checks `NEW.status =
'won'` or `'lost'` but has no rollback branch.

**Impact**: Lead stuck `Lost` until manual stage change. Rare in
practice (Phase 11b immutability blocks most regressions).

**Fix shape**: add `ELSIF NEW.status IN ('draft', 'sent', 'negotiating')
AND OLD.status = 'lost'` → roll lead back to `QuoteSent` IF its current
stage is `Lost` AND no other won/lost quote exists.

**Sprint estimate**: 1 hr SQL.

---

### P1-5. Auto-check-in companion rows still create duplicate map pins

**Symptom**: `/admin/gps/<rep>` shows the same lead at the same coord
twice — once from the real meeting save, once from the companion
"I'm here · auto-check-in" row.

**Cause**: Phase 93.6 + 93.7 added the JSX `uniqueMeetingCount` helper
but didn't filter the map-pin render path. Map shows ALL meeting rows
with GPS coords regardless of companion flag.

**Impact**: visual noise on the admin map. Owner described as "looks
ok but I can see double dot" (his words 25 May).

**Fix shape**: extend the `meetingActs` filter in GpsTrackV2.jsx:491
to ALSO skip rows where `notes` LIKE `I'm here · auto-check-in%`. One
line.

**Sprint estimate**: 15 min.

---

### P1-6. PostCallOutcomeModal LIKE-only intent parser misses some Gujarati transliterations

**Symptom**: Rep speaks Gujarati outcome ("ગમ્યું" or "ના પાડી"). Modal
sometimes doesn't pre-fill outcome chip.

**Cause**: Regex at PostCallOutcomeModal.jsx:50-69 covers Devanagari
+ Latin transliteration + Gujarati script, but Whisper sometimes
returns word-boundary-different Gujarati (e.g. `ગમ્યુ` without nukta).
Phase 34Z.69 broadened Hindi negation but didn't fully sweep Gujarati.

**Impact**: small. Rep has to manually tick chip. Save still works.

**Fix shape**: expand regex AND remove word boundaries on Gujarati
patterns. ~20 min.

**Sprint estimate**: 20 min.

---

## P2 — minor UX / cosmetic

### P2-1. `lost_reason` default 'NoNeed' on quote-loss propagation

`quote_status_propagate_to_lead()` sets `lost_reason = COALESCE(existing,
'NoNeed')` when quote.status = 'lost'. Owner may want a richer default
like 'price' or 'competitor'. Cosmetic; UX gap.

### P2-2. Score trigger duplicate (fixed 93.7.2 — needs SQL run)

Already documented + fix shipped in pending SQL.

### P2-3. Stale dead function `bump_meeting_counter()` (fixed 93.7.1)

Already commented as DEAD. Could DROP in a future cleanup commit.

### P2-4. NotificationPanel sources mix lead_id + quote_id route patterns

Items can route to `/leads/:id` OR `/quotes/:id` OR `/proposal/:id`
depending on source. Already consistent per Phase 34Z.81+34Z.83 logic.
But the per-source route logic at NotificationPanel.jsx:97-122 is
brittle to schema drift. Centralising into a helper would protect
future edits.

### P2-5. `bump_daily_counter` helper not visible

Phase 93.7.1 trigger calls `public.bump_daily_counter(user, key, delta)`.
Couldn't locate the helper definition in supabase_*.sql files. Either
inlined into another phase OR pre-Phase-12 baseline. Worth confirming
the helper exists + handles upsert vs update correctly.

### P2-6. `useLeadTasks.snooze()` removes from local state but doesn't refetch

Optimistic UI on snooze. If the DB update silently fails (RLS reject),
the task disappears from UI but remains in DB. Realtime sub *should*
catch it but isn't guaranteed.

### P2-7. Telecaller team-lead view (Renuka) — never built

Phase 30 noted as deferred (§30 of CLAUDE.md). Folds into Phase 42.2
sales_manager frontend. Not a bug; missing feature.

### P2-8. P&L module — spec only, no code

Per §29. Not a sales-module bug per se but downstream of any WON deal
flowing to revenue. Owner-side deferred.

---

## Architecture observations (no fix needed, knowledge only)

### A-1. Trigger inventory on `lead_activities` (post Phase 88.4)

Current trigger list (after diag SQL 25 May):

| Trigger | Function | Purpose |
|---|---|---|
| `tg_score_on_activity` | `tg_recompute_score_on_activity` | Phase 34Z.66 daily score |
| `trg_clear_handoff_sla` | `clear_handoff_sla_on_activity` | Phase 93.8a SLA auto-clear |
| `trg_lead_activity_after_insert` | `lead_activity_after_insert` | contact_attempts + auto_lost suggestion |
| `trg_lead_activity_aftermath` | `lead_activity_aftermath` | Phase 88.4 consolidated (first_engagement + auto_heat insert + sync_followup) |
| `trg_lead_activity_bump_counter` | `lead_activity_bump_counter` | daily_counters bump (Phase 93.7.1 fix lives here) |
| `trg_lead_auto_heat_on_update` | `lead_auto_heat_from_outcome` | UPDATE path of auto-heat |
| `trg_recompute_score_on_activity` | `tg_recompute_score_on_activity` | DUPLICATE — drop via 93.7.2 |

Total: 6 effective triggers per row (after 93.7.2). All AFTER INSERT
except `trg_lead_auto_heat_on_update` (AFTER UPDATE).

### A-2. Quote-flow triggers

| Trigger | Function | Purpose |
|---|---|---|
| `trg_quote_status_propagate_to_lead` | `quote_status_propagate_to_lead` | Phase 34Q won/lost → lead stage |
| `trg_quote_status_propagate_on_insert` | `quote_status_propagate_on_insert` | Phase 34Z.50 INSERT path |
| `trg_quote_after_delete_rollback_lead` | `quote_after_delete_rollback_lead` | Phase 34Z.50 DELETE rollback |
| `trg_payment_followups_on_won` | (in 33g file) | post-Won payment chase cadence |
| `trg_quote_immutability_*` | Phase 11b | rules on stage/status transitions |

### A-3. Lead lifecycle

Stages: `New | Working | QuoteSent | Won | Lost | Nurture` (frozen §28).

Auto-transitions:
- New → Working: any engagement activity (call/meeting/site_visit) via
  Phase 45.2 → consolidated into Phase 88.4 `lead_activity_aftermath`
- QuoteSent: set by quote wizard via `WizardShell` Phase 14
- Won: via quote.status='won' propagation (Phase 34Q/34Z.50) OR manual
- Lost: manual via ChangeStageModal (mandatory lost_reason) OR via
  quote.status='lost' propagation

### A-4. Activity outcome coverage

Outcomes: `positive | neutral | negative | callback`. Set via
PostCallOutcomeModal on call rows ONLY. Meeting rows don't capture
outcome — outcome stays NULL on meeting INSERT.

→ Heat auto-flip (Phase 47.4) doesn't fire on meeting activity since
outcome is NULL. By design.

→ Auto-lost suggestion (Phase 34B) at 15 attempts considers outcomes
`NULL | neutral | negative`. Meeting rows count toward attempts but
NULL outcome doesn't block the suggestion. By design.

### A-5. Push pipeline

```
DB trigger / cron → enqueue_push(user, title, body, url, tag)
                      ↓
                    pg_net.http_post → Supabase Edge Function notify-rep
                      ↓
                    (FCM v1 native OR VAPID web)
                      ↓
                    Device → notification tray
```

Audit trail: `push_log` row per attempt (Phase 34Z.69). Status codes
recorded. Owner can grep `push_failures` view for failures.

Phase 34Z.55 fires per-task push triggers on INSERT to
`lead_tasks` + `follow_ups`. New activity rows DON'T fire push (by
design — score trigger handles them).

Phase 93.8e adds time-based follow-up reminder cron (every 5 min,
fires push when follow_up_time crosses past 5 min window).

### A-6. Performance / churn

Per-row INSERT to lead_activities currently fires 6 triggers (5 after
93.7.2). Each rep call/meeting = ~6 PL/pgSQL function calls + at least
2 secondary UPDATE statements (leads stage/heat + work_sessions counter).

Phase 88.4 consolidation reduced from 3 separate functions to 1
(`lead_activity_aftermath`). Further consolidation possible but each
trigger has clear separation of concerns.

Realtime: Phase 88.6 added `lead_activities` + `follow_ups` to
`supabase_realtime` publication. Every INSERT broadcasts to all
connected pages via WebSocket. `useAutoRefresh` hook debounces at
800ms to avoid storm during bulk ops.

### A-7. RLS surface

Sales rep can write:
- `leads` (assigned_to = self OR sales_manager team override)
- `lead_activities` via leads RLS chain
- `follow_ups` via assigned_to OR sales_manager
- `quotes` via created_by
- `work_sessions` via user_id

Sales rep can READ all the above for own + team (sales_manager) +
public dashboards.

No bypass detected. Service-role only on:
- `notify-rep` Edge Function (FCM token)
- `lead_activity_aftermath` (SECURITY DEFINER for cross-RLS UPDATE)
- Phase 93.7.1 `lead_activity_bump_counter` (SECURITY DEFINER for
  work_sessions write)

---

## Recommended sprint ordering

| # | Item | Severity | Hours | Blocker? |
|---|---|---|---|---|
| 1 | Push 93.7.1 + 93.7.2 SQL (already shipped, awaiting owner run) | P0 | 5 min | Yes — affects meeting KPI today |
| 2 | Push 93.17 GPS sprint (already shipped, awaiting Vercel) | P0 | (done) | Yes — Kirti blocked |
| 3 | P0-3 pg_cron worker diag | P0 | 1 hr | Owner runs SQL + reports |
| 4 | P0-2 push delivery channel debug | P0 | 30 min phone-side | Owner pulls phone Settings |
| 5 | P0-1 IST date migration (5 highest-impact sites) | P0 | 2 hr | No, but corrupts boundary-hour data |
| 6 | P1-5 companion-row map pin filter | P1 | 15 min | No |
| 7 | P1-1 bulk reassign timeline rows | P1 | 30 min | No |
| 8 | P1-4 quote lost→sent rollback | P1 | 1 hr | No, rare |
| 9 | P1-6 PostCallOutcomeModal regex sweep | P1 | 20 min | No |
| 10 | P1-3 dismissed-set DB sync | P1 | 3 hr | No |
| 11 | P2-1 lost_reason default polish | P2 | 10 min | No |
| 12 | P2 cleanup (drop dead bump_meeting_counter, etc) | P2 | 1 hr | No |

**Total queued work**: ~10 hr of fixes after the 2 already-shipped pending pushes.

---

## What did NOT need a finding

- Lead → Quote linkage (Phase 14) — wired correctly
- ChangeStageModal lost_reason mandatory — enforced
- `useAutoRefresh` Phase 88.6 realtime + visibility + focus — solid
- Phase 88.4 trigger consolidation — clean, doesn't conflict with 93.7.1
- DNC / WA opt-out gating — Phase 47.5 covers tel: + WA buttons
- Phase 87.5 profile pic upload — RLS + EXIF strip + 5 MB cap
- Phase 93.5 TC card layout — confirmed live + tokens-on-scale
- Phase 93.14 mobile leads cards — owner-confirmed clean after 93.16

End of audit.
