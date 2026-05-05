# PHASE 1 DESIGN — M1 + M7 + M8
**Period:** Tue 6 May → Fri 30 May 2026 (4 weeks)
**Owner:** Brijesh Solanki
**Modules:** M1 Sales Activity & Lead · M7 Telecaller-to-Sales Handoff · M8 Owner Cockpit
**Status:** DRAFT for owner approval — no code until approved

> **Re-read instruction for future Claude:** before any code change tied to Phase 1, read this doc + `UNTITLED_OS_MASTER_SPEC.md` end-to-end. If a feature isn't in this doc, it's out of scope for May; add to Phase 2 list, don't build inline.

---

## 0. What "done" looks like on May 30

You sit on your phone at 9 AM and read a single WhatsApp message that tells you:
- Yesterday's collection vs target
- Who hit / missed daily activity targets
- Lead pipeline stage counts
- Top 3 issues needing your attention today

Every sales rep:
- Submitted a morning plan before they could check in
- Checked in at 9 AM with GPS
- Logged each call and meeting throughout the day with outcome + next action
- Submitted evening report
- Saw their daily counter (meetings X/Y, calls X/Y, leads X/Y)

Every telecaller (DHARA + 2 New Telecallers):
- Worked their call queue assigned by stage + heat
- Marked leads "Sales Ready" only after qualifying (budget + timeline + decision-maker)
- Saw their qualification accuracy KPI

You (admin):
- Uploaded a Cronberry export, mapped columns, ingested 800+ leads
- Reassigned leads in bulk between reps
- Watched the live cockpit (web dashboard + WhatsApp)

If any of those don't work end-to-end across all four roles (admin / sales / agency / co_owner / telecaller), Phase 1 isn't done.

---

## 1. Team structure changes (from owner's screenshot)

The architecture doc said 14 people; the actual team is 22. Hierarchy as parsed:

```
Brijesh (Owner / Admin)
├── DHARA (Inside Sales / Telecaller Lead) — Vadodara
│   └── New Telecaller (Vadodara)
├── MAYUR (Sales Executive) — Veraval
├── ASHISH (Sales Executive) — Bhavnagar
├── Surat Sales Executive × 2 — Surat
├── Jamnagar Sales Executive — Jamnagar
├── Vadodara Sales Executive — Vadodara
├── RENUKA, SAFIKA, SHREYA, DIKSHITA (Designers) — Vadodara
├── PIYUSH (Video Editor) — Vadodara
├── MEET, RAHUL (Operations Execution) — Vadodara
├── DIYA (Accounts) — Vadodara
├── Riya (HR) — Vadodara
├── DIXITA (Admin) — Vadodara
└── KEVIN (Office boy) — Vadodara

Vishal (Co-owner / Government Partner) — Gandhinagar
├── Gandhinagar Sales Executive
└── New Telecaller (Gandhinagar)
```

**Implication for the data model:** users need `manager_id` (FK to users.id) and `city` (text). The OS will use `manager_id` so DHARA sees her telecaller's leads, Vishal sees his Gandhinagar team's pipeline, etc.

**Recommended team_role values** (different from auth role):
- `owner` (Brijesh)
- `co_owner` (Vishal)
- `sales_lead` (DHARA — manages telecallers)
- `sales` (Mayur, Ashish, Surat × 2, Jamnagar, Vadodara, Gandhinagar)
- `telecaller` (DHARA + 2 New)
- `creative_lead` (TBD — pick from RENUKA / SAFIKA / SHREYA / DIKSHITA)
- `designer`, `video_editor`, `ops_execution`, `accounts`, `hr`, `admin_staff`, `office_boy`

This is a labeling field, not an auth role. Auth role stays {admin, co_owner, sales, agency}.

---

## 2. Database schema additions

### 2.1 ALTER existing tables

```sql
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS manager_id   uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS city         text,
  ADD COLUMN IF NOT EXISTS team_role    text,
  ADD COLUMN IF NOT EXISTS daily_targets jsonb DEFAULT '{"meetings":5,"calls":20,"new_leads":10}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_users_manager_id ON public.users (manager_id);
CREATE INDEX IF NOT EXISTS idx_users_city       ON public.users (city);
```

