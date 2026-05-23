# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# ─── Phase 76.2.2 audit close (item 7.4) ──────────────────────────
# Capacitor + custom plugin keep rules. ACTIVE the moment
# `minifyEnabled true` is flipped on `buildTypes.release`. Today
# minify is OFF (item 2.3) — rules sit inert until enabled. Without
# these, R8 strips classes that Capacitor's plugin loader reaches
# via reflection (@CapacitorPlugin annotation) and the APK crashes
# at runtime with "Plugin <name> not loaded".

# Keep all classes in our own package — TrackingPlugin, CallLogPlugin,
# MainActivity. Capacitor scans for @CapacitorPlugin via reflection.
-keep class in.untitledad.app.** { *; }

# Keep all Capacitor framework classes + JS-bridge entry points.
-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.** { *; }
-keep class com.equimaps.capacitor_background_geolocation.** { *; }

# @CapacitorPlugin and @PluginMethod annotations — needed for
# reflective plugin discovery at app startup.
-keep @com.getcapacitor.annotation.CapacitorPlugin class *
-keepclassmembers class * extends com.getcapacitor.Plugin {
  @com.getcapacitor.annotation.PluginMethod public *;
  @com.getcapacitor.annotation.PermissionCallback private *;
}

# Plugin event listeners (JS subscribes via addListener — handler
# names reach Java via string lookup, can't be obfuscated).
-keepclassmembers class * extends com.getcapacitor.Plugin {
  public void load();
  protected void handleOnDestroy();
}

# Firebase Messaging — auto-handled by firebase-messaging consumer
# rules, but pin explicitly so future SDK updates don't drift.
-keep class com.google.firebase.messaging.** { *; }
-keep class com.google.android.gms.measurement.** { *; }

# WebView JS interface guard (template hint — currently no Java→JS
# @JavascriptInterface bridges defined; Capacitor handles its own
# bridge).
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Line numbers in stack traces for crash reporting.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Strip Android log calls in release (saves ~30KB + hides debug
# spew if APK is ever decompiled). Optional — currently OFF to
# preserve UntitledTracking logcat output during Dhara/Rima debug.
#-assumenosideeffects class android.util.Log {
#  public static *** d(...);
#  public static *** v(...);
#}
