# Untitled OS — Architecture & Audit

**Status:** v2.0 · Phase 33Y · 12 May 2026
**Owner:** Brijesh Solanki (Untitled Advertising · Untitled Adflux Pvt Ltd)
**Repo:** `untitledgsrtc-maker/adflux` · branch `untitled-os`
**Live (staging):** untitled-os-tau.vercel.app · kompjctmisnitjpbjalh.supabase.co

> This is the single source of truth for **how the codebase is organised**, **what each layer does**, and **what rules govern changes**. Read end-to-end before touching code.
>
> Supersedes ARCHITECTURE.md v1.0 (pre-Phase 33). Roles, schema, modules and tone rules have all evolved since then.

---

## 1 · Repo layout

```
adflux/
├── ARCHITECTURE.md              ← this file (single source of truth)
├── CLAUDE.md                    ← Claude operating rules (read first)
├── README.md
│
├── .claude/                     ← Hook layer (Phase 33Y)
│   ├── README.md                  hook documentation
│   ├── settings.json              registers hooks with Claude Code / Cowork
│   └── hooks/
│       ├── PreToolUse.sh          fires before Write/Edit · blocks brand violations
│       ├── PostToolUse.sh         fires after Write/Edit · runs schema + parse checks
│       └── SessionStart.sh        loads git state + schema columns into context
│
├── scripts/                     ← Manual-run guardrail scripts
│   ├── check-sql-schema.sh        denylist + alias-column validation
│   └── check-jsx-brand.sh         #facc15 / #0a0e1a violation grep
│
├── src/
│   ├── App.jsx                  ← route table (specific BEFORE param)
│   ├── main.jsx
│   ├── lib/
│   │   └── supabase.js            singleton supabase client
│   ├── store/
│   │   ├── authStore.js           Zustand · profile + session
│   │   └── quoteStore.js          Zustand · quote filters
│   ├── hooks/
│   │   ├── useAuth.js
│   │   ├── useQuotes.js
│   │   ├── usePayments.js
│   │   └── useLeadTasks.js
│   ├── utils/
│   │   ├── pushNotifications.js   PWA push subscribe + invoke (Phase 33R-X)
│   │   ├── formatters.js
│   │   ├── numberToWords.js       Indian numbering (lakh/crore)
│   │   ├── incentiveCalc.js
│   │   ├── settlement.js
│   │   └── period.js
│   ├── components/
│   │   ├── v2/                    shell + topbar + nav + search
│   │   ├── incentives/            ProposedIncentiveCard · PerformanceScoreCard
│   │   ├── leads/                 LeadShared · LogActivityModal · ChangeStageModal
│   │   │                          · TodayTasksPanel · RepDayTools · PhotoCapture
│   │   │                          · WhatsAppPromptModal
│   │   ├── quotes/                wizard steps · QuotePDF
│   │   ├── hr/                    OfferLetterPDF
│   │   └── ...
│   ├── pages/v2/                ← every active screen
│   │   ├── WorkV2.jsx             sales home (/work)
│   │   ├── LeadsV2.jsx
│   │   ├── LeadDetailV2.jsx
│   │   ├── QuotesV2.jsx
│   │   ├── ClientsV2.jsx
│   │   ├── FollowUpsV2.jsx
│   │   ├── MyPerformanceV2.jsx
│   │   ├── LeavesAdminV2.jsx       (admin) /admin/leaves
│   │   ├── TaPayoutsAdminV2.jsx    (admin) /admin/ta-payouts
│   │   ├── MasterV2.jsx
│   │   ├── CreateQuote*.jsx        4 wizards: Private LED · Govt Auto · GSRTC · Other Media
│   │   └── ...
│   └── styles/
│       ├── tokens.css           ★ live design tokens — wins when docs disagree
│       ├── v2.css                 v2-scoped tokens (--v2-*)
│       └── leads.css
│
├── public/
│   ├── manifest.json              PWA manifest (Phase 33U)
│   ├── sw.js                      service worker (Phase 33R)
│   ├── icon-180.png / 192 / 512   PWA icons
│   └── fonts/
│
├── supabase/
│   └── functions/
│       └── notify-rep/
│           └── index.ts           Edge Function · web-push fanout (Phase 33S)
│
├── supabase_schema.sql          ← base schema (Phase 1)
├── supabase_phase*.sql          ← every migration in order
└── _design_reference/           ← owner-approved mockups
```