### 2.2 New tables

#### `leads` — the Cronberry replacement
```sql
CREATE TABLE public.leads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source          text NOT NULL,             -- IndiaMart / Justdial / WABA / Excel / Manual / Referral
  name            text NOT NULL,
  company         text,
  phone           text,
  email           text,
  city            text,
  segment         text CHECK (segment IN ('PRIVATE','GOVERNMENT')),
  industry        text,
  expected_value  numeric,
  heat            text CHECK (heat IN ('hot','warm','cold')) DEFAULT 'cold',
  stage           text NOT NULL CHECK (stage IN
                    ('New','Contacted','Qualified','SalesReady','MeetingScheduled',
                     'QuoteSent','Negotiating','Won','Lost','Nurture')) DEFAULT 'New',
  lost_reason     text,                       -- Price, Timing, Competitor, NoNeed, NoResponse, WrongContact
  nurture_revisit_date date,                  -- mandatory if stage = Nurture
  assigned_to     uuid REFERENCES public.users(id),  -- sales rep
  telecaller_id   uuid REFERENCES public.users(id),  -- who pre-qualified
  qualified_at    timestamptz,
  sales_ready_at  timestamptz,
  handoff_sla_due_at timestamptz,             -- = sales_ready_at + 24h
  contact_attempts_count int DEFAULT 0,
  last_contact_at timestamptz,
  notes           text,
  quote_id        uuid REFERENCES public.quotes(id) ON DELETE SET NULL,  -- if QuoteSent or Won
  created_by      uuid NOT NULL REFERENCES public.users(id),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_leads_stage              ON public.leads (stage);
CREATE INDEX idx_leads_assigned_to        ON public.leads (assigned_to);
CREATE INDEX idx_leads_telecaller_id      ON public.leads (telecaller_id);
CREATE INDEX idx_leads_handoff_sla_due_at ON public.leads (handoff_sla_due_at) WHERE stage = 'SalesReady';
CREATE INDEX idx_leads_segment_city       ON public.leads (segment, city);
CREATE INDEX idx_leads_phone              ON public.leads (phone) WHERE phone IS NOT NULL;
```

#### `lead_activities` — every touch on a lead
```sql
CREATE TABLE public.lead_activities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  activity_type   text NOT NULL CHECK (activity_type IN
                    ('call','whatsapp','email','meeting','site_visit','note','status_change')),
  outcome         text CHECK (outcome IN ('positive','neutral','negative')),
  notes           text,
  next_action     text,
  next_action_date date,                      -- mandatory unless lead.stage in (Won, Lost)
  duration_seconds int,                       -- for calls + meetings
  gps_lat         numeric(9,6),
  gps_lng         numeric(9,6),
  gps_accuracy_m  int,
  created_by      uuid NOT NULL REFERENCES public.users(id),
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_lead_activities_lead_id      ON public.lead_activities (lead_id);
CREATE INDEX idx_lead_activities_created_by   ON public.lead_activities (created_by, created_at DESC);
CREATE INDEX idx_lead_activities_next_action  ON public.lead_activities (next_action_date) WHERE next_action_date IS NOT NULL;
```

#### `work_sessions` — daily attendance + activity rollup
```sql
CREATE TABLE public.work_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id),
  work_date       date NOT NULL,
  plan_submitted_at timestamptz,
  planned_meetings    jsonb,                  -- [{client_name, time, location}]
  planned_calls       int,
  planned_leads       int,
  check_in_at     timestamptz,
  check_in_gps    point,
  check_out_at    timestamptz,
  check_out_gps   point,
  evening_report_submitted_at timestamptz,
  evening_summary jsonb,                      -- meetings_done, calls_made, leads_added, blockers, tomorrow_plan
  daily_counters  jsonb DEFAULT '{}'::jsonb,  -- { meetings: 0, calls: 0, new_leads: 0 } — incremented by activities
  is_off_day      boolean DEFAULT false,
  off_reason      text,
  UNIQUE (user_id, work_date)
);

CREATE INDEX idx_work_sessions_user_date ON public.work_sessions (user_id, work_date DESC);
CREATE INDEX idx_work_sessions_no_checkin ON public.work_sessions (work_date) WHERE check_in_at IS NULL AND is_off_day = false;
```

