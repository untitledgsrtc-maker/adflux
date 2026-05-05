# UNTITLED OS — MASTER SPEC v2 (FINAL)

**Owner:** Brijesh Solanki, Untitled Advertising, Vadodara
**Last updated:** 2026-05-05
**Supersedes:** Master Spec v1
**Companion docs:**
- `UI_DESIGN_SYSTEM.md` — mandatory for any UI work
- `PHASE1_DESIGN.md` — module-level plan for M1+M7+M8
- `AUDIT_2026_05_05.md` — current codebase audit
- Original architecture: `Untitled_OS_Architecture_v1-111aff78.docx`

> **Re-read instruction for future Claude:** before any module-level work, read this file end-to-end PLUS `UI_DESIGN_SYSTEM.md`. Owner is "very UI oriented" — broken or off-brand UI is a hard fail.

---

## 1. Business in 5 lines

Untitled Advertising — 12-year-old, ₹9 Cr/year, **22-person** team in Vadodara + cities (Veraval, Bhavnagar, Surat, Jamnagar, Gandhinagar). Four revenue segments: Govt DAVP Auto Hood (cash cow), Govt GSRTC LED, Private LED (264 screens, mostly empty), Private Services. Two legal entities: **Untitled Advertising** (govt) and **Untitled Adflux Pvt Ltd** (private). Owner's #1 problem: cannot see what 22 people are doing every day. This OS is a **control system** that delivers visibility and accountability through one app.

---

## 2. The 8 modules + 8 productivity features (FINAL list)

### 2.1 Original 8 modules (from architecture doc)

| # | Module | Status | Phase |
|---|---|---|---|
| **M1** | Sales Activity & Lead | 25% | **Phase 1** |
| **M7** | Telecaller-to-Sales Handoff | 0% | **Phase 1** |
| **M8** | Owner Cockpit | 20% | **Phase 1** |
| **M3** | Quote → Invoice → Payment | 40% | Phase 2 |
| **M2** | Creative Production | 0% | Phase 3 (owner deferred) |
| **M4** | Campaign Operations | 5% | Phase 2 |
| **M6** | Reporting & Renewal Engine | 10% | Phase 2 |
| **M5** | HR & Attendance | 15% | Phase 3 |

### 2.2 Owner's 8 ranked productivity features (from `table.csv`)

| Rank | Feature | Where it lands |
|---|---|---|
| **1** | **AI Co-Pilot — Natural Gujarati + English queries** | **Phase 1.5 (June W1–W2)** — bolted onto M8 cockpit. Type/speak "આજે કોણે check-in નથી કર્યું?" → instant answer + WhatsApp action. Reuses M1 + M3 + M7 tables. **8–10 days.** |
| **2** | **Voice-First Field Actions (Gujarati)** | **Phase 2 (June W3–W4)** — sales reps + telecallers speak in Gujarati → call outcome / next action / GPS / evening report transcribed and structured. Lifts M1 + call_logs accuracy 3×. **6–7 days.** |
| **3** | **Smart Task + Auto-Assignment Engine** | **Phase 1 (baked into M1+M7)** — every new lead/quote/creative job/renewal auto-creates a task with owner + deadline + SLA. System reassigns on miss. Already part of the M7 24h SLA design. **+2 days extension on Phase 1.** |
| **4** | **Real-time Cash-Flow & Collection Forecaster** | **Phase 2 (June)** — AI predicts next 30/60/90-day collections from invoice aging + client payment behaviour + renewal probability. Surfaces in cockpit. **5 days.** |
| **5** | **Individual Daily Scorecard (Auto WhatsApp at 7:30 PM)** | **Phase 1.5 (June W1)** — extension of AI-1 daily owner brief. Each person (sales / designer / telecaller / accounts) gets a personal 7:30 PM WhatsApp + their rank vs team. **4 days.** |
| **6** | **Advanced Document Intelligence (OCR for govt WO / OC)** | **Phase 2 (June W2–W3)** — already on the AI-4 list. Extracts PO# / validity / amount from photo + flags missing fields + auto-fills invoice attachments. Drops govt invoice cycle 60d → 30–35d. **6 days.** |
| **7** | **Expense + Reimbursement with GPS Proof** | **Phase 3 (July W1)** — reps upload fuel/food bill → GPS auto-validates → sales lead approves → bank transfer request. Tied to `work_sessions` + new `expenses` table. **5 days.** |
| **8** | **Team Load Balancer + Capacity View** | **Phase 3 (July W2)** — live "who is overloaded vs free" view for owner / sales lead / creative lead. Quotes + creative jobs + meetings combined. **4 days.** |

