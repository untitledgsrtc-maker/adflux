---
name: project-android-signing-key-parked
description: Android debug signing key was only on the old (now gone) iMac; new APK build is parked until a key copy is found or reps reinstall once
metadata:
  node_type: memory
  type: project
  originSessionId: 56c4050e-f7d2-46c6-83eb-d42732cf2fd9
  modified: 2026-10-13T08:36:24.587Z
---

The reps' installed Android app (APK 96019, in.untitledad.app) is signed with `~/.android/debug.keystore` from the old iMac (cert SHA-256 15d785ae...2fe6). That iMac no longer exists and no copy was found on the new MacBook Air or in iCloud Documents. Parked by owner on 2026-10-13.

**Why:** Phones refuse an update signed with a different key, so a new APK would force every rep to uninstall and reinstall once.

**How to apply:** Web changes never need an APK (app loads https://app.untitledad.in live). Only native shell changes do. If a native change comes up, ask the owner for a Time Machine/other-Mac copy of `.android/debug.keystore` first; otherwise plan a one-time reinstall with a proper release key. Do not open or read keystores in other projects (Influancers, Campaign) - owner said those are different apps.

New Mac setup done 2026-10-13: Node 24 in ~/.local/node, gh + supabase CLI in ~/.local/bin, GitHub and Supabase CLI signed in. Owner wants me to commit, push and run SQL myself, asking only before destructive SQL or for logins.
