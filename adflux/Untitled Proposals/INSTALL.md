# Install + Deploy Guide

End-to-end. Total time first run: about 60–90 min if Supabase + Vercel accounts are ready.

---

## 0. Prerequisites

Before you start, have these installed and signed in:

- **Node 20+** (`node -v` → v20.x or higher)
- **npm 10+** (ships with Node 20)
- **git** (for cloning + version control)
- **Supabase account** — free tier is fine. <https://supabase.com>
- **Vercel account** — free tier is fine. <https://vercel.com>
- **Authenticator app** on your phone — Google Authenticator, 1Password, Aegis, etc.
- **(Optional) Netlify account** if you'd rather host the static app there

You'll also need:

- The owner's Gmail (`untitledadvertising@gmail.com`) for the Supabase signup
- A scratch text file to paste API keys into — you'll generate ~6 of them

Open a terminal and `cd` into the project root (`untitled-proposals/`). Stay there — every command below assumes you're at the project root unless it says `cd <somewhere>`.

---

## 1. Create the Supabase project

1. Go to <https://supabase.com/dashboard> and click **New project**.
2. Fill in:
   - **Name:** `untitled-proposals`
   - **Database password:** generate a strong one and save it in your password manager
   - **Region:** `Mumbai (ap-south-1)` for Gujarat latency
   - **Pricing plan:** Free
3. Wait ~2 min for provisioning.
4. Once ready, you're in the project dashboard. Two pages you'll keep coming back to:
   - **Project Settings → API** — has your `Project URL` and three keys (`anon`, `service_role`, `JWT secret`)
   - **SQL Editor** — for running migrations

---

## 2. Run the database migrations

In the Supabase dashboard, open **SQL Editor → New query**.

Run these files **in order, one at a time**, by copy-pasting the contents and clicking **Run**:

```
db/001_core_tables.sql
db/002_masters.sql
db/003_proposals.sql
db/004_receipts.sql
db/005_pnl_and_audit.sql
db/006_rls_policies.sql
db/007_seed_data.sql
db/008_proposal_rpc.sql
db/009_receipt_rpc.sql
db/010_status_transitions.sql
db/011_auth_user_sync.sql
```

After each one: confirm "Success. No rows returned" (or similar). If any errors, **stop and read the error** before running the next file. Common gotchas:

- *"type X already exists"* — you re-ran a migration. Most are idempotent thanks to `do $$ begin if not exists ... end $$;` blocks. Safe to ignore.
- *"function NAME does not exist"* — you ran them out of order. Restart from 001.

After all 11 are green, run this sanity check in SQL Editor:

```sql
select count(*) as tables from pg_tables where schemaname = 'public';
-- expect: 19

select count(*) as functions from pg_proc p
  join pg_namespace n on p.pronamespace = n.oid
  where n.nspname = 'public';
-- expect: ~25 (includes triggers + RPCs + helpers)

select count(*) as gsrtc_stations from public.gsrtc_stations;
-- expect: 20

select count(*) as auto_districts from public.auto_districts;
-- expect: 33

select * from public.auto_rate_master where effective_to is null;
-- expect: 1 row, davp_per_rickshaw_rate = 825
```

If those look right, the schema is good.

---

## 3. Enable MFA in Supabase Auth

The P&L module requires TOTP. Turn it on:

1. **Authentication → Providers → Email** → confirm enabled.
2. **Authentication → Multi-Factor Authentication** → toggle **TOTP** on.
3. **Authentication → URL Configuration** → set:
   - **Site URL** = wherever you'll host the app (for now `http://localhost:5173`; update later)
   - **Redirect URLs** = add the deployed app URL once you have it

---

## 4. Create the owner user + promote to owner role

The app starts with no users. You need to create one for yourself (Brijesh) and promote it to `owner`.

1. **Authentication → Users → Add user → Create new user**
   - Email: `untitledadvertising@gmail.com`
   - Password: pick a strong one
   - **Auto-confirm user**: ✅ ON (skips email verification)
2. The migration 011 trigger auto-creates a `public.users` row with role `'user'`.
3. Promote yourself to owner. In **SQL Editor**:
   ```sql
   update public.users
     set role = 'owner', full_name = 'Brijesh Patel'
     where email = 'untitledadvertising@gmail.com';

   -- verify
   select id, email, full_name, role, totp_enrolled from public.users;
   ```
