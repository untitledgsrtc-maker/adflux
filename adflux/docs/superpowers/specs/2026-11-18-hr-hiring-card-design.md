# HR hiring card — one path from offer to login (design)

Date: 18 Nov 2026 · Owner: Brijesh · Status: draft for owner approval (builder check done 19 Nov)

## Why

Owner: "offer sent first then add member, confusing two steps — she (HR) doesn't have a proper flow."

Today HR can hire through two unconnected screens:

1. **Offers / invites** (`SendOfferModal` → `hr_offers` row → candidate opens `/offer/:token`, fills PII, accepts).
2. **Add member** (`HRNewUserV2`) — HR re-types name, phone, salary, targets and creates the login, then is offered "Generate offer letter".

For Devang (joined 16 Nov) HR sent the offer, he accepted, then she created the login again by hand in Add member. An accepted offer already has a one-click **Convert to user** (`OfferDetailModal`, Phase 307) — HR never found it because it is buried inside the offer popup. Nothing asks the owner before a salary goes out.

## Goals

- ONE visible path per hire: **Offer drafted → Owner approves salary → Link sent → Candidate accepts → Login created → Onboarding started**.
- Every value is typed **once** (in the offer). The login is created from the offer data with one button.
- **No offer link can be sent until the owner approves the salary.** Owner can change the salary while approving.
- HR always sees what is waiting on whom: *Waiting for owner · Waiting for candidate · Ready to create login · Onboarding*.

## Non-goals

- Recruit (candidate list, resumes, calls) — unchanged except a "Start hire" button on a shortlisted candidate.
- Onboarding templates / timeline — unchanged; the hire just lands there.
- Leaves, TA claims, roster, attendance, Exit — not in this change (owner raised only the hire flow).
- Email delivery of offers — links are still shared on WhatsApp as today.

## Anti-goals (would make it a failure even if it works)

- HR typing salary / role / dates a second time anywhere.
- A login created for someone who has not accepted.
- An offer link reaching a candidate before the owner saw the salary.
- Breaking the 24 existing offers (20 converted, 4 accepted-not-converted on 18 Nov).

## Constraints

- Existing tables: `hr_offers` (status CHECK `draft, sent, filled, accepted, converted_to_user, cancelled`, has salary, position, joining date, designation_*, converted_user_id), `hr_candidates` (has `converted_user_id`), `admin_create_user` RPC, `create_onboarding_run` RPC.
- Public candidate form `/offer/:token` (`fetch_offer_by_token`, `submit_offer_acceptance`) is anon-callable on purpose (CLAUDE.md §603 list) — keep its contract.
- SQL idempotent + VERIFY block + `NOTIFY pgrst` (CLAUDE.md §8). Roles: admin = owner. No `owner` role.
- HR user role is `hr`; HR_NAV lives in V2AppShell (frozen → sales-module-guardian before commit).

## Approaches considered

- **A. One hiring card per person (CHOSEN by owner, 18 Nov).** A stepper card per offer showing the six steps; each step's button lives on the card; HR home shows the four waiting-on columns. Biggest change, removes the double entry and the "which screen first" question.
- B. Keep both screens, link them (approval gate + Add member pre-filled from accepted offer). Smaller, but HR still has to know the order — the actual complaint.
- C. Create the login first, offer after. Rejected: creates logins for people who may decline.

## Design (decided)

**Statuses.** Add `pending_approval` and `approved` to `hr_offers.status`:
`draft → pending_approval → approved → sent → filled → accepted → converted_to_user` (+ `cancelled`, and a `changes_requested`-style return to `draft` when the owner rejects). The 4 existing `accepted` and 20 `converted_to_user` rows are untouched (they predate approval).

**Approval gate (DB-enforced, not just UI).** Moving an offer to `sent` (and generating/sharing its token link) is refused unless the offer has been approved by an admin. Approval records `approved_by`, `approved_at`, and the approved salary; if salary/incentive fields change after approval, the offer drops back to `pending_approval`.

