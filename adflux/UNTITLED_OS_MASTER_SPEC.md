# UNTITLED OS — MASTER SPEC v1
**Owner:** Brijesh Solanki, Untitled Advertising, Vadodara
**Last updated:** 2026-05-05
**Original architecture doc:** `Untitled_OS_Architecture_v1-111aff78.docx` (29 April 2026)
**Audit doc:** `AUDIT_2026_05_05.md`

> **Re-read instruction for future Claude:** before any code change in this repo, read this file end-to-end. It supersedes piecemeal task lists. The original architecture has 8 modules; we have only built fragments of M1 + M3. The owner has been frustrated with patch-style work; the directive going forward is module-by-module, fully audited, cross-role tested.

---

## 1. Business context (one screen)

Untitled Advertising is a 12-year-old, ₹9 Cr/year, 14-person outdoor advertising firm in Vadodara, Gujarat. Four revenue segments:

1. **Government DAVP / Auto Hood** (₹7–8 Cr) — auto-rickshaw hood ads, DAVP-rate, 33 districts
2. **Government GSRTC LED** — bus-station LED screens, DAVP-category rates, 20 stations
3. **Private LED** — 264 screens at GSRTC bus stops (mostly empty inventory — parked)
4. **Private services** — design + media buying for private clients

Two legal entities (already in the codebase):
- **Untitled Advertising** — govt segment (GSTIN, bank, letterhead in `companies` table)
- **Untitled Adflux Pvt Ltd** — private segment (separate GSTIN, bank, letterhead)

**The owner's actual ask** (architecture doc §1.2):
> "Automate the business so I can easily follow all people. I want a system where everyone works in the same direction. I want visibility and accountability across 14 people."

This is a **control system, not a growth system.** It is not a generic CRM.

---

## 2. The 8 modules — original vision vs current state

| # | Module | Original purpose | Built? | Status today |
|---|---|---|---|---|
| **M1** | Sales Activity & Lead | Daily check-in/out, GPS activity log, morning plan, evening report, lead pipeline (replace Cronberry) | ~25% | Quotes module + clients + follow-ups exist. NO check-in, NO morning plan, NO evening report, NO GPS, NO lead pipeline, NO Excel lead upload. |
| **M2** | Creative Production | 12-field brief, designer queue, revision counter, asset library | 0% | Not started. |
| **M3** | Quote → Invoice → Payment | Auto-trigger invoice draft on Won, payment chase, GoGSTBill + Tally integration | ~40% | Quote+payment+approval flow built. NO GoGSTBill API, NO Tally sync, NO auto chase, NO govt-format invoice with attachments. |
| **M4** | Campaign Operations | LED slot scheduling, screen health monitoring, campaign go-live | 5% | `campaign_start_date` / `campaign_end_date` columns exist. NO scheduling, NO health, NO go-live workflow. |
| **M5** | HR & Attendance | Daily attendance, leave, performance reviews | ~15% | HR offer letters built. NO attendance, NO leave, NO perf reviews. |
| **M6** | Client Reporting & Renewal | Weekly auto-reports, Day-14 renewal trigger, satisfaction pulse | ~10% | Renewal Tools page lists campaigns ending soon. NO auto-reports, NO renewal pitch generation, NO satisfaction pulse. |
| **M7** | Telecaller-to-Sales Handoff | Telecaller qualifies leads, SLA-driven assignment, qualification accuracy metric | 0% | Not started. |
| **M8** | Owner Cockpit | Daily 9 AM WhatsApp report, weekly review, red-flag alerts | ~20% | Admin dashboard exists. NO WhatsApp 9 AM report, NO red-flag alerts, NO delegated views (Mehulbhai / Sales Lead / Creative Lead). |

**Net build progress against architecture: ~14%.** Most of what was built so far is a slightly polished quote+invoice tool, not the full Untitled OS.

---

## 3. Owner's new asks (from last 10 messages, must be folded into the spec)