### 2.3 Total revised timeline

**Phase 1 (May 6 → May 30, 4 weeks)** — M1 + M7 + M8 + AI-1 + Smart Task Engine.
**Phase 1.5 (June 1 → June 14, 2 weeks)** — AI Co-Pilot (Rank 1) + Individual Daily Scorecard (Rank 5).
**Phase 2 (June 15 → July 12, 4 weeks)** — M3 invoice automation + M4 campaigns + M6 reporting/renewal + Voice-First (Rank 2) + Cash Forecaster (Rank 4) + OCR (Rank 6).
**Phase 3 (July 13 → August 9, 4 weeks)** — M2 Creative + M5 HR + Expense (Rank 7) + Load Balancer (Rank 8).
**Phase 4 (August onward)** — polish, GoGSTBill API, Tally sync, Cronberry full sunset, Trackdek sunset.

**Total to "all 22 people on one screen": ~14 weeks (~3.5 months).** Original architecture said 12 months. We're compressing because (a) the Adflux skeleton already exists and (b) we're not doing org-structure work in the timeline.

---

## 3. Team structure (final, from owner's screenshot)

```
Brijesh Solanki (Owner / Admin)
│
├── DHARA — Inside Sales Lead (PROMOTE FROM "Telesales") — Vadodara
│   └── New Telecaller (Vadodara)
│
├── Field Sales (each reports to Brijesh; future: Sales Lead)
│   ├── MAYUR — Sales Executive — Veraval
│   ├── ASHISH — Sales Executive — Bhavnagar
│   ├── Surat Sales Executive × 2 — Surat
│   ├── Jamnagar Sales Executive — Jamnagar
│   └── Vadodara Sales Executive — Vadodara
│
├── Creative team (future: Creative Lead from one of these — TBD by owner)
│   ├── RENUKA, SAFIKA, SHREYA, DIKSHITA — Graphic Designers — Vadodara
│   └── PIYUSH — Video Editor — Vadodara
│
├── Operations
│   ├── MEET, RAHUL — Operation Execution — Vadodara
│
├── Back office
│   ├── DIYA — Accounts — Vadodara
│   ├── Riya — HR — Vadodara
│   ├── DIXITA — Admin — Vadodara
│   └── KEVIN — Office boy — Vadodara
│
Vishal Chauhan (Co-owner — Government Partner) — Gandhinagar
├── Gandhinagar Sales Executive
└── New Telecaller (Gandhinagar)
```

**DB implication:** `users` needs `manager_id` (FK), `city`, `team_role`, `daily_targets jsonb`. Already in `PHASE1_DESIGN.md` §2.1.

---

## 4. UI design system (binding)

**See `UI_DESIGN_SYSTEM.md` for the full reference.** Highlights:

- **Theme:** Night (default `#0a0e1a` bg) + Day toggle. CSS variables only.
- **Fonts:** Inter (body), Space Grotesk (display + numbers), JetBrains Mono (IDs / mono).
- **Brand color:** yellow `#facc15` accent.
- **Status palette:** green `#4ade80`, amber `#fbbf24`, red `#f87171`, blue `#60a5fa`, purple `#c084fc`.
- **Cards:** 14px radius, subtle inner highlight + drop shadow.
- **Hero revenue:** teal gradient with yellow radial glow at corner.
- **AI briefing:** purple+blue gradient card, pulse-animated AI icon.
- **Pills / chips:** 999px radius with status tints.
- **Hero numbers:** Space Grotesk 30–60px, weight 600, letter-spacing −.02em.

**Build checklist** (every new screen must pass §10 of `UI_DESIGN_SYSTEM.md` before sign-off): no hardcoded colors, both themes work, status uses chip+tint, fonts correct, radii match scale, hover defined, empty/loading/error states designed, mobile breakpoints tested, focus rings visible, only Lucide icons.

---

## 5. AI features ranked by ROI (combined view)