#### `call_logs` — telecaller + sales call tracking
```sql
CREATE TABLE public.call_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id),
  lead_id         uuid REFERENCES public.leads(id),
  client_id       uuid REFERENCES public.clients(id),
  client_phone    text,                       -- captured even if no lead/client matched
  call_at         timestamptz DEFAULT now(),
  duration_seconds int,
  outcome         text CHECK (outcome IN
                    ('connected','no_answer','busy','wrong_number',
                     'callback_requested','not_interested','sales_ready','already_client')),
  notes           text,
  next_action     text,
  next_action_date date,
  recording_url   text,                       -- optional — Phase 2
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_call_logs_user_at  ON public.call_logs (user_id, call_at DESC);
CREATE INDEX idx_call_logs_lead     ON public.call_logs (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX idx_call_logs_phone    ON public.call_logs (client_phone) WHERE client_phone IS NOT NULL;
```

#### `lead_imports` — Excel upload audit trail
```sql
CREATE TABLE public.lead_imports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name       text NOT NULL,
  uploaded_by     uuid NOT NULL REFERENCES public.users(id),
  total_rows      int,
  imported_count  int DEFAULT 0,
  skipped_count   int DEFAULT 0,
  duplicate_count int DEFAULT 0,
  errors          jsonb,                      -- [{row, error_message}]
  status          text CHECK (status IN ('processing','completed','failed')) DEFAULT 'processing',
  default_assignee_id uuid REFERENCES public.users(id),  -- if user picked one
  default_segment text,
  created_at      timestamptz DEFAULT now()
);
```

### 2.3 RLS policies

Each new table needs:
- Admin: full access
- Sales / agency: SELECT own (where assigned_to = auth.uid() or created_by = auth.uid())
- Sales lead / co-owner: SELECT for direct reports too (via manager_id check)
- Telecaller: SELECT/UPDATE leads where telecaller_id = auth.uid() OR assigned_to = auth.uid()

Detailed policies in the SQL migration file (drafted but not pasted here for length).

### 2.4 Triggers + functions

1. **Auto-set `handoff_sla_due_at`** on stage change to SalesReady → `now() + interval '24 hours'`.
2. **Increment `contact_attempts_count`** when a call/whatsapp activity is inserted.
3. **Daily `work_sessions` row creation** — if a user logs an activity but has no work_session row for today, auto-create with check_in_at = first activity time.
4. **Bump `last_contact_at`** on any activity insert.
5. **Quote → lead linkage** — when a quote is created with a `lead_id`, advance the lead's stage to QuoteSent.
6. **Auto-Lost on 3 attempts** — when contact_attempts_count hits 3 and outcome is no_answer/no_response, auto-set stage = Lost, lost_reason = NoResponse.

---

## 3. Pages and per-role behaviour

### 3.1 `/leads` — lead list (NEW)

| Role | What they see |
|---|---|
| admin (Brijesh) | All leads. Filter by stage, source, segment, city, assigned_to, telecaller, date range. Search. Bulk select for reassign. Excel upload button. |
| co_owner (Vishal) | All leads in his team's cities (Gandhinagar) + all govt leads. Same filters. |
| sales_lead (DHARA) | All leads where `telecaller_id IS NULL OR telecaller_id = me OR telecaller_id IN (my reports)`. Reassign within her team. |
| sales | Only my leads (assigned_to = me). Cannot reassign. Can advance stage. |
| telecaller | Only my call queue (telecaller_id = me OR unassigned in my city). Cannot pass to sales without qualifying. |

Columns: # · Name · Company · City · Source · Stage · Heat · Assigned · Last contact · Next action · Value · Actions.

Bulk actions (admin / sales_lead): assign-to, change-stage (with reason if Lost), delete.

### 3.2 `/leads/upload` — Excel import (admin only)

Drop a `.xlsx` or `.csv`. Map columns to fields. Choose default segment + default assignee. Preview first 10 rows. Click Import.