### 3.1 Team call tracking
- "Today's call list" on every sales rep's dashboard — auto-built from open quotes + follow-up due dates + lead heat
- Each call logged with outcome (positive / neutral / negative + 1-line note + next action)
- Call log feeds into evening report (architecture §4.1)

### 3.2 Lead Excel upload (admin-only)
- Admin uploads `.xlsx` of leads (name, company, phone, email, source, city, expected value)
- System creates one lead per row, deduped on phone
- Admin assigns leads to telecallers / sales reps in bulk
- Reassign leads from one rep to another (single + bulk)

### 3.3 Telecaller module (M7)
- Telecaller dashboard: today's call queue, their qualified leads, conversion rate
- Lead status flow: New → Contacted → Qualified → Sales Ready → Handoff → (Won/Lost)
- Telecaller earns part of closure incentive when their qualified lead converts (per architecture §4.7)

### 3.4 Live tracking
- Sales rep checks in at 9 AM with GPS
- Each meeting requires "check in at client" with GPS
- Owner sees live map of where each rep is (admin dashboard widget)
- Activities outside assigned city flagged

### 3.5 Creative module (M2)
- Sales rep submits 12-field brief when quote is Won
- Designer sees queue, picks top job, timer starts
- Revision counter visible to all parties; round 3 = automatic alert
- Asset library: every approved creative tagged for reuse

### 3.6 Check-in / check-out for whole team
- Sales: GPS check-in / check-out (already in M1)
- Designers / accounts / HR / admin: single tap "I'm at office" check-in
- HR sees attendance rollup; auto-marked absent if no check-in by 11 AM

### 3.7 AI agent
- The owner has not specified what the AI should do; treats it as a feature label
- Below in §6 I propose the 5 highest-ROI AI capabilities for this specific business

### 3.8 One app across whole business
- This IS the Untitled OS. The architecture doc was always the spec. We have been building fragments without honoring the cross-module flow.

---

## 4. The data model (what exists vs what's needed)

### 4.1 Tables that exist today (from `AUDIT_2026_05_05.md`)
- `users` (with `segment_access`, `signing_authority`)
- `quotes`, `quote_cities`, `payments`
- `clients`, `follow_ups`
- `cities`, `auto_districts`, `gsrtc_stations`
- `companies` (Phase 10 — both legal entities seeded)
- `proposal_templates`, `attachment_templates`
- `staff_incentive_profiles`, `incentive_settings`
- `hr_offers`
- `proposal_attachments` (Phase 11E, partial)

### 4.2 Tables we MUST add for the full OS

