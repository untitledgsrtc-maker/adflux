# Creative team "My Work" - plan + structure (STEP 1 of 3: plan -> UI/UX -> build)
Date: 2026-10-13. Status: PLAN ONLY - nothing built. Replaces Trackdek (subscription ends 30 Nov 2026).
Supersedes the screen-first approach in `DESIGN_creative_role_views.md` (kept as reference); the owner's sequence is plan -> UI/UX -> build.

## 1. What Trackdek really does for you (read from the live account, 13 Oct 2026)
Pick a client (142 "projects") -> type a task name -> run the clock -> switch task = new time slice -> admin reads hours.
23,708 slices so far; 8 people use it daily (~55 h/day); a maker/checker habit exists but is never recorded
(e.g. Dixita Rana / Gohel "working on campaign", Damini / Renuka "checking" on Swachh Bharat Mission).
It never records: deadline, brief, the delivered file, approve / reject, who is waiting. Task status is always "New".

## 2. The goal (one sentence)
A person opens the app, starts the clock on a client in two taps, switches when they switch, and the head sees hours per client
and who is waiting on a check - with no screenshots and no activity scoring.

## 3. Structure (the data, in plain English)
| Thing | What it is | New table |
|---|---|---|
| Work project | a client OR an internal stream (HR, AI Adflux, GSRTC work). Seeded from the 142 Trackdek names. Optional link to `clients`. | `work_projects` |
| Time entry | one slice: who, which project, task text typed by the person, start, end, source (timer / added later), note. One running timer per person. | `work_time_entries` |
| Job (phase 2) | one deliverable: project, title, DUE DATE, maker, checker, status = Assigned / Sent / Approved / Changes asked (the four words of the earlier design). Time entries may point at a job. | `work_jobs` |
| Review (phase 2) | the checker's verdict on a job + a chip reason | `work_reviews` |
| Added-later time (phase 1) | "I forgot to start" entry, needs the head's approve / decline (same as Trackdek manual time) | status column on time entries |
Reused from the app (not rebuilt): users + roles, leaves, holidays, push notifications, Hours-of-work check-in rule, client list, role landing.
Dropped on purpose: screenshots, mouse / keyboard counts, productivity %, a separate "attendance" calendar (leave + holiday already live).

## 4. Who sees what
- Maker (designer / video editor / creative): own timer, own day, own jobs.
- Checker: the above + jobs waiting for their verdict.
- Head / admin: everyone's day, hours per client and per person, jobs overdue, added-later approvals.
- co_owner (government desk) and sales reps: none in phase 1. Sales gets a two-line strip on the order in phase 3.
Access is enforced in the database (RLS), not only hidden in the screen.

## 5. Phases (in order; each ships and is checked before the next)
1. **Timeclock** (must be live by ~15 Nov so Trackdek can end): projects seeded, start / stop / switch, today list, day total, added-later with approval, admin day table + hours per client. Maker landing = "My Work".
2. **Jobs**: deadline, maker + checker, the four statuses, "who is stopped".
3. **Delivery**: send file -> checker verdict -> push to the sales rep with the approved file.
4. **Reports**: hours per client against what that client pays us (the one number Trackdek cannot give).

## 6. DECISIONS LOCKED (owner, 2026-10-13)
1. Replace Trackdek fully by 30 Nov; timeclock first. YES.
2. First timer start = clock in; last stop = clock out; no separate check-in. YES.
3. No screenshots, no keyboard / mouse counts, no productivity %. YES, for good.
4. Checker is NOT fixed per person. It is chosen per job, at the time, by whoever assigns the job (phase 2). Phase 1 has no checker at all.
5. Task name = free typing with suggestions from past names. YES.

## 7. STRUCTURE DESIGN (detail)
### 7.1 Who is on the timeclock
Not by role - by a switch. Trackdek's 8 daily users are a mix (HR, ops, designers, video, a campaign team), and only ONE of them (Riya, HR) has a login in our app today.
So: a per-user flag `users.uses_timeclock` (admin sets it; same pattern as `can_view_team_dashboard`). It MUST be pinned in the `users_self_update_avatar` policy
(section 172 contract) or a person could switch it on for themselves. People who are not in the app yet are created first (Add Member, role "staff" for designer / video / creative).
Open: map Trackdek names to logins - confirm "Dixita" (ops head, dixita@untitledad.in) vs "Dixita Rana" / "DIXITA GOHEL" are who.

### 7.2 Tables
`work_projects`  id, name (unique ignoring case), kind client | internal | govt, client_id -> clients (nullable), is_active, created_by, created_at.
  Seeded from the 142 Trackdek names (duplicates like MAHANT INVESTMENT merged). Anyone on the timeclock may add one by typing; the head can rename, merge, archive.
`work_time_entries`  id, user_id, project_id, task_label (text, 80), started_at, ended_at (null while running), source timer | added_later,
  status approved | pending | declined (timer entries are approved; added_later start pending), decided_by, decided_at, note, job_id (nullable, phase 2), created_at.
  Rules in the database: ONE running entry per person (partial unique index); ended_at after started_at; an entry never crosses midnight IST (split at midnight);
  added_later must be in the past, at most 12 h, must not overlap another entry; a person edits or deletes only their OWN entries of the last 7 days that are not approved-by-head.
