# Prompt for Claude Design - Work module (Untitled OS)

Paste everything below the line into Claude Design.

---

You are designing the **Work module** of "Untitled OS", the internal operating system of Untitled Advertising (an Indian outdoor / digital advertising company, Vadodara). It replaces a tool called Trackdek: a **timeclock + job board** for the 8-person creative team (graphic designers, video editors), with a head / admin view.
Design **desktop first (1440 px wide, the main layout)**, then a phone layout (390 px). English only. Every screen needs a designed **empty, loading and error state**.

## Brand rules (hard rules, do not break)
- Dark theme only. Page background `#0f172a`, cards `#1e293b`, inner/raised `#334155`, borders `#334155` (strong `#475569`).
- Text `#f1f5f9`, muted `#94a3b8`, subtle `#64748b`.
- **Brand yellow `#FFE600`** = the primary action and the "active" state ONLY (one yellow button per screen area). Text on yellow `#0f172a`. Soft yellow tint `rgba(255,230,0,0.14)`.
- Status colours (always as a soft tint background + solid text, never alone): success `#10B981`, warning `#F59E0B`, danger `#EF4444`, info `#3B82F6`.
- Radius scale only: 6 / 10 / 14 / 20 px, pills 999. Nothing else.
- Fonts: **Space Grotesk** for headings and ALL numbers (use tabular figures), **DM Sans** for body text. Body 16 px minimum. No monospace.
- Icons: Lucide only, stroke 1.6, sizes 14 / 16 / 18 / 22. No emoji anywhere.
- Touch targets at least 44 px. Visible focus rings. Hover state on every clickable thing. Text contrast at least 4.5:1.
- Voice: plain, calm, precise, grown-up. Short labels. No marketing words, no exclamation marks, no "Awesome!". Currency is Indian (Rs 1,23,456 - lakh/crore grouping), dates dd/mm/yyyy or "14 Oct".
- Status is never colour alone: always an icon or a word as well.
- Layout: 12-column grid, 24 px gutters, 8 px spacing scale. Cards align to the grid. **Do not repeat the same number or the same list in two places on one screen.** One source of truth per figure.

## Users
1. **Team member** (designer / editor): sees only their own work. Wants to know in 3 seconds: what do I do today, is my timer running, did I finish.
2. **Head / Admin**: sees the whole team. Wants to know: who is working right now, what is stuck or overdue, what needs my approval, what did it cost.

## Screens and features to design - TEAM MEMBER

**A. My Work (home)**
- Running timer card: big elapsed time, client + what, Pause and Finish buttons. When nothing runs: a "Start work" form (client dropdown, "what are you doing" text with suggestions, Start).
- Today strip: hours today, first clock-in time.
- Task board, 3 columns: Assigned, In process, Finished. Cards are draggable (person moves only their own task forward). Each card: title, client, due date state (due today / overdue / on track), Start and Finish buttons, people avatars.
- Date filter: From - To dates plus a Today button. Default = Today (today's tasks + everything overdue + what was finished today). Show a count: "Today - 4 open - 1 overdue".
- Evening report card, only after 7 PM: hours, clock-in, finished / in process / late, optional note, button "Share to your team group" (WhatsApp).
- Tabs: My work, Asked by me (tasks I created for others, with progress), My hours.
- Shortcuts: My profile, Leave request, Salary slips.
- "Ask for work" button opens New task.

**B. New task** (modal / side panel): title, client, people with each person's part and due date, optional checklist steps, repeat (none / daily / weekly on a weekday / monthly on a day, with end date).

**C. Task detail** (side panel): status, due date, people and their part with status, "give to someone else" select, checklist with progress bar, comments, activity log.

**D. My hours**: list of days grouped by client with durations; "Add forgotten time" form (client, what, start, end, note) that goes to the head for approval.

**E. My profile**: photo + upload, name, designation, reports to, city, joined, email. Month cards: present days, on time, late, average check-in; tasks this month, done on time, overdue. Month calendar: each day shows check-in time (green on time by 9:30, amber late to 11:30 / half day after, red no clock-in, grey Sunday/holiday) and **hours worked that day**; previous / next month. Month summary: hours tracked, tasks finished x of y.

## Screens and features to design - HEAD / ADMIN (Team Work)
Top: page title, date range filter (Today / Yesterday / Past 7 / Past 30 / Pick a date), tab bar.
1. **Overview**: "Needs you" list (approvals waiting, overdue tasks, unassigned work); 4 KPIs (team hours, working now x of y, open tasks, finished today); "Who is working" live list (person, client, running time); "Fired this morning" (repeating tasks created today); "Evening report" (who has shared, who has not).
2. **Tasks**: the same 3-column board for the whole team, filter by person / client, task cost visible on cards for admin and accounts only (never for others).
3. **People**: table of the work team: person, now running what, hours in range, head yes/no toggle, add / remove from team.
4. **Clients**: list with hours and cost, add, rename, archive, merge duplicates.
5. **Timeline**: one row per person, a horizontal day bar of work blocks coloured by client, click a person for their day detail.
6. **Hours and cost** (admin + accounts only): team cost, hours tracked, average cost per hour, share of time not on any task; hours per client bars; task cost table.
7. **Approvals**: forgotten-time requests with person, day, client, duration, note and Approve / Decline.

## What I want from you
1. A consistent page shell (header, filters, tab bar) used by every screen above.
2. Component specs I can reuse: KPI card, task card, board column, person row, status pill, empty state, side panel, date-range filter.
3. For each screen: desktop layout and phone layout, with the states listed above.
4. Remove duplicated information; if two screens show the same thing, tell me which one keeps it.
5. Deliver as Figma-style frames or HTML, plus the exact token values used.
