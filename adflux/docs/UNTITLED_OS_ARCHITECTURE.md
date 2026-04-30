**UNTITLED OS**

**Master Architecture Document --- v1**

*A 12-month build to put 14 people on one screen for one owner*

Prepared for: Brijesh Solanki

Untitled Advertising --- Vadodara, Gujarat

Date: 29 April 2026

*Status: Draft for owner review*

**How to Read This Document**

This document is a working draft. It is not the final spec. It is the
structure that we will iterate ONCE on, then build.

**Three things to know before you start reading:**

**1. Yellow boxes = assumptions I made.**

**🟡 ASSUMPTION ---** Where you see a yellow box like this, I had to
guess. Mark it CORRECT or replace with the right answer. These are the
things I most need you to validate.

**2. Red boxes = honest pushback.**

**⚠ HONEST NOTE ---** Where you see a red box like this, I am flagging
something I think is wrong even though you did not ask. You can ignore
these or address them. They are not blockers --- just my professional
opinion. Read them, decide, move on.

**3. Read in this order:**

-   Section 1 (Executive Summary) --- the whole picture in 4 pages.

-   Section 2 (Strategic Frame) --- what we are doing and what we are
    NOT doing.

-   Section 3 (The 3 Fires) --- the immediate fixes for your top 3 pain
    points.

-   Section 9 (Org Structure) --- the people changes that must accompany
    the software.

-   Section 10 (Build Sequence) --- the 12-month plan.

-   Then come back and read the module specs (Section 4) only for the
    modules you care most about.

*Estimated reading time: 2--3 hours. Don\'t try to read it in one
sitting. Read in 3 chunks of \~25 pages each.*

**How to give feedback:**

-   Use Word\'s comment feature on the right margin.

-   Don\'t try to fix every detail. Focus on: (a) is the architecture
    right? (b) is the priority right? (c) are the assumptions correct?

-   Detail-level changes can happen during build.

**Table of Contents**

**1. Executive Summary**

**2. Strategic Frame --- What We\'re Building, What We\'re Not**

**3. The 3 Fires --- Immediate Fixes**

**4. Module-by-Module Specifications**

-   4.1 M1 --- Sales Activity & Lead Module

-   4.2 M2 --- Creative Production Module

-   4.3 M3 --- Quote → Invoice → Payment Module

-   4.4 M4 --- Campaign Operations Module

-   4.5 M5 --- HR & Attendance Module

-   4.6 M6 --- Client Reporting & Renewal Module

-   4.7 M7 --- Telecaller-to-Sales Handoff Module

-   4.8 M8 --- Owner Cockpit Module

**5. The 4-Segment Architecture**

**6. Cross-Module Workflows**

**7. The Daily / Weekly / Monthly Rhythm**

**8. WhatsApp Automation Catalog**

**9. Org Structure Changes**

**10. Build Sequence --- 12 Months**

**11. Rollout Plan & Adoption Strategy**

**12. Risk Register**

**13. Success Metrics**

**14. What\'s Deliberately NOT in This OS**

**15. Open Questions & Assumptions Index**

**1. Executive Summary**

**1.1 The Business in One Page**

Untitled Advertising is a 12-year-old, 360° media marketing company in
Vadodara, Gujarat. You operate across 4 distinct revenue segments:

  ----------------------------- --------------------- ------------------------------------- ------------------------
  **Segment**                   **Revenue**           **Status**                            **Profitability Rank**
  Government DAVP Auto Hood     ₹7-8 Cr/year          Cash cow, low manpower                \#1 (most profitable)
  Private Clients (All Media)   ₹1.2 Cr/year          Currently burning                     \#2
  Private GSRTC LED             New, 6 months old     Sleeping giant --- 80%+ slots empty   \#3 (high potential)
  Government GSRTC LED          Only 1 order so far   Awaiting DAVP-LED empanelment         \#4 (nascent)
  ----------------------------- --------------------- ------------------------------------- ------------------------

Total turnover: approximately ₹9 Cr per year across segments.

Team: 14 people (4 sales, 2 telecallers, 3 designers, 1 video editor, 2
admin, 1 accounts, 1 senior accounts/CA, 1 HR).

Inventory: 264 LED screens across 20 cities in Gujarat at GSRTC bus
stands. Plus auto branding, hoardings, mall, cinema, and digital
services.

**1.2 What You Asked For**

You came with a clear, narrow ask:

\"*I want to automate the business so I can easily follow all people. I
want a system where everyone works in the same direction. I want
visibility and accountability across 14 people.*\"

This document delivers exactly that. It is a control system, not a
growth strategy.

**⚠ HONEST NOTE ---** I have parked your bigger strategic problems (LED
inventory utilization, agency concentration, multi-city expansion) per
your direction. They are real and important. Section 14 lists them. But
they are not in this OS.

**1.3 The 3 Fires We Are Putting Out First**

From your own answers, here are your top 3 operational pain points:

**Fire 1 --- Invoice delay: \"Agency wants invoice in 2 hours, we
generate in 1 month or more.\"**

**Fire 2 --- Creative chaos: \"Designer takes 5 days for a 1-day job.
3-10 revisions per job, no bar.\"**

**Fire 3 --- Sales follow-up failure: \"Sales people don\'t follow up
with clients.\"**

Phase 1 (months 1--3) of this OS attacks these three fires directly.
Section 3 details the fixes.

**1.4 The Solution in One Sentence**

Build **Untitled OS** --- an extension to the existing Adflux platform
--- that gives one screen visibility across all 14 people, with
WhatsApp-driven daily accountability, and replaces or integrates with
Cronberry, Trackdek, GoGSTBill, and Tally over 12 months.

**1.5 The 8 Modules**

  --------------------------------- -------------------------- --------------------------
  **Module**                        **Owner Role**             **Phase**
  M1. Sales Activity & Lead         Sales Lead (promoted)      Phase 1-2
  M2. Creative Production           Creative Lead (promoted)   Phase 1
  M3. Quote → Invoice → Payment     Diya (Accounts)            Phase 1-2
  M4. Campaign Operations           Ops Coordinator (new)      Phase 2
  M5. HR & Attendance               Riya (HR)                  Phase 3
  M6. Client Reporting & Renewal    Telecaller + Sales         Phase 2-3
  M7. Telecaller-to-Sales Handoff   Sales Lead                 Phase 2
  M8. Owner Cockpit                 You                        Phase 1, refined ongoing
  --------------------------------- -------------------------- --------------------------

**1.6 What Success Looks Like**

In 12 months, with this OS in place:

-   You spend 30 minutes/day on team management instead of all day.

-   Every invoice goes out within 24 hours of \"Won\" --- not 1 month
    later.

-   Average creative job has 1--2 revisions, not 3--10.

-   Every sales person hits their daily targets or you know within 30
    minutes that they didn\'t.

-   Every active client gets an automated weekly campaign report.

-   You can answer \"what is anyone in my company doing right now\" in
    10 seconds.

-   Cronberry and Trackdek are sunset. One system, one source of truth.

-   Revenue: ₹9 Cr → ₹12-14 Cr (organic growth from cleaner ops, no new
    strategic moves).

**1.7 What This Document Is NOT**

-   Not a code spec. It tells WHAT to build, not HOW to write the SQL.

-   Not a growth strategy. LED inventory and expansion are deliberately
    out of scope.

-   Not a final design. We iterate ONCE on this document, then build.

-   Not a guarantee. Software adoption depends on your willingness to
    enforce it.

**2. Strategic Frame --- What We\'re Building, What We\'re Not**

**2.1 The Real Business Picture**