| ID | Feature | Phase | Effort | Cost/month | ROI signal |
|---|---|---|---|---|---|
| AI-1 | **Daily Owner WhatsApp Brief** (9 AM + 7:30 PM) | **Phase 1** | 1 day | ~₹100 | Owner saves 30 min/day |
| AI-COPILOT | **Natural Gujarati/English query** ("kone check-in nathi karyu?") | **Phase 1.5** | 8–10 days | ~₹500 | Replaces 30+ min daily data-chasing for everyone |
| AI-SCORECARD | **Individual Daily Scorecard** WhatsApp to each person | **Phase 1.5** | 4 days | ~₹200 | Self-correction loop, no manual nagging |
| AI-VOICE | **Voice-first activity logging** in Gujarati | **Phase 2** | 6–7 days | ~₹300 (Whisper) | Field team adoption 3× |
| AI-FORECAST | **30/60/90-day cash-flow forecast** | **Phase 2** | 5 days | ~₹100 | No surprise cash shortfalls |
| AI-OCR | **Govt WO / OC document extraction** | **Phase 2** | 6 days | ~₹2/doc | Govt invoice cycle 60d → 30–35d |
| AI-RENEWAL | **Personalized Gujarati renewal pitch** | **Phase 2 (M6)** | 1.5 days | ~₹200 | Renewal rate 0% → target 50% |
| AI-DRAFTER | **Gujarati proposal-letter drafter** | **Phase 2** | 1.5 days | ~₹200 | 15 min saved per proposal |

**Combined cost at full scale: ~₹1,600/month** (well under your ₹3,000 budget).

All AI features log to a single `ai_runs` table for cost/observability:
```sql
ai_runs(id, run_type, input_json, output_json, model, tokens_in, tokens_out,
        cost_inr, success, created_by, created_at)
```

---

## 6. Phase 1 — what ships May 6–30 (4 weeks, locked)

**Owner's priority: M1 + M7 + M8.** Full design in `PHASE1_DESIGN.md`. Key outcomes:

### Sales rep mobile flow
- 8:30 AM: WhatsApp nudge → submit morning plan (5 meetings + targets)
- 9:00 AM: tap Check In → GPS captured
- All day: Log Call / Log Meeting / Add Lead → counters tick
- 6:30 PM: WhatsApp nudge → evening report → unlocks Check Out
- 7:00 PM: Check Out → day's summary auto-WhatsApped to manager

### Telecaller flow (DHARA + 2 New Telecallers)
- Call queue ranked by heat + age
- Lead can only become "Sales Ready" after 4 fields confirmed (budget / timeline / decision-maker / service interest)
- Auto-assigned to a sales rep on city + load
- 24h SLA → escalation to sales lead if missed

### Admin (Brijesh)
- Excel upload for leads (auto-detect Cronberry columns)
- Bulk reassign + filter + search
- `/cockpit` web page with Hero revenue + AI briefing card + lead funnel + team scorecard + outstanding aging + activity feed
- 9 AM + 7:30 PM WhatsApp brief

### Cross-role test on May 30
Every journey in `PHASE1_DESIGN.md` §9 must pass.

---

## 7. Phase 1.5 — June 1–14 (2 weeks)

**Two AI features that supercharge Phase 1.**

### AI Co-Pilot (Rank 1) — 8–10 days

A search/chat interface in the topbar (⌘K shortcut) that accepts natural Gujarati or English queries and returns:
- Direct answer (text + small chart)
- One-click WhatsApp action ("send this list to sales lead")
- One-click drill-into-page

**Examples the user gave:**
- "આજે કોને check-in નથી કર્યું?" / "Who hasn't checked in today?"
- "Pending invoices >45 days dikhao"
- "Last week wins by city"
- "Vishnu na lead show"

**How it works:**
1. User types/speaks query.
2. LLM (Claude Haiku for cost) translates to a structured query plan.
3. We execute SQL against existing tables (no schema changes).
4. LLM formats the result as a human answer + optional chart spec.
5. UI renders answer card with action buttons.

**Why it's huge:** the OS already has all the data. The Co-Pilot makes everyone able to ask anything without learning where the page lives. This is the "30 min/day → 3 min/day" promise from the architecture doc.

### Individual Daily Scorecard (Rank 5) — 4 days

7:30 PM cron sends each user a personalized WhatsApp:
```
🎯 Brijesh — Mon 5 May
✅ Meetings 5/5 (target hit)
⚠️ Calls 12/20 — 60%
✅ New leads 14/10 (140%)
🏆 Rank #2 of 6 sales (ahead of avg)
💰 ₹3.4L pipeline added this week
Tomorrow: 3 callbacks, follow-up Stanza Living, renewal pitch GSPC
```

Same data feeds owner's brief but personalized + with rank.

---

## 8. Phase 2 — June 15 → July 12 (4 weeks)