---

## 2 · Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React 18 + Vite | Owner-friendly HMR, single bundle, easy Vercel deploys |
| Routing | React Router v6 | Standard for SPAs. **Specific routes BEFORE parameterised** (avoid `/leads/:id` shadowing `/leads/new`) |
| State | Zustand | Lightweight; no Redux boilerplate. Stores: auth, quotes |
| Forms | React Hook Form + Zod | Wizard step validation |
| Backend | Supabase (Postgres + Auth + Realtime + RLS + Storage) | One platform, no server to maintain |
| Edge functions | Deno on Supabase | Server-side push fanout (`notify-rep`) + Co-Pilot + voice-process + daily-brief + scorecard |
| In-app PDFs | `@react-pdf/renderer` for Private LED · `html2canvas + jsPDF` for Govt / Other Media | Two paths because Govt needs Gujarati script support |
| Push notifications | Web Push API + service worker + VAPID | PWA on iOS / Chrome (Phase 33R-X) |
| Icons | `lucide-react` only · stroke 1.6 · sizes 14/16/18/22 | CLAUDE.md §7 |
| Fonts | DM Sans · Space Grotesk · JetBrains Mono · Noto Sans Gujarati | Loaded from Google Fonts in `index.html` |
| Hosting | Vercel (auto-deploy from `untitled-os` branch) | One-click deploy on push |
| Date math | `date-fns` + custom Postgres `fy_for_date()` | Indian Financial Year (Apr 1 – Mar 31) |

---

## 3 · Module map (the 8-module OS)

Per `UNTITLED_OS_MASTER_SPEC.md`:

| # | Module | Status | Surfaces |
|---|---|---|---|
| M1 | Sales / Leads | ✅ Live | /work · /leads · /leads/:id · /follow-ups |
| M2 | Creative jobs | Phase 3 (Jul+) | not started |
| M3 | Invoicing | Phase 2 (Jun 15+) | not started |
| M4 | Campaign tracking | Phase 2 | not started |
| M5 | HR + payroll | Phase 3 | partial — leaves (33G.8), score (33E), TA (33H) |
| M6 | Reporting / renewals | Phase 2 | /renewal-tools exists; auto-flag pending |
| M7 | Telecaller | ✅ Live | /telecaller dashboard + auto-assignment + 24h SLA |
| M8 | Owner cockpit | ✅ Live | /cockpit · AI-1 daily brief · /dashboard |

Eight productivity features:

| | Feature | Status |
|---|---|---|
| AI-1 | Daily WhatsApp brief | ✅ Edge Function `daily-brief` |
| AI-2 | Co-Pilot NL Gujarati/English | ✅ Edge Function `copilot` |
| AI-3 | Voice-First (Whisper + Claude) | ✅ Edge Function `voice-process` |
| AI-4 | Performance score + variable salary | ✅ Phase 33E |
| AI-5 | Smart Task engine | ✅ Phase 19 + 33T fix |
| AI-6 | Follow-up auto-cadence | ✅ Phase 33D.6 (6 pre-quote + 3 quote-chase + 30-day nurture/lost) |
| AI-7 | Photo OCR (business cards) | ✅ Phase 33C/D · Claude Vision |
| AI-8 | Push notifications | ✅ Phase 33R-X · auto-triggers in Phase 33W |

---

## 4 · User roles (5 total — `owner` role NOT used)

