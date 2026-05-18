# Capacitor Android build guide

**Phase 56 scaffold (18 May 2026).**
Wraps the existing React + Vite + Supabase app in a native Android
shell so reps get real background GPS, call-log capture, and PWA-free
push notifications. iOS follows from the same codebase.

---

## What's in the box (this commit)

- `@capacitor/core` + `@capacitor/cli` + `@capacitor/android` installed.
- 5 first-party plugins: `geolocation`, `push-notifications`,
  `preferences`, `splash-screen`, `status-bar`, `app`.
- `capacitor.config.json` — appId `in.untitledad.app`, app name
  "Untitled OS", web dir `dist/`.
- `android/` directory — full native Android project scaffold
  (Gradle, manifest, MainActivity, resources, splash).
- Manifest permissions for: GPS (fine, coarse, background, foreground
  service), call-log read, push notifications, network state.
- `.gitignore` extended to exclude Android build outputs + APK / AAB
  / keystore files.
- `package.json` scripts: `cap:sync`, `cap:open:android`,
  `cap:run:android`.

## What's NOT done yet (separate sprints)

- **Phase 56b** — Background GPS plugin (`@capacitor-community/background-geolocation`)
  wired to push `gps_pings` rows even when screen is off.
- **Phase 56c** — Call-log reader (custom Capacitor plugin OR community
  one) that fires after a call ends and patches `call_logs.duration_seconds`.
- **Phase 56d** — Firebase Cloud Messaging (FCM) setup + key wiring to
  replace PWA push for Android users.
- **Splash icon + app icon** — currently the default Capacitor icons.
  Drop `app-icon.png` (1024×1024) + `app-splash.png` (2732×2732) into
  `resources/` then run `npx capacitor-assets generate --android`.

---

## Build prerequisites (one-time on the build machine)

1. **JDK 21** — Android Gradle Plugin 8.x needs JDK 21. macOS:
   `brew install openjdk@21 && echo 'export JAVA_HOME=$(/usr/libexec/java_home -v 21)' >> ~/.zshrc`.
2. **Android Studio** — download from developer.android.com/studio.
   Open it once → install Android SDK Platform 34 + Build Tools 34.0.0.
3. **`ANDROID_HOME` env var** — usually `~/Library/Android/sdk`. Add
   to `~/.zshrc`: `export ANDROID_HOME=~/Library/Android/sdk`.
4. **A physical Android phone** (any Android 8+) OR an emulator created
   via Android Studio → Device Manager.

## Build a debug APK

```bash
# From repo root: adflux/
npm install                   # if not already
npm run cap:sync              # vite build + cap sync android
npm run cap:open:android      # opens Android Studio
```

In Android Studio:

1. Wait for Gradle sync (~2-3 min first run).
2. **Build → Make Project** (or ⌘F9).
3. **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
4. APK lands at `android/app/build/outputs/apk/debug/app-debug.apk`.
5. Transfer to phone (AirDrop / WhatsApp / USB) → tap to install.
   First time: phone prompts "Install unknown apps" — flip it ON
   for the source app (e.g. WhatsApp).

## Run directly on a connected phone

```bash
# Enable USB debugging on phone: Settings → About → tap Build Number 7×
# → Developer Options → USB Debugging ON. Plug into Mac.
npm run cap:run:android
```

Auto-builds, installs, launches.

## Live-reload mode (skip rebuilding for every web change)

Inside `capacitor.config.json`, uncomment the `server` block:

```json
"server": {
  "url": "https://app.untitledad.in",
  "cleartext": false,
  "androidScheme": "https"
}
```

Then `npm run cap:sync` and re-install. The APK now loads the web
bundle from the custom domain. Push a Vercel deploy → reps see the
new bundle on next app open. No APK redistribution needed unless
native code or permissions change.

**Pin to the bundled copy** before signing release builds — the
"server.url" mode requires a live network connection to start.

## Distribute (sideload — recommended for owner workflow)

Per CLAUDE.md §3 (modules-not-patches) and owner directive 18 May 2026,
the app is sideloaded — NOT published to Google Play Store. Reason:
Play Store flags `READ_CALL_LOG` permission and the review cycle is
slow + uncertain.

1. Build a **signed release** APK once the app is feature-complete:
   - Android Studio → Build → Generate Signed Bundle / APK → APK
   - Create a keystore (`untitled-os.jks`) — **store it OFF the repo**;
     losing it means new APK signature → reps must reinstall.
   - Keystore password — write it down in 1Password / Keychain.
2. Send the APK file via WhatsApp to each rep.
3. Rep opens the APK → Android prompts → installs.
4. Each rep does the one-time onboarding (Phase 56b adds an in-app
   walkthrough screen):
   - Allow location all the time
   - Allow call log
   - Allow notifications
   - Battery → set this app to **Unrestricted**

## Common pitfalls

- **`Gradle sync failed`** → wrong JDK. Run `./gradlew --version` in
  `android/`; if it complains, install JDK 21 + re-export JAVA_HOME.
- **`SDK location not found`** → Add `sdk.dir=/Users/<you>/Library/Android/sdk`
  to `android/local.properties` (this file is gitignored).
- **App opens to a white screen** → `npm run build` was skipped before
  `cap:sync`. Re-run `npm run cap:sync`.
- **Background GPS doesn't fire** → Samsung / Xiaomi battery saver.
  Phone settings → Battery → app → **Unrestricted**.
- **Call log empty** → READ_CALL_LOG permission denied. Settings →
  Apps → Untitled OS → Permissions → Call log → Allow.

## Versioning

`android/app/build.gradle` has `versionCode` (integer, every release
must bump) and `versionName` (string, human-readable e.g. "1.0.1").

```
versionCode 1
versionName "1.0.0"
```

Bump both for every signed release. Reps must reinstall when the
signature stays the same; Android refuses to install over a different
keystore signature, so the keystore is sacred.

## Adding more native plugins later

```bash
npm install @capacitor-community/background-geolocation
npx cap sync android
```

Then read the plugin's README for any AndroidManifest changes (most
add their own permissions automatically; some need an Activity entry).