**Cronberry export columns we'll auto-detect:**
- Name → leads.name
- Mobile / Phone → leads.phone
- Email → leads.email
- Company → leads.company
- City → leads.city
- Source → leads.source
- Status / Stage → leads.stage (mapped per architecture §3.7)
- Notes → leads.notes
- Created by / Owner → leads.assigned_to (matched to user by name; unmatched rows → default assignee)

Dedup rule: if a lead with same `phone + created_by` exists, skip and increment `duplicate_count`. Surfaced in the import audit trail.

### 3.3 `/leads/:id` — lead detail (NEW)

Header: name, company, stage badge, heat, assigned, last contact.
Tabs:
- **Activity** — full chronology of calls, meetings, status changes
- **Quotes** — quotes linked to this lead
- **Call** button (sales/telecaller) — opens call log form
- **WhatsApp** button — opens wa.me with phone prefilled
- **Convert to Quote** button (sales only) — pre-fills wizard with lead data, flips stage to QuoteSent on save

Stage transitions: dropdown forces decision. Lost requires lost_reason. Nurture requires revisit_date. SalesReady requires telecaller to fill 4 mandatory: budget confirmed, timeline confirmed, decision-maker contact, service interest.

### 3.4 `/work` — my workday (NEW, mobile-first)

For sales rep on phone. Three states based on time of day + work session:

**State A — before check-in (morning plan needed)**
- Form: planned meetings (5 default rows: client, time, location), planned calls (number), planned new leads (number), focus area.
- Submit → enables Check In button.

**State B — checked in (active work day)**
- Live counters: Meetings 3/5, Calls 15/20, New Leads 7/10.
- Quick actions: Log Call, Log Meeting, Add Lead, Mark Stage Change.
- Today's activity timeline.
- Check-in time + GPS shown.

**State C — checked out OR evening report needed**
- Pre-filled summary: today's activities, quotes sent, won, lost.
- Form: tomorrow's plan, blockers, manager notes.
- Submit → enables Check Out button.

GPS captured at: check-in, every meeting check-in (separate from work check-in), check-out. Browser geolocation API; needs HTTPS + user permission.

### 3.5 `/cockpit` — owner cockpit web (NEW)

Visible to admin + co_owner only. One-page dashboard:

```
┌─ Today's collection ───┬─ MTD revenue ──┬─ Outstanding aging ─┐
│ ₹X (Y% of target)      │ ₹A / ₹B (Z%)   │ 0-30: ₹..  >60: ₹.. │
└────────────────────────┴────────────────┴─────────────────────┘
┌─ Sales team today ─────────────────────────────────────────────┐
│ ✅ On target: …                                                │
│ ⚠️ Missed: … (reason)                                          │
│ ❌ No check-in by 11 AM: …                                     │
│ Total: meetings X, calls Y, new leads Z, wins W                │
└────────────────────────────────────────────────────────────────┘
┌─ Lead pipeline ────────────────────────────────────────────────┐
│ New: A  Contacted: B  Qualified: C  SalesReady: D              │
│ MeetingScheduled: E  QuoteSent: F  Negotiating: G              │
│ Won (this week): H  Lost (this week): I                        │
│ SLA breaches: J leads past 24h handoff                         │
└────────────────────────────────────────────────────────────────┘
┌─ Top 3 attention items ────────────────────────────────────────┐
│ 1. Vishnu hasn't checked in 3 days                             │
│ 2. ₹46,020 invoice 28 days overdue (Stanza Living)             │
│ 3. 4 Sales Ready leads breached 24h SLA                        │
└────────────────────────────────────────────────────────────────┘
```

Web cockpit refreshes every 30 sec. WhatsApp version (below) is the same content, formatted for thumb-scroll.

### 3.6 `/telecaller` — telecaller dashboard (NEW)

Visible to telecallers + their lead (DHARA) + admin.