| Role | Sees | Notes |
|---|---|---|
| `admin` | All operational + all financial + P&L | Full access |
| `co_owner` | Same as admin | Currently identical to admin |
| `sales` | Own quotes/payments/clients + scoped leads | RLS-filtered. `segment_access` either GOVT or PRIVATE |
| `agency` | Their own quotes + commission view | External commission partner (Phase 32F) — no daily plan, no GPS, no leads |
| `telecaller` | Call queue + leads (segment-scoped) | Phase 26b. Mobile bottom nav: Today/Queue/Leads/Voice |

Role check in DB: `get_my_role()` SECURITY DEFINER function. **There is no `owner` role** — DB constraint dropped it. Don't reintroduce.

Three-layer access:
1. **Segment scope** on `users.segment_access` — applies only to sales + telecaller. Everyone else = ALL.
2. **Operational data** (creative, attendance, leads) — segment-blind for non-sales.
3. **Financial data** — gated by role.

---

## 5 · Two-company architecture (hard rule)

| Segment | Legal entity | GSTIN/Bank | Letterhead |
|---|---|---|---|
| `GOVERNMENT` | Untitled Advertising | from `companies` WHERE segment='GOVERNMENT' | govt letterhead |
| `PRIVATE` | Untitled Adflux Pvt Ltd | from `companies` WHERE segment='PRIVATE' | private letterhead |

