# Sales Head — MANAGER (write) module (spec, 2026-08-07)

Owner-approved 2026-08-07. Evolves the shipped **read-only** Sales Head
(`docs/SALES_HEAD_SPEC.md`, v1 — a `can_view_team_dashboard` watcher) into a real
**working manager** with write powers, a team cockpit, and approvals. Jayna is the
first Sales Head; she stays a **telecaller** and keeps her own queue + target +
incentive (player-coach) — the manager layer is ADDITIVE on top.

---

## 1 · Powers matrix (decided)

**CAN — whole team, WITH WRITE:**
- **Edit any rep's quote** (draft / sent / negotiating). NOT a won/locked quote —
  respects the existing locked-proposal (§9/§20) + active-quote (§11b) + won guards;
  a Sales Head is NOT exempt.
- **Reassign / balance leads** — any rep → any rep.
- **Reply in any rep's WhatsApp chat** — send on any thread (v1 already lets her READ
  all threads).
- **Per-rep performance view** — the new Team cockpit.
- **Approve**: leaves · TA/DA claims · **quote discounts (NEW gate)** for her team.
- **Keeps her own telecaller work** — /telecaller, personal leads/calls, target,
  incentive — all unchanged.

**CANNOT — admin/owner only (the boundary, hard-enforced):**
- **Finance / P&L** (`/finance`).
- **Salary / HR / incentive rates** (`/people` salary, `/hr`, incentive setup).
- **Master config** (`/master` — companies, GSTIN/bank, media types, signers, templates).
- **Record / approve CLIENT payments** (money-IN). *(She DOES approve TA money-OUT —
  that's an operational reimbursement sign-off, NOT the client-payment revenue gate.)*

---

## 2 · The grant (architecture)

- **New reusable flag `users.is_sales_head boolean DEFAULT false`** — distinct from
  `can_view_team_dashboard` (which stays the pure read-only viewer). Reusable: any user
  → Sales Head with one UPDATE. **Additive** — sits on top of the base role; Jayna stays
  `telecaller` (keeps her rep experience + incentive math untouched — no base-role change).
- **`public.is_sales_head()`** DEFINER helper (mirrors `is_team_viewer()`), **fail-closed
  on NULL** (`COALESCE(...,false)`).
- A Sales Head **implies** the v1 read-only team visibility (so `is_sales_head()` grants
  the reads too — or set both flags on the user). Reads keep flowing through the existing
  `team_all_leads` / `team_all_quotes` / `team_all_followups` / `team_dashboard_bundle`
  RPCs (widen their gate to `is_team_viewer() OR is_sales_head()`).

---

## 3 · Delivery — safe, no admin-surface leak (the §84/§150 lesson)

- **Writes go through gated SECURITY DEFINER RPCs** that check `is_sales_head()` — the
  SAME pattern as the v1 read RPCs + the §100.A `reassign_lead` RPC. **NOT broad RLS
  write policies** on `leads`/`quotes` (broad write RLS over-grants + risks the frozen
  rep flows app-wide — the exact §84 leads-doctrine trap).
- **Boundary = three layers** (matches §84/§152): (a) no nav entry to the blocked
  surfaces, (b) route-guard bounce, (c) no admin RLS + no admin RPC gate includes
  `is_sales_head`. She literally has no path to finance/salary/master/client-payments.
- **Frozen files** (LeadsV2, QuotesV2, FollowUpsV2, CampaignInboxV2, CreateQuote*V2,
  ReassignModal): every write control gated `isSalesHead` **ALONGSIDE** `isPrivileged`
  (never replacing it). **sales-module-guardian PASS required per touched file** (§28).

---

## 4 · Phases (ship one at a time — §3 module-not-patch)

### P1 — write on what she already watches (most daily value, smallest build)
1. **Reassign leads** — she's already in the LeadsV2 team view (v1). Extend the §100.A
   `reassign_lead` / `reassign_leads_bulk` role gate to admit `is_sales_head()`
   (any-rep → any-rep; keep the lane/stage guards). Unlock the reassign controls in
   LeadsV2 + ReassignModal for a Sales Head.
2. **Edit any quote** — a gated `sales_head_can_edit_quote` path: unlock the Edit button
   on the QuotesV2 team view; the quote wizards (CreateQuote*V2) accept a Sales-Head
   editor for a cross-owner quote UPDATE. Respect locked/won guards. Cross-owner update
   via a DEFINER RPC (RLS keeps quotes `created_by`-scoped for reps).
3. **Reply in any chat** — CampaignInboxV2: widen the send/compose + template gate from
   `isPrivileged` to include `is_sales_head` (v1 already gives her read-all-threads;
   `api/wa/send` server-gate widened to allow a Sales Head on any thread).
- Guardian + security audits on all four frozen surfaces.

### P2 — Team cockpit (per-rep performance)
- New gated `sales_head_team_performance()` RPC + a manager view (new page or a
  Sales-Head section on /team-dashboard): per-rep **target vs actual** — calls, meetings,
  quotes sent, won ₹, collection %, follow-ups done, daily score. "Who's behind" highlight,
  sortable. Reuses `monthly_score` / `daily_performance` / existing team RPCs. **NO pay/
  incentive figures** (boundary). Visual companion when we design the layout.

### P3 — Approvals
- **Leaves** — extend `approve_leave` gate to `is_sales_head()`; a leave-approval queue
  scoped to her team.
- **TA/DA** — same for the TA claims queue.
- **Discount gate (NEW build)** — on quote save, if `offered_rate` < the standard/city
  rate, flag `quotes.discount_approval_status = 'pending'`; the rep sees "pending head
  approval"; the Sales Head gets a queue → approve/reject (a DEFINER RPC). Needs the
  column + the save-time flag + the approval RPC + the rep-side status surface.

---

## 5 · Open details (proposed — confirm at build)

- **Discount trigger** = `offered_rate` below the city/standard rate (ANY amount below).
  *Alt: below by more than X%. Owner to confirm.*
- **Team scope** = ALL sales + telecaller reps (no sub-teams / `manager_id` filtering).
  *Owner to confirm — if sub-teams later, scope by `manager_id` chain (§42).*

---

## 6 · Security / boundary contract (FREEZE)

- `is_sales_head()` fail-closed on NULL role (COALESCE → false).
- Sales Head gets **ZERO** of: finance RPCs, salary/incentive RPCs, master-table writes,
  client-payment approval. Three-layer enforce (nav-gate + route-guard + no-RLS/no-RPC-gate).
- Every frozen-file write gate adds `is_sales_head` **alongside** `isPrivileged` — never
  replaces it; **guardian PASS per file**.
- Quote edit obeys locked-proposal (§9/§20) + active-quote (§11b) + won guards — no
  Sales-Head exemption.
- She is **not** co_owner and **not** admin — do NOT add `is_sales_head` to any
  `*_admin_all` RLS policy (the §150/§152 leak class). Grant only via the specific
  gated RPCs listed per phase.

---

## 7 · Gates before EACH phase commit (§40)

- **sales-module-guardian** — the frozen files (write gates alongside isPrivileged, no
  frozen contract touched, no other nav change).
- **security-rls-auditor** — the new grant + RPCs: fail-closed on NULL, no admin-surface
  leak, cross-owner writes scoped correctly.
- **Adversarial verify** — can a Sales Head reach finance / salary / master / client-payment
  approve? (MUST be no.) Edit a WON/locked quote? (MUST be no.) Reassign/reply/approve
  outside her powers? NULL-role fail-closed?

## 8 · Owner action (per phase)

Run the phase's ONE SQL file, push (JS — reaches the APK on next open), Jayna refreshes.
No APK rebuild. The grant itself = one UPDATE: `users.is_sales_head = true` for Jayna
(and any future Sales Head).
