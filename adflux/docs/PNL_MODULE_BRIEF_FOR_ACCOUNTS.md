# P&L Module — Brief for Accounts Team

**For:** Mehulbhai / Diya (Accounts)
**From:** Brijesh Solanki, Untitled Advertising
**Date:** 16 May 2026
**Purpose:** Explain what the new "Profit & Loss" module will do inside our Untitled OS software, in plain language, so that the Accounts team can write the detailed accounting requirements + tax treatment document on top of it.

---

## 1. What this module does

Right now, Untitled OS tracks **revenue** (every quote, every invoice, every payment) but it does **not** track **what each deal actually cost us**. So at the end of the month, we can see "we billed ₹42 lakh" — but we cannot see "we *made* ₹4.8 lakh after costs."

The P&L module closes that gap. It is a **simple two-ledger system**:

1. **Per-deal costs** — every time a quote becomes WON, Brijesh enters what we paid (media owner, production, agency commission, other) against that deal.
2. **Monthly office costs** — every month, Brijesh enters fixed overheads (salaries, rent, electricity, internet, fuel, CA fees, etc.).

The software then automatically calculates **Net Profit** for the month and the financial year.

**Only Brijesh sees this module.** Sales reps, telecallers, agency partners, and even admin users cannot see P&L data. It's gated to one role.

---

## 2. The two ledgers

### Ledger A — Per-Quote Costs

For every quote that reaches WON status, the software creates an empty cost sheet. Brijesh (or whoever is authorised) opens that sheet and enters **four numbers**:

| Field | What it means |
|---|---|
| **Media Payout Amount** | What we owe / paid the media owner (BCCL, ENIL, Reliance, GSRTC, etc.) |
| **Production Cost** | Flex print, vinyl, jingle production, install labour, mounting |
| **Partner Commission** | Cut paid to agency partners (Madison, GroupM, freelance brokers) |
| **Other Direct Cost** | Travel for site visit, permits, crane rental, artwork charges, anything else tied to *this specific deal* |

Software then auto-calculates:
- **Total Cost** = sum of the four numbers above
- **Business Profit** = Quote Total – Total Cost
- **Margin %** = Profit ÷ Quote Total × 100

The accountant or owner can also add a free-text **Note** (e.g. "Madison retainer client, renew in August" or "Cinema slot got cancelled — refund pending").

#### Example — ENIL Radio quote, May 2026

| Item | Amount |
|---|---|
| Quote total (billed to client) | ₹3,50,000 |
| Media payout to ENIL | ₹2,10,000 |
| Jingle production | ₹15,000 |
| Madison commission (5%) | ₹17,500 |
| Creative artwork | ₹7,500 |
| **Total cost** | **₹2,50,000** |
| **Business profit** | **₹1,00,000** |
| **Margin** | **28.57 %** |

#### Example — Government Auto-Hood quote, May 2026

| Item | Amount |
|---|---|
| Quote total (billed to GVMC) | ₹3,00,000 |
| Auto-rickshaw owner payouts | ₹1,80,000 |
| Hood printing + mounting | ₹40,000 |
| Partner commission | 0 (direct govt deal) |
| Permits + transport | ₹12,000 |
| **Total cost** | **₹2,32,000** |
| **Business profit** | **₹68,000** |
| **Margin** | **22.67 %** |

#### Example — Mall LED that turned into a loss

| Item | Amount |
|---|---|
| Quote total | ₹1,75,000 |
| Media payout (mall owner) | ₹1,40,000 |
| Production | ₹25,000 |
| Partner commission | ₹10,000 |
| Other (extra mounting trip) | ₹8,000 |
| **Total cost** | **₹1,83,000** |
| **Business profit** | **–₹8,000** (loss) |
| **Margin** | **–4.6 %** |

Loss-making deals show up in red on the dashboard so we can investigate why they lost money (was it under-quoted, did costs run over, was there a refund).

---

### Ledger B — Monthly Admin Expenses

Once a month, Accounts enters the **office overheads** that are not tied to any specific deal. These are dropdown-driven — one of 14 fixed categories per row:

```
SALARY            RENT              ELECTRICITY       INTERNET
PHONE             VEHICLE_FUEL      CA_FEES           OFFICE_SUPPLIES
TRAVEL            INSURANCE         SUBSCRIPTIONS     BANK_CHARGES
MARKETING         OTHER
```

The form has only four fields: **FY**, **Month**, **Expense Type**, **Amount**, plus an optional **Note** field.

#### Example — May 2026 admin expense entries