4. *(Optional)* Add Vishal as co_owner the same way:
   ```sql
   -- after Vishal signs up via the app or you create him in Auth UI
   update public.users set role = 'co_owner', full_name = 'Vishal …'
     where email = '<vishal-email>';
   ```

---

## 5. Configure the app

Get the keys from **Project Settings → API**:

- `Project URL` → goes into `VITE_SUPABASE_URL`
- `anon public` key → goes into `VITE_SUPABASE_ANON_KEY`
- `service_role` key → ⚠ **secret**, only used by `pdf-api/` (do not commit)

In a terminal:

```bash
cd app
cp .env.example .env.local
# Edit .env.local — fill in the two VITE_SUPABASE_* values.
# Leave VITE_PDF_API_URL blank for now (filled after step 7).
```

Install dependencies:

```bash
npm install
```

Run the app locally:

```bash
npm run dev
# opens http://localhost:5173
```

You should see the login page. Sign in as `untitledadvertising@gmail.com`.

You should land on the dashboard. Navigate to **Proposals → New** to confirm the wizard loads. **Don't try to save a proposal yet** — the PDF API isn't deployed.

If anything fails to load, open the browser console. Most "empty data" issues at this stage are RLS misconfiguration; double-check that step 4 set your role to `'owner'`.

---

## 6. Run unit tests + smoke tests

Sanity check before deploying:

```bash
# from project root
cd app && npm test           # → 77 tests pass
cd ../pdf-templates && node smoke-test.mjs   # → 7 templates pass
```

Both should be all green. If not, stop and investigate before deploying.

---

## 7. Deploy the PDF rendering API to Vercel

The PDF API is a separate Vercel project from the static app, because it needs Node + Puppeteer.

```bash
cd pdf-api
cp .env.example .env
# Edit .env — fill in:
#   SUPABASE_URL                = same as VITE_SUPABASE_URL
#   SUPABASE_ANON_KEY           = same as VITE_SUPABASE_ANON_KEY
#   SUPABASE_SERVICE_ROLE_KEY   = service_role key (SECRET)
#   BRAND_*                     = your real GSTIN, PAN, etc.
#   ALLOWED_ORIGINS             = https://your-app-domain.com (or * for now)
#   CRON_SECRET                 = any long random string (e.g. `openssl rand -hex 32`)
npm install
```

Install the Vercel CLI if you don't have it:

```bash
npm install -g vercel
vercel login    # opens browser, pick your account
```

Deploy (preview first, then prod):

```bash
npm run sync-templates    # copies pdf-templates/ → _templates/
vercel                    # preview deploy — answer prompts
```

