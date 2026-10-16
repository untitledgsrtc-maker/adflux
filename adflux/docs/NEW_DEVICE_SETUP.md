# New device / new folder setup (Untitled OS)

Goal: nothing important lives only on one computer. GitHub (`untitledgsrtc-maker/adflux`, branch `untitled-os`) holds the
code, every `.md` note, the Claude working rules and the saved Claude memory notes. This file is the checklist for a fresh Mac.

## 1. Get the code
```bash
git clone https://github.com/untitledgsrtc-maker/adflux.git
cd adflux
git checkout untitled-os
cd adflux            # the app is the inner adflux folder
npm install
npm run build        # must pass
```
(GitHub Desktop: File -> Clone Repository -> untitledgsrtc-maker/adflux, branch untitled-os.)

## 2. Restore the Claude workspace files (they sit OUTSIDE the app folder, so they are mirrored here)
Everything is in `docs/workspace-backup/` (see its README). Copy it up to the workspace folder that CONTAINS the cloned repo:
`CLAUDE.md`, `AGENTS.md`, the 3 other `.md` files, `.mcp.json`, and `.claude/` (agents, skills, settings, launch).
Then copy `docs/workspace-backup/memory/*.md` into `~/.claude/projects/<this-folder-path-with-dashes>/memory/`.
The app's own rules file `adflux/CLAUDE.md` is already in the repo and loads by itself.

## 3. Secrets (NEVER in git - get them again from the source)
| What | Where it lives | How to get it |
|---|---|---|
| `adflux/.env` (browser build): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_MAPTILER_KEY`, `VITE_GOOGLE_ROADS_KEY` | local file, git-ignored | Supabase project -> Settings -> API; the other two from the map / Google consoles; Vercel has the same values |
| Server keys for `api/*` (read by Vercel only): `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `CAMPAIGN_WA_TOKEN`, `TEAM_ASSISTANT_SECRET`, `AI_REPLY_SECRET`, `OPS_SYNC_SECRET`, `RESEND_API_KEY`, `RENDER_SECRET`, `META_LEADS_TOKEN`, ... | Vercel project `untitled-os` -> Settings -> Environment Variables | nothing to copy: they stay in Vercel |
| GitHub login | the Mac keychain / GitHub Desktop | sign in again (needs the `workflow` permission only to create files under `.github/workflows`; do that one through github.com) |
| Supabase CLI | `~/.supabase` | `supabase login`, then in `adflux/` run `supabase link --project-ref kompjctmisnitjpbjalh` |
| `gh` CLI | keychain | `gh auth login` |

## 4. Other tools
- Vercel deploys by itself from the `untitled-os` branch (no local step). Build is skipped for commits that touch only docs / SQL / `windows-agent` (see `vercel.json`).
- Windows installer: built by GitHub Actions (`.github/workflows/windows-agent.yml`, Actions tab -> Windows agent -> artifact). Needs no local Rust.
- SQL: run files from `adflux/*.sql` and `adflux/db/functions/*.sql` with `supabase db query --linked -f <file>`.

## 5. iCloud warning
If the project folder sits in iCloud Drive: keep `.git`, `node_modules` and `dist` OUT of the sync by renaming them to
`.git.nosync`, `node_modules.nosync`, `dist.nosync` and leaving a symlink with the old name
(`ln -s node_modules.nosync node_modules`). iCloud writing into `.git` left hundreds of broken temp files. A second Mac should
CLONE from GitHub, not reuse the iCloud copy of `.git`.