```
leads                        — M1, M7 (Cronberry replacement)
  id, source, name, company, phone, email, city, industry,
  segment, expected_value_range, hot_warm_cold,
  stage (New/Contacted/Qualified/SalesReady/MeetingScheduled/QuoteSent/Negotiating/Won/Lost/Nurture),
  lost_reason, assigned_to, assigned_at, qualified_by, qualified_at,
  created_by, created_at, updated_at

lead_activities              — every touch: call/whatsapp/meeting/email
  id, lead_id, activity_type, channel, outcome, notes,
  next_action, next_action_date, gps_lat, gps_lng,
  created_by, created_at

work_sessions                — M1 daily attendance + check-in/out
  id, user_id, work_date, plan_submitted_at, planned_meetings_json,
  check_in_at, check_in_gps, check_out_at, check_out_gps,
  evening_report_submitted_at, summary_json

call_logs                    — M1 + M7 telecaller call tracking
  id, user_id, lead_id (nullable), client_phone, call_at,
  duration_seconds, outcome, notes, next_action, next_action_date

creative_jobs                — M2
  id, quote_id (nullable for ad-hoc), brief_json, type, dimensions,
  duration_sec, language, deadline, priority, assigned_to,
  status (Brief/Queued/InProgress/InternalReview/ClientReview/Approved/Live),
  revision_count, time_spent_seconds, created_by, created_at

creative_revisions           — M2
  id, creative_job_id, round_number, sender_role,
  notes, attachments_json, created_at

creative_assets              — M2 asset library
  id, creative_job_id, file_url, file_kind,
  industry_tag, language_tag, style_tag, color_palette, is_template_eligible

campaigns                    — M4 (one per Won quote going live)
  id, quote_id, status (Pending/Live/Ended), go_live_at, end_at,
  cms_schedule_id, screens_count, screens_json

screen_health_logs           — M4
  id, screen_id, date, expected_impressions, actual_impressions,
  status (ok/under/down)

invoices                     — M3 (separate from quote, supports edits + multi-version)
  id, quote_id, invoice_number, segment, total, gst_amount,
  status (Draft/Sent/Paid/Overdue/Cancelled), sent_at,
  due_date, paid_at, gogstbill_ref, tally_synced_at

invoice_attachments          — M3 (govt mandatory: WO, photos, Media Report)
  id, invoice_id, attachment_type, file_url, uploaded_by

attendance                   — M5 (non-sales single-tap office check-in)
  id, user_id, work_date, check_in_at, status (present/absent/leave/half-day)

leave_requests               — M5
  id, user_id, leave_type, from_date, to_date, reason,
  status (pending/approved/rejected), approved_by, decided_at

performance_reviews          — M5
  id, user_id, period_start, period_end, kpi_data_json,
  manager_score, employee_self_score, comments, status, decided_by

campaign_reports             — M6
  id, campaign_id, week_number, pdf_url, sent_at, sent_via, delivery_status

renewal_pipeline             — M6
  id, campaign_id, days_to_end, suggested_action, sales_action_at,
  renewed_quote_id (nullable), status

client_satisfaction          — M6
  id, campaign_id, score, feedback_text, captured_at

ai_runs                      — observability for AI agent calls
  id, run_type, input_json, output_json, model, tokens_in, tokens_out,
  cost_inr, success, created_by, created_at
```

That's **15 new tables** beyond what exists today. Each is required for one of M1, M2, M4, M5, M6, M7 to function as the architecture envisions.

---

## 5. Module-by-module: what to build, in priority order

For each module: **Define done**, **Acceptance criteria**, **Estimate**, **Dependencies**.

### M1 — Sales Activity & Lead (Phase 1, 5–7 days)
**Define done:** every sales rep submits morning plan → checks in with GPS → logs each meeting/call with outcome → submits evening report → checks out. Admin sees daily roll-up. Leads can be uploaded in bulk and reassigned.

**Acceptance:**
- Cannot check in without morning plan
- Cannot check out without evening report
- Each lead activity has GPS + timestamp
- Excel lead upload works for admin (validates phone dedup)
- Admin reassigns leads single + bulk
- Daily live counter shows meetings X/Y, leads X/Y, calls X/Y

**Depends on:** new tables `leads`, `lead_activities`, `work_sessions`, `call_logs`

### M7 — Telecaller-to-Sales Handoff (Phase 1, 2–3 days)
**Define done:** telecaller dashboard with call queue + qualified-lead handoff to sales with 24h SLA.

**Acceptance:**
- Telecaller can only mark "Sales Ready" after filling: budget confirmed + timeline confirmed + decision-maker contact + service interest
- Lead auto-assigned to a sales rep on city + load
- 24h SLA enforced; missed → escalation to Sales Lead
- Telecaller's qualified-rate KPI visible

**Depends on:** M1 tables. Add `telecaller_id` + `sales_ready_at` to `leads`.

### M3 — Invoice automation (Phase 1, 3–4 days)
**Define done:** Quote Won → invoice draft auto-created → admin approves → invoice sent (PDF + email + WhatsApp). Govt format with mandatory attachments.

