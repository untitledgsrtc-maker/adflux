# Untitled Work for Windows

Tauri v2 program for the Work team's Windows PCs. Design: `_design_reference/work_windows_app_software_design.html`.
Plan + decisions: `docs/PLAN_creative_timeclock_structure.md` section 14. Database: `supabase_phase381_work_activity.sql`, `supabase_phase382_work_break_hours.sql`.

## What it does
- Sign in with the website email + password. Same timer as the website (`work_clock_start / stop`, `work_finish_part`).
- Records ONLY while a timer runs, the person is switched on in Team Work -> Activity, and consent is accepted:
  foreground program + window title + idle seconds (per minute) and a screenshot every N minutes (default 10).
- Idle question after N idle minutes (default 5): Yes / Break / Stop; no answer in 5 min = auto-stop at idle start.
- Tray icon, always-on-top timer widget, start with Windows, close = hide to tray.

## Build (GitHub Actions, unsigned)
`github-workflow/windows-agent.yml` (copy it to `.github/workflows/windows-agent.yml` at the REPO ROOT `Untitled/`; GitHub only reads it there and a normal OAuth push cannot create it without the `workflow` scope, so add it once via the GitHub website). Runs on `windows-latest`:
`npm install` -> `npx tauri icon app-icon.png` -> `npx tauri build` -> artifact `UntitledWork-Setup` (NSIS .exe).
Trigger: push touching `adflux/windows-agent/**`, or Actions -> Windows agent -> Run workflow.

## Install (per PC)
Run the .exe. Windows shows "Windows protected your PC" (unsigned): More info -> Run anyway. Sign in, accept the consent screen.

## Not in v0.1
Auto-update, offline screenshot queue (slices ARE queued), tray colour states, orphan screenshot file sweep.

## Files
- `src/main.js` - one bundle, three windows (`?view=main | widget | idle`); main = engine.
- `src-tauri/src/main.rs` - idle time, foreground window, screenshot (xcap), tray, autostart, window show/hide.
- `src/config.js` - public Supabase URL + anon key (RLS protects data).