| Module | What ships |
|---|---|
| **M3 Invoice automation** | Quote Won → invoice draft (in-app, not GoGSTBill yet) → admin approval → PDF + email + WhatsApp. Govt format with mandatory attachments. Auto chase Day 30 / 45 / 60. |
| **M4 Campaign Ops** | Won quote → campaign record → scheduling stub → daily screen-health pull (manual import for now). Day-14 renewal trigger. |
| **M6 Reporting + Renewal** | Monday cron lists active campaigns. Manual PDF upload per campaign. Auto-WhatsApp delivery to client. Day-14 pipeline + AI renewal pitch (Gujarati). Satisfaction pulse on campaign end. |
| **AI-VOICE** | Press-and-hold mic in `/work` and `/leads/:id`. Gujarati transcription via Whisper API. Auto-fills outcome / next action / notes. |
| **AI-FORECAST** | Cockpit widget: next 30/60/90-day expected collections + confidence bands. |
| **AI-OCR** | Upload WO/OC photo → Claude Vision extracts fields → user confirms → auto-attaches to quote. |
| **AI-DRAFTER** | "Generate Gujarati cover letter" button on govt quote create flow. Sales rep types 2-line English brief; AI returns formal Gujarati cover letter content matching template. |

---

## 9. Phase 3 — July 13 → August 9 (4 weeks)

| Module | What ships |
|---|---|
| **M2 Creative Production** | 12-field brief form (cannot create job without). Designer queue (auto-assigned by type + load). Internal review gate. Revision counter; round 3 alerts owner. Asset library with auto-tagging. |
| **M5 HR & Attendance** | Single-tap office check-in for non-sales (designers, accounts, HR). Leave requests with manager approval. Quarterly performance review with auto-pulled KPIs. |
| **Expense + GPS Proof** (Rank 7) | Reps upload fuel/food/meeting bill → GPS validates location → sales lead approves → bank-transfer request export. New `expenses` table. |
| **Load Balancer + Capacity** (Rank 8) | Live capacity view: who has X quotes + Y creative jobs + Z meetings this week. Heatmap by person. Owner / sales lead / creative lead access. |

---

## 10. Phase 4 — August onward (polish + integrations)

- **GoGSTBill API** integration → invoice draft auto-creation (replaces in-app PDF for live invoicing).
- **Tally one-way sync** (daily) for accounting books.
- **Cronberry sunset** (after 30 days of clean Phase 1+1.5 operation).
- **Trackdek sunset** (after M5 HR is bedded in).
- **Meta WhatsApp Business templates** all 8 templates approved + monitored.
- Performance optimization: query caching, virtualized long lists.
- Accessibility audit (WCAG AA).

---

## 11. Database — final shape

### Existing (already in repo)
`users`, `quotes`, `quote_cities`, `payments`, `clients` (now phone-nullable), `cities`, `auto_districts`, `gsrtc_stations`, `companies`, `proposal_templates`, `attachment_templates`, `staff_incentive_profiles`, `incentive_settings`, `hr_offers`, `proposal_attachments`, `follow_ups`.

### Phase 1 additions
`leads`, `lead_activities`, `work_sessions`, `call_logs`, `lead_imports`. Plus `manager_id`, `city`, `team_role`, `daily_targets` columns on `users`.

### Phase 1.5 additions
`ai_runs` (single table for all AI feature observability + cost tracking).

### Phase 2 additions
`invoices`, `invoice_attachments`, `campaigns`, `screen_health_logs`, `campaign_reports`, `renewal_pipeline`, `client_satisfaction`.

### Phase 3 additions
`creative_jobs`, `creative_revisions`, `creative_assets`, `attendance`, `leave_requests`, `performance_reviews`, `expenses`.

**Total: 24 tables when complete** (existing 17 + 5 + 1 + 7 + 7 = uses some shared, net new ~20).

---

## 12. Acceptance criteria per role (running list, updated each phase)

For **every** phase milestone, all four user-journeys in `PHASE1_DESIGN.md` §9 must pass. The list grows per phase:

| Role | Phase 1 must work | Phase 1.5 adds | Phase 2 adds | Phase 3 adds |
|---|---|---|---|---|
| **Admin** (Brijesh) | Lead upload + cockpit + 9 AM brief | Co-Pilot query + each-person scorecard | Cash forecast + voice playback + OCR review | Creative queue + capacity view |
| **Co-owner** (Vishal) | Scoped to Gandhinagar team + brief | Co-Pilot + scorecard | Same as admin scoped | Same as admin scoped |
| **Sales Lead** (DHARA) | Telecaller team + reassign | Per-person scorecard for her team | — | — |
| **Sales rep** | Morning plan / GPS / activity log / evening report | Personal scorecard | Voice notes / OCR for WO | Expense submission |
| **Telecaller** | Call queue + qualify-to-handoff | Personal scorecard | Voice notes | — |
| **Designer** | (Phase 3) | — | — | Brief form / queue / asset library |
| **Accounts** (DIYA) | (Phase 2) | — | Invoice draft + chase + cash forecast | — |
| **HR** (Riya) | (Phase 3) | — | — | Attendance / leave / perf review |