**Acceptance:**
- Quote.status=won triggers invoice draft (DB trigger or Edge Function)
- Govt invoice cannot be marked Sent until WO + photos + completion certificate are attached
- Auto-WhatsApp on Day 30 / 45 / 60 if unpaid
- TAT: Quote Won → Invoice Sent within 24 hours (measured KPI)

**NOT in v1:** GoGSTBill API + Tally sync. We use our own invoice number + PDF; integration is Phase 2.

**Depends on:** new `invoices`, `invoice_attachments` tables.

### M8 — Owner Cockpit + Daily WhatsApp Report (Phase 1, 2–3 days)
**Define done:** Brijesh receives a single WhatsApp message at 9 AM and 7:30 PM, plus a web cockpit page.

**Acceptance:**
- 9 AM message contains: yesterday's collection, MTD revenue, outstanding aging, sales team performance, creative status, campaigns, top 3 attention items
- 7:30 PM message lists who hit/missed targets today
- Red-flag alerts trigger anytime: invoice >45d, screen down, satisfaction <2, no check-in by 11 AM
- Admin web cockpit consolidates everything

**Depends on:** WhatsApp Business API setup (Meta approval ~7 days for first templates).

### M2 — Creative Production (Phase 2, 4–5 days)
**Define done:** brief form → designer queue → timer → internal review → client review → approval → asset library.

**Acceptance:**
- Cannot create creative job without 12-field brief filled
- Designer queue ranked by deadline
- Revision counter visible; round 3 = mandatory escalation
- Asset library auto-tags + searchable

**Depends on:** new `creative_jobs`, `creative_revisions`, `creative_assets` tables.

### M4 — Campaign Operations (Phase 2, 3–4 days)
**Define done:** Won quote → campaign record → schedule in CMS → live → daily health monitoring.

**Acceptance:**
- Status transitions: Pending → Scheduled → Live → Ended
- Screen health: daily check, alert if <70% expected impressions
- Auto-WhatsApp to client on go-live
- Renewal trigger fires Day -14 of end_date

**Depends on:** existing CMS for actual scheduling. We track + alert.

### M6 — Client Reporting & Renewal Engine (Phase 2, 3–4 days)
**Define done:** Monday cron lists active campaigns; manual PDF upload per campaign; auto-WhatsApp to clients. Day -14 renewal pipeline.

**Acceptance:**
- Renewal pipeline page shows every campaign ending in 14 days with suggested pitch
- Auto-WhatsApp to client on Day -14
- Satisfaction pulse on campaign end (1–5 score → renewal nudge or escalation)

**Depends on:** M4 campaigns table.

### M5 — HR & Attendance (Phase 3, 3–4 days)
**Define done:** non-sales attendance, leave requests, quarterly performance review with auto-pulled KPIs.

**Acceptance:**
- Single-tap office check-in for designers/accounts/HR
- Leave request flow with approval
- Performance review pre-fills from quote/payment/creative data

**Depends on:** new `attendance`, `leave_requests`, `performance_reviews` tables.

---

## 6. AI agent — what it should actually do

The owner doesn't know what AI should do. Below are the 5 capabilities ranked by ROI for **this specific business** (Gujarati outdoor advertising, govt-heavy, 14 people, owner is the bottleneck). Each is a separate AI feature that can ship independently.

### AI-1 — Daily Owner WhatsApp Brief (highest ROI)
**What:** every morning at 9 AM, AI scans yesterday's data + open issues, produces the cockpit message in M8 format, sends via WhatsApp.
**Why high ROI:** directly serves the owner's stated #1 need ("answer 'what is anyone doing right now' in 10 seconds"). Replaces 30+ minutes of manual review.
**Cost:** ~₹100/month at current scale (one ChatGPT call per day).
**Build:** 1 day (the data is already in the tables; only need scheduling + LLM summarization).