- My call queue today (auto-built from leads where telecaller_id = me, prioritised by heat + days since last contact)
- "Next call" big yellow button — opens lead detail in call mode
- KPIs: today's calls X, qualified Y, accepted by sales Z%, conversions to Won this month
- Pending hand-offs (leads I marked SalesReady, where sales hasn't acted yet) with hours remaining

### 3.7 Updates to existing pages

- `/dashboard` (sales view) — add lead pipeline strip + today's call list
- `/dashboard` (admin view) — add cockpit-style top 3 attention items
- `/quotes/new` wizards — add "from lead" entry point, prefill client info from leads.id

---

## 4. Workflows

### 4.1 Daily sales rep flow

```
8:30 AM  WhatsApp nudge: "Submit today's plan"
8:30-9:00 AM  Rep opens /work → fills morning plan → submits
9:00 AM  Rep taps Check In → GPS + timestamp captured → State B
…
Throughout day:
  Tap Log Call → fills outcome + next_action_date → counter increments
  Tap Log Meeting → GPS captured at "check in at client" → fills outcome → counter increments
  Tap Add Lead → creates leads row → counter increments
6:30 PM  WhatsApp nudge: "End your day. Submit evening report."
6:30-7:00 PM  Rep submits evening report → Check Out unlocked
7:00 PM  Tap Check Out → GPS + timestamp → day's summary auto-sent to manager via WhatsApp
```

Enforcement:
- No morning plan = Check In button disabled.
- No evening report = Check Out button disabled.
- Activity outside assigned city → flagged in admin's daily report (not blocked).
- 3 consecutive missed days → auto-WhatsApp escalation to admin.

### 4.2 Telecaller flow

```
Lead lands in queue (from IndiaMart webhook / Excel upload / manual).
Telecaller sees it in "My queue" sorted by heat + age.
Clicks Call → opens lead detail in call mode → makes the call (off-platform).
After call: fills outcome + notes + next_action_date.
If outcome = sales_ready: form opens, requires 4 fields filled, then click "Pass to Sales".
System auto-assigns to a sales rep based on city + load.
sales_ready_at + handoff_sla_due_at set.
Sales rep gets notification.
24h timer starts.
If sales doesn't act in 24h → escalation to sales_lead.
If sales rep "Rejects" with reason → goes back to telecaller's queue + hits qualification accuracy metric.
```

### 4.3 Admin Excel upload

```
Admin clicks Upload Leads → /leads/upload page.
Drop file (.xlsx or .csv).
Auto-detect Cronberry-style columns.
Show preview first 10 rows.
Pick default assignee (or "round-robin among Vadodara sales").
Pick default segment if not in file.
Click Import.
Backend processes async → progress bar.
Result: imported X / skipped Y / duplicates Z.
Errors visible in lead_imports row.
```

### 4.4 Owner cockpit

```
9 AM cron (Edge Function or scheduled task):
  - Aggregate yesterday's data
  - Call Claude/GPT to format the WhatsApp message in M8 spec format
  - Send via Meta WhatsApp Business API to Brijesh + Vishal (delegated views)
7:30 PM cron:
  - Same flow with end-of-day data
Anytime:
  - Red-flag triggers (no_checkin_by_11, screen_down, satisfaction_bad, invoice_45d, sla_breach)
  - WhatsApp alert pushed immediately
```

---

## 5. AI agent — AI-1 (Daily Owner Brief) integrated into M8

Single AI feature in Phase 1 — the daily WhatsApp brief.

**Input to LLM:** structured JSON of yesterday's metrics + open issues.
**Prompt:** "You are the daily ops brief generator for Untitled Advertising. Format the following data into a Hindi/English (Hinglish) WhatsApp message in the M8 cockpit style. Be terse. Use emoji for section headers. List specific names. Top 3 attention items. Max 280 words."
**Output:** WhatsApp-ready text.
**Cost guard:** ai_runs table logs every call with token count; alert if monthly cost > ₹3000.

---

## 6. WhatsApp Business API templates needed

You said Meta is approved. Templates to register (each takes 3-7 days for approval):

1. `morning_plan_nudge` — 8:30 AM to each sales rep
2. `evening_report_nudge` — 6:30 PM to each sales rep
3. `daily_owner_brief_admin` — 9 AM to Brijesh
4. `daily_owner_brief_eod` — 7:30 PM to Brijesh
5. `lead_assigned` — to sales rep when telecaller passes a lead
6. `sla_breach_alert` — to sales lead when 24h SLA missed
7. `lost_lead_3_attempts` — internal alert when auto-lost fires
8. `client_proposal_link` — to client (already similar template exists for WhatsApp share)

Submit all 8 templates to Meta on **Day 1** of Phase 1 so they're approved by week 3 when we wire them up.

---

## 7. 4-week schedule with weekly milestones

### Week 1 (May 6–10): foundation + leads list + Excel upload
- Day 1: SQL migrations (all tables + RLS + triggers). Submit Meta templates.
- Day 2: `/leads` page with filters (admin sees all, sales sees own).
- Day 3: `/leads/:id` detail page with activity tab.
- Day 4: Excel upload + Cronberry column auto-detect + dedup.
- Day 5: Lead reassignment (single + bulk). Cross-role test.

**Milestone:** Brijesh can upload his Cronberry CSV and reassign leads.

### Week 2 (May 11–17): work module + GPS check-in/out
- Day 1-2: `/work` mobile-first page (state A/B/C).
- Day 3: GPS capture wired (check-in, per-meeting, check-out).
- Day 4: Morning plan + evening report enforcement.
- Day 5: Daily counter + activity timeline.

**Milestone:** every sales rep can complete a full day's flow on their phone.

### Week 3 (May 18–24): telecaller + cockpit + AI brief
- Day 1: `/telecaller` dashboard + auto-assignment trigger.
- Day 2: 24h SLA + escalation.
- Day 3: `/cockpit` web page (admin + co-owner).
- Day 4: AI-1 daily brief — LLM call + format.
- Day 5: WhatsApp send wiring (assuming Meta templates approved by now).

**Milestone:** Brijesh receives 9 AM WhatsApp brief on May 24.

### Week 4 (May 25–30): polish + Cronberry migration + cross-role test
- Day 1: Cronberry historical data import (one-time CSV).
- Day 2: Stage mapping cleanup (Future Prospect / Call Many Times → forced Lost).
- Day 3-4: Cross-role end-to-end test (admin / co-owner / sales / sales_lead / telecaller).
- Day 5: Bug fixes from cross-role test. Sign-off.

**Milestone:** Phase 1 declared done. Cronberry can be sunset.

---

## 8. Out of scope for Phase 1 (deferred to Phase 2)

So we don't drift:
- M2 Creative Production (designer brief, queue, revisions)
- M3 GoGSTBill / Tally integration (in-app invoicing already works)
- M4 Campaign Operations + Screen Health
- M5 HR & Attendance for non-sales (designers single-tap office check-in)
- M6 Auto weekly client reports + renewal pitch generator (Renewal Tools page exists; auto-generation is Phase 2)
- AI features 2-5 (Gujarati drafter, follow-up advisor, OCR, renewal pitch)
- Voice recording / IVR
- Self-serve client portal

---

## 9. Acceptance criteria per role

### Admin (Brijesh) — must work end-to-end before sign-off
1. Upload Cronberry CSV of 800 leads → imported with dedup report.
2. View `/leads` list, filter by stage = SalesReady, see all reps' SLA status.
3. Bulk-reassign 10 leads from one rep to another.
4. Visit `/cockpit` → see today's pipeline, top 3 attention items.
5. Receive 9 AM WhatsApp brief on May 24+.
6. Drill into a lead → see full activity timeline.

### Co-owner (Vishal)
1. Login → land on cockpit (admin-equivalent for his team).
2. Filter `/leads` to Gandhinagar — see his telecaller's qualified leads + his sales rep's pipeline.
3. Reassign within Gandhinagar team (cannot reassign Vadodara/Surat etc.).
4. Receive same 9 AM WhatsApp brief, scoped to his cities.

### Sales rep (Mayur, in Veraval)
1. 8:30 AM nudge → submit morning plan.
2. 9 AM check in with GPS.
3. Get assigned a SalesReady lead from a telecaller.
4. Open lead → log call → outcome positive → next_action_date set.
5. Counter increments. Daily target visible.
6. 6:30 PM nudge → evening report.
7. 7:00 PM check out.
8. Cannot see other reps' leads.

### Sales lead (DHARA)
1. Login → see her own leads + her telecaller's leads + her own call queue.
2. Reassign within her team only.
3. SLA breach alerts for her telecaller's hand-offs surface in her dashboard.

### Telecaller (New Telecaller, Vadodara)
1. See only my call queue (filtered by city + assignment).
2. Can update lead stage to Contacted, Qualified, Nurture.
3. To mark SalesReady: 4 mandatory fields filled, system auto-assigns to a Vadodara sales rep.
4. Cannot create quotes (sales-only privilege).
5. KPI panel shows my qualification accuracy.

### Agency (Rannade Corporatio)
1. Same as sales rep but their leads are tagged with agency = true.
2. Their incentive flows through agency commission, not sales.

---

## 10. Risks + open dependencies

| Risk | Mitigation |
|---|---|
| WhatsApp templates not approved by Meta in time | Submit Day 1. Manually copy-paste content for testing in interim. |
| GPS doesn't work on some sales reps' phones | Browser geolocation requires HTTPS (we have via Vercel). Old Android browsers may not support. Fallback: timestamp without GPS, flagged in audit. |
| Cronberry CSV format differs from what we coded | First import will surface mismatches. We adjust column mapping UI to handle. |
| Excel upload large files | Process in chunks (1000 rows at a time) via Edge Function. |
| Telecallers resist new system | Architecture §11.3: predicted. Owner enforcement required. |
| Admin reassignment introduces RLS conflicts | We test all four roles before sign-off (week 4). |

---

## 11. Files that will be created or changed

### New SQL migrations
- `supabase_phase12a_users_hierarchy.sql` — adds manager_id, city, team_role, daily_targets
- `supabase_phase12b_leads_module.sql` — leads, lead_activities, lead_imports
- `supabase_phase12c_work_sessions.sql` — work_sessions
- `supabase_phase12d_call_logs.sql` — call_logs
- `supabase_phase12e_lead_triggers.sql` — auto-SLA, auto-lost, counter increments
- `supabase_phase12f_rls_policies.sql` — full RLS for all new tables

### New frontend pages / components
- `src/pages/v2/LeadsV2.jsx`
- `src/pages/v2/LeadDetailV2.jsx`
- `src/pages/v2/LeadUploadV2.jsx`
- `src/pages/v2/WorkV2.jsx`
- `src/pages/v2/CockpitV2.jsx`
- `src/pages/v2/TelecallerV2.jsx`
- `src/components/leads/LeadTable.jsx`
- `src/components/leads/LeadStageDropdown.jsx`
- `src/components/leads/LogCallForm.jsx`
- `src/components/leads/MeetingCheckIn.jsx`
- `src/components/work/MorningPlanForm.jsx`
- `src/components/work/EveningReportForm.jsx`
- `src/components/work/DailyCounter.jsx`

### New hooks / utils
- `src/hooks/useLeads.js`
- `src/hooks/useWorkSession.js`
- `src/hooks/useTelecaller.js`
- `src/utils/cronberryColumnMap.js`
- `src/utils/excelParser.js`

### Edge Functions / scheduled jobs
- `daily_owner_brief.ts` — runs at 9 AM, 7:30 PM (Vercel cron + Supabase Edge Function)
- `auto_lost_3_attempts.ts` — runs hourly
- `sla_breach_alert.ts` — runs every 30 min

---

## 12. What I need from owner before starting

1. **Approve this design.** Either "Yes start Tuesday" or "change X first".
2. **Cronberry export.** Send the latest CSV — I want to test the importer against real data, not assumed columns.
3. **Sales rep daily targets.** Architecture defaults: 5 meetings, 20 calls, 10 new leads. Confirm or change. Per person?
4. **DHARA's hand-off rule.** Architecture says auto-assign on city + load. Confirm: telecaller in Gandhinagar → assigns to Gandhinagar sales rep, telecaller in Vadodara → round-robin among Vadodara sales reps?
5. **WhatsApp Business Account ID + Phone Number ID.** Needed to wire up Meta API. Get from your Meta Business Manager → WhatsApp → API setup.
6. **Vishal's exact responsibility.** Just Gandhinagar team, or all govt clients regardless of city?
7. **Off-day handling.** Sundays off? Half-Saturdays? Holidays calendar?

---

**End of Phase 1 design v1.**
**Next action:** owner reviews + approves + answers §12 questions.
**Then:** Tuesday May 6 morning, SQL migrations + Meta template submissions begin.
