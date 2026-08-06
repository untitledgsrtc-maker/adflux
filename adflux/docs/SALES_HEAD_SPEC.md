# Sales Head — read-only whole-team visibility (spec, 2026-08-06)

Owner: build a "Sales Head" who sees EVERYTHING of sales + TC — leads, quotes,
follow-ups, GPS, **and chats** — read-only. Approved approach: **reuse the existing
`can_view_team_dashboard` flag** (rebrand "Sales Head"), don't add a DB role.

## Locked decisions
- **Read-only v1** (watch, not manage). No writes anywhere. Reassign/act = later.
- **Chats = the campaign WhatsApp inbox** (all reps' conversations). NOT the admin
  bot/broadcast/QR tabs — just the conversations.
- **Amounts visible** on quotes (she's a head).
- **Govt + Private both** — the team views are segment-blind; a head sees all.
- **One flag = the grant.** `users.can_view_team_dashboard=true`. UI label → "Sales Head".

## Current state (already live behind her flag — §84/§116/§141/§247/§269)
Jayna (telecaller, flag=true) ALREADY has read-only all-team: leads (`team_all_leads`),
quotes+amounts (`team_all_quotes`), follow-ups (`team_all_followups`), GPS + team
dashboard (`team_dashboard_bundle`), via gated `is_team_viewer()` DEFINER RPCs.
**The ONLY gap is chats.** (If she still sees "only mine" elsewhere → stale app bundle,
§269 — reinstall.)

## The build — team-chats read view (the one new piece)

### Inbox architecture (verified `CampaignInboxV2.jsx`)
- `isPrivileged = admin/co_owner/sales_manager`. `canInbox` also includes sales/tc/agency.
- `loadThreads`: `.from('whatsapp_conversations').select('*')`; **`if (!isPrivileged) q = q.eq('assigned_to', profile.id)`** (client backstop, §243). RLS: `wa_conv_admin` (all, admin) + `wa_conv_self_or_lead` (own, reps).
- `loadMsgs`: whatsapp_messages by conversation_id; RLS `wa_msg_admin` + `wa_msg_via_conv`.
- Writes: send/reassign/admin dropdowns all gated on `isPrivileged`.

### 1. SQL (one file `supabase_sales_head_team_chats.sql`)
Add read-only team visibility for a Sales Head:
- `wa_conv_team_viewer` — `FOR SELECT TO authenticated USING (public.is_team_viewer())`.
- `wa_msg_team_viewer` — `FOR SELECT ... USING (EXISTS(SELECT 1 FROM whatsapp_conversations c WHERE c.id = conversation_id) AND public.is_team_viewer())` (or mirror `wa_msg_via_conv`'s existing shape + is_team_viewer).
- **Why broad RLS is OK here (unlike the §84 leads-doctrine):** `whatsapp_conversations`/`whatsapp_messages` have a SINGLE rep-facing reader — the campaign inbox. The AI/webhook use the service role (RLS-exempt). So a broad `is_team_viewer()` SELECT is BOUNDED to the inbox surface — it can't leak app-wide the way a broad `leads` policy did (leads leak to /work, /leads, dashboards). Verify no other rep-facing page reads these tables before shipping.
- Idempotent (DROP POLICY IF EXISTS → CREATE), NOTIFY pgrst, VERIFY (policy count).

### 2. `CampaignInboxV2.jsx` (campaign page, NOT §28-frozen)
- `const isTeamViewer = profile?.can_view_team_dashboard === true`
- `const canSeeAll = isPrivileged || isTeamViewer` → use `canSeeAll` for the
  `loadThreads` filter (drop `.eq('assigned_to')` for her) + the realtime scope.
- **Keep every WRITE gated on `isPrivileged` ONLY** (send composer, reassign dropdown,
  admin team-filter). She is read-only: no send, no reassign. Add a "Read-only ·
  whole team" banner when `isTeamViewer && !isPrivileged`.
- The team-filter dropdown (§131, isPrivileged-gated) — widen to `canSeeAll` so she
  can filter by rep too (read-only, useful for a head). Optional.

### 3. Relabel (small)
Wherever the grant/role is shown, label a `can_view_team_dashboard` user "Sales Head".
(The People/Team edit UI where the flag is toggled, if any; else document that the
flag = Sales Head.) The nav "Team Live" (§269) stays; the Inbox tab (§112, reps see
Inbox-only) is already visible to her — it just needs the widened read-scope above.

## Gates before commit
- **security-rls-auditor** — the new RLS policies (broad SELECT + is_team_viewer,
  fail-closed on NULL role; confirm no app-wide leak — single-reader argument).
- **sales-module-guardian** — CampaignInboxV2 write-paths stay `isPrivileged`-only
  (she can't send/reassign); no frozen contract touched.
- Adversarial review: can a Sales Head SEND or reassign? (must be no); does she see
  ALL threads incl. govt? (yes, intended); NULL-role fail-closed on is_team_viewer().

## Owner action (when built)
Run the one SQL file, push (JS), Jayna reinstalls/refreshes → her inbox shows all
reps' chats, read-only. No new role, no APK.

## NOT in v1 (later, if owner asks)
- Write powers (reassign leads, reply in chats) — a separate decision.
- A true `sales_manager` role/module (manager dashboard) — bigger.
