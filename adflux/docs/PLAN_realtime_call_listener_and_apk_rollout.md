# Job: real-time call listener + one clean APK rollout (2026-07-14)

**Why this exists:** CLAUDE.md §92 — capturing calls by reading the device call
log + trusting the OEM `TYPE` integer is fragile (broke on every new phone brand →
~8 patches). This job replaces that with an OEM-independent real-time listener and
gets ONE current APK onto every phone, which also makes the GPS-off + internet-off
logs actually run. After this, no more per-phone call patches.

**Shape:** one native build → device-test on one phone → fleet rollout via the
in-app updater. Owner runs the build/upload/install steps; I write the code.

---

## Part A — Real-time incoming-call listener (native, the core)

**Goal:** capture every incoming call the moment it happens, independent of how the
brand logs it afterward.

**Mechanism:** a manifest-registered `PHONE_STATE` BroadcastReceiver (fires even when
the app is backgrounded) inside the existing tracking plugin, reading call state:
- `RINGING` (with incoming number) → an incoming call started. Remember start + number.
- `OFFHOOK` after a RINGING → the incoming was **answered**. Remember answer time.
- `IDLE` → call ended:
  - RINGING → IDLE, never OFFHOOK → **missed** incoming.
  - RINGING → OFFHOOK → IDLE → **answered** incoming; duration = IDLE − OFFHOOK.
  - OFFHOOK with NO prior RINGING = an outgoing dial → **ignore** (outgoing already
    captured via the in-app "Call" tap; avoids double).

**Write path:** fire a Capacitor event → JS inserts into `call_logs`
(`direction='incoming'`, real computed duration) through the SAME insert + dedup as
today, so it merges with any call-log-read rows during the transition (no doubles).
Reuse the §173 direction-aware + §220 same-physical-call guards.

**Permissions to re-add** (were removed Phase 76.2.2):
- `READ_PHONE_STATE` — to get call state.
- `READ_PHONE_NUMBERS` — likely needed for the incoming number on Android 11+ (test).
- `READ_CALL_LOG` — already present (needed for the number on Android 9+).
- All fine — the app sideloads (§38/§50), no Play Store permission review.

**Files (mine):** `TrackingPlugin.java` (or a new `CallStateReceiver.java`),
`AndroidManifest.xml` (permission + `<receiver>` for `android.intent.action.PHONE_STATE`),
`src/utils/nativeTracking.js` (a `callDetected` handler → `call_logs` insert),
version bump in `build.gradle`.

**Supersedes:** the type patches Phase 220 / 227 / 227.1 (they stay as a harmless
stopgap until the listener is proven on the fleet, then they're moot — do NOT extend
them, §92).

**Risks:**
- Incoming-number redaction on newer Android → mitigate with `READ_PHONE_NUMBERS`;
  worst case the row records with no number (still counts the call) → verify on device.
- Force-stopped app → receiver won't fire (already surfaced via §76.2 force-stop log).
- Dedup during transition: listener row + a recognized-type call-log row for the same
  call must merge (§220 exact-`call_at` guard) — verify no double on a test call.

---

## Part B — One clean APK build + fleet rollout (the foundation, §74/§76/§81)

**Goal:** get the current native code (this listener + the GPS/network watchers +
the in-app updater) onto EVERY rep's phone, and fix the stuck rollout (§81).

**Steps (owner runs, I provide the exact commands + the app_version SQL):**
1. Version bump (I do in code — e.g. 96018).
2. Clean build (§74.2 — iCloud `" 2"` dup cleanup first):
   ```
   find android -name "* 2.dex" -o -name "* 2.apk" -o -name "* 2.json" -delete
   npm run build && npx cap sync android
   cd android && ./gradlew clean assembleDebug
   ```
3. **Upload the signed APK to the Supabase `apk` bucket as `untitled-os.apk`** — the
   §76 `/api/apk` proxy serves it with the right content-type. (This upload is the
   §81 blocker that was likely skipped before — it's the whole point of this part.)
4. I publish an `app_version` row (new versionCode + `apk_url`) → the in-app
   "Update available" banner (§74/§180) prompts every rep.
5. **Device-test on ONE phone first (§39 — native = device test):** install, make a
   test incoming call → it records as incoming with a real duration; toggle GPS off →
   gps_off log; toggle internet off → network_off log; publish a dummy version → the
   updater banner installs it. Retire the dummy row.
6. Only then → fleet: reps tap "Update available" → 2-tap install.

**Risks (§39/§81):** debug-signature must match the installed app or it won't install
over it (§74.2 — assembleDebug, debug keystore). If reps are on very old builds, the
first update may need a one-time manual install; after that the in-app updater carries
every future release.

---

## Part C — Surface the internet-off log (JS, ships alongside — quick)

The capture already exists (§76.1/§76.2 `network_off_events` + the native watcher +
it's in the day-summary). Missing: it's not SHOWN like GPS-off. I surface
`network_off_events` in `GpsTrackV2` (day-track timeline) + `TeamDashboardV2`,
mirroring `gps_off_events` exactly. Pure JS (live-update, no rebuild) — but it only
shows data once Part B's APK (with the watcher) is on a phone.

---

## Order of execution
1. **Part C first** (JS, instant) — surfaces the internet-off log; no rebuild.
2. **Part A** — write the real-time listener (native).
3. **Part B** — one clean APK build + upload + device-test + fleet rollout.
4. **CLAUDE.md update (§93)** — record what shipped, what's now frozen, foot-guns.

## Who does what
- **Me:** all code (native + JS), the app_version SQL, the exact build commands, the
  device-test checklist, guardian/audit passes, the CLAUDE.md entry.
- **Owner:** run the build + APK upload + the one-phone device test + trigger the
  fleet rollout (the parts only reachable from your Mac + a physical phone).

## Definition of done
- A real incoming call on ANY phone brand records as `incoming` with a real duration,
  with zero per-phone type code.
- GPS-off + internet-off logs visible in the rep activity / day-track.
- The current APK is on the whole team via the in-app updater.
- CLAUDE.md updated.
