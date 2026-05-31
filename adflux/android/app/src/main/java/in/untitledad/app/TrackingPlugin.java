package in.untitledad.app;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.location.LocationManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Build;
import android.util.Log;
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