Day figures are DERIVED, not stored: clock in = first start of the IST day, clock out = last end, total = sum of slices.
Task suggestions are DERIVED: most recent distinct `task_label` for that project (then that person), no table.
Phase 2: `work_jobs` (project, title, due date, maker, checker - empty until chosen, status Assigned / Sent / Approved / Changes asked, timestamps) and `work_reviews` (verdict + chip reason).

### 7.3 Rules for the clock
- Starting a timer on another task stops the current one in the same step (switch = one tap).
- A timer left running is stopped automatically at a cut-off (proposal 21:30 IST) and marked "auto-stopped" so the person can correct it next morning.
- Leave / holiday days: timer still allowed (a person may work a holiday); no warning, no blocking.
- NO PAY EFFECT. Hours are a display and a report. They do not feed salary, score, incentive, absent-marking or the 20:30 attendance job (that job only touches sales / telecaller and is untouched).

### 7.4 Access (enforced in the database)
- Person: reads / writes own entries. Added-later entries need the head's approve / decline.
- Head (admin, or a person the admin flags): reads everyone on the timeclock; approves added-later; manages projects.
- co_owner, sales, telecaller, agency and everyone else not flagged: no access. No segment data is involved.

### 7.5 What it reuses / what it must not touch
Reuses: users, roles, Add Member + convert, push notifications, clients list, the role landing redirect.
Must not touch (section 28 / 45): check-in gate for sales / telecaller, compute_daily_score, compute_monthly_salary, attendance cron, any frozen sales page.
A new route + a new nav entry only (additive). New tables only.

### 7.6 Phase 1 acceptance (what "done" means)
1. A flagged person starts, switches and stops a timer in two taps each, on phone and on desktop.
2. Today list + day total match the sum of slices; forgotten timer auto-stops.
3. Head sees every person's day and hours per client for any date range.
4. Added-later entry goes pending, head approves, it counts.
5. Switch-over: the 142 projects exist; a week of both systems side by side; Trackdek can end 30 Nov.

## 8. Final answers (owner, 2026-10-13) - STRUCTURE CLOSED
A. Our "Dixita" (ops head, dixita@untitledad.in) is a DIFFERENT person from Trackdek's "Dixita Rana". So 7 of the 8 daily Trackdek users still need a login first (Dixita Rana, DIXITA GOHEL, Damini Rane, Renuka Vasava, Safika Bansiwala, Piyush Kumawat, Akshar Gohil, Shreya Panchal) - Riya (HR) is the only one who has one.
B. Forgotten timer auto-stops at 21:30 IST. YES.
C. Anyone on the timeclock may add a project by typing it; the head merges / archives. YES.
Next: STEP 2 = UI/UX (real app screens, approved before any build).

## 9. SCOPE CHANGE (owner, 2026-10-13, mid-design): tasks are IN phase 1
Owner: "first make the admin dashboard design and the individual person design; task assigned, in process, finished - this also wanted."
- A **task** (the phase-2 "job") moves into phase 1. Statuses are the owner's words: **Assigned -> In process -> Finished** (replaces the earlier four-word set; no checker / approval yet - decided later).
- Admin creates a task: client, what, person, due date. Person sees it under Assigned; Start moves it to In process AND starts the clock on it; Pause stops the clock; Finish stops the clock and moves it to Finished (optional note).
- Anyone can still start the clock on a client without a task (free work, as Trackdek).
- Admin dashboard = team hours, working now, late tasks, time to approve, a 3-column task board, who is working, hours per client, New task form.
- Order unchanged: design approved -> then SQL + build. NOTHING built yet (the timeclock SQL was not run).
Data impact: new `work_tasks` (project, title, assigned_to, assigned_by, due_date, status, started_at, finished_at, note); `work_time_entries.task_id` nullable.

## 10. OWNER'S FLOW (2026-10-13): one campaign, start to close + one-time and recurring tasks
Flow: Lead won -> assigned to designer -> video approved -> campaign live -> monthly report sent -> invoice to accounts -> campaign end photo -> closed.
Anyone can create a one-time or a recurring task; recurring tasks fire every morning.
DESIGN (shown as mockups, awaiting approval - NOTHING built):
- A campaign has 7 steps; each step is a task for a person; Finish on a step opens the next one. Campaign card per won quote.
- Recurring task template: title, client (optional), person, repeat (daily / weekly / monthly), start / end date, time. A 7 AM IST job creates today's tasks, idempotent per (template, date), skips Sundays and holidays (reuse `is_off_day`).
- Admin dashboard tabs: Campaigns (7-step tracker per client, stuck / late first), Tasks, People, Hours.
- Won-quote -> campaign must NOT be a trigger on the live quotes table (section 45): created by a guarded RPC / cron that reads newly won quotes.
- "Invoice to accounts" = a TASK for Accounts with client, amount and dates; the invoice itself is the separate unbuilt Govt/Private invoice module (section 23).
PROPOSED SPLIT (Trackdek ends 30 Nov): Phase 1 = timeclock + one-time and recurring tasks + admin dashboard (live by ~15 Nov). Phase 2 = campaign pipeline from a won quote.
OPEN QUESTIONS: invoice once or every month? who may assign tasks to others? skip Sunday / holiday for recurring? who is the approver (step 3)?