Before we design anything, we need to be brutally clear about what this
business is. Most owners describe their business in slogans (\"we are a
360° media company\"). The honest description is:

Untitled is a **government-empanelled outdoor advertising operator**
with a strong cash cow (₹7-8 Cr DAVP auto hood), a marginal private
services business (₹1.2 Cr, low margin), and a brand-new LED inventory
layer (264 screens) that is mostly empty.

The cash cow funds the rest. The private business creates client
relationships and operational practice. The LED inventory is the future
bet.

**2.2 What This OS Is Designed For**

This OS is built around one core problem: you cannot see what 14 people
are doing every day, and you don\'t trust them to do their parts without
supervision. The OS solves the visibility and accountability problem
first, the productivity problem second, and the growth problem not at
all.

**2.3 What This OS Will NOT Do**

Be clear-eyed about the limits:

-   It will not make a non-performing sales person perform. It will only
    make their non-performance visible faster.

-   It will not fill empty LED slots. That is a sales/pricing/packaging
    problem we are not solving here.

-   It will not reduce your government dependency. You need to win more
    private LED for that.

-   It will not protect you from losing the 40% agency client.
    Diversification is your strategic work.

-   It will not replace your judgment on hiring, firing, or pricing
    decisions.

**2.4 Strategic Risks That Are Outside This OS**

These are real risks. They are not what this OS solves. But you should
be aware they exist while we build:

  --------------------------------------- ------------------- ------------------------------------------------------------
  **Risk**                                **Probability**     **What to do (NOT in this OS)**
  Government policy change reduces DAVP   Medium              Diversify into private LED aggressively
  Agency client (40% of private) leaves   Low-medium          Maintain personal relationship + add 2 more agency clients
  GSRTC contract not renewed              Low                 Keep relationship strong, document compliance
  Key person dependency (you)             High (today)        Build org structure (Section 9 of this doc)
  LED inventory remains 80% empty         High (status quo)   Separate LED commercial project (not in OS)
  DAVP-LED empanelment delayed            Medium              Pursue actively --- your personal project
  --------------------------------------- ------------------- ------------------------------------------------------------

**2.5 The Strategic Outcome (12 Months)**

If this OS is built and adopted as designed, here is what your business
looks like 12 months from today:

-   You are managing through a structured layer (Sales Lead, Creative
    Lead, Operations Coordinator) instead of directly managing 14
    people.

-   Your 30-min morning review tells you the state of every workflow in
    the company.

-   Cash flow is predictable because invoices go out same-day and
    collections are tracked.

-   Creative production capacity is roughly doubled (from cutting
    revision waste).

-   Sales people who underperform are visible within 30 days, not 6
    months.

-   You are ready to expand to new cities --- because the operational
    backbone is solid.

This is the foundation. Growth strategy comes **after** the foundation
is solid, not before.

**3. The 3 Fires --- Immediate Fixes**

These are your top 3 operational pain points, addressed in priority
order. Each has a quick fix you can do this week (without code) and a
permanent fix in the OS.

**3.1 Fire \#1 --- Invoice Delay**

*The problem: \"Agency wants invoice in 2 hours, we generate in 1 month
or more.\"*

**Why this matters:**

-   Every day of invoice delay = 1 day of payment delay.

-   Government clients (DAVP, GSRTC) have 60-day payment cycles that
    START from invoice date. A 30-day invoice delay = 90 days from
    work-done to payment received.

-   This is your single biggest cash flow leak. Probably costs you
    ₹5--15 lakh in working capital tied up at any moment.

**Quick Fix (Week 1, no code)**

1.  Sales person sends \"Quote Won\" notification to Diya via WhatsApp
    the moment a quote is agreed.

2.  Diya generates the invoice in GoGSTBill within 2 hours and sends to
    Brijesh.

3.  Brijesh approves (or asks questions) within 1 hour.

4.  Diya emails invoice to client + sales person same day.

5.  Track on a simple Google Sheet: Quote Won Date \| Invoice Sent Date
    \| Days Delay. Brijesh reviews this sheet daily.

Target: 90% of invoices out within 24 hours of \"Won\" --- within 2
weeks of starting this discipline.

**Permanent Fix (Months 2--3, in M3 module)**

-   Quote moves to \"Won\" in Adflux → automatic trigger creates invoice
    draft in GoGSTBill via API.

-   Diya gets notification: \"Invoice draft ready for \[Client\]. Review
    and send.\"

-   She reviews fields (PO number, government work order number if
    applicable), clicks Send.

-   Invoice auto-emailed to client + auto-WhatsApp to client + auto-PDF
    saved to client record.

-   Aging starts immediately. Day 30: auto-WhatsApp reminder. Day 45:
    escalation to sales person. Day 60: alert to Brijesh.

-   Government invoices route through a separate template (DAVP format,
    GSRTC format) with mandatory PO/work-order fields.

**3.2 Fire \#2 --- Creative Production Chaos**

*The problem: \"Designer takes 5 days for a 1-day job. 3-10 revisions
per job, no bar. Sales person tells designer verbally on WhatsApp. No
one decides priority. No productivity measurement.\"*

**Why this matters:**

-   If average revisions are 3-10, you\'re effectively running at 40-60%
    creative capacity. The other 40-60% is rework.

-   With 4 creative people (3 designers + 1 video editor), you\'re
    paying ₹1.2-1.6 lakh/month for the equivalent of 2 productive
    people.

-   Bad briefs cause most of this. Sales people don\'t write briefs ---
    they message verbally.

**Quick Fix (Week 1, no code)**

6.  Print one A4 sheet: \"Creative Brief Form.\" Mandatory fields:
    Client name, Campaign name, Type (video/static), Dimensions,
    Duration, Language, Exact approved copy text, Must-include elements,
    Reference style, Deadline.

7.  Hard rule: No designer starts work without this filled and signed by
    sales person.

8.  Hard rule: Maximum 2 revision rounds per job. Round 3 requires
    written approval from Brijesh, with sales person explaining why the
    original brief was incomplete.

9.  Track on a whiteboard: Job ID \| Sales person \| Designer \| Brief
    received \| Started \| Submitted \| Revision count \| Closed.

Target: revision count drops from 3-10 to 1-3 within 30 days.

**Permanent Fix (Month 2, in M2 module)**

-   Creative job is a record in Adflux, auto-created when a quote is Won
    OR manually by sales person for ad-hoc requests.

-   Brief form has 12 mandatory fields --- sales person literally cannot
    submit without filling them.

-   Auto-assignment to designer based on type + current workload (not
    designer self-pick).

-   Designer sees a queue, ranked by deadline. Clicks \"Start Work\" ---
    system tracks time.

-   Internal review gate before client sees anything (catches 70% of
    errors).

-   Revision counter visible to all parties. At round 3, system alerts
    sales person and Brijesh.

-   Asset library --- every approved creative tagged by industry,
    language, style. Future jobs start from templates.

**3.3 Fire \#3 --- Sales Follow-up Failure**

*The problem: \"Sales people don\'t follow up with hot leads. They are
very irresponsible for reporting.\"*

**Why this matters:**

-   Cronberry data shows 41 missed follow-ups vs. 55 completed in one
    week --- a 43% miss rate.

-   Sales people who miss follow-ups don\'t think they\'re missing them
    --- they think the lead \"went cold.\"

-   Without enforcement, every system you build will be ignored or
    filled with fake data.

**Quick Fix (Week 1, no code)**

10. 9:00 AM daily standup, mandatory, 15 minutes. Each sales person
    says: yesterday\'s meetings done, today\'s plan, blockers.

11. Brijesh attends or designates Sales Lead to run it.

12. End of day, each sales person sends WhatsApp summary to Brijesh:
    meetings completed, leads added, calls made, wins.

13. Anyone who misses standup or evening report --- Brijesh asks why,
    immediately.

This will surface the resistance. Some will protest. Some will comply
badly. That\'s the data you need before automating.

**Permanent Fix (Months 2--3, in M1 module)**

-   Mandatory morning plan submission (5 meetings planned, X leads to
    add, Y calls).

-   Mandatory check-in with GPS at 9 AM.

-   Activity log throughout day --- every meeting, call, follow-up
    logged with GPS + outcome.

-   Mandatory evening report --- pre-filled with logged activities, just
    confirm/edit.

-   Mandatory check-out --- cannot end day without evening report.

-   Live counter: today\'s meetings 3/5, leads 7/10, calls 15/20.

-   WhatsApp nudges at 8:30 AM (\"submit plan\"), 2:00 PM (\"3 hours
    left, you\'re behind\"), 6:30 PM (\"submit evening report\").

-   Brijesh\'s daily 7:30 PM WhatsApp report: who hit targets, who
    missed, what\'s stuck.

**⚠ HONEST NOTE ---** Adoption will fail unless you back the system with
consequences. If a sales person ignores the morning plan twice in a
week, you must have a conversation. If they ignore it 3 times in a
month, there must be a financial consequence (incentive deduction).
Without consequences, this becomes another tool people ignore.

**4. Module-by-Module Specifications**

This section is the meat of the document. Each module has the same
structure:

-   Purpose --- the business problem it solves.

-   Owner Role --- who uses it daily.

-   Data Model --- the tables and key fields.

-   Workflows --- what happens, in order.

-   Integration Points --- how it talks to other modules.

-   KPIs Surfaced --- the numbers it produces.

-   What\'s NOT in this module --- to prevent scope creep.

-   Build Complexity --- Small (S), Medium (M), Large (L).

-   Phase --- when we build it.

Read the modules you care about most. You don\'t need to read every
module in detail in this v1 review --- that\'s for the build phase.

**4.1 Module M1 --- Sales Activity & Lead**

  ---------------------- -------------------------------------------------------------------------------
  **Purpose**            Make sales activity visible, enforce daily targets, replace Cronberry.
  **Primary Owner**      Sales Lead (promoted from current sales team)
  **Daily Users**        4 sales people, 2 telecallers, Sales Lead, Brijesh
  **Build Complexity**   Large (L)
  **Phase**              Phase 1 (months 1-3) for activity layer; Phase 2 (months 4-6) for lead module
  ---------------------- -------------------------------------------------------------------------------

**Data Model**

**New tables in Adflux:**

  ------------------ -------------------------------------- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Table**          **Purpose**                            **Key Fields**
  leads              Replace Cronberry. One row per lead.   id, business\_name, contact, phone, city, source, source\_detail, industry, service\_interest, budget\_range, timeline, stage, assigned\_to, lost\_reason, nurture\_until
  lead\_activities   Every interaction with a lead          id, lead\_id, type (call/meeting/whatsapp/visit), outcome, notes, next\_action, next\_action\_date, lat, lng, created\_by
  daily\_targets     Per-person daily targets               user\_id, min\_meetings, min\_new\_leads, min\_calls, effective\_from, effective\_to
  work\_sessions     One row per person per day             user\_id, date, check\_in\_at/lat/lng, check\_out\_at/lat/lng, status
  morning\_plans     Daily plan submission                  work\_session\_id, planned\_meetings (jsonb), priority\_focus, submitted\_at
  evening\_reports   End-of-day report                      work\_session\_id, meetings\_done, leads\_added, calls\_made, quotes\_sent, wins, tomorrow\_plan, blockers, submitted\_at
  ------------------ -------------------------------------- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**Lead Stages (force decision, no trash bin)**

-   New --- just received, not yet contacted

-   Contacted --- first attempt made

-   Qualified --- has need + budget + timeline + decision-maker access
    (all 4 required)

-   Meeting Scheduled

-   Quote Sent --- handoff to existing Quotes module

-   Negotiating

-   Won --- auto-creates client + invoice trigger

-   Lost --- mandatory reason: Price, Timing, Competitor, No Need, No
    Response, Wrong Contact

-   Nurture --- genuinely \"later,\" but mandatory revisit date max 90
    days out

**⚠ HONEST NOTE ---** I am dropping Cronberry\'s \"Call Many Times\" and
\"Future Prospect\" stages. They are trash bins that let leads rot.
After 3 contact attempts with no response → Lost (No Response). Force
the decision.

**Daily Workflow for Sales Person**

**8:30 AM:**

-   WhatsApp nudge: \"Good morning \[Name\]. Submit today\'s plan to
    start your day.\"

-   Sales person opens Adflux mobile, fills morning plan: 5 meetings
    (client + time + location), expected new leads, focus area.

-   Cannot check in until plan is submitted.

**9:00 AM (or whenever they start):**

-   Tap \"Check In.\" GPS + timestamp captured.

-   Outside Vadodara/assigned city → flag for manager review (don\'t
    block).

**Throughout the day:**

-   Before each meeting: \"Check in at \[Client\]\" → GPS captured.

-   After each meeting: \"Log outcome\" → 30-second form
    (positive/neutral/negative + 1-line note + next action).

-   Hard rule: cannot log activity without setting next\_action and
    next\_action\_date --- unless lead is Won/Lost/Nurture.

**6:30 PM:**

-   WhatsApp push: \"End your day. Submit evening report.\"

-   Pre-filled with today\'s logged activities. Sales person
    confirms/edits.

-   Asks: tomorrow\'s plan, any blockers.

-   Submit → unlocks check-out button.

**7:00 PM:**

-   Tap \"Check Out.\" GPS + timestamp. Day\'s report auto-sent to
    Brijesh via WhatsApp.

**Live Counter Visible to Sales Person**

-   Meetings: 3/5 ✅

-   New leads: 7/10 ⚠️

-   Calls: 15/20 ⚠️

**Enforcement Rules (the part that matters most)**

-   No morning plan = no check-in possible.

-   No evening report = no check-out possible.

-   Missed targets flagged automatically. Brijesh gets a 7:30 PM
    WhatsApp listing every person who missed today.

-   3 consecutive days missed → auto-WhatsApp escalation to Brijesh.

-   Every activity must have GPS + timestamp. Activities logged with
    home-address GPS are flagged.

**Integration Points**

-   → M2 (Creative): Quote Won triggers creative job auto-creation.

-   → M3 (Invoice): Quote Won triggers invoice draft.

-   → M7 (Telecaller Handoff): Telecaller marks lead \"Sales Ready\" →
    auto-assigns to sales person here.

-   → M8 (Cockpit): Daily aggregates feed Brijesh\'s morning report.

**KPIs Surfaced**

-   Daily: meetings/leads/calls per person, target hit rate, % active
    sales force checked in.

-   Weekly: conversion rate per person (leads → meetings → quotes →
    wins), follow-up adherence %.

-   Monthly: revenue per sales person, lead source effectiveness,
    lost-reason analysis.

**What\'s NOT in M1**

-   Commission/incentive calculation (already exists in current Adflux).

-   Quote creation (existing Quotes module).

-   Client master data (existing Clients module).

-   Lead scoring beyond simple Hot/Warm/Cold flag (overbuild for now).

**4.2 Module M2 --- Creative Production**

  ---------------------- -------------------------------------------------------------------------------------------------
  **Purpose**            End the 3-10 revisions chaos. Make designer productivity measurable. Enforce structured briefs.
  **Primary Owner**      Creative Lead (promoted from current designers)
  **Daily Users**        3 designers, 1 video editor, all sales people, Creative Lead, Brijesh
  **Build Complexity**   Medium-Large (M-L)
  **Phase**              Phase 1 (months 1-3)
  ---------------------- -------------------------------------------------------------------------------------------------

**Data Model**

  ------------------------- ------------------------------ --------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Table**                 **Purpose**                    **Key Fields**
  creative\_jobs            One row per creative job       id, quote\_id (nullable), client\_id, type, dimensions, duration, language, brief\_text, copy\_approved, deadline, priority, assigned\_to, status, revision\_count
  creative\_brief\_fields   Mandatory brief data           job\_id, must\_include (jsonb), reference\_images (jsonb), notes
  creative\_revisions       Track each revision            job\_id, round\_number, requested\_by, change\_request\_text, designer\_response, completed\_at
  creative\_time\_logs      Time tracking per job          job\_id, designer\_id, started\_at, paused\_at, resumed\_at, completed\_at, total\_minutes
  asset\_library            Approved creative repository   id, job\_id, file\_url, tags (industry, language, style, type), client\_id, approved\_at
  ------------------------- ------------------------------ --------------------------------------------------------------------------------------------------------------------------------------------------------------------

**The Brief --- 12 Mandatory Fields**

14. Type: static image / video / motion graphic / GIF

15. Dimensions: 1920x1080 / 1080x1920 / square / custom (linked to which
    screens)

16. Duration: for video --- 10s / 15s / 30s / custom

17. Language: Gujarati / Hindi / English / mixed

18. Exact approved copy text (mandatory free-text --- sales must paste
    client-approved wording, not paraphrase)

19. Must include: logo files (upload), contact details, offer text,
    dates

20. Reference style: 1-2 reference images (mandatory upload)

21. Client-approved color/branding requirements

22. Deadline (with auto-warning if \<48 hours)

23. Priority: Standard / Urgent (Urgent requires Brijesh approval)

24. Target audience description (1 sentence)

25. Campaign cities/screens (auto-pulled from quote if linked)

**No brief = no job created. No exceptions.**

**Designer Workflow**

-   Designer opens Adflux, sees their queue ranked by deadline.

-   Picks top job. Clicks \"Start Work.\" Timer starts.

-   Cannot pick a different job until current job is paused/submitted
    (forces focus).

-   Submits draft → goes to Internal Review (Creative Lead checks before
    client sees).

-   Internal review approves OR sends back with notes.

-   Approved internally → sales person sends to client.

-   Client revision request → designer notified, revision counter
    increments.

-   Round 3 reached → system alerts sales person + Brijesh: \"This brief
    is on round 3. Was it complete?\"

**Auto-Assignment Logic**

-   Job type → designer skill (video → editor, motion → motion designer,
    static → general designer)

-   Current workload (lowest-loaded gets next job, no self-pick)

-   Skill tag matching (e.g., \"good with Gujarati typography\")

-   Brijesh can override assignment manually for high-priority jobs.

**Asset Library**

-   Every approved creative auto-tagged: industry, service type,
    language, style, color palette, client.

-   Designers searching new jobs can find similar past work, start from
    templates.

-   After 12 months: target 60% of new creatives are template-derived.

-   Effect: 4 designers produce equivalent of 7-8 designers\' output.

**Integration Points**

-   ← M1 (Quotes): Quote Won → auto-creates creative job (sales fills
    brief).

-   → M4 (Campaign Ops): Approved creative → auto-pushes to AdFlux
    signage system → goes live.

-   → M8 (Cockpit): Time-per-job, revision counts, designer utilization
    feed into Brijesh\'s dashboard.

**KPIs Surfaced**

-   Average revisions per job (target: \<2)

-   Average time per job by type

-   Designer utilization % (target 70-85%, not 100% --- burnout)

-   Brief quality by sales person (revision rate per sales person)

-   Cost per creative (designer hourly rate × time spent)

**What\'s NOT in M2**

-   Stock image library (separate vendor --- Freepik/Adobe Stock).

-   Designer payroll (in M5).

-   Client direct upload portal (Phase 4 maybe).

**4.3 Module M3 --- Quote → Invoice → Payment**

  ---------------------- ----------------------------------------------------------------------------
  **Purpose**            Close the cash flow loop. Eliminate invoice delay. Automate payment chase.
  **Primary Owner**      Diya (Accounts) + Mehulbhai (Senior Accounts/CA)
  **Daily Users**        Diya, Mehulbhai, all sales people, Brijesh
  **Build Complexity**   Medium-Large (M-L)
  **Phase**              Phase 1 (invoice automation), Phase 2 (payment chase)
  ---------------------- ----------------------------------------------------------------------------

**Data Model**

  ---------------------------- ------------------------------ -----------------------------------------------------------------------------------------------------------------------------------------------
  **Table**                    **Purpose**                    **Key Fields**
  invoices                     Mirror of GoGSTBill invoices   id, gogst\_invoice\_id, quote\_id, client\_id, amount, gst\_amount, status, sent\_at, due\_date, segment\_type (private/govt-davp/govt-gsrtc)
  invoice\_line\_items         Per-line detail                invoice\_id, description, hsn\_sac, qty, rate, amount
  payment\_reminders           Auto-WhatsApp chase log        invoice\_id, scheduled\_at, sent\_at, channel, template\_id, status
  govt\_collection\_tracking   Govt-specific PO tracking      invoice\_id, work\_order\_no, po\_number, dept\_contact, last\_followup, status, expected\_payment\_date
  ---------------------------- ------------------------------ -----------------------------------------------------------------------------------------------------------------------------------------------

**Workflow: Private Client Invoice**

26. Quote moves to Won in Adflux.

27. Auto-trigger creates invoice draft via GoGSTBill API.

28. Diya gets notification: \"Invoice draft for \[Client\] ₹\[Amount\].
    Review and send.\"

29. Diya reviews tax %, line items, GSTIN. Clicks Approve.

30. Invoice auto-emailed to client + auto-WhatsApp with PDF + UPI link +
    Pay Now button.

31. Tally export queued for next daily sync.

Target TAT: Quote Won → Invoice Sent in ≤ 2 hours.

**Workflow: Government Invoice (DAVP / GSRTC)**

-   Separate template with mandatory fields: Work Order No., PO Number,
    Department contact, Empanelment ref.

-   Government invoices include all required attachments
    (work-completion certificate, photographs, Media Report PDF).

-   These attachments must be uploaded BEFORE invoice can be marked
    \"sent.\"

-   Diya generates physical-copy version (govt requires hardcopy
    submission).

-   Tracking goes into govt\_collection\_tracking, not standard
    payment\_reminders (different cycle).

**⚠ HONEST NOTE ---** Government invoices have specific formats and
rejection reasons. I\'m assuming Mehulbhai (CA) knows these. If not, do
a 1-day workshop with the empanelment department of DAVP/GSRTC to
document EXACT format requirements before we automate this.

**Auto Payment Chase Sequence (Private)**

  ---------------------- ----------------------------------------------------- -----------------------
  **Day**                **Action**                                            **Recipient**
  Day 0 (invoice sent)   WhatsApp to client with invoice + UPI link            Client
  Day 7                  Polite reminder: \"Following up on invoice \[\#\]\"   Client
  Day 14                 Reminder + sales person CC\'d                         Client + Sales Person
  Day 21                 Stronger reminder + Diya notified                     Client + Diya
  Day 30                 Final reminder + Brijesh alerted                      Client + Brijesh
  Day 45                 Manual escalation flagged in Owner Cockpit            Brijesh decides
  ---------------------- ----------------------------------------------------- -----------------------

**Integration Points**

-   ← M1 (Quotes Won): triggers invoice draft.

-   ← M4 (Campaign Live): triggers proof-of-execution attachment for
    govt invoices.

-   → GoGSTBill: API integration for invoice generation.

-   → Tally: daily one-way sync for accounting books.

-   → M8 (Cockpit): outstanding aging, collection efficiency.

**KPIs Surfaced**

-   Invoice TAT (target: same day)

-   Outstanding aging buckets (0-30, 31-60, 61-90, 90+)

-   Collection efficiency by client (which clients always pay late?)

-   Government collection cycle adherence (target: \<60 days for DAVP)

-   Cash flow forecast (next 30/60/90 days expected collections)

**What\'s NOT in M3**

-   Replacement of GoGSTBill or Tally --- we INTEGRATE, not replace.

-   Direct GST filing --- Mehulbhai/CA continues this manually.

-   Bank reconciliation --- that stays in Tally.

-   Vendor payments / payables (out of scope for v1; could be Phase 4).

**4.4 Module M4 --- Campaign Operations**

  ---------------------- ----------------------------------------------------------------------------------------------------------
  **Purpose**            Manage the lifecycle of an active campaign. Lighter than expected because your CMS handles slot booking.
  **Primary Owner**      Operations Coordinator (NEW HIRE --- replaces designers booking slots)
  **Daily Users**        Ops Coordinator, sales people, telecallers, Brijesh
  **Build Complexity**   Medium (M)
  **Phase**              Phase 2 (months 4-6)
  ---------------------- ----------------------------------------------------------------------------------------------------------

**⚠ HONEST NOTE ---** Right now Safika (designer) and Piyush (video
editor) book LED slots. This is operationally backwards --- design
talent doing admin work. The Ops Coordinator role is critical. If you
don\'t hire one, this module\'s adoption will be uneven.

**Data Model**

  ---------------------- ------------------------------------ ---------------------------------------------------------------------------------------------------------------------------------------------
  **Table**              **Purpose**                          **Key Fields**
  campaigns              Active campaign master record        id, quote\_id, client\_id, type, status, scheduled\_start, scheduled\_end, actual\_start, actual\_end, cms\_campaign\_id (link to your CMS)
  campaign\_screens      Which screens carry this campaign    campaign\_id, screen\_id, city, slot\_seconds, plays\_per\_day, scheduled\_start, scheduled\_end
  campaign\_milestones   Lifecycle event log                  campaign\_id, event\_type (creative\_received, scheduled, live, ended, renewed), event\_at, notes
  screen\_health         Daily status check from AI cameras   screen\_id, date, expected\_plays, actual\_plays, ai\_impressions, status (ok / underperforming / down)
  ---------------------- ------------------------------------ ---------------------------------------------------------------------------------------------------------------------------------------------

**Workflow: Campaign Go-Live**

32. Quote Won → creative job created (M2).

33. Creative approved internally → sent to client (M2).

34. Client approves creative.

35. Ops Coordinator schedules in CMS (existing tool, integrated).

36. CMS go-live event → status changes in Adflux to \"Live.\"

37. Auto-WhatsApp to client: \"Your campaign is now live across \[X\]
    screens. First report in 7 days.\"

38. Sales person notified: \"Campaign live. Renewal reminder set for 14
    days before end.\"

**Screen Health Monitoring (Killer Feature)**

-   Your AI cameras already capture impressions per screen per hour.

-   This module surfaces underperformance: if a screen is delivering
    \<70% of expected impressions, alert.

-   Daily health check: every screen reports \"ok / underperforming /
    down.\"

-   Without this, you only find out when a client complains. With this,
    you fix it before the client notices.

-   Target: zero client complaints about \"my ad isn\'t playing.\"

**Integration Points**

-   ← M2 (Creative Approved): triggers go-live workflow.

-   ↔ Your CMS: bi-directional sync (schedule from Adflux, plays/health
    back from CMS).

-   → M6 (Reporting): live campaigns auto-generate weekly reports.

-   → M3 (Invoice): for govt, campaign-end with proof triggers invoice
    generation.

**KPIs Surfaced**

-   Active campaigns count, by segment, by city.

-   Time from \"Won\" to \"Live\" (target: \<7 days for private, \<14
    for govt).

-   Screen uptime % (target: \>95%).

-   Underperforming screens flagged.

-   Campaigns ending in next 14 days (renewal pipeline).

**What\'s NOT in M4**

-   Slot booking itself --- your CMS does that, we just talk to it.

-   Screen hardware monitoring (electrical, network) --- that\'s the AI
    camera + CMS layer.

-   Empty-slot inventory yield management --- DELIBERATELY OUT (this is
    the LED commercial problem we parked).

**4.5 Module M5 --- HR & Attendance**

  ---------------------- ---------------------------------------------------------------------
  **Purpose**            Replace Trackdek. Unify attendance, leave, performance, onboarding.
  **Primary Owner**      Riya (HR --- also takes 50% Operations role)
  **Daily Users**        All 14 employees, Riya, Brijesh
  **Build Complexity**   Medium (M)
  **Phase**              Phase 3 (months 7-9)
  ---------------------- ---------------------------------------------------------------------

**⚠ HONEST NOTE ---** Phase 3 because it\'s important but not urgent.
The check-in/checkout system from M1 covers the basic attendance need
from Day 1. Trackdek can keep running until M5 is built. Don\'t migrate
everything at once.

**Data Model**

  ------------------------ ------------------------------------------- -----------------------------------------------------------------------------------------------
  **Table**                **Purpose**                                 **Key Fields**
  employees                Master record (extends users table)         id, employee\_id, name, role, dept, doj, salary, manager\_id, status
  attendance               Daily attendance (from work\_sessions M1)   user\_id, date, check\_in, check\_out, hours\_worked, status (present / wfh / leave / absent)
  leave\_requests          Leave application & approval                id, user\_id, type (cl/sl/pl/other), from\_date, to\_date, reason, status, approved\_by
  performance\_reviews     Quarterly review records                    id, user\_id, period, kpis\_achieved (jsonb), self\_rating, manager\_rating, comments
  onboarding\_checklists   New hire onboarding tracking                id, user\_id, item, owner, status, due\_date
  ------------------------ ------------------------------------------- -----------------------------------------------------------------------------------------------

**Workflows**

**Daily attendance:**

-   Reuses M1 check-in/checkout for sales team.

-   For non-sales (designers, accounts, HR, admin): single \"office
    check-in\" tap on Adflux mobile or web.

-   Auto-marked absent if no check-in by 11 AM (HR can override).

**Leave management:**

-   Employee submits leave request in Adflux.

-   Auto-routed to manager (or Brijesh if no manager) for approval.

-   Approved → goes to Riya for record-keeping + payroll integration.

**Performance reviews:**

-   Quarterly cycle, auto-triggered.

-   System pre-fills KPIs from real data (sales: revenue + targets hit;
    designers: jobs done + revisions; etc.).

-   Manager + employee fill ratings + comments.

-   Brijesh sees rollup, decides increments/promotions.

**Integration Points**

-   ← M1: work\_sessions feed attendance directly.

-   ← M2: designer revision rates feed creative performance reviews.

-   ← M3: collection efficiency feeds accounts performance review.

-   → Existing payroll: monthly salary export.

**KPIs Surfaced**

-   Attendance %, leave usage, late arrivals.

-   Performance scores by role and department.

-   Salary cost vs revenue (per role contribution).

-   Tenure & attrition rate.

**What\'s NOT in M5 (yet)**

-   Payroll computation --- keep current method (probably Excel + bank
    transfer).

-   Statutory compliance (PF, ESI, gratuity) --- handled by CA.

-   Recruitment ATS --- overbuild for 14-person team.

**4.6 Module M6 --- Client Reporting & Renewal**

  ---------------------- --------------------------------------------------------------------------------------------
  **Purpose**            Auto-deliver weekly campaign reports. Drive renewals (you have ZERO renewal motion today).
  **Primary Owner**      Telecallers (delivery) + Sales (renewal pitch)
  **Daily Users**        Telecallers, sales people, clients (recipients), Brijesh
  **Build Complexity**   Medium (M)
  **Phase**              Phase 2-3 (months 4-9)
  ---------------------- --------------------------------------------------------------------------------------------

**⚠ HONEST NOTE ---** This is your single biggest revenue lever inside
the OS. You have a 6-month-old LED business with NO renewal pitch
system. You\'re losing every renewal you could be earning. Build this
aggressively.

**Data Model**

  ---------------------- ------------------------ -----------------------------------------------------------------------------------------------------------------------------------------
  **Table**              **Purpose**              **Key Fields**
  campaign\_reports      Weekly + final reports   id, campaign\_id, period\_start, period\_end, generated\_at, pdf\_path, sent\_at, sent\_via, delivery\_status
  renewal\_pipeline      Upcoming renewals        id, campaign\_id, client\_id, current\_end\_date, renewal\_value\_estimate, assigned\_to, stage (notified / pitched / quoted / decided)
  client\_satisfaction   Pulse checks             id, client\_id, campaign\_id, score (1-5), feedback\_text, captured\_at
  ---------------------- ------------------------ -----------------------------------------------------------------------------------------------------------------------------------------

**Workflow: Weekly Auto-Reports (Hybrid)**

39. Monday 9 AM cron job: lists all active campaigns.

40. Brijesh / Ops Coordinator generates AI Media Report PDFs from your
    existing portal (the one we saw --- works well).

41. Upload PDFs into Adflux, one per campaign (drag-drop with quote-id
    selector).

42. Adflux auto-WhatsApps each PDF to corresponding client with template
    message.

43. Logs delivery status in campaign\_reports.

This is hybrid --- generation manual, delivery automated. Build full
integration later.

**Workflow: Renewal Engine (THE killer feature)**

-   Daily check: any campaign ending in next 14 days?

-   Yes → auto-generates \"Renewal Brief\" for sales person:

    -   • Client name, current campaign details, total impressions
        delivered, paid amount

    -   • Suggested renewal: same package or upsell?

    -   • Past renewal pattern (if any)

-   Auto-WhatsApp to client (Day -14): \"Hi \[Name\], your campaign ends
    in 14 days. Want to discuss renewal?\"

-   Sales person sees in their daily plan: \"Call \[Client\] for renewal
    pitch.\"

-   Sales updates renewal stage as it progresses.

**Target: 50%+ renewal rate within 6 months of building this. Currently
it\'s near zero.**

**Workflow: Client Satisfaction Pulse**

-   After every campaign ends → auto-WhatsApp to client: \"Rate your
    experience 1-5.\"

-   Score 4-5 → \"Glad you loved it! Renew now?\" (renewal nudge)

-   Score 1-3 → \"Sorry to hear. Brijesh will call you within 24
    hours.\" (escalation to Brijesh)

**Integration Points**

-   ← M4 (Campaign Live): triggers report generation schedule.

-   ← Existing AI portal: upload-based for v1.

-   → M1 (Sales): renewal pipeline becomes daily targets.

-   → M8 (Cockpit): renewal rate, client satisfaction in dashboard.

**KPIs Surfaced**

-   Reports sent on time % (target: 100%).

-   Renewal rate (target: 50%+ within 6 months).

-   Average client satisfaction score.

-   Upsell rate at renewal (renewing for higher value than original).

**What\'s NOT in M6**

-   Direct API integration with AI portal (Phase 4 maybe).

-   Client portal where they log in to see reports (overbuild for now).

**4.7 Module M7 --- Telecaller-to-Sales Handoff**

  ---------------------- ------------------------------------------------------------------------
  **Purpose**            Stop telecaller and sales blaming each other. Make handoff measurable.
  **Primary Owner**      Sales Lead
  **Daily Users**        Telecallers, sales people, Sales Lead
  **Build Complexity**   Small-Medium (S-M)
  **Phase**              Phase 2 (months 4-6)
  ---------------------- ------------------------------------------------------------------------

**The Problem It Solves**

Right now telecallers (Cronberry users) generate leads, and somehow they
reach sales. There\'s no SLA, no measurement, no shared definition of
\"qualified.\" When deals don\'t close, telecallers say \"sales didn\'t
follow up,\" sales say \"the leads were junk.\" Both are partially
right.

**Workflow**

44. Telecaller calls IndiaMart/JustDial/website lead.

45. Records call outcome: not interested / call-later /
    interested-but-not-qualified / SALES READY.

46. Only \"Sales Ready\" leads can be passed forward. Mandatory fields:
    budget confirmed, timeline confirmed, decision-maker contact,
    service interest.

47. Lead auto-assigned to a sales person based on (a) city, (b) industry
    expertise, (c) current load.

48. Sales person has 24-hour SLA to: (a) call the lead, (b) book a
    meeting OR (c) reject lead with reason.

49. Reject reason goes back to telecaller --- feedback loop.

50. If sales person doesn\'t act in 24h → escalation to Sales Lead.

51. If lead is rejected as \"not qualified\" → telecaller\'s
    qualified-rate metric updates.

**Telecaller KPIs (DIFFERENT from current)**

**⚠ HONEST NOTE ---** Right now telecallers are paid on leads-passed.
This rewards quantity over quality. Change to:
leads-qualified-and-converted. Telecaller earns part of the closure
incentive when their qualified lead converts to a Won quote. This single
change drives behavior in the right direction.

-   Daily calls made (target: 80-100)

-   Qualified leads passed (target: 5-8 per day)

-   Qualification accuracy (% accepted by sales --- target: 70%+)

-   Conversion rate (qualified → won --- target: 10%+)

-   Earnings model: base salary + small per-qualified-lead + closure
    bonus on converted leads

**Integration Points**

-   ← Existing IndiaMart/JustDial webhooks: auto-create leads in Adflux.

-   → M1 (Sales): qualified leads auto-assigned.

-   → M8 (Cockpit): handoff metrics, telecaller performance.

**What\'s NOT in M7**

-   Auto-call dialer / IVR --- overbuild for current scale.

-   Voice-recording analysis --- privacy + complexity overhead.

**4.8 Module M8 --- Owner Cockpit**

  ---------------------- ----------------------------------------------------------------------------------------
  **Purpose**            Your one screen. Everything you need to know about the business in 30 minutes per day.
  **Primary Owner**      Brijesh (you)
  **Daily Users**        Brijesh only (with delegated views to Mehulbhai, Sales Lead, Creative Lead, HR Riya)
  **Build Complexity**   Medium (M) --- but iterative; v1 simple, v2 better
  **Phase**              v1 in Phase 1, refined ongoing
  ---------------------- ----------------------------------------------------------------------------------------

**Your Daily 9 AM WhatsApp Report**

Single message every morning. Designed for thumb-scroll on your phone:

**📊 UNTITLED --- 29 Apr 2026**

💰 Yesterday\'s collection: ₹1,24,000 (target: ₹1,50,000) ⚠️

📈 MTD revenue: ₹X \| Target: ₹Y (Z% achieved)

📋 Outstanding: ₹A,B (X invoices \> 30 days)

**👥 SALES TEAM YESTERDAY**

✅ On target: Brijesh, Sondarva

⚠️ Missed: Swati (3/5 meetings), Vishnu (no check-in)

Total: 14 meetings, 32 leads, 2 wins

**🎨 CREATIVE**

Yesterday: 8 jobs completed, 3 in progress

Stuck \>2 days: 2 jobs (View)

**📡 CAMPAIGNS**

Live: 38 \| Ending in 14 days: 6 (renewal pipeline)

Underperforming screens: 2 (View)

**🔥 NEEDS YOUR ATTENTION (Top 3)**

1\. Vishnu hasn\'t checked in 3 days in a row

2\. Stanza Living invoice 28 days overdue (₹46,020)

3\. Pizza Hut creative on revision round 4

*Full dashboard: \[link\]*

**Weekly Monday Review (deeper, on web dashboard)**

-   Last week revenue vs. target, by segment

-   Sales person scorecards (meetings/leads/quotes/wins/conversion)

-   Designer scorecards (jobs/revisions/utilization)

-   Pipeline review (quotes by stage, expected close)

-   Aging receivables review

-   Top 3 risks/issues this week

**Monthly Board View**

-   P&L roll-up (revenue, costs, gross margin) --- needs Tally sync

-   Segment performance (private vs DAVP vs LED)

-   Cash position + receivables aging

-   Headcount cost vs revenue

-   Top 5 clients (revenue, margin, satisfaction)

-   Top 5 risks (probability × impact)

**Red-Flag Alerts (push to your WhatsApp anytime)**

-   Any sales person hasn\'t checked in by 11 AM.

-   Any creative job at revision round 4.

-   Any invoice \>45 days outstanding.

-   Any active campaign with screen \<70% expected impressions.

-   Any client gives satisfaction score 1-2.

-   Any large quote (\>₹5L) hasn\'t been touched in 7 days.

**Delegated Views**

-   Mehulbhai: Finance section (P&L, receivables, GST status, cash).

-   Sales Lead: Sales section (team performance, pipeline, leaderboard).

-   Creative Lead: Creative section (queue, revisions, designer load).

-   Riya HR: Attendance, leave, onboarding.

**What\'s NOT in M8**

-   BI / advanced analytics --- overbuild for v1, can add later.

-   Predictive forecasting --- needs 12+ months of clean data first.

**5. The 4-Segment Architecture**

Your 4 revenue segments have different workflows even though they share
modules. This section describes how the SAME modules behave DIFFERENTLY
for each segment.

**5.1 Segment-Specific Behaviors**

  ---------------- -------------------------------- ---------------------------------------------- ---------------------------
  **Aspect**       **Private (All Media)**          **Govt DAVP**                                  **Private/Govt LED**
  Lead source      IndiaMart, JustDial, referral    Empanelment, RFP                               Direct sales + agencies
  Quote format     Standard Adflux quote            Govt RFP format with detailed pricing          Slot-based pricing
  Approval flow    Sales → Brijesh                  Sales → Brijesh → CA review                    Sales → Brijesh
  Invoice format   GoGSTBill standard               Govt format + WO + attachments                 GoGSTBill standard
  Payment terms    50% advance, 50% on completion   60-day post-completion                         Negotiable, often advance
  Reporting        Weekly auto-PDF                  Final report + photographs + completion cert   Weekly auto-PDF
  Renewal motion   Standard pitch                   Re-tender / re-empanelment cycle               AGGRESSIVE renewal pitch
  ---------------- -------------------------------- ---------------------------------------------- ---------------------------

**5.2 Why This Matters**

If we build the OS treating all segments as the same, government
invoices will fail (wrong format), private LED renewals will be missed
(no specific motion), and the whole thing becomes a generic CRM. The
architecture must respect segment differences.

Implementation: each module has a **segment\_type** field on its core
records. Workflows branch based on this. Templates differ. KPIs split.

**5.3 Government Workflow Specialization**

Because government is your cash cow (₹7-8 Cr), special attention needed:

-   Separate quote template (DAVP format)

-   Tender/empanelment renewal calendar (don\'t miss empanelment
    renewal!)

-   Compliance checklist (each govt invoice has 5-7 mandatory
    attachments)

-   Dedicated collection officer workflow (you have one --- formalize
    their dashboard)

-   Work-completion certificate generation

**6. Cross-Module Workflows**

This is where the magic happens --- modules talking to each other
automatically. Five end-to-end flows:

**6.1 Flow A --- Lead to Cash (Private Direct)**

52. IndiaMart webhook → Lead created in Adflux (M1)

53. Auto-WhatsApp ack to lead within 60 sec

54. Auto-assigned to telecaller (M7)

55. Telecaller qualifies → marks Sales Ready

56. Auto-assigned to sales person (M1) with 24h SLA

57. Sales person calls, books meeting, logs activity

58. Quote sent (existing module)

59. Auto-WhatsApp follow-up at 48h, 7d if no response

60. Quote Won → triggers creative job (M2) + invoice draft (M3)

61. Creative completed → client approves → goes live (M4)

62. Invoice sent → auto-payment chase begins (M3)

63. Weekly reports auto-WhatsApped (M6)

64. Day -14 of campaign end → renewal pipeline activated (M6)

65. Payment received → quote settled, incentive credited

**6.2 Flow B --- Tender to Cash (Government DAVP)**

66. DAVP empanelment notification (manual)

67. Tender response by Brijesh (manual, parked outside OS)

68. PO received → enter as quote-equivalent in Adflux with
    segment\_type=govt-davp

69. Creative job created (M2) --- uses govt-approved templates

70. Campaign scheduled (M4) --- auto branding workflow

71. Campaign live → daily proof captured (photos, AI camera data)

72. Campaign end → completion certificate auto-generated

73. Invoice generation (M3) with mandatory attachments --- WO, photos,
    certificates, Media Report

74. Hardcopy submission to govt department

75. Govt collection tracking (M3) --- 60-day cycle

76. Payment received → tally sync

**6.3 Flow C --- Creative Request to Live Campaign**

77. Quote Won (M1) → creative job auto-created (M2)

78. Sales fills 12-field brief (mandatory)

79. Auto-assigned to designer based on type + load

80. Designer starts work (timer starts)

81. Designer submits → Internal Review (Creative Lead)

82. Internal review approves → sales sends to client

83. Client approves OR requests revision

84. If revisions: counter increments, alert at round 3

85. Final approval → asset library tagged

86. Auto-pushed to CMS for scheduling (M4)

87. Goes live → client auto-notified

88. Campaign reports begin (M6)

**6.4 Flow D --- Active Campaign to Renewal**

89. Campaign live (M4)

90. Weekly auto-reports (M6)

91. Day -14 of end\_date → renewal pipeline activated (M6)

92. Auto-WhatsApp to client: \"Renew?\"

93. Sales person notified: \"Pitch renewal to \[Client\]\"

94. Sales calls, sends renewal quote

95. Renewal quote treated as new Quote in M1

96. Cycle continues, but now \"Renewal\" type with shorter quote-to-won
    time

97. Day 0 of end → if no renewal, campaign-end report sent +
    satisfaction pulse

98. Score 4-5 → renewal nudge \| Score 1-3 → escalation to Brijesh

**6.5 Flow E --- Hire to Performance Review**

99. Job opening → HR Riya posts (manual for now)

100. Candidate selected → onboarding checklist auto-created (M5)

101. Day 1: HR documents, IT setup, role-specific training assigned

102. Day 30: 30-day check-in (auto-trigger to manager)

103. Day 90: probation review with KPI data pre-filled

104. Quarterly: performance review (M5)

105. System pulls: sales numbers, designer revisions, accounts
     efficiency, etc.

106. Manager + employee complete review

107. Brijesh sees rollup, decides increment/promotion/PIP

**7. The Daily / Weekly / Monthly Rhythm**

This section describes WHEN things happen --- the temporal structure of
the OS.

**7.1 Daily Rhythm**

  ---------------- ---------------------------------------------------------- --------------------------------------
  **Time**         **Event**                                                  **Who**
  8:30 AM          WhatsApp nudge to all sales: submit morning plans          All sales + telecallers
  9:00 AM          Brijesh\'s daily report arrives on WhatsApp                Brijesh
  9:00 AM          Sales standup (15 min) --- daily review of plan            Sales Lead + 4 sales + 2 telecallers
  9:30 AM onward   Check-ins, activity logging begins                         Everyone
  10:00 AM         Creative queue review (15 min)                             Creative Lead + designers
  11:00 AM         Anyone not checked-in flagged to Brijesh                   System
  2:00 PM          Mid-day pulse: who\'s behind today\'s targets gets nudge   System → laggards
  6:30 PM          WhatsApp nudge: submit evening reports                     All sales
  7:00 PM          Check-outs                                                 Everyone
  7:30 PM          Brijesh\'s end-of-day summary on WhatsApp                  Brijesh
  Night cron       Data aggregation, next-day prep                            System
  ---------------- ---------------------------------------------------------- --------------------------------------

**7.2 Weekly Rhythm**

-   Monday 9 AM: Last week\'s scorecard auto-emailed to Brijesh + Sales
    Lead

-   Monday 10 AM: Pipeline review meeting (sales lead + sales)

-   Monday 10 AM: Active campaign list generated for report uploads (M6)

-   Wednesday: Creative review (Creative Lead + designers --- what\'s
    behind, what\'s blocking)

-   Thursday: Outstanding receivables review (Diya + Brijesh)

-   Friday 5 PM: Weekly auto-reports go out to active clients (M6)

-   Friday 6 PM: Renewal pipeline review (sales + Brijesh)

-   Saturday morning: Weekly designer revision report

**7.3 Monthly Rhythm**

-   1st: Last month performance scorecards per role generated

-   3rd: Salary calculation prep (HR + accounts)

-   5th: Salaries paid + incentives calculated

-   7th: Monthly client satisfaction summary (M6)

-   10th: GST filing (Mehulbhai)

-   15th: Monthly P&L + cash review (Brijesh + Mehulbhai)

-   20th: Monthly performance review meetings (manager + employee)

-   25th: Renewal pipeline for next month --- proactive outreach

-   28th-30th: Month-close prep --- Tally reconciliation

**8. WhatsApp Automation Catalog**

Every automated WhatsApp message in the system. Templates must be
approved by Meta WhatsApp Business API (3-7 days each).

**⚠ HONEST NOTE ---** WhatsApp Business templates have content rules.
Messages can\'t be promotional in non-utility templates. Some of these
will need to be reworded during Meta approval. Plan for 1-2 weeks of
template approval before Phase 1 ships.

**8.1 Sales Team Templates**

  --------------------------- ------------------------ ---------------------------------------------------------------------
  **Trigger**                 **Recipient**            **Sample Text**
  Daily 8:30 AM               Each sales person        \"Good morning \[Name\]. Submit today\'s plan: \[link\]\"
  Daily 6:30 PM               Each sales person        \"End your day. Submit evening report: \[link\]\"
  Behind target 2 PM          Sales person             \"You\'ve logged X/Y meetings. 4 hours left.\"
  Missed target               Sales person + Brijesh   \"Today\'s targets missed: meetings X/Y, leads X/Y.\"
  Lead assigned               Sales person             \"New qualified lead: \[Client Name\], \[City\]. Call within 24h.\"
  Quote not followed up 48h   Sales person             \"Quote to \[Client\] sent 48h ago. Time to follow up.\"
  3-day no checkin            Brijesh                  \"\[Name\] has not checked in 3 days in a row.\"
  --------------------------- ------------------------ ---------------------------------------------------------------------

**8.2 Creative Team Templates**

  ------------------------------ -------------------------- ----------------------------------------------------------------------------
  **Trigger**                    **Recipient**              **Sample Text**
  New job assigned               Designer                   \"New job: \[Job ID\] for \[Client\]. Deadline: \[Date\]. Open: \[link\]\"
  Job stuck \>2 days             Designer + Creative Lead   \"Job \[Job ID\] is in progress for 2+ days.\"
  Revision round 3               Sales + Brijesh            \"Job \[Job ID\] is on revision round 3. Brief review needed.\"
  Internal review pending \>4h   Creative Lead              \"Job \[Job ID\] awaiting your review for 4+ hours.\"
  ------------------------------ -------------------------- ----------------------------------------------------------------------------

**8.3 Client-Facing Templates**

  ----------------------- --------------- ---------------------------------------------------------------------------------------------------
  **Trigger**             **Recipient**   **Sample Text**
  Lead inquiry received   Client          \"Thanks for your interest in Untitled Advertising. \[Sales Name\] will call you within 30 min.\"
  Quote sent              Client          \"Hi \[Name\], here\'s your proposal: \[PDF\]. Available to discuss anytime.\"
  Quote follow-up 48h     Client          \"Following up on the proposal we shared. Any questions?\"
  Invoice sent            Client          \"Invoice \[\#\] for ₹\[Amount\]. Pay via UPI: \[link\] or bank: \[details\].\"
  Payment due day 7       Client          \"Friendly reminder: invoice \[\#\] is due. Pay link: \[link\]\"
  Campaign live           Client          \"Your campaign is live across \[X\] screens. First report in 7 days.\"
  Weekly report           Client          \"Weekly campaign report for \[Period\]: \[PDF\]. Total impressions: \[X\].\"
  Renewal -14 days        Client          \"Your campaign ends in 14 days. Want to discuss renewal?\"
  Satisfaction pulse      Client          \"Rate your campaign experience 1-5. Reply with the number.\"
  ----------------------- --------------- ---------------------------------------------------------------------------------------------------

**8.4 Brijesh Owner Templates**

-   Daily 9 AM summary (covered in M8)

-   Daily 7:30 PM summary

-   Red-flag alerts: invoice \>45d, screen down, satisfaction score 1-2,
    etc.

-   Weekly Monday scorecard

-   Monthly P&L summary

**Total templates to register with Meta: approximately 35-45.**

**9. Org Structure Changes**

**⚠ HONEST NOTE ---** This section is the most important for actual
results. Software without org structure changes = ₹1.2 Cr business with
better dashboards. You said you don\'t want to fire anyone. Fine. But
you MUST add structure layers, otherwise you remain the bottleneck and
the OS doesn\'t work.

**9.1 Current State (Today)**

Per your own answer: \"to me bottleneck.\" Everyone reports to Brijesh.

**BRIJESH (Owner) --- managing 14 people directly**

-   4 Sales executives

-   2 Telecallers

-   3 Designers

-   1 Video editor (Piyush)

-   2 Admin

-   1 Accounts (Diya)

-   1 Senior Accounts/CA (Mehulbhai)

-   1 HR (Riya)

**Problems with this structure:**

-   You approve every quote, decide every priority, handle every
    escalation.

-   Designers (Safika) and video editor (Piyush) are doing slot-booking
    admin work.

-   No middle layer --- when you\'re not available, things stop.

-   No accountability layer --- direct-to-owner = you can\'t really push
    back hard on anyone.

**9.2 Target State (12 Months)**

**BRIJESH (CEO/Owner) --- manages 3 functional heads**

**├── Head of Sales & Marketing**

-   Promote your strongest sales person to this role

-   Manages: 4 sales executives + 2 telecallers

-   Owns: pipeline, conversions, daily standup, telecaller-to-sales
    handoff

-   Salary bump: +₹5-10K initially, plus 1-2% override on team revenue

**├── Head of Operations**

-   Two options: (a) Promote Riya HR to HR + Operations dual role (since
    she has 50% bandwidth) OR (b) New hire at ₹40-50K/month

-   Manages: Creative Lead (promoted senior designer), Operations
    Coordinator (new hire), 2 admin

-   Owns: campaign go-live, slot booking, creative quality, internal
    coordination

**│ ├── Creative Lead**

-   Promote senior designer (whoever is strongest)

-   Manages: 2 other designers + Piyush (video editor)

-   Owns: designer assignments, internal review, asset library, creative
    quality

-   Salary bump: +₹5K initially

**│ ├── Operations Coordinator (NEW HIRE)**

-   Critical role --- replaces Safika/Piyush doing admin work

-   Owns: CMS slot scheduling, campaign go-live, screen health
    monitoring, govt compliance attachments

-   Background: 1-2 years of operations/coordination experience, ideally
    in OOH or events

-   Salary: ₹25-35K/month

**│ └── 2 Admin staff (existing)**

**└── Head of Finance & HR**

-   Mehulbhai (CA) formalized as Head of Finance & HR

-   Manages: Diya (accounts), Riya (HR), govt collection officer

-   Owns: P&L, cash flow, GST, HR compliance, payroll

-   Effectively a fractional CFO role

**9.3 Why This Structure**

-   Brijesh now manages 3 people, not 14 --- bandwidth freed up for
    strategy.

-   Each functional head owns clear domain --- accountability is real.

-   Promote-from-within for 3 of 4 layer roles --- minimal hiring cost,
    builds loyalty.

-   Only 1 new hire (Operations Coordinator) --- cheap relative to
    value.

-   Creative talent (Safika, Piyush) returns to creative work --- not
    slot booking.

**9.4 Transition Plan**

Don\'t change everything Day 1. Phase the org changes alongside the
software:

-   Month 1: Identify Sales Lead candidate (your strongest sales
    person). Have a 1:1. Offer the role.

-   Month 1: Identify Creative Lead candidate. Same conversation.

-   Month 2: Both new leads start informal --- leading standups,
    reviewing work.

-   Month 3: Formalize titles + salary increments + announce to team.

-   Month 4: Start hiring for Operations Coordinator.

-   Month 5: Operations Coordinator joins, takes over slot booking from
    Safika/Piyush.

-   Month 6: Mehulbhai formalized as Head of Finance & HR.

-   Month 7-12: Refine, adjust, replace anyone not working out.

**9.5 Hiring Costs (Estimate)**

  ----------------------------------- -------------------------- ------------
  **Change**                          **Cost Increase**          **Timing**
  Sales Lead (promotion)              +₹5-10K/month + override   Month 3
  Creative Lead (promotion)           +₹5K/month                 Month 3
  Ops Coordinator (new hire)          +₹25-35K/month             Month 5
  Mehulbhai formalization             +₹5-10K/month              Month 6
  Total monthly increase by Month 6   ₹40-60K/month              
  Annual cost increase                ₹4.8-7.2 lakh              
  ----------------------------------- -------------------------- ------------

Compared to your ₹9 Cr revenue, this is **0.5-0.8% of revenue** to add
proper management layers. The ROI from invoice automation alone
(recovering working capital) will pay for this 5x over in year one.

**10. Build Sequence --- 12 Months**

This is the master plan. Don\'t try to do everything in parallel ---
that\'s how OS projects fail. Sequence matters more than speed.

**10.1 Phase 1 (Months 1--3): Stop the Bleeding**

**Goal: Address the 3 fires. Establish basic visibility. Get adoption.**

**What we build:**

-   M1 Activity Layer: Daily check-in/check-out, morning plans, evening
    reports, GPS activity logs

-   M2 Creative Production v1: Brief form (mandatory), designer queue,
    time tracking, revision counter

-   M3 Invoice Automation v1: Quote Won → invoice draft → Diya review →
    send

-   M8 Owner Cockpit v1: Daily 9 AM WhatsApp report (basic)

-   WhatsApp Business API setup + first batch of templates approved

**What we don\'t build yet:**

-   Lead module (Cronberry stays for now)

-   Auto-payment chase

-   Auto client reports

-   HR module

**Org changes:**

-   Identify and promote Sales Lead + Creative Lead (informal start)

-   Document quick-fix processes (paper brief form, daily standup, etc.)

**Success metrics by Month 3:**

-   100% sales staff using daily check-in/checkout

-   Average creative revisions: 3-10 → 1-3

-   Invoice TAT: 1 month → \<48 hours for 80% of invoices

-   Brijesh receives clean daily report every morning

**10.2 Phase 2 (Months 4--6): Sales Firepower + Renewal Engine**

**Goal: Replace Cronberry. Drive renewals. Automate follow-ups.**

**What we build:**

-   M1 Lead Module: Replace Cronberry --- leads, stages, activities

-   M7 Telecaller-to-Sales Handoff: SLA-driven, qualification-based

-   M3 Auto-payment chase: Day 7/14/21/30/45 sequence

-   M6 Client Reporting v1 (hybrid): Auto-deliver uploaded PDFs

-   M6 Renewal Engine: Day -14 trigger, sales pipeline activated

-   M4 Campaign Operations v1: Go-live workflow, basic screen health

**Org changes:**

-   Sales Lead role formalized + announced

-   Creative Lead role formalized + announced

-   Operations Coordinator hire posted + interviewed

**Success metrics by Month 6:**

-   Cronberry sunset 100%

-   Renewal pipeline activated for every campaign ending

-   Outstanding receivables: ₹X → ₹0.5X

-   Lead-to-meeting conversion: Y% → 1.5Y%

**10.3 Phase 3 (Months 7--9): Government Workflow + HR**

**Goal: Specialize for government. Replace Trackdek. Tighten finance.**

**What we build:**

-   M3 Government Invoice Workflow: separate format, mandatory
    attachments, work-completion certificates

-   M3 Tally one-way sync (daily)

-   M5 HR Module: replaces Trackdek for attendance, leave, performance
    reviews

-   M4 Screen Health full integration with AI cameras

-   M6 Client Satisfaction Pulse

**Org changes:**

-   Operations Coordinator joins, takes over from Safika/Piyush

-   Mehulbhai formalized as Head of Finance & HR

-   Trackdek sunset

**Success metrics by Month 9:**

-   Trackdek sunset 100%

-   All govt invoices use new workflow

-   Tally always reconciled --- no manual data entry needed

-   Performance reviews data-driven, not gut-feel

**10.4 Phase 4 (Months 10--12): Polish + Multi-City Readiness**

**Goal: Refine, optimize, prepare for scale.**

**What we build:**

-   M2 Asset Library full version (auto-tagging, search)

-   M8 Owner Cockpit v2 (predictive forecasts, deeper analytics)

-   Procurement & Vendor module (basic --- for screen maintenance,
    content production)

-   Multi-city operational playbook

-   Onboarding portal for new sales hires

**Org changes:**

-   Org chart fully implemented and stable

-   Bottom 20% performers identified and addressed (with data, not gut)

**Success metrics by Month 12:**

-   All 8 modules live and adopted

-   Brijesh spends \<30 min/day on team management

-   Revenue: ₹9 Cr → ₹12-14 Cr (organic, from cleaner ops)

-   Multi-city expansion can begin without operational chaos

**11. Rollout Plan & Adoption Strategy**

**⚠ HONEST NOTE ---** Adoption is harder than building. 80% of internal
software projects fail because no one uses them. The rollout plan
matters more than the code. Read this section carefully.

**11.1 The 4 Adoption Principles**

108. Pilot before broad rollout. Always 2 people first, 30 days, fix
     what breaks.

109. Backed by Brijesh personally. If you don\'t enforce it, no one
     will.

110. Consequences must exist. Missing the morning plan twice/week =
     conversation. Three times/month = financial impact.

111. Make it 10% easier than current method. If new system is harder,
     people revert.

**11.2 Phase 1 Rollout --- Detailed Week-by-Week**

**Week 1: Communicate**

-   All-hands meeting: Brijesh announces \"Untitled OS\" project.

-   Reasoning: \"We\'re a ₹9 Cr business --- we need to operate like
    one.\"

-   Reassurance: \"This is to help us, not to fire anyone.\"

-   Honest: \"It will require discipline. Some of you will resist.
    We\'re doing it anyway.\"

**Week 2: Manual quick fixes**

-   Paper creative brief forms in use

-   Daily 9 AM standup starts (15 min)

-   Quote-Won → Invoice in 24h discipline (manual, tracked on sheet)

-   Brijesh personally enforces every day

**Week 3-4: Build M1 v1 + M3 v1**

-   Dev team builds check-in/checkout, morning plan, evening report

-   Dev team builds invoice draft trigger from Quote Won

-   Templates submitted to Meta for WhatsApp approval

**Week 5-6: Pilot with 2 people**

-   Pick: 1 sales person (Brijesh, since you said you\'re working too) +
    1 designer

-   Run M1 + M2 + M3 with just these 2 for 14 days

-   Daily debrief: what\'s working, what\'s broken, what\'s friction

-   Fix issues before broad rollout

**Week 7-8: Broad rollout**

-   All sales onboarded to M1

-   All designers onboarded to M2

-   Diya onboarded to M3

-   Daily 9 AM cockpit report goes live to Brijesh

**Week 9-12: Hardening**

-   Iterate on what\'s annoying

-   Address resistors (with data showing they\'re not adopting)

-   Lock in habits --- by end of Month 3, this is just \"how we work\"

**11.3 Handling Resistance**

Predictable resistance patterns and responses:

  ---------------------------------- --------------------------------------------------- -----------------------------------------------------------------------------------------
  **Resistance**                     **Why It Happens**                                  **How to Handle**
  \"This is micromanagement\"        Person was never accountable before; now they are   \"This is professionalism. ₹9 Cr companies don\'t run on trust alone.\"
  Fake check-ins (home GPS)          They don\'t go to client sites                      GPS data shows it. Have the conversation. Three strikes = financial impact.
  Skip morning plans                 They want flexibility                               No plan, no check-in. Hard rule. Brijesh enforces.
  Designers refuse internal review   Pride; don\'t want approval gate                    \"Internal review catches errors before client sees. It saves your reputation.\"
  Sales blame bad briefs             Reality --- briefs ARE bad initially                Track brief→revision rate per sales person. Coach the bad ones.
  \"Old system was faster\"          Familiarity bias                                    Show data: revisions down, invoice TAT down, conversion up. Real numbers beat feelings.
  ---------------------------------- --------------------------------------------------- -----------------------------------------------------------------------------------------

**11.4 The Two People You Will Lose**

Be ready: implementing this OS will likely cost you 1-2 people. **They
will quit or you\'ll have to let them go.**

-   Some people are productive only when not measured. They will leave.

-   Some people are unproductive AND don\'t want to be measured. They
    will fight, and you\'ll have to ask them to leave.

-   This is not failure. This is the OS doing its job.

-   Plan for backfill: have job descriptions ready by Month 2 so you can
    hire quickly.

**12. Risk Register**

Risks specific to this OS build (not the broader business).

  ------------------------------------------------- ----------------- ------------ -----------------------------------------------------------------------
  **Risk**                                          **Probability**   **Impact**   **Mitigation**
  Team resists adoption                             High              High         Brijesh personally enforces; consequences exist; pilot before broad
  WhatsApp template approval delay                  Medium            Medium       Submit early; have email/SMS fallback
  GoGSTBill API integration breaks                  Medium            High         Test thoroughly; manual fallback for invoice creation
  Adflux dev capacity insufficient                  Medium            High         Honest assessment of dev team size; maybe hire 1 contractor
  Cronberry data migration messy                    High              Low          Don\'t migrate junk; start fresh with active leads only
  Designers refuse mandatory briefs                 Medium            Medium       Backed by Brijesh; brief form is non-negotiable
  Ops Coordinator hire takes \>3 months             Medium            Medium       Start hiring earlier (Month 4 vs Month 5)
  Gov segment workflow gets too complex             Medium            Medium       Phase 3 dedicated; CA workshop on requirements
  Tally sync errors                                 Low               Medium       One-way only initially; manual reconciliation backup
  Brijesh distracted by growth, drops enforcement   High              Critical     This is the biggest risk. You must commit to 30 min/day for 6 months.
  ------------------------------------------------- ----------------- ------------ -----------------------------------------------------------------------

**⚠ HONEST NOTE ---** The single biggest risk is the last one. If you
(Brijesh) don\'t personally enforce adoption for the first 6 months,
this entire OS becomes another tool no one uses. Software adoption
requires owner air cover. Period.

**13. Success Metrics**

How we\'ll know this is working --- at 30, 90, 180, and 365 days.

**13.1 30-Day Metrics (Discipline Establishment)**

-   80%+ sales people submit morning plan daily

-   80%+ sales people submit evening report daily

-   100% creative jobs use brief form

-   Average revisions: dropped from 3-10 to \<3

-   Brijesh receives daily report 25+ days/month

**13.2 90-Day Metrics (System Working)**

-   95%+ daily check-in/checkout adherence

-   Average revisions: \<2 per job

-   Invoice TAT: \<48 hours for 90% of invoices

-   Cronberry sunset complete

-   Sales Lead and Creative Lead roles formalized

-   Outstanding receivables down 30%

**13.3 180-Day Metrics (Productivity Gains)**

-   Lead-to-meeting conversion: +50%

-   Revenue: +20% vs baseline (organic)

-   Renewal rate: 0% → 30%+

-   Creative team output: +40% (same headcount)

-   Designer revision rate: \<1.5 per job

-   Brijesh time on team management: 30 min/day

**13.4 365-Day Metrics (Strategic Outcomes)**

-   Revenue: ₹9 Cr → ₹12-14 Cr

-   Renewal rate: 50%+

-   Outstanding receivables stable, low

-   Brijesh able to leave business for 1 week and operations continue

-   All 8 modules adopted

-   Org structure stable: 3 functional heads operating well

-   Multi-city expansion plan ready to execute

**13.5 The Single Most Important Metric**

If you only track one thing, track this: **\"Can Brijesh answer \'What
is anyone in my company doing right now\' in 10 seconds, accurately?\"**

If yes --- the OS is working. If no --- something is broken. This is the
entire purpose of the build.

**14. What\'s Deliberately NOT in This OS**

Per your direction, these strategic and operational items are PARKED.
They are real. They will need to be addressed at some point. They are
not in this OS.

**14.1 Parked Strategic Items**

-   LED inventory yield management (80% empty slots problem)

-   Empty-slot pricing tiers / packages / agency partnerships

-   Self-serve LED booking portal

-   Multi-city expansion playbook (until ₹15 Cr+ on existing footprint)

-   DAVP-LED empanelment (your personal project, not software)

-   Branch offices in other states

-   Franchise model for city operations

-   Diversification away from agency client (40% of private)

**14.2 Parked Operational Items**

-   Vendor/procurement automation (screen maintenance, content
    production)

-   Per-campaign profitability tracking (needs cost capture; do this
    manually first 6 months)

-   Stock image / video library subscriptions management

-   Voice-call recording / IVR automation

-   Client portal for self-service

-   Recruitment ATS

-   Payroll processing

-   Statutory compliance automation (PF, ESI, gratuity)

**14.3 Why These Are Parked**

-   Each one is real but not the bottleneck right now.

-   Building everything = adopting nothing.

-   Phase 1-4 attacks the 3 fires + visibility, which is enough work for
    12 months.

-   Once OS is stable, revisit this list and pick the next phase.

**⚠ HONEST NOTE ---** Of the parked items, the LED inventory problem is
the biggest ₹ opportunity. After OS Phase 1-2 are working (Month 6), you
should run a 30-day LED commercial experiment in parallel. That\'s not
part of this OS. But mark Month 6 in your calendar.

**15. Open Questions & Assumptions Index**

All assumptions I made while writing this. Validate during your review.
Mark each one CORRECT, WRONG, or UNSURE.

  ------------- ------------------------------------------------------------ ----------------------------
  **Section**   **Assumption**                                               **Validate?**
  1.1           Total turnover \~₹9 Cr across 4 segments                     \[ \] Correct \[ \] Wrong
  1.4           WhatsApp Business API is owned and active                    \[ \] Correct \[ \] Wrong
  3.1           GoGSTBill has API/integration capability                     \[ \] Correct \[ \] Wrong
  3.2           Designers will accept brief-form mandatory rule              \[ \] Maybe \[ \] Won\'t
  3.3           Sales team will resist mandatory check-in                    \[ \] Yes \[ \] No
  4.3           60-day govt payment cycle is consistent                      \[ \] Correct \[ \] Wrong
  4.4           Your CMS has API for slot scheduling                         \[ \] Yes \[ \] No
  4.5           Trackdek can be sunset cleanly                               \[ \] Yes \[ \] No
  4.6           Existing AI portal generates clean per-campaign PDFs         \[ \] Yes \[ \] No
  8.1           Sales people use Adflux mobile (not just web)                \[ \] Yes \[ \] Need build
  9.2           1-2 sales people are promotion candidates for Sales Lead     \[ \] Yes \[ \] No
  9.2           1 senior designer is promotion candidate for Creative Lead   \[ \] Yes \[ \] No
  9.2           Riya HR has bandwidth for Operations role                    \[ \] Yes \[ \] No
  9.4           ₹40-60K/month additional org cost is acceptable              \[ \] Yes \[ \] No
  10.1          Adflux dev team can build Phase 1 in 3 months                \[ \] Yes \[ \] No
  11.4          You\'re prepared to lose 1-2 people during rollout           \[ \] Yes \[ \] No
  12            You commit to 30 min/day enforcement for 6 months            \[ \] Yes \[ \] No
  ------------- ------------------------------------------------------------ ----------------------------

**15.2 Open Questions for You**

-   Who is your strongest sales person? (For Sales Lead promotion)

-   Who is your strongest designer? (For Creative Lead promotion)

-   Is Mehulbhai a fractional CA or full-time?

-   What is your dev team size for building this OS?

-   What is your monthly fixed cost burn rate (rough)?

-   Do you have a written agreement with the 40% agency client?

-   When does the GSRTC contract come up for renewal?

-   Are you the 100% owner, or do you have partners?

**15.3 Decisions You Need to Make**

112. Approve this OS architecture, or revise sections?

113. Approve the org structure changes? (Phase + costs)

114. Approve Phase 1 scope to begin building?

115. Commit to enforcement for 6 months?

116. Identify Sales Lead and Creative Lead candidates by Month 1?

**Closing**

This document is a draft. It is not the final spec. It is the structure
we will iterate ONCE on, then build.

**My commitment to you:**

-   Listen to your feedback on this v1.

-   Revise once into v2 --- the build-ready version.

-   Help you sequence the rollout.

-   Be honest when something is going wrong during build, not pretend
    everything is fine.

**Your commitment to this:**

-   Read this document carefully (2-3 hours, in chunks).

-   Mark up assumptions that are wrong.

-   Decide on org structure changes.

-   Personally enforce adoption for 6 months.

-   Don\'t add scope mid-build. Park new ideas for Phase 5.

The biggest risk to this entire plan is not the technology. It is
whether you will stop being involved in every decision and let the
system do its job. The OS gives you visibility and control --- but only
if you actually use the visibility to act, and let the structure handle
the control.

Build the OS. Hire the Operations Coordinator. Promote the Sales Lead.
Then **step back**.

That\'s the real strategy. The software is just the enabler.

*--- End of v1 ---*
