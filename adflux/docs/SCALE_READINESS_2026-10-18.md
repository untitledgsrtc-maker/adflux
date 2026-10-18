# Scale readiness - what breaks first at 10x traffic (18 Oct 2026)

Plain-words check against the "4 prompts so your app survives going viral" list. Facts below come from the repo, CLAUDE.md history and one live read-only check (DB 868 MB, 35 of 120 connections, pg_stat_statements installed, 3 unused indexes over 1 MB, 2 heavily row-scanned tables - names not yet read).

## Where it runs
- App: Vercel Hobby (free). Limits that bit us: 12 serverless functions (new endpoints must be Edge), 10 GB deployment storage (overrun 15 Oct; builds now skipped for docs/sql-only commits).
- Database: Supabase, upgraded Micro -> Medium on 15 Sep after the outage (CPU 98%, 15 connections). The app talks to it through Supabase's REST layer, which pools connections itself, so no extra pooler setup is needed.
- Stateless: yes. Only in-memory use is per-instance rate limits (soft by design).

## What breaks first (in order)
1. Database CPU (2-core on every tier up to Large). Cause: heavy dashboard loads and cron/webhook bursts. Fix: aggregate in SQL (done for several), trim polling, then bigger tier (2XL adds cores, costs most).
2. Vercel Hobby limits: function count and storage. Fix: keep new endpoints Edge, push less often, move public/deck media to Supabase storage; Pro plan if needed.
3. WhatsApp number quality, not servers: volume of cold QR scans on one number. Fix: spread boards across both numbers.

## Done / not done
- Indexes: many added (phases 197, 315, 293 load cuts). Not done: before/after timings; drop 3 unused indexes after reading their names.
- Caching: static media under /deck /led /investor /email now cached 1 day (this change). Private data deliberately NOT cached.
- Load test: not done. Needs a separate copy of the database first; never against the live one.
- Automated tests: none. Next: tests for salary, score and TA functions on a copy.

## Live read (18 Oct 2026, read-only)
- Never-used indexes: gps_pings_user_time_idx on gps_pings (107 MB, written every few seconds), idx_lead_activities_created_by (5 MB), idx_webhook_log_provider_at (2.5 MB). Dropping is reversible but not done - owner decision.
- Row-scan tables: leads (11k rows, 99k scans vs 20.8M index scans - fine), follow_ups (58k rows, 34k scans vs 1.45M index scans - fine).
- Slowest repeated calls: one REST function call averaging 1.2 s (385 calls), team_all_leads (Sales Head team view) 1.1 s (93 calls). The other slow rows are Supabase internals.
- pg_stat_statements here uses total_exec_time/calls (no mean_time column).