When prompted:
- *Set up and deploy?* → `yes`
- *Which scope?* → your personal/team account
- *Link to existing project?* → `no`
- *Project name?* → `untitled-proposals-pdf-api`
- *Directory with code?* → `./` (you're already in pdf-api/)
- *Override settings?* → `no`

After preview deploy succeeds, copy the URL (e.g. `https://untitled-proposals-pdf-api.vercel.app`).

Now set the env vars on Vercel:

```bash
# easiest way — point Vercel at your local .env file
vercel env pull .env.production    # creates an empty file initially
# Then set each var manually via dashboard, OR:
for VAR in SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY \
           BRAND_NAME BRAND_NAME_GU BRAND_GSTIN BRAND_PAN BRAND_HSN \
           ALLOWED_ORIGINS CRON_SECRET; do
  vercel env add "$VAR" production
done
```

(Or in the Vercel dashboard: **Project → Settings → Environment Variables → Add**.)

Deploy to production:

```bash
npm run deploy            # = sync-templates + vercel --prod
```

Test the endpoints (won't render anything useful yet — no proposals exist — but confirms auth):

```bash
# Get a JWT for testing — open the app in a browser, sign in, then in
# devtools console run:
#   await (await window.fetch('https://YOUR-SUPABASE.supabase.co/auth/v1/user', {headers:{Authorization:`Bearer ${JSON.parse(localStorage.getItem('sb-YOUR-PROJECT-auth-token')).access_token}`}})).json()
# Or use Supabase's session inspector.

curl -X POST https://untitled-proposals-pdf-api.vercel.app/api/render-proposal \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"proposal_id":"00000000-0000-0000-0000-000000000000"}'
# Expected: 404 with {"error":"Proposal ... not found"} — confirms auth + routing work.
```

Now point the app at the API. Edit `app/.env.local`:

```
VITE_PDF_API_URL=https://untitled-proposals-pdf-api.vercel.app
```

Restart `npm run dev`.

---

## 8. Confirm the cron job is registered

After the production deploy, in the Vercel dashboard:

**Your project → Settings → Cron Jobs** — you should see one entry:

```
Path: /api/cron-expire-proposals
Schedule: 30 20 * * *  (daily at 20:30 UTC = 02:00 IST)
```

Trigger it once manually to verify (Vercel dashboard → click the cron entry → **Run**). Or hit it from your terminal with the secret:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://untitled-proposals-pdf-api.vercel.app/api/cron-expire-proposals
# Expected: {"ok":true,"expired_count":0,...}  (0 because no SENT proposals yet)
```

Owner can also trigger it from the **Admin** page in the app.

---

## 9. Deploy the static app

Two options. Pick one.

### Option A: Vercel (same account as the API)

```bash
cd app
vercel
# Project name: untitled-proposals-app
# Framework preset: Vite
# Build command: npm run build
# Output directory: dist
# Install command: npm install
# Add env vars (same as .env.local) via dashboard or `vercel env add`:
#   VITE_SUPABASE_URL
#   VITE_SUPABASE_ANON_KEY
#   VITE_PDF_API_URL
vercel --prod
```

### Option B: Netlify

```bash
cd app
npm install -g netlify-cli
netlify login
netlify init
# Build command: npm run build
# Publish directory: dist
netlify env:set VITE_SUPABASE_URL "https://YOUR.supabase.co"
netlify env:set VITE_SUPABASE_ANON_KEY "<anon key>"
netlify env:set VITE_PDF_API_URL "https://untitled-proposals-pdf-api.vercel.app"
netlify deploy --prod --build
```

After deploy, copy the URL (e.g. `https://untitled-proposals-app.vercel.app`).

Update **Supabase → Authentication → URL Configuration**:
- **Site URL** = your deployed app URL
- **Redirect URLs** = add it

Update **pdf-api → ALLOWED_ORIGINS** in Vercel env vars to match (or keep `*` for now).

---

## 10. First-time owner setup in the deployed app

1. Open the deployed app URL.
2. Sign in as `untitledadvertising@gmail.com`.
3. Click **P&L** in the sidebar.
4. The TOTP enrollment screen appears. Open your authenticator app, scan the QR (or paste the secret manually). Enter the first 6-digit code → **Confirm + activate**.
5. You're now in the P&L tabs view. Verify:
   - **Summary** tab loads (will be empty — no WON proposals yet)
   - **Per proposal** tab loads (empty)
   - **Admin expenses** tab loads (empty) and `+ Add expense` opens the modal
   - **Access log** tab loads — should show your VIEW_SUMMARY entry from a moment ago

---

## 11. End-to-end verification

Run through one full happy path to confirm everything's wired:

1. **Clients** → check the page loads (empty list)
2. **Proposals → New**:
   - Step 1: pick a client (use **+ Add new client** if needed). Pick AUTO + DAVP.
   - Step 2: enter subjects + a proposal date.
   - Step 3: **+ Add all (33)** — should add all districts at ₹825/rickshaw.
   - Step 4: leave defaults (18% GST, no discount).
   - Step 5: pick the seeded signer (Brijesh Patel).
   - Step 6: click **Save as DRAFT**.
3. On the proposal detail page:
   - Click **Proposal PDF** → downloads the PDF. Open it. Verify Gujarati text renders correctly (conjuncts like ક્ષ, ર્ડ should display, not show empty boxes).
   - Click **Mark sent** → pick EMAIL → confirm.
   - Click **Mark won (PO received)** → fill PO number / date / amount / paste a Drive URL → confirm.
   - Click **+ Receipt** → enter a gross amount → save.
   - Click **Settlement PDF** → downloads.
4. **Payments** page → see the receipt you just added.
5. **P&L → Per proposal** → should now show one WON proposal. Click it. Edit costs. Save. The business profit updates.
6. **P&L → Summary** → see the FY total reflect what you just entered.

If all of that works, you're shipped.

---

## 12. Operations + troubleshooting

### Backups

Supabase free tier does daily backups (kept 7 days). For longer retention, use the dashboard **Database → Backups** to download manually before any risky migration.

To export all your business data on demand:
```sql
copy public.proposals to '/tmp/proposals.csv' csv header;
copy public.proposal_receipts to '/tmp/receipts.csv' csv header;
-- etc — or use Supabase's CSV export from the table view
```

### "I broke RLS — empty page everywhere"

Most likely the `public.users` row for your account has the wrong role or `is_active = false`. In SQL Editor:

```sql
select id, email, role, is_active from public.users;
update public.users set role = 'owner', is_active = true where email = '<your-email>';
```

### "PDF download fails with 401"

JWT expired. Sign out and back in. If it persists, check `VITE_PDF_API_URL` in the deployed app matches the actual Vercel URL of the API.

### "Gujarati text shows empty boxes in PDF"

This means `document.fonts.ready` didn't resolve before the snapshot. Check the API logs in Vercel — `[render-proposal] error:` lines. Usually a network issue fetching Google Fonts. Re-deploy.

### "I want to add another co_owner"

```sql
-- after they sign up via the app
update public.users set role = 'co_owner' where email = '<their-email>';
```

### "The cron didn't run"

Check Vercel **Project → Logs** for the `/api/cron-expire-proposals` function. Common causes:
- `CRON_SECRET` mismatch between the env var and the cron config (Vercel's auto-bearer)
- Function timed out (raise `maxDuration` in `vercel.json`)

### "I want to reset everything and start over"

In SQL Editor:
```sql
-- nukes all business data, leaves schema + users intact
truncate
  public.proposal_receipts,
  public.proposal_line_items,
  public.proposal_versions,
  public.proposal_attachments,
  public.proposal_followups,
  public.proposal_pnl,
  public.audit_log,
  public.pnl_access_log,
  public.proposals,
  public.ref_no_counters
  cascade;
```

To nuke schema + data and start from migration 001 again, drop the public schema and re-run all migrations:
```sql
drop schema public cascade;
create schema public;
grant usage on schema public to anon, authenticated, service_role;
```

---

## 13. What's NOT yet built

These are deliberate gaps, listed so you know to expect them:

- **No file upload** — `office_copy_url` and `po_file_url` are pasted Drive links. If you want native upload to Supabase Storage, build a small uploader.
- **No Tax Invoice generation** — the receipt PDF is a Receipt Voucher (Rule 50 CGST). Tax invoices are issued separately by your CA, as designed.
- **No user invitation UI** — to add a new user, do it via Supabase's Auth dashboard (or build the Admin → Users page).
- **No recovery codes for TOTP** — if Brijesh loses his phone, owner must run `update public.users set totp_enrolled = false` + `delete from auth.mfa_factors where user_id = ...` in SQL, then re-enroll.
- **No proposal-list filters** — there's a list but only basic. Add filters when you have enough proposals to need them.
- **No email/SMS notifications** — receipts and proposal status changes don't notify clients. Add via Supabase Functions if/when needed.

---

## 14. Where to look when something breaks

| Symptom | Where to look first |
| --- | --- |
| Login fails | Supabase **Authentication → Users** — confirm user exists + is_confirmed |
| Empty pages, no errors | `public.users` row missing or wrong role; or RLS misconfigured |
| RPC returns "forbidden" | Same as above — check `select role from public.users where id = auth.uid()` |
| PDF generation hangs | Vercel function logs; usually Puppeteer cold-start (15+ s) |
| Gujarati shaping wrong | `pdf-poc/render-local.mjs` — re-run locally to compare |
| Math doesn't match preview | `app/src/lib/calc.test.js` — boundary cases (e.g. 1.005 round) |
| Cron not firing | Vercel **Settings → Cron Jobs** + function logs |
| Migration fails | Run `db/001..011` in order in SQL Editor; read the error |

That's it. You're shipped.