| Expense Type | Amount | Note |
|---|---|---|
| SALARY | ₹4,80,000 | 22 staff payroll |
| RENT | ₹85,000 | Vadodara office |
| ELECTRICITY | ₹12,400 | MGVCL May bill |
| INTERNET | ₹3,200 | Tata Tele leased line |
| PHONE | ₹8,500 | Jio postpaid × 8 reps |
| VEHICLE_FUEL | ₹22,000 | Petrol cards |
| CA_FEES | ₹18,000 | Mehulbhai monthly retainer |
| OFFICE_SUPPLIES | ₹6,400 | Stationery + printer cartridge |
| TRAVEL | ₹14,500 | Brijesh Mumbai trip |
| INSURANCE | ₹9,200 | Office + vehicles |
| SUBSCRIPTIONS | ₹14,500 | Vercel + Supabase + WhatsApp API |
| BANK_CHARGES | ₹2,100 | HDFC current account fees |
| MARKETING | ₹35,000 | LinkedIn ads + Diwali gifts |
| **TOTAL (May)** | **₹7,10,800** | |

If the same category is entered twice in the same month, the second entry replaces the first (no duplicate rows). Every edit is logged with who did it and when.

---

## 3. How the monthly P&L is calculated

The software pulls the numbers automatically:

```
Revenue              =  Sum of all WON quotes whose Won-date falls in that month
Direct Costs         =  Sum of all four per-quote cost fields, same month
Gross Profit         =  Revenue – Direct Costs
Admin Expenses       =  Sum of monthly_admin_expenses, same month
─────────────────────────────────────
NET PROFIT           =  Gross Profit – Admin Expenses
```

#### Example — May 2026 rollup

| Line | Amount |
|---|---|
| Revenue (15 LED + 2 Auto-Hood + 1 GSRTC + 3 Other Media) | ₹42,80,000 |
| Direct Costs | ₹31,15,000 |
| **Gross Profit** | **₹11,65,000 (27.2 %)** |
| Admin Expenses | ₹7,10,800 |
| **NET PROFIT** | **₹4,54,200 (10.6 %)** |

#### Example — Financial Year Year-to-Date (Apr + May)

| Line | Apr 26 | May 26 | YTD |
|---|---|---|---|
| Revenue | ₹38,40,000 | ₹42,80,000 | ₹81,20,000 |
| Direct Costs | ₹27,90,000 | ₹31,15,000 | ₹59,05,000 |
| Gross Profit | ₹10,50,000 | ₹11,65,000 | ₹22,15,000 |
| Admin Expenses | ₹6,65,300 | ₹7,10,800 | ₹13,76,100 |
| **NET PROFIT** | **₹3,84,700** | **₹4,54,200** | **₹8,38,900** |

Margin % = 10.3 %.

---

## 4. What the screens look like

Four pages live under the URL prefix `/pnl`. Only the owner role can navigate to them. The sidebar will show a "P&L" entry that's hidden for everyone else.

### Page 1 — `PnLLanding` (the landing page at `/pnl`)

The single number that matters, at the top:
- **This Month's Net Profit** (one big number)
- **YTD Net Profit** (smaller, below)
- Three buttons: [View Month Detail] · [View Quote P&L] · [Manage Admin Expenses]

### Page 2 — `PnLSummary` (month rollup at `/pnl/month/2026-05`)

Three sections:
1. **Revenue breakdown** — split by segment (Private LED / Govt Auto / Govt GSRTC / Private Other Media) with quote count.
2. **Direct costs breakdown** — split by cost type (media payout / production / partner commission / other).
3. **Top 5 margin deals** + **Bottom 3 (thin-margin or loss-making) deals**, with quote ref number and percent margin.

Clicking any quote row drills into Page 3.

### Page 3 — `QuotePnL` (data entry at `/pnl/quote/:id`)

This is where Accounts spends most of their time. One form per WON quote:

```
Quote: UA-2026-0042 · ENIL Radio · ABC Pvt Ltd
Status: WON · Won date: 12 May 2026
Total invoiced: ₹3,50,000
──────────────────────────────────────────
Media payout         [  2,10,000 ]
Production cost      [    15,000 ]
Partner commission   [    17,500 ]
Other direct cost    [     7,500 ]
──────────────────────────────────────────
Total cost:          ₹2,50,000
► Profit:            ₹1,00,000
► Margin:             28.57 %
──────────────────────────────────────────
Notes: [_______________________________]
Last edited: Brijesh · 14 May 2026 18:42 IST
                                    [Save]
```

Save creates an audit trail (who edited, what changed, when).

### Page 4 — `AdminExpenses` (ledger at `/pnl/admin-expenses`)

