# Adflux — Fresh Deploy Guide

Written for a non-developer. Copy-paste only. Budget **90 minutes** the first time, 60 if everything cooperates.

You're setting up a **completely new** version of the app. Your old Supabase data will not be touched (and per your instruction, doesn't need to be — it was test data).

## What you'll end up with

- A new Supabase project (empty database, filled with the fresh schema)
- A new GitHub repo containing the clean code
- A new Vercel deployment at whatever URL you pick
- An admin login: **admin@untitledad.in** / **Admin@9428**

## Before you start

You need accounts on three services (you already have all of these):

1. **Supabase** — https://supabase.com
2. **GitHub** — https://github.com
3. **Vercel** — https://vercel.com

Open all three in browser tabs. Stay logged in.

---

## Section 1 — Create a new Supabase project (10 min)

1. Supabase dashboard → top-left **"New project"**.
2. Fill in:
   - Name: `adflux`
   - Database password: pick a strong one (write it in your password manager — you will rarely use it)
   - Region: **Southeast Asia (Mumbai)** or closest to you
3. Click **Create new project**. Wait 2–3 minutes until the project status goes green ("Active").
4. Left menu → **Project Settings** → **API**. You'll see two values you need later — keep this tab open:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon public** key (a long string starting with `eyJ...`)

---

## Section 2 — Run the schema SQL (5 min)

1. Left menu → **SQL Editor** → **New query**.
2. Open `supabase_schema.sql` from this folder, copy everything.
3. Paste into the editor → click **Run**.
4. Expected result: "Success. No rows returned." and maybe a few NOTICEs. If you see a red error, screenshot it and send it to me.

---

## Section 3 — Create the admin login (10 min)

This happens in two steps because Supabase Auth and your `users` table are separate.

### Step 1 — Create the Auth user

1. Left menu → **Authentication** → **Users** → **Add user** button (top right) → **Create new user**.
2. Fill in:
   - Email: `admin@untitledad.in`
   - Password: `Admin@9428`
   - **Uncheck** "Auto Confirm User"? → Actually **leave it CHECKED** (so the user is auto-confirmed and can log in immediately)
3. Click **Create user**.
4. A row appears in the users list. Click it. Copy the **UID** value — it's a long string like `7a2f...`. You'll paste it in the next step.

### Step 2 — Turn off email confirmations

This keeps Supabase from emailing every user you create later.

1. Left menu → **Authentication** → **Providers** → scroll to **Email**.
2. Set **Confirm email** to **OFF**.
3. Click **Save**.

### Step 3 — Seed the admin row

1. Left menu → **SQL Editor** → **New query**.
2. Paste the snippet below, **replacing `PASTE-UUID-HERE`** with the UID you copied in Step 1:

```sql
INSERT INTO users (id, name, email, role, is_active)
VALUES (
  'PASTE-UUID-HERE',
  'Admin',
  'admin@untitledad.in',
  'admin',
  true
);
```

3. Click **Run**. Should say "Success. 1 row affected."

### Step 4 — Check it worked

- Left menu → **Table Editor** → **users** table.
- You should see exactly one row: Admin / admin@untitledad.in / admin / true.

---

## Section 4 — Put the code on GitHub (15 min)

### Option A — Brand new repo (recommended if you want a clean slate)

1. GitHub → top right **+** → **New repository**.
2. Name: `adflux` (or anything you want)
3. **Private** (internal app)
4. Do **NOT** tick "Add a README" or "Add a .gitignore" — we have those in the zip.
5. Click **Create repository**.
6. On the "Quick setup" page, click **"uploading an existing file"** link.
7. Open the `adflux` folder from this zip on your computer.
8. **Important — what to drag in:** select ALL files INSIDE the `adflux` folder (not the folder itself). On Windows: Ctrl+A. On Mac: Cmd+A. You should be uploading `src/`, `package.json`, `supabase_schema.sql`, `DEPLOY_GUIDE.md`, and the rest.
9. Drag them into the GitHub upload box.
10. Wait for all files to finish uploading (progress bar).
11. Scroll down → **Commit changes**.