---

## 13. WhatsApp Business templates needed

You confirmed Meta is approved. Submit these on **Day 1 of each phase** (3–7 days approval lead time):

**Phase 1 templates:**
1. `morning_plan_nudge` — 8:30 AM to each rep
2. `evening_report_nudge` — 6:30 PM to each rep
3. `daily_owner_brief_admin` — 9 AM
4. `daily_owner_brief_eod` — 7:30 PM
5. `lead_assigned` — to sales rep when telecaller passes
6. `sla_breach_alert` — to sales lead
7. `lost_lead_3_attempts` — internal alert
8. `client_proposal_link` — to client (already similar exists)

**Phase 1.5 templates:**
9. `daily_scorecard_individual` — 7:30 PM to each person

**Phase 2 templates:**
10. `invoice_sent` — to client
11. `invoice_chase_30d` / `_45d` / `_60d` — to client
12. `campaign_live_notify` — to client
13. `weekly_report` — to client
14. `renewal_pitch` — to client (Day -14)
15. `satisfaction_pulse` — to client (campaign end)

**Phase 3 templates:**
16. `creative_assigned` — to designer
17. `creative_internal_review` — to creative lead
18. `creative_revision_round_3` — to owner
19. `expense_submitted` — to sales lead
20. `leave_request` — to manager

---

## 14. Open questions answered (May 5)

| Q | Answer |
|---|---|
| WhatsApp Business API approved? | ✅ YES |
| Phones for GPS? | ✅ Personal phones |
| Telecaller incentive structure? | ✅ Different per person — model needs per-user fields |
| AI agent ~₹3,000/month budget? | ✅ OK |
| Sales Lead + Creative Lead candidates? | ✅ DHARA = Sales Lead. Creative Lead = TBD (pick from Renuka / Safika / Shreya / Dikshita) |
| Cronberry / Trackdek sunset dates? | After we replace functionality — built-in to phase plan |
| Priority? | M1 + M7 + M8 first; M2 Creative deferred to Phase 3 |

### Still open

1. **Cronberry CSV** — need export to test importer.
2. **Daily targets** — defaults 5 meetings / 20 calls / 10 leads; confirm or override per person.
3. **Auto-assignment rule** — Vadodara telecaller → round-robin among Vadodara reps? Confirm.
4. **WhatsApp Business Account ID + Phone Number ID** — get from Meta Business Manager.
5. **Vishal's exact scope** — Gandhinagar team only, or all govt regardless of city?
6. **Off-day calendar** — Sundays off? Holidays?
7. **Creative Lead pick** — Renuka / Safika / Shreya / Dikshita?

---

## 15. Things explicitly NOT in this plan

So we don't drift (per architecture §14 + owner direction):

- LED inventory yield management (the 80% empty slots problem)
- Multi-city expansion playbook (after ₹15 Cr+ on existing footprint)
- Vendor / procurement automation
- Self-serve client portal (Phase 4+ maybe)
- Recruitment ATS (overbuild for 22-person team)
- Statutory compliance automation (PF, ESI, gratuity)
- Voice-call recording / IVR
- DAVP-LED empanelment work (your strategic project, not software)
- Branch offices / franchise model

If you ask for any of these mid-build, the answer is: "Phase 4 or later — let me note it."

---

## 16. How to use this document

**For the owner:**
- Read once now.
- Mark up sections with comments (paste into chat with "section X — change Y").
- Re-read at the start of each phase to remember what's IN and OUT of scope.

**For future Claude:**
- Re-read at the start of every conversation that touches code.
- If a request doesn't fit a module/phase, propose where it goes — don't build it inline.
- Always pair code work with `UI_DESIGN_SYSTEM.md` reference.
- Cross-role test (admin / co-owner / sales lead / sales / telecaller / agency) before any commit.

---

**End of Master Spec v2.**
**Next action:** owner reviews § 14 still-open questions + sends Cronberry CSV. Tuesday May 6 morning starts Phase 1.
