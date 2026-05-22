package in.untitledad.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.location.LocationManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkRequest;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Phase 76.2 — UntitledTracking native plugin.
 *
 * Owner directive 22 May 2026 (deferred to today): surface 3 events
 * that the web bundle alone cannot see on Android —
 *   1. gps_off  — Location services toggled off in OS settings
 *   2. network_off — connectivity lost (no Wi-Fi + no mobile data)
 *   3. force_stop — app killed during work hours (detected on relaunch
 *      via a heartbeat gap)
 *
 * JS subscribes via the Capacitor plugin events. JS does the Supabase
 * writes (Phase 76.1 tables: gps_off_events, network_off_events,
 * force_stop_events). Native side does NOT hold Supabase credentials.
 *
 * Pattern matches the existing CallLogPlugin.java — minimal Java
 * surface, JS handles all networked work.
 */
@CapacitorPlugin(name = "UntitledTracking")
public class TrackingPlugin extends Plugin {

    private static final String PREF_FILE = "untitled_tracking";
    private static final String PREF_LAST_HEARTBEAT = "last_heartbeat_ms";

    private BroadcastReceiver gpsReceiver;
    private ConnectivityManager.NetworkCallback networkCallback;

    @Override
    public void load() {
        super.load();
        registerGpsToggleReceiver();
        registerNetworkWatcher();
        checkForceStopOnLaunch();
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        unregisterReceivers();
    }

    // ─── 1. GPS toggle ──────────────────────────────────────────
    // Listens for LocationManager.MODE_CHANGED_ACTION. Fires
    // 'gpsStateChanged' event with { enabled: boolean, atMs: long }.
    private void registerGpsToggleReceiver() {
        Context ctx = getContext();
        gpsReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                LocationManager lm = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
                boolean enabled = false;
                try {
                    enabled = lm.isProviderEnabled(LocationManager.GPS_PROVIDER)
                           || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
                } catch (Throwable ignored) { /* permission denied */ }
                JSObject payload = new JSObject();
                payload.put("enabled", enabled);
                payload.put("atMs", System.currentTimeMillis());
                notifyListeners("gpsStateChanged", payload);
            }
        };
        IntentFilter filter = new IntentFilter(LocationManager.MODE_CHANGED_ACTION);
        if (Build.VERSION.SDK_INT >= 33) {
            ctx.registerReceiver(gpsReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            ctx.registerReceiver(gpsReceiver, filter);
        }
    }

    // ─── 2. Network watcher ─────────────────────────────────────
    // Fires 'networkStateChanged' with { online: boolean, atMs: long }.
    private void registerNetworkWatcher() {
        Context ctx = getContext();
        ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return;
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                emit(true);
            }

            @Override
            public void onLost(Network network) {
                emit(false);
            }

            private void emit(boolean online) {
                JSObject payload = new JSObject();
                payload.put("online", online);
                payload.put("atMs", System.currentTimeMillis());
                notifyListeners("networkStateChanged", payload);
            }
        };
        NetworkRequest request = new NetworkRequest.Builder().build();
        try {
            cm.registerNetworkCallback(request, networkCallback);
        } catch (Throwable ignored) { /* tolerate older devices */ }
    }

    // ─── 3. Force-stop detection ────────────────────────────────
    // On plugin load, compare SharedPreferences last_heartbeat_ms
    // to now. Gap > 5 minutes during 10:00-19:00 IST = likely
    // force-stop. Fires 'forceStopDetected' once.
    private void checkForceStopOnLaunch() {
        Context ctx = getContext();
        SharedPreferences prefs = ctx.getSharedPreferences(PREF_FILE, Context.MODE_PRIVATE);
        long last = prefs.getLong(PREF_LAST_HEARTBEAT, 0L);
        long now = System.currentTimeMillis();
        if (last > 0 && (now - last) > 5L * 60L * 1000L) {
            JSObject payload = new JSObject();
            payload.put("lastSeenMs", last);
            payload.put("relaunchMs", now);
            payload.put("gapMs", now - last);
            notifyListeners("forceStopDetected", payload);
        }
        prefs.edit().putLong(PREF_LAST_HEARTBEAT, now).apply();
    }

    // ─── 4. Heartbeat — bumps SharedPreferences from JS ─────────
    // JS calls bumpHeartbeat() every 60s (foreground tick). On the
    // next app relaunch, checkForceStopOnLaunch reads this to spot
    // gaps. Keeping the tick on the JS side avoids needing a
    // ForegroundService here.
    @PluginMethod
    public void bumpHeartbeat(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREF_FILE, Context.MODE_PRIVATE);
        prefs.edit().putLong(PREF_LAST_HEARTBEAT, System.currentTimeMillis()).apply();
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    // ─── 5. Polling API for JS ──────────────────────────────────
    @PluginMethod
    public void isGpsOn(PluginCall call) {
        LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        boolean enabled = false;
        try {
            enabled = lm.isProviderEnabled(LocationManager.GPS_PROVIDER)
                   || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        } catch (Throwable ignored) {}
        JSObject ret = new JSObject();
        ret.put("enabled", enabled);
        call.resolve(ret);
    }

    @PluginMethod
    public void isOnline(PluginCall call) {
        ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        boolean online = false;
        try {
            online = cm != null && cm.getActiveNetwork() != null;
        } catch (Throwable ignored) {}
        JSObject ret = new JSObject();
        ret.put("online", online);
        call.resolve(ret);
    }

    // ─── Cleanup ────────────────────────────────────────────────
    private void unregisterReceivers() {
        Context ctx = getContext();
        try {
            if (gpsReceiver != null) {
                ctx.unregisterReceiver(gpsReceiver);
                gpsReceiver = null;
            }
        } catch (Throwable ignored) {}
        try {
            ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null && networkCallback != null) {
                cm.unregisterNetworkCallback(networkCallback);
                networkCallback = null;
            }
        } catch (Throwable ignored) {}
    }
}