### AI-2 — Gujarati proposal letter drafter
**What:** sales rep types a 2-line English brief; AI generates the formal Gujarati cover letter content following the existing template.
**Why high ROI:** govt sales reps may not type Gujarati well. Today rendering is templated; content is hand-edited. Saves ~15 min per proposal.
**Cost:** ~₹100–500/month.
**Build:** 1.5 days. Needs: prompt with the existing Gujarati template + the quote data.

### AI-3 — Smart follow-up scheduler
**What:** every morning, AI looks at all open leads + their last activity + heat + days since contact + quote stage. Produces today's prioritized call list per rep, with a one-line script suggestion in Gujarati.
**Why high ROI:** "sales people don't follow up" is Fire #3 in the architecture doc. This makes the next-action obvious.
**Cost:** ~₹500/month.
**Build:** 2 days.

### AI-4 — OCR for govt documents
**What:** rep uploads photo/scan of Work Order / OC Copy / Invoice. AI extracts: PO number, date, amount, validity, signature presence. Auto-fills attachment metadata + alerts if anything looks off.
**Why high ROI:** govt invoice cycle is 60 days; one missing field = another 30-day delay. Reduces data entry + reduces rejection risk.
**Cost:** ~₹2/document.
**Build:** 1.5 days. Use Claude / GPT-4o vision.

### AI-5 — Renewal pitch generator
**What:** Day -14 of campaign end, AI looks at delivered impressions vs promised, payment history, past renewals. Generates a personalized pitch in Gujarati for the sales rep to send.
**Why high ROI:** Architecture says renewal rate today is near zero. Target is 50%. Each renewal is ₹X without any new lead-gen.
**Cost:** ~₹200/month.
**Build:** 1.5 days. Depends on M4 (campaign data) + M6 (renewal pipeline).

**Recommended sequence:** AI-1 first (immediate owner value). Then AI-2 + AI-3 (sales team). AI-4 + AI-5 in Phase 2.

---

## 7. Realistic phase plan

The original architecture says **12 months for the full OS**. The owner wants it by **Sunday May 10**, which is 5 days. The honest answer is below.

### What can actually ship by Sunday May 10
- Polish what's already built (75% audit baseline)
- Verify Phase 10 company rendering end-to-end
- Run Phase 11i / 11l SQL migrations
- Backfill orphan clients
- Fix segment_access filtering on Quotes + Clients lists
- Wire Phase 8C Master attachments fully
- Wire Phase 11F company asset upload
- Cross-role end-to-end test
- **AI-1 (Daily owner WhatsApp brief)** — 1 day, highest leverage

That's enough work for 5 days of focused effort. NO new module.

### What ships in Phase 1 (May 11 → May 31, 3 weeks)
- M1 fully built (lead pipeline + Excel upload + check-in/out + GPS + morning plan + evening report)
- M7 telecaller module
- M3 invoice automation (in-app, not GoGSTBill yet)
- M8 cockpit web page
- AI-2 + AI-3 (Gujarati drafter + follow-up scheduler)

### What ships in Phase 2 (June, 4 weeks)
- M2 creative production
- M4 campaign operations
- M6 reporting + renewal engine
- AI-4 (OCR for govt docs)
- AI-5 (renewal pitch generator)

### What ships in Phase 3 (July, 3 weeks)
- M5 HR & attendance
- GoGSTBill + Tally integration
- WhatsApp Business API templates approved with Meta
- Polish + adoption push

**Total realistic timeline to full Untitled OS: 11–13 weeks (2.5–3 months).** The original architecture said 12 months because it included org-structure changes (hiring Sales Lead, Creative Lead, Operations Coordinator) which are people work, not software work.

---

## 8. Acceptance criteria for "ready to use Monday morning" (May 11)

Before declaring Phase 0 done on Sunday, verify the following four user journeys end to end:

