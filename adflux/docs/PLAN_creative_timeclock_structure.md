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

## 6. Decisions needed before UI/UX (STEP 2)
1. Replace Trackdek fully by 30 Nov, timeclock first? (recommended: yes)
2. Is the first timer start = clock in and last stop = clock out (no separate check-in)? (recommended: yes)
3. Drop screenshots and keyboard / mouse scoring for good? (recommended: yes - a web app cannot capture them anyway, and it is what makes people game the clock)
4. Checker per person - confirm: design -> Renuka Vasava; video -> Piyush Kumawat; GSRTC video -> Safika Bansiwala; own work of a checker -> Brijesh.
5. Task name: free typing with suggestions from past names (recommended), or a fixed list from the 11 core jobs?

## 7. Risks
- The team must find it as fast as Trackdek (two taps to start). That is the whole test; UI/UX is step 2.
- 142 projects is long; the list needs "recent first" + search, and archive the dead ones.
- A running timer left on overnight: auto-stop at a set time (to decide in UI/UX).