### Option B — Reuse your existing repo

If you'd rather replace the code in your current repo:

1. GitHub → your existing adflux repo.
2. **Settings** → scroll to bottom → **Delete this repository** → type the repo name to confirm. (This is OK because your database data isn't in here.)
3. Start over from **Option A, step 1**.

---

## Section 5 — Deploy on Vercel (15 min)

1. https://vercel.com → dashboard → **Add New** → **Project**.
2. "Import Git Repository" — find your `adflux` repo → click **Import**.
3. Vercel auto-detects Vite. Settings should be:
   - **Framework Preset:** Vite
   - **Build Command:** `npm run build` (default)
   - **Output Directory:** `dist` (default)
4. Expand **Environment Variables**. Add these two (paste from the Supabase API page from Section 1):

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://YOUR-PROJECT.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `eyJ...` (long string) |

5. Click **Deploy**. Wait 2–3 minutes.
6. When the fireworks animation plays, you're live. Click **"Visit"** to open the app.

---

## Section 6 — First login & smoke test (10 min)

1. Open your new Vercel URL in an **incognito window**.
2. Log in as **admin@untitledad.in** / **Admin@9428**.
3. You should land on the Dashboard. All four KPI cards will read ₹0 — that's correct, the database is empty.
4. Left sidebar → **Cities** → click **Add City**. Create one test city so the quote wizard has something to pick from.
5. Left sidebar → **Team** → **Add Member** → create yourself a test sales user with a fake email and salary. Log out, log in as that user, confirm you can see the sales dashboard.
6. Log back in as admin → **Quotes** → **New Quote** → walk through the wizard end-to-end using the test city and test client data. The quote number should come out as `UA-2026-0001` (or whatever year it is).

If any of those steps break, screenshot the error and send it to me with which step number failed.

---

## Section 7 — If something goes wrong

### "Missing Supabase environment variables" on the live site
You forgot to paste the env vars in Vercel, or you pasted them in the wrong names. Go to Vercel → Project → Settings → Environment Variables. Make sure the names are EXACTLY `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. After fixing, go to Deployments → latest → ⋯ → **Redeploy**.

### Login "Invalid email or password"
Two common causes:
- You typed a different password than Admin@9428. Reset it in Supabase → Authentication → Users → click user → Reset password.
- The `users` table doesn't have a row with your Auth UUID. Re-run Section 3, Step 3 with the correct UUID.

### Dashboard is blank (white screen)
Open DevTools (right-click → Inspect) → Console tab. Copy the first red error and send it to me.

### Quote wizard shows no cities
You forgot to add a city in Section 6, step 4. Add one.

---

## Section 8 — Turning the URL into something usable

By default Vercel gives you a URL like `adflux-xyz123.vercel.app`. To use a prettier one:

- Keep it as-is if you're the only team using it.
- Or → Vercel → Project → **Settings** → **Domains** → add a domain like `app.untitledad.in`. You'll need DNS access with your registrar to add a CNAME record Vercel shows you.

That's outside the app itself — skip unless you want it.

---

## What I did NOT automate in this deploy

I want you to know what I left for you, so you don't expect magic:

- **Supabase email sender configuration** — if you want password-reset emails to come from your own domain, you'd set that up in Supabase → Authentication → SMTP Settings. Otherwise Supabase's default works fine for internal use.
- **WhatsApp sending integration** — the code has placeholders; actually sending via WhatsApp Business API or Twilio needs a paid account and API keys you don't have yet. The app will still let you export a PDF and manually attach it in WhatsApp.
- **Backups schedule** — Supabase Pro plan auto-backs-up daily. Free plan is point-in-time recovery only for 7 days. If you want guaranteed backups, upgrade to Pro when the app has real data.
- **Custom domain SSL** — Vercel handles this automatically IF you add a domain. But you have to add the domain first.

---

## When you're done

Reply in our chat with:

1. The new Vercel URL
2. Screenshot of the dashboard after first login
3. Whether any step above broke — and if so, which step number

I'll verify from there.