Two views, switchable:

- **Grid view** — months on top, expense categories on the side, totals at the bottom. Click any cell to edit.
- **Add Expense form** — pick FY, month, expense type from dropdown, enter amount, save.

---

## 5. Who sees what

| Role | Sees revenue? | Sees own incentive? | Sees team revenue? | Sees P&L? |
|---|---|---|---|---|
| **Owner** (Brijesh) | Yes | N/A | Yes | **Yes** (this module) |
| **Co-owner** | Yes | N/A | Yes | **Yes** |
| **Admin** (operational) | Yes | N/A | Yes | **No** |
| **Accounts** (Mehulbhai, Diya) | Yes | N/A | Yes | **No** (today's spec — see open question #1) |
| **Sales lead** | Team only | Yes | Team only | No |
| **Sales rep / Telecaller / Agency** | Own only | Yes | No | No |

---

## 6. Open questions for the Accounts team to decide

Before the developer writes the final spec + code, please answer these. Each one affects how the math + tax treatment works.

1. **Accounts visibility.** Today's plan keeps P&L owner-only. Mehulbhai needs to see at least *cost-side* numbers to do journal entries. Should Accounts get a read-only view of P&L (revenue + costs + profit) but no edit rights? Or full edit on costs?

2. **When do costs get entered?**
   - Option A: Upfront estimate the moment a quote goes WON (we book the planned cost).
   - Option B: Actuals only — Accounts enters the cost when the media owner's invoice physically arrives (could be 30-60 days after WON).
   - Mixed: estimate at WON, then update to actuals when invoice arrives.

3. **TDS treatment on Government revenue.**
   - Government deals lose 4% to TDS (2% Income Tax + 2% GST TDS) at source.
   - Should the P&L's "Revenue" number show **gross** (before TDS) or **net** (after TDS)?
   - This affects margin %. Gross gives industry-standard margin; net gives cash-realised margin.

4. **Refunds and cancellations.**
   - If a WON quote later gets cancelled and a refund is issued, how is it handled in P&L?
   - Reverse the quote_pnl row? Create a negative-profit "refund" line in monthly_admin_expenses? Neither is in the current spec — please advise.

5. **Year-end / FY boundary expenses.**
   - Annual insurance paid in March 2026 covers Apr 2026 – Mar 2027 (next FY).
   - Two options: (a) book the full amount in the month it was paid (cash basis); (b) split across 12 months (accrual basis).
   - Current spec assumes cash basis. Does this match the tax treatment we file?

6. **GST treatment of admin expenses.**
   - Rent, internet, electricity etc. have GST that we can claim as input credit.
   - Should `monthly_admin_expenses` track the **gross** amount (incl. GST) or **net** (excl. GST), with a separate `gst_input_credit` column?
   - Currently the spec is single-amount only. Please specify what's right for filing.

7. **Multi-currency.**
   - Currently no foreign currency support. If we ever bill a US client in USD, costs in INR — how should P&L convert?
   - Out of scope for v1 unless Accounts confirms it's coming.

8. **Audit trail retention.**
   - Every edit is logged (who, what, when) to a permanent table called `audit_log`.
   - Retention period? 3 years? 7 years (Income Tax Act)? Forever?

9. **Bank-charge categorisation.**
   - Should bank charges split into `BANK_CHARGES` (current account fees) and `INTEREST_EXPENSE` (any loan interest)?
   - Currently lumped together.

10. **Owner draw / dividend.**
    - Owner takes monthly drawings from the business. Should this be a separate expense type (`OWNER_DRAW`) or kept outside P&L entirely (cash flow only)?
    - Tax treatment differs — please advise.

---

## 7. What we want the Accounts team to deliver

After reading this brief, please write a follow-up document covering:

- **Mapping table:** which line in this P&L module maps to which row in Tally / GoGSTBill / GST returns / Income Tax filings.
- **Sign-off on the 10 open questions** above. One line per question is enough.
- **Any missing fields.** If a row needs `HSN/SAC`, `TDS section`, `vendor PAN`, or anything else for compliance, list it now so we can add it to the spec.
- **Approval flow for high-value costs.** Should any cost above ₹X require sign-off (you or Brijesh) before saving? If yes, what's X?
- **Reporting cadence.** Do you need a monthly export to Excel/PDF? Quarterly? For GST filing dates?

Once we have your answers, the developer writes the final spec + builds the four pages + two tables in roughly one working week.

---

**Contact:** Brijesh Solanki · untitledadvertising@gmail.com
**Software branch:** `untitled-os` (staging, not yet on live production)
**Estimated build time after sign-off:** 5 working days