**Who approves (my call, from live data 19 Nov).** Role `admin` only (today: Brijesh, the sole active admin). `co_owner` (Vishal, government-scoped per CLAUDE.md §42) does NOT approve private salaries; `hr` (Riya) never approves. An offer drafted by an admin is approved on save (no self-approval round-trip).

**Login details live on the offer (OWNER DECISION 19 Nov).** Step 1 also captures what the login needs and today's one-click Convert does not carry: **manager** (`manager_id`), **segment** (PRIVATE / GOVERNMENT — replaces Convert's hardcoded PRIVATE), **TA / DA / Hotel / Other allowance switches**, and **daily targets** (calls / quotes / follow-ups, pre-filled from the designation defaults, editable). They are new nullable `hr_offers` columns; the owner sees them on the approval screen; they do NOT appear on the candidate's letter. Step 5 passes all of them through so "Create login" needs no typing.

**Link + edits (my call).** The public offer page (`fetch_offer_by_token`) refuses an offer that is still `draft` / `pending_approval` (shows "This offer is not ready yet") — the only change to the anon functions; acceptance (`submit_offer_acceptance`) refuses the same. HR's card hides the link until approved. From `sent` onward salary, incentive and the login-detail fields are LOCKED (DB-enforced); to change them HR cancels and creates a new offer, so a candidate can never sign one salary while the record holds another. Before `sent`, editing salary/incentive/login fields drops an approved offer back to `pending_approval`.

**Owner approval.**
- On "Send for approval", the owner (active admin users) gets a push "Offer needs your approval — <name> · <position> · Rs <salary>/month".
- The owner approves on a screen listing pending offers (reachable from the push and from the HR home "Waiting for owner" column). He can edit salary/incentive before approving, or send it back with a note.
- HR gets a push on approve / send-back.

**The hiring card** (one per `hr_offers` row), opened from HR home / Offers / a candidate:

```
Devang · Sales Head · joining 16 Nov                        [Cancel offer]
 (1) Offer drafted ✓  (2) Owner approval ●  (3) Link sent  (4) Accepted  (5) Login  (6) Onboarding
 Salary Rs 25,000 /month · Vadodara · manager —
 [ Next step button for the current step only ]
```

- Step 1: the existing offer form fields (from `SendOfferModal`) on the card.
- Step 2: "Send for approval" (HR) / Approve · Edit · Send back (owner).
- Step 3: "Copy link / Share on WhatsApp" — enabled only after approval (reuses today's link + WhatsApp share).
- Step 4: shows "Waiting for <name> to fill and accept" + resend; turns green on accept with the PDF link.
- Step 5: "Create login" — the existing one-click Convert (admin_create_user) using offer data; also sets salary profile + targets exactly as `HRNewUserV2` does today, and links `hr_candidates.converted_user_id` when the offer came from a candidate.
- Step 6: starts onboarding (`create_onboarding_run`) automatically on step 5 and links to the person's onboarding timeline.

**HR home.** The "2 · Hire" tile pair (Add member / Offers) becomes one "Hiring" tile with four counts: Waiting for owner · Waiting for candidate · Ready to create login · Onboarding. A shortlisted candidate in Recruit gets "Start hire" which opens a new card pre-filled with name/phone/email.

**Add member page** stays reachable for admin-only special cases (an account with no offer, e.g. a test or partner login) but is removed from the HR navigation and HR home so HR always hires through the card.

## Left to the builder

- Exact column names for approval fields and how "salary changed after approval" is detected (trigger vs RPC).
- Whether the card is a page (`/hr/hire/:offerId`) or a drawer over the Offers list — pick what reuses `OfferDetailModal` best.
- Push texts (plain, Gujarati optional), tag names, quiet-hours handling via the existing `enqueue_push` pattern.
- Backfill: nothing to migrate; old rows keep their status.
- Tests: rolled-back SQL tests as HR (cannot send unapproved, cannot approve) and as admin (can approve); live check of the card in the browser.
