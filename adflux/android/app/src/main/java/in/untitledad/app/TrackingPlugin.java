package in.untitledad.app;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import java.io.File;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Phase 76.2 — UntitledTracking native plugin.
 * Phase 76.2.2 — Tier A + B fixes applied 23 May 2026 evening:
 *   - RECEIVER_EXPORTED for system broadcasts (was NOT_EXPORTED,
 *     blocked LOCATION_MODE_CHANGED on Android 14).
 *   - registerDefaultNetworkCallback (was empty NetworkRequest,
 *     didn't fire on actual user-perceived connectivity changes).
 *   - Null guards on getContext() across load path.
 *   - Logcat instrumentation under tag 'UntitledTracking'.
 *   - Heartbeat ALSO bumped from MainActivity.onResume so JS-side
 *     setInterval pausing on background no longer falsely triggers
 *     force_stop on next foreground.
 *
 * Owner directive 22 May 2026: surface 3 events that the web bundle
 * alone cannot see on Android —
 *   1. gps_off  — Location services toggled off in OS settings
 *   2. network_off — connectivity lost (no Wi-Fi + no mobile data)
 *   3. force_stop — app killed during work hours (detected on
 *      relaunch via a heartbeat gap)
 *
 * JS subscribes via the Capacitor plugin events. JS does the
 * Supabase writes (Phase 76.1 tables). Native side does NOT hold
 * Supabase credentials.
 */
@CapacitorPlugin(name = "UntitledTracking")
public class TrackingPlugin extends Plugin {

    private static final String TAG = "UntitledTracking";
    private static final String PREF_FILE = "untitled_tracking";
    private static final String PREF_LAST_HEARTBEAT = "last_heartbeat_ms";
    private static final long FORCE_STOP_THRESHOLD_MS = 5L * 60L * 1000L;

    private BroadcastReceiver gpsReceiver;
    private ConnectivityManager.NetworkCallback networkCallback;
    // Phase 76.2.2 audit fix — track last-emitted online state so
    // onCapabilitiesChanged only fires the event on actual flips,
    // not on every Wi-Fi RSSI tick or captive-portal probe. Boxed
    // Boolean so the first event after load() always emits.
    private Boolean lastEmittedOnline = null;

    @Override
    public void load() {
        super.load();
        Log.d(TAG, "load() called");
        Context ctx = getContext();
        if (ctx == null) {
            Log.e(TAG, "getContext() returned null at load() — aborting plugin init");
            return;
        }
        registerGpsToggleReceiver(ctx);
        registerNetworkWatcher(ctx);
        checkForceStopOnLaunch(ctx);
        Log.d(TAG, "load() complete — receivers + callback active");
    }

    @Override
    protected void handleOnDestroy() {
        Log.d(TAG, "handleOnDestroy() — unregistering receivers");
        unregisterReceivers();
        super.handleOnDestroy();
    }

    // Phase 76.2.2 — Activity-lifecycle hook so MainActivity can
    // bump the heartbeat on every onResume. JS setInterval pauses
    // when the WebView is backgrounded; this Java bump survives
    // background. Called from MainActivity.onResume.
    public static void bumpHeartbeatFromActivity(Context ctx) {
        if (ctx == null) return;
        try {
            SharedPreferences prefs = ctx.getSharedPreferences(PREF_FILE, Context.MODE_PRIVATE);
            prefs.edit().putLong(PREF_LAST_HEARTBEAT, System.currentTimeMillis()).apply();
            Log.d(TAG, "heartbeat bumped (Activity)");
        } catch (Throwable t) {
            Log.w(TAG, "Activity heartbeat bump failed: " + t.getMessage());
        }
    }

    // ─── 1. GPS toggle ──────────────────────────────────────────
    // Listens for LocationManager.MODE_CHANGED_ACTION. Fires
    // 'gpsStateChanged' event with { enabled: boolean, atMs: long }.
    private void registerGpsToggleReceiver(Context ctx) {
        gpsReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (!LocationManager.MODE_CHANGED_ACTION.equals(intent.getAction())) {
                    Log.d(TAG, "ignoring non-MODE_CHANGED action: " + intent.getAction());
                    return;
                }
                LocationManager lm = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
                boolean enabled = false;
                try {
                    enabled = lm != null && (
                        lm.isProviderEnabled(LocationManager.GPS_PROVIDER)
                        || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER));
                } catch (Throwable t) {
                    Log.w(TAG, "isProviderEnabled threw: " + t.getMessage());
                }
                Log.d(TAG, "gpsStateChanged enabled=" + enabled);
                JSObject payload = new JSObject();
                payload.put("enabled", enabled);
                payload.put("atMs", System.currentTimeMillis());
                notifyListeners("gpsStateChanged", payload);
            }
        };
        IntentFilter filter = new IntentFilter(LocationManager.MODE_CHANGED_ACTION);
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                // Phase 76.2.2 — system broadcasts require EXPORTED on
                // Android 13+. NOT_EXPORTED silently drops the
                // delivery on Android 14 (some OEMs).
                ctx.registerReceiver(gpsReceiver, filter, Context.RECEIVER_EXPORTED);
            } else {
                ctx.registerReceiver(gpsReceiver, filter);
            }
            Log.d(TAG, "gpsReceiver registered");
        } catch (Throwable t) {
            Log.e(TAG, "gpsReceiver register failed: " + t.getMessage());
        }
    }

    // ─── 2. Network watcher ─────────────────────────────────────
    // Fires 'networkStateChanged' with { online: boolean, atMs: long }.
    // Phase 76.2.2 — uses registerDefaultNetworkCallback so the
    // callback fires when the user's effective default network
    // changes (wifi → cellular → none), not for every transient
    // network the device sees.
    private void registerNetworkWatcher(Context ctx) {
        ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) {
            Log.w(TAG, "ConnectivityManager unavailable");
            return;
        }
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                emit(true);
            }

            @Override
            public void onLost(Network network) {
                emit(false);
            }

            @Override
            public void onCapabilitiesChanged(Network network, NetworkCapabilities caps) {
                // Edge case: capabilities lose VALIDATED (Wi-Fi
                // connected to a captive portal with no real
                // internet). Treat as offline.
                boolean validated = caps != null
                        && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
                emit(validated);
            }

            private synchronized void emit(boolean online) {
                // Phase 76.2.2 audit — flip-only emission. Wi-Fi
                // capability changes fire continuously during
                // normal operation; without this guard the JS shim
                // would write a network_off_events row on every
                // RSSI tick.
                if (lastEmittedOnline != null && lastEmittedOnline == online) {
                    return;
                }
                lastEmittedOnline = online;
                Log.d(TAG, "networkStateChanged online=" + online);
                JSObject payload = new JSObject();
                payload.put("online", online);
                payload.put("atMs", System.currentTimeMillis());
                notifyListeners("networkStateChanged", payload);
            }
        };
        try {
            if (Build.VERSION.SDK_INT >= 24) {
                cm.registerDefaultNetworkCallback(networkCallback);
                Log.d(TAG, "registerDefaultNetworkCallback OK");
            } else {
                NetworkRequest request = new NetworkRequest.Builder()
                        .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                        .build();
                cm.registerNetworkCallback(request, networkCallback);
                Log.d(TAG, "registerNetworkCallback (legacy) OK");
            }
        } catch (Throwable t) {
            Log.e(TAG, "registerNetworkCallback failed: " + t.getMessage());
        }
    }

    // ─── 3. Force-stop detection ────────────────────────────────
    // On plugin load, compare SharedPreferences last_heartbeat_ms
    // to now. Gap > FORCE_STOP_THRESHOLD = likely force-stop.
    // Fires 'forceStopDetected' once.
    private void checkForceStopOnLaunch(Context ctx) {
        try {
            SharedPreferences prefs = ctx.getSharedPreferences(PREF_FILE, Context.MODE_PRIVATE);
            long last = prefs.getLong(PREF_LAST_HEARTBEAT, 0L);
            long now = System.currentTimeMillis();
            if (last > 0 && (now - last) > FORCE_STOP_THRESHOLD_MS) {
                Log.d(TAG, "force_stop detected gap=" + (now - last) + "ms");
                JSObject payload = new JSObject();
                payload.put("lastSeenMs", last);
                payload.put("relaunchMs", now);
                payload.put("gapMs", now - last);
                notifyListeners("forceStopDetected", payload);
            }
            prefs.edit().putLong(PREF_LAST_HEARTBEAT, now).apply();
        } catch (Throwable t) {
            Log.e(TAG, "checkForceStopOnLaunch failed: " + t.getMessage());
        }
    }

    // ─── 4. Heartbeat — bumps SharedPreferences from JS ─────────
    // JS calls bumpHeartbeat() every 60s (foreground tick). Java
    // ALSO bumps it from MainActivity.onResume so the gap detection
    // doesn't false-positive on backgrounding.
    @PluginMethod
    public void bumpHeartbeat(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) { call.reject("Plugin context null"); return; }
        try {
            SharedPreferences prefs = ctx.getSharedPreferences(PREF_FILE, Context.MODE_PRIVATE);
            prefs.edit().putLong(PREF_LAST_HEARTBEAT, System.currentTimeMillis()).apply();
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Throwable t) {
            call.reject("heartbeat write failed: " + t.getMessage());
        }
    }

    // ─── 5. Polling API for JS ──────────────────────────────────
    // Owner-locked decision (2026-05-23 audit) — "GPS on" deliberately
    // includes BOTH hardware GPS_PROVIDER and NETWORK_PROVIDER
    // (cell-tower / Wi-Fi geolocation). Reps in Vadodara frequently
    // run Battery Saving mode on long workdays; that mode shuts
    // hardware GPS but leaves NETWORK_PROVIDER active. Treating that
    // as "GPS off" would generate false alarms in gps_off_events
    // every time a rep enables battery saver. The accuracy hit
    // (cell-tower ~300-1000m vs hardware ~5-20m) is acceptable for
    // attendance / route reconstruction at our zoom levels. Do NOT
    // drop NETWORK_PROVIDER without owner re-approval.
    @PluginMethod
    public void isGpsOn(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) { call.reject("Plugin context null"); return; }
        LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
        boolean enabled = false;
        try {
            enabled = lm != null && (
                lm.isProviderEnabled(LocationManager.GPS_PROVIDER)
                || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER));
        } catch (Throwable t) {
            Log.w(TAG, "isGpsOn check threw: " + t.getMessage());
        }
        JSObject ret = new JSObject();
        ret.put("enabled", enabled);
        call.resolve(ret);
    }

    @PluginMethod
    public void isOnline(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) { call.reject("Plugin context null"); return; }
        ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
        boolean online = false;
        try {
            online = cm != null && cm.getActiveNetwork() != null;
        } catch (Throwable t) {
            Log.w(TAG, "isOnline check threw: " + t.getMessage());
        }
        JSObject ret = new JSObject();
        ret.put("online", online);
        call.resolve(ret);
    }

    // ─── 6. Phase 103.D.3 — native foreground location service ──────
    // STEP 1: start/stop LocationTrackingService (log-only for now —
    // proves the service survives app-close before any server write is
    // added in Step 2). startForegroundService on 26+. NOTE: this MUST
    // be called while the app is in the foreground (Step 1 calls it on
    // app open). On Android 12+ a background startForegroundService
    // throws ForegroundServiceStartNotAllowedException — the service's
    // own try/catch swallows it so there's no crash, but do NOT move
    // this call to a background trigger in a later step without adding
    // an Android-12 background-start guard.
    @PluginMethod
    public void startTracking(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) { call.reject("Plugin context null"); return; }
        // Phase 103.D.3 Step 1 hotfix — DO NOT start a location foreground
        // service without location permission. On Android 14+ the service
        // cannot legally call startForeground() (location type needs the
        // permission), so it bails without promoting and Android kills the
        // process with ForegroundServiceDidNotStartInTimeException (owner
        // crash 2026-05-31). Gating here (native) means even an early/stale
        // JS call — e.g. on cold start before the rep taps Allow — can't
        // crash the app; it just no-ops until permission exists.
        boolean fineGranted = ContextCompat.checkSelfPermission(
                ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean coarseGranted = ContextCompat.checkSelfPermission(
                ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        if (!fineGranted && !coarseGranted) {
            Log.w(TAG, "startTracking skipped — location permission not granted");
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", "no_location_permission");
            call.resolve(ret);
            return;
        }
        try {
            Intent svc = new Intent(ctx, LocationTrackingService.class);
            if (Build.VERSION.SDK_INT >= 26) {
                ctx.startForegroundService(svc);
            } else {
                ctx.startService(svc);
            }
            Log.d(TAG, "startTracking — service start requested");
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Throwable t) {
            Log.e(TAG, "startTracking failed: " + t.getMessage());
            call.reject("startTracking failed: " + t.getMessage());
        }
    }

    @PluginMethod
    public void stopTracking(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) { call.reject("Plugin context null"); return; }
        try {
            ctx.stopService(new Intent(ctx, LocationTrackingService.class));
            Log.d(TAG, "stopTracking — service stop requested");
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Throwable t) {
            Log.e(TAG, "stopTracking failed: " + t.getMessage());
            call.reject("stopTracking failed: " + t.getMessage());
        }
    }

    // Phase 103.D.3 Step 2 — JS hands the LocationTrackingService its
    // server write context: the ingest-gps Edge URL + this device's FCM
    // token (the device key the Edge maps to user_id). Stored in
    // SharedPreferences; the service reads it per fix. Passing empty/null
    // clears it (service falls back to log-only).
    @PluginMethod
    public void setTrackingContext(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) { call.reject("Plugin context null"); return; }
        String url = call.getString("url");
        String token = call.getString("token");
        try {
            SharedPreferences prefs = ctx.getSharedPreferences(PREF_FILE, Context.MODE_PRIVATE);
            SharedPreferences.Editor ed = prefs.edit();
            if (url != null && !url.isEmpty()) ed.putString("ingest_url", url); else ed.remove("ingest_url");
            if (token != null && !token.isEmpty()) ed.putString("ingest_token", token); else ed.remove("ingest_token");
            ed.apply();
            Log.d(TAG, "setTrackingContext stored (url=" + (url != null) + " token=" + (token != null) + ")");
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Throwable t) {
            call.reject("setTrackingContext failed: " + t.getMessage());
        }
    }

    // ─── 7. Phase 180 — in-app APK self-update ──────────────────
    // Downloads the signed APK via the system DownloadManager (shows a
    // download notification, survives backgrounding) and, on completion,
    // fires the package-installer intent through the existing FileProvider
    // (${applicationId}.fileprovider, already declared in the manifest).
    // Android REQUIRES the user to confirm the install (sideload security):
    // "tap Update here, tap Install there" (2 taps). The APK lands in the
    // app-private external files dir (no storage permission needed).
    private long apkDownloadId = -1L;
    private BroadcastReceiver apkInstallReceiver;

    @PluginMethod
    public void installApk(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) { call.reject("Plugin context null"); return; }
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) { call.reject("url required"); return; }
        try {
            File dir = new File(ctx.getExternalFilesDir(null), "apk");
            if (!dir.exists()) dir.mkdirs();
            final File apkFile = new File(dir, "update.apk");
            if (apkFile.exists()) apkFile.delete();

            DownloadManager dm = (DownloadManager) ctx.getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm == null) { call.reject("DownloadManager unavailable"); return; }
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            req.setTitle("Untitled OS update");
            req.setDescription("Downloading the latest app…");
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationInExternalFilesDir(ctx, null, "apk/update.apk");
            req.setMimeType("application/vnd.android.package-archive");

            // One-shot completion receiver → launch the installer.
            apkInstallReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context c, Intent intent) {
                    long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
                    if (id != apkDownloadId) return;
                    try { c.unregisterReceiver(this); } catch (Throwable ignore) {}
                    apkInstallReceiver = null;
                    try {
                        Uri apkUri = FileProvider.getUriForFile(
                            c, c.getPackageName() + ".fileprovider", apkFile);
                        Intent install = new Intent(Intent.ACTION_VIEW);
                        install.setDataAndType(apkUri, "application/vnd.android.package-archive");
                        install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        c.startActivity(install);
                        Log.d(TAG, "installApk — installer launched");
                    } catch (Throwable t) {
                        Log.e(TAG, "installApk launch failed: " + t.getMessage());
                    }
                }
            };
            IntentFilter f = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
            if (Build.VERSION.SDK_INT >= 33) {
                ctx.registerReceiver(apkInstallReceiver, f, Context.RECEIVER_EXPORTED);
            } else {
                ctx.registerReceiver(apkInstallReceiver, f);
            }
            apkDownloadId = dm.enqueue(req);
            Log.d(TAG, "installApk — download enqueued id=" + apkDownloadId);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Throwable t) {
            Log.e(TAG, "installApk failed: " + t.getMessage());
            call.reject("installApk failed: " + t.getMessage());
        }
    }

    // Whether this app may install packages (Android 8+ asks the user to
    // allow "install unknown apps" for this source). JS uses this to route
    // the rep to that settings screen if false.
    @PluginMethod
    public void canInstallPackages(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) { call.reject("Plugin context null"); return; }
        boolean can = true;
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                can = ctx.getPackageManager().canRequestPackageInstalls();
            }
        } catch (Throwable t) {
            Log.w(TAG, "canInstallPackages threw: " + t.getMessage());
        }
        JSObject ret = new JSObject();
        ret.put("value", can);
        call.resolve(ret);
    }

    // ─── 8. Phase 180 — GPS-capture onboarding deep-links (§73 #1) ──
    // The dark-window km undercount is closed by two phone settings the rep
    // must grant: Location = "Allow all the time" + Battery = Unrestricted.
    // Android does NOT let an app set these silently — we can only deep-link
    // the rep to the right screen. JS shows a one-time guided prompt.

    // Opens THIS app's details screen → rep taps Permissions → Location →
    // "Allow all the time" (background location can't be granted via an
    // in-app dialog on Android 11+).
    @PluginMethod
    public void openLocationSettings(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) { call.reject("Plugin context null"); return; }
        try {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + ctx.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            JSObject ret = new JSObject(); ret.put("ok", true); call.resolve(ret);
        } catch (Throwable t) {
            call.reject("openLocationSettings failed: " + t.getMessage());
        }
    }

    // Fires the system "ignore battery optimizations?" dialog for this app
    // → rep taps Allow → the foreground GPS service stops getting killed on
    // screen-lock. Returns {already:true} if already unrestricted (no dialog).
    @PluginMethod
    public void requestBatteryUnrestricted(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) { call.reject("Plugin context null"); return; }
        try {
            boolean already = false;
            if (Build.VERSION.SDK_INT >= 23) {
                PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
                already = pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
                if (!already) {
                    Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        Uri.parse("package:" + ctx.getPackageName()));
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    ctx.startActivity(i);
                }
            }
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("already", already);
            call.resolve(ret);
        } catch (Throwable t) {
            call.reject("requestBatteryUnrestricted failed: " + t.getMessage());
        }
    }

    // ─── Cleanup ────────────────────────────────────────────────
    private void unregisterReceivers() {
        Context ctx = getContext();
        if (ctx == null) return;
        try {
            if (gpsReceiver != null) {
                ctx.unregisterReceiver(gpsReceiver);
                gpsReceiver = null;
            }
        } catch (Throwable t) {
            Log.w(TAG, "gpsReceiver unregister failed: " + t.getMessage());
        }
        try {
            ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null && networkCallback != null) {
                cm.unregisterNetworkCallback(networkCallback);
                networkCallback = null;
            }
        } catch (Throwable t) {
            Log.w(TAG, "networkCallback unregister failed: " + t.getMessage());
        }
    }
}