### Journey A — Admin (Brijesh)
1. Log in → land on dashboard. See yesterday's collection, MTD, outstanding aging.
2. Open Quotes list → see all quotes regardless of who created.
3. Filter by segment + date range + status. Search by client name.
4. Open a govt quote → see correct legal entity (Untitled Advertising) on rendered letter, GSRTC station names in Gujarati, district list in Gujarati.
5. Approve a pending payment from Approvals tab. See it disappear from queue.
6. Open Master → Companies. Upload a new letterhead. Confirm it shows on next-rendered proposal.
7. Open Team. Add a new sales rep. Set their segment_access. Promote a user to signer.

### Journey B — Sales rep (KAMINA)
1. Log in → land on personal dashboard. See MTD revenue, target gap, my open quotes.
2. Click New Quote → see only the segments my segment_access allows.
3. Create a govt Auto Hood quote with manual qty per district.
4. Save as draft. Confirm quote appears in My Quotes.
5. Mark Sent → upload OC copy in modal → confirm flips to Sent.
6. Click WhatsApp / Email → confirm Gmail compose opens with Gujarati body and signed PDF link.
7. Confirm clients tab shows my synced clients.

### Journey C — Agency rep (Rannade Corporatio)
- Same flow as KAMINA.
- Confirm RLS allows them to see only their own quotes/clients/payments.
- Confirm clients sync (Phase 11l fix).

### Journey D — Co-owner (Vishal)
- Same as admin EXCEPT cannot delete records.
- Can sign proposals.
- Cannot remove signers (admin-only).

If any of these four journeys breaks, do not declare Phase 0 done.

---

## 9. How I'll recall this in future conversations

Save these pointers in MEMORY.md so any future Claude in this workspace can re-read the master spec at the start:

1. **Reference memory:** `untitled_os_master_spec.md` → "Untitled OS master spec lives at `Untitled/adflux/UNTITLED_OS_MASTER_SPEC.md`. Re-read before any module-level work. Original architecture in `Untitled_OS_Architecture_v1-111aff78.docx`. Audit in `AUDIT_2026_05_05.md`."
2. **Project memory:** "8 modules planned (M1–M8). Currently ~14% built (mostly fragments of M1+M3). Owner wants full OS, not just CRM. Realistic timeline 11–13 weeks for full build."
3. **Feedback memory:** "Owner has explicitly asked for module-level work, not patches. Audit before each module. Cross-role test (admin/sales/agency/co_owner) before commit. No emoji glaze."

---

## 10. Open questions for the owner

These need answers before Phase 1 starts (architecture §15.2 carried forward + new):

1. **WhatsApp Business API**: do you have a Meta Business account approved? Template approval is 3–7 days lead time per template. Without this, M8 daily report can't ship.
2. **GPS for check-in**: are sales reps using personal phones or company phones? Browser GPS requires HTTPS + permission (already on Vercel). Confirm reps will allow it.
3. **Excel lead upload columns**: what's your standard Cronberry export format? I'll build the parser to match. If unsure, paste one sample row.
4. **Telecaller incentive structure**: per architecture §4.7 — base + per-qualified-lead + closure-bonus. Confirm the rupee amounts.
5. **AI agent budget**: the 5 AI features cost ~₹3,000/month combined at current scale. OK?
6. **Sales Lead + Creative Lead promotion** (architecture §9): pick the people. The OS layer counts on these two roles existing.
7. **The 40% agency client**: is there a written contract? Architecture flagged this as a strategic risk.
8. **Cronberry / Trackdek sunset dates**: when can we stop running them in parallel?

---

## 11. What we are explicitly NOT building (per architecture §14)

So we don't drift:
- LED inventory yield management (the 80% empty slots problem)
- Multi-city expansion playbook
- Voice-call recording / IVR
- Self-serve client portal
- Recruitment ATS
- Statutory compliance automation (PF, ESI, gratuity)
- Vendor / procurement automation

If the owner asks for any of these, the answer is "Phase 4 or later."

---

**End of master spec v1.**
**Next action:** owner reviews + approves §7 phase plan + answers §10 open questions.
**Then:** Phase 0 work begins (Tuesday May 6 morning).