Rules:
- Every PDF / proposal / quote **reads the `companies` row by `segment`**. Never hardcode company name, address, GSTIN, bank, or logo.
- **Hard-fail** (don't fall back) if company row is missing required fields.
- Renderers `assert(segment matches company)`. Mismatch raises.
- Two segments only. Stored as `quotes.segment`.

**Govt is locked** to AUTO_HOOD + GSRTC_LED only. Other media (DAVP for hoardings/mall/cinema/digital) is **explicitly blocked** at DB level via CHECK + `media_segment_validity` config table.

Ref-number formats are **locked for existing 50 quotes** (`UA-2026-NNNN`). New formats apply to new quotes only:
- `UA/AUTO/2026-27/NNNN` for AUTO_HOOD
- `UA/GSRTC/2026-27/NNNN` for GSRTC_LED
- `UA-2026-NNNN` for Private LED + supplementary media

---

## 6 · Data model (key tables)

### Core (Phase 1)

| Table | Purpose | Key columns / notes |
|---|---|---|
| `users` | Team members | id · name · **email (NOT NULL)** · role · team_role · segment_access · daily_targets (jsonb) · manager_id · is_active |
| `quotes` | Sent quotations | id · **quote_number (NOT NULL UNIQUE)** · client_* (denormalised snapshot) · total_amount · status (draft/sent/negotiating/won/lost) · segment · media_type · created_by · lead_id · campaign_start_date · campaign_end_date · is_expired (Phase 33J) |
| `quote_cities` | Line items | quote_id · **city_name** (note: city _NAME_, not media_type) · hsn_sac · cgst_pct · sgst_pct |
| `payments` | Received money | quote_id · amount_received · payment_mode · **received_by** (NOT recorded_by) · approval_status (pending/approved/rejected) · is_final_payment |
| `clients` | CRM client list | UNIQUE on (phone, created_by). Sales sees own |
| `cities` | LED location catalog | name · daily/offered rate · photo |

### Leads + activities (Phase 12)

| Table | Purpose |
|---|---|
| `leads` | id · name · company · phone · email · stage (New/Working/QuoteSent/Nurture/Won/Lost) · heat · assigned_to · revisit_date · industry |
| `activities` | lead_id · kind · note · gps · outcome · user_id |
| `follow_ups` | quote_id OR lead_id · assigned_to · follow_up_date · note · is_done |
| `work_sessions` | user_id · work_date · check_in_at · check_in_gps_* · daily_counters (jsonb {meetings, calls, new_leads}) · is_off_day · overnight_stay (Phase 33Q) |
| `holidays` | holiday_date · name · is_active |
| `call_logs` | Telecaller call tracking |

### Phase 33 additions

| Table | Phase | Purpose |
|---|---|---|
| `daily_performance` | 33E | Per-rep per-day score % |
| `staff_incentive_profiles` | pre | monthly_salary · slab rules |
| `monthly_sales_data` | pre | Derived aggregate — rebuilt by triggers |
| `leaves` | 33G.8 | (user_id, leave_date) unique · type · status · reason |
| `daily_ta` | 33H | (user_id, ta_date) · primary_city · km · DA · bike · hotel · status · hotel_requested (Phase 33Q) |
| `city_da_ceilings` | 33H | 21 cities · centroid lat/lng · radius_km · daily_da · bike_per_km · hotel_rate · is_home |
| `gps_pings` | 31Z | user_id · captured_at · lat · lng · accuracy_m · source |
| `push_subscriptions` | 33R | endpoint UNIQUE · p256dh · auth |
| `user_notification_prefs` | 33R | category opt-outs · quiet hours |

### Quote status invariants

- Enum: `draft → sent → negotiating → won | lost`. **One-way transitions** enforced by Phase 11b trigger.
- Won → lost allowed only if no final payment cleared.
- Payment approval: `pending → approved | rejected`. Sales inserts always `pending`; admin inserts can be `approved` directly.
- `monthly_sales_data` is **derived** — rebuilt by `rebuild_monthly_sales(staff_id, month_year)` from approved final payments. Frontend never writes to it.

### Lead → quote linkage (contract every wizard must honor)

`quotes.lead_id` exists. Every wizard (Auto Hood, GSRTC LED, Private LED, Other Media) **must**:
1. Accept `prefill.lead_id` from `location.state`
2. Persist it on the inserted quote row
3. After insert, update lead: `stage='QuoteSent'`, `quote_id={new}`

Breaking this contract breaks the lead pipeline.

---

## 7 · Routing

### Sales nav (`SALES_NAV` in V2AppShell)
| Path | Page | Notes |
|---|---|---|
| `/work` | WorkV2 | landing (Phase 31K Plan-A) |
| `/follow-ups` | FollowUpsV2 | |
| `/leads`, `/leads/new`, `/leads/:id` | Lead pages | **specific BEFORE param** |
| `/quotes`, `/quotes/:id`, `/quotes/new/*` | Quote pages | |
| `/clients` | ClientsV2 | |
| `/voice` | VoiceLogV2 | not in nav post Phase 33N |
| `/my-performance` | MyPerformanceV2 | PerformanceScoreCard |

### Sales mobile bottom nav (Phase 33J)
Today · Follow-ups · Leads · Quotes

### Admin nav (`ADMIN_NAV`)
Dashboard · Lead Pipeline · Team Live · Leads · Quotes · Clients · Approvals · Cities · Auto Districts · GSRTC Stations · Master · Team · HR · **Leaves** · **TA Payouts** · Renewals · Incentives.

### Agency nav (`AGENCY_NAV` — Phase 32F)
Quotes · My Earnings · My Offer. External commission partner; no daily plan, no GPS, no leads.

### Telecaller nav (Phase 26b)
Today · Queue · Leads · Voice · Quotes · Clients.

---

## 8 · Design system (`src/styles/tokens.css` wins over docs)

### Backgrounds
```
--bg:        #0f172a
--surface:   #1e293b
--surface-2: #334155
--surface-3: #475569
```

### Text
```
--text:        #f1f5f9
--text-muted:  #94a3b8
--text-subtle: #64748b
```

### Brand
```
--accent:       #FFE600   ← brand yellow. NOT #facc15.
--accent-fg:    #0f172a
--accent-soft:  rgba(255,230,0,0.14)
```

### Status
```
--success: #10B981   --warning: #F59E0B   --danger: #EF4444   --blue: #3B82F6
```

### Typography
- `--font-sans` — DM Sans → Inter → system
- `--font-display` — Space Grotesk (headings, big numbers)
- `--font-mono` — JetBrains Mono (IDs, currency, ages)

### Radius scale
6 / 8 / 9 / 10 / 12 / 14 / 16 / 999

### Inside `.v2`-scoped pages
Use `--v2-*` tokens from `v2.css` (`--v2-yellow`, `--v2-ink-0/1/2`, `--v2-bg-0/1/2`, `--v2-line`, `--v2-display`).

### Inline-style fallback
Always use the CSS variable with a hex fallback: `var(--v2-yellow, #FFE600)`. **Never** `#facc15`.

### UI build checklist (every new screen, before declaring done)
1. CSS variables only — no hardcoded colors
2. Renders in Night + Day theme where applicable
3. Status chips use the chip + tint pattern (`--tint-*-bg` + `--tint-*-bd`)
4. Numbers Space Grotesk · IDs/ages JetBrains Mono · body DM Sans
5. Border-radius from the scale
6. Hover state on every interactive element
7. Empty state designed (not a blank box)
8. Loading state designed (skeleton or spinner)
9. Error state designed (red banner with retry)
10. Mobile tested at 720px and 1100px breakpoints
11. Focus rings visible on tab nav
12. Lucide icons only, stroke 1.6, size 14/16/18/22

Skipping any of these is the kind of thing the owner catches and calls out.

---

## 9 · Hook layer (Phase 33Y · `.claude/` + `scripts/`)

Catches the 6 schema-assumption bugs from Phase 33 **before they ship**.

### How it works

| Hook | When | What it does |
|---|---|---|
| `.claude/hooks/SessionStart.sh` | New Claude session | Loads git status + last 5 commits + the 6 critical tables' column schemas into context |
| `.claude/hooks/PreToolUse.sh` | Before Write/Edit/MultiEdit | Blocks JSX writes with hardcoded `#facc15` / `#0a0e1a` |
| `.claude/hooks/PostToolUse.sh` | After Write/Edit/MultiEdit | SQL files → `check-sql-schema.sh` · JSX/TSX → brand check + esbuild parse |

`.claude/settings.json` registers the hooks with Claude Code / Cowork via the standard `hooks` block format.

### Denylist (known-bad column names)
```
valid_until         → not on quotes; use created_at + interval
ref_number          → not on quotes; use quote_number only
recorded_by         → wrong; column is received_by on payments
next_follow_up_at   → not on leads; data is in follow_ups table
```

### Manual run
```bash
bash scripts/check-sql-schema.sh supabase_phase33h_ta_module.sql
bash scripts/check-jsx-brand.sh src/pages/v2/MasterV2.jsx
```

Verified against this sprint's actual bugs:
- Phase 33J hygiene SQL (`valid_until`) → **caught**
- Phase 33G.7 payment FU (`ref_number`) → **caught**
- Phase 33H clean file → **passes**

---

## 10 · Push notifications (Phase 33R-X)

End-to-end stack, fully wired and **verified delivering** on iPhone PWA + Mac Chrome.

```
Event in DB                pg_net trigger              Edge Function           web-push          Device
(lead assign,    ───────►  enqueue_push()    ───────►  notify-rep      ──────► FCM/Apple ──────► iPhone PWA
 payment,                  HTTP POST                   web-push library                          Mac Chrome
 quote→Won,
 daily 9 AM IST cron)
```

### Status (all green)

| Piece | Status |
|---|---|
| VAPID keys (Vercel + Supabase pair) | ✅ |
| Service worker (`public/sw.js`) | ✅ |
| Manifest (`public/manifest.json`) + Apple meta tags | ✅ |
| Browser subscription (raw fetch upsert per Phase 33X) | ✅ |
| Edge Function `notify-rep` (deployed `--no-verify-jwt`) | ✅ |
| pg_net trigger with 20s timeout | ✅ |
| SQL triggers (lead assign · payment · Won) | ✅ |
| pg_cron daily reminders at 9 AM IST | ✅ |
| Delivery verified iPhone PWA + Mac Chrome | ✅ |

### Auto-firing events (Phase 33W)

| Event | Push to | Routes to |
|---|---|---|
| Lead assigned to rep | new assignee | `/leads/:id` |
| Payment approved | quote creator | `/quotes/:id` |
| Quote status → Won | quote creator | `/quotes/:id` |
| Daily 9 AM IST cron | every rep w/ overdue FUs or 3-day-miss | `/follow-ups` or `/my-performance` |

### iOS install flow (one-time)

1. Open Safari → tap **Share** → **Add to Home Screen** → Add
2. **Close Safari completely**
3. Open the app via the new home-screen icon
4. iOS prompts "Untitled would like to send notifications" → Allow
5. Notifications work from then on

**Apple does NOT allow Web Push in regular Safari tabs.** PWA install is mandatory.

---

## 11 · Phase 33 log (this sprint)

| Phase | What |
|---|---|
| 33A | Today screen + simplified LogMeeting |
| 33B.3/4 | Validation + IncentiveCard placement + login routing |
| 33C/D | VoiceInput wrapper + photo capture + OCR |
| 33D.6 | Auto-cadence engine (6+3+30 pattern) |
| 33E | Performance score + 70/30 variable salary |
| 33F | P1+P2 cleanup batch (10 items) |
| 33G | P0 chrome cleanup from live audit |
| 33G.2 | Lead detail action grid 9 → 5 + More |
| 33G.3 | PerformanceScoreCard empty state |
| 33G.4 | Hamburger restored for sales/agency |
| 33G.5 | `monthly_score` SQL ambiguity fix |
| 33G.6+7 | Forecast dropdown + payment FU on Won |
| 33G.8 | Real `leaves` table + admin UI |
| 33H | TA module (city ceilings + GPS aggregator + admin payouts) |
| 33I | B2/B3/B4/B5/B9 fixes |
| 33J | F2 nav + B1/B11/F6/F8 + EXPIRED + N1 |
| 33J fix | `valid_until` → `created_at + 30d` |
| 33K | MasterV2 brand cleanup + dead-code removal |
| 33L | F5 sparkline + F7 OCR confirm + F10 Save-now + WhatsApp long-press |
| 33L.2 | Realtime forecast + duplicate-client merge |
| 33M | TA filter + bulk approve |
| 33N | pgTAP smoke tests (12 tests) |
| 33O | `next_workday` timestamp overload |
| 33P | Lead detail 2×2 mockup |
| 33Q | Rep day tools (leave/overnight/3-day-miss) |
| 33R | Push subscriptions DB + service worker |
| 33S | `notify-rep` Edge Function |
| 33T | `generate_lead_tasks` `next_follow_up_at` bug fix |
| 33U | PWA manifest + Apple meta tags |
| 33V | Explicit Enable Notifications button |
| 33W | Auto-trigger wiring + JWT bypass |
| 33X | Raw-fetch upsert (auth race fix) |
| 33Y | **Hooks layer** (this file's reason for existing) |

---

## 12 · Pre-deploy checklist

Before `git push origin untitled-os`:

1. ✅ `git status` → only intended files staged
2. ✅ `bash scripts/check-jsx-brand.sh <each .jsx>` → no #facc15
3. ✅ `bash scripts/check-sql-schema.sh <each .sql>` → no denylist hits
4. ✅ Esbuild parse-check every modified JSX:
   ```
   ./node_modules/.bin/esbuild --loader:.jsx=jsx --log-level=warning <file> > /dev/null
   ```
5. ✅ Commit message follows: `Phase {N}{rev?}: {one-line}` + bullet body
6. ✅ Before claiming push succeeded: `git log origin/untitled-os` confirms commit
7. ✅ Any SQL files: owner needs to paste into Supabase Studio + verify run

After deploy:

8. ✅ Run smoke tests: `supabase_phase33n_smoke_tests.sql`
9. ✅ Verify live page on real mobile device (not just emulator)
10. ✅ Push-touching change: send test push via `/work` button OR `enqueue_push()` RPC

---

## 13 · Module-not-patch directive (5 May 2026)

Owner's explicit rule: **build modules, don't patch.** Anti-pattern is the 75-task patch chain that produced inconsistent UX.

For any new feature:
1. Audit current state of affected module
2. Cross-role test: admin / co_owner / sales / agency / telecaller
3. Write acceptance criteria BEFORE code
4. Ship one cohesive module-level change, not a stream of fixes

---

## 14 · Tone & response rules

From owner preferences + CLAUDE.md §2:

- **No glazing.** Don't say "great", "smart", "brilliant" without specifics. Lead with what's missing.
- **Never agree by default.** First instinct = stress-test the idea.
- **Don't echo framing.** "I think X is the move" ≠ "X is definitely the move."
- **Be direct.** First sentence = the answer.
- **The more certain owner sounds, the more pushback he expects.**
- **Plain language.** A sales rep with no training should understand.
- **One sprint at a time.** No batching multiple modules.
- **Walk owner click-by-click** for Mac / GitHub / Vercel / Supabase steps.
- **Read intent.** He writes fast Indian-English / Gujarati phrasing. Don't correct spelling.

### Mandatory response format (non-trivial replies)

Six sections in order:
1. **Audit Summary** — what is broken / what the request requires
2. **Dependency Map** — files / tables / RLS / external systems touched
3. **Proposed Solution** — smallest change that meets spec
4. **Acceptance Criteria** — observable checks that prove it works
5. **Files to Change/Create** — explicit list, one-line purpose each
6. **Next Action for Owner** — run SQL, push, smoke test, etc.

---

## 15 · Production environments

| Env | Branch | Vercel URL | Supabase | Purpose |
|---|---|---|---|---|
| Staging | `untitled-os` | untitled-os-tau.vercel.app | kompjctmisnitjpbjalh.supabase.co | All new modules. Real users test here first. |
| Production | `main` | adflux-iota.vercel.app | (original AdFlux Supabase) | Live. Real money. Touch only for prod fixes. |

**Never merge `untitled-os` → `main`** until a sprint is genuinely shippable.

The sandbox **cannot push to GitHub** — no credentials. After every commit:
1. Tell owner the commit SHA
2. Tell owner the exact command:
   ```
   cd ~/Documents/untitled-os2/Untitled/adflux
   git push origin untitled-os
   ```
3. Vercel auto-deploys. SQL files must be pasted into Supabase Studio manually.
4. **Never claim push succeeded** unless `git log origin/untitled-os` confirms it.

---

## 16 · GST / invoice formatting (India)

- Indian numbering: **lakh / crore**, never million / billion.
- `12,21,300` → "Twelve Lakh Twenty-One Thousand Three Hundred Rupees Only" (use `src/utils/numberToWords.js`)
- GST 18% = CGST 9% + SGST 9% (intrastate)
- Default HSN/SAC for media: `998397`
- "Total in Words" required on every invoice / quotation PDF
- Bank details panel: Name / Branch / Acc Name / Acc Number / IFSC / MICR — from `companies` row

---

## 17 · Incentive math (`src/utils/incentiveCalc.js`)

Per rep per month:

```
threshold     = monthly_salary * 2         # below this = no incentive
target        = monthly_salary * multiplier # default 5×
total_revenue = new_client_revenue + renewal_revenue

if total_revenue < threshold:    incentive = 0
elif total_revenue < target:     incentive = new_rev*new_rate + ren_rev*ren_rate  # default 5%/2%
else:                            incentive = above scaled + flat_bonus            # default ₹10,000
```

Same formula runs for **Earned** (using `monthly_sales_data` only) and **Forecast** (msd + open pipeline + won-unsettled). Both shown on /my-performance, /admin/incentives, and ProposedIncentiveCard.

### Variable salary model (Phase 33E)

Separate from above. Drives push notifications via `consecutive_missed_days` RPC.

- Base = 70% fixed
- Variable = 30% × (avg_score_pct / 100)
- Below 50% monthly avg → variable = 0
- Sundays / holidays / approved leaves excluded from average

---

## 18 · Foot-guns (don't repeat)

### Original
- ❌ `#facc15` anywhere. Brand is `#FFE600`.
- ❌ Defining `/leads/:id` before `/leads/new`
- ❌ Building a new wizard without `lead_id` plumbing
- ❌ Hardcoding company name / GSTIN / bank in a renderer
- ❌ `delete` on an active quote (Phase 11b blocks it)
- ❌ Backdated `payment_date`
- ❌ Modifying a locked proposal PDF (regenerate, don't mutate)
- ❌ `owner` role (use `admin` or `co_owner`)
- ❌ Reading `media_type` from `quote_cities` (wizard saves to `city_name`)
- ❌ Claiming `git push` succeeded from the sandbox — it can't push
- ❌ Auto-fixing 50 unrelated style violations during a feature commit
- ❌ Starting a response with "Great point" or "You're absolutely right"
- ❌ Salesy / persuasive copy in PDFs / UI labels — voice is precise, quiet, grown-up
- ❌ Emoji in any file unless owner asks
- ❌ Mocking the database in tests — use real Supabase

### Phase 33 lessons (4-hour debug cost each)
- ❌ `quotes.valid_until`         — never existed (denylisted)
- ❌ `quotes.ref_number`          — never existed (denylisted)
- ❌ `payments.recorded_by`       — actual is `received_by` (denylisted)
- ❌ `leads.next_follow_up_at`    — data lives in `follow_ups` (denylisted)
- ❌ Inserting into `users` without `email` — NOT NULL
- ❌ `next_workday(timestamp)`    — needs date cast; overload added in 33O
- ❌ Pushing notifications without matching VAPID pair on both Vercel + Supabase

The denylist in `scripts/check-sql-schema.sh` enforces the 4 column-name ones.

---

## 19 · Known gaps & debt

Not blockers. Documented so future-Claude doesn't re-discover.

| Item | Why deferred |
|---|---|
| TDS columns on `payments` | First Govt PARTIAL_PAID will hit this |
| `GovtInvoiceRenderer` | No auto-invoice on Mark Won yet |
| Hotel auto-detect (TA) | Needs overnight-stay heuristic. Admin types manually in v1 |
| TA city radii tuning | Pilot data-dependent |
| Voice low-confidence confirm | Whisper doesn't expose per-segment confidence |
| GPS exponential backoff | Battery telemetry needed |
| Auto-cadence batch override UI | Phase 2 feature |
| M3 Invoice / M4 Campaigns / M6 Renewals | Phase 2 (Jun 15+) |
| M2 Creative / M5 HR payroll | Phase 3 (Jul+) |
| GoGSTBill / Tally / Cronberry sunset / Trackdek sunset | Phase 4 |
| Score breakdown coaching detail | 33I added milestone hints; deeper "what to fix" pending |
| /admin/ta-payouts mobile view | Admin desktop-first by spec |

---

## 20 · How to read this file

This document is the **architecture map**. It does not replace:

- `CLAUDE.md` — Claude operating rules + project-specific quirks
- `UNTITLED_OS_MASTER_SPEC.md` — vision + 8-module plan
- `UI_DESIGN_SYSTEM.md` — design token deep-dive
- `src/styles/tokens.css` + `v2.css` — **the actual tokens** (these win over docs when they diverge)
- The `supabase_*.sql` files — **the actual schema** (docs lag SQL by definition)

When a doc disagrees with code: **code wins**. Then update the doc.

---

## 21 · Updating this file

Append-only at the bottom. Add a numbered section. Don't rewrite history.

Format: `## {N} · {Title} ({DD-MM-YYYY})`

Example:

> ## 22 · M3 Invoice module landed (15-Jun-2026)
> Phase 34 ships first Govt invoice template. New table `invoices`, new RLS pattern, Phase 33H TA wire-up extended to include TDS columns.

---

End of architecture document.
