package in.untitledad.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import org.json.JSONObject;

/**
 * Phase 103.D.3 — native foreground location service.
 *
 * STEP 1 (this commit) is LOG-ONLY. It writes NOTHING to the server.
 * Its only job is to prove, on a real device, that a foreground service
 * keeps receiving location fixes AFTER the app is fully closed (swiped
 * from recents) — the case the JS / web-view path can't cover (the
 * web view dies, so no ping is written). Verify via logcat:
 *
 *     adb logcat -s UntitledLocSvc
 *
 * Expect "FIX lat=.. lng=.." lines every ~2 min WITH THE APP CLOSED.
 * If they keep coming, Step 2 adds the native server write. If the OEM
 * kills the service on close, we learn that here — before any server
 * write or functional change exists, so there is zero risk to current
 * functions at this step.
 *
 * Design choices:
 *   • Framework LocationManager (android.location.*) — NO Play Services
 *     dependency, so it always compiles. FusedLocationProvider can be
 *     swapped in later for better battery if needed.
 *   • START_STICKY — Android restarts the service if the system kills
 *     it for memory (not the same as an OEM force-stop).
 *   • Foreground notification (Android 8+ requirement for long-running
 *     background work) + foregroundServiceType=location (Android 14+).
 *   • GPS_PROVIDER + NETWORK_PROVIDER (matches TrackingPlugin.isGpsOn —
 *     network provider keeps working when a rep is on battery-saver).
 *
 * Started / stopped from JS via TrackingPlugin.startTracking() /
 * stopTracking(). Step 1 wiring starts it on app init (ungated, for
 * testing on the owner's device); Step 3 will gate it to field sales
 * and tie start/stop to check-in / checkout.
 */
public class LocationTrackingService extends Service {

    private static final String TAG        = "UntitledLocSvc";
    private static final String CHANNEL_ID = "untitled_tracking_fg";
    private static final int    NOTIF_ID   = 7301;
    private static final long   MIN_TIME_MS = 120000L; // ~2 min between fixes
    private static final float  MIN_DIST_M  = 0f;       // time-based, not distance

    private LocationManager  locationManager;
    private LocationListener listener;
    private int fixCount = 0;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "onCreate");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "onStartCommand");
        // CRITICAL (Android 12+): a service started via
        // startForegroundService() MUST call startForeground() within
        // ~5 seconds or the OS kills the process
        // (ForegroundServiceDidNotStartInTimeException — owner crash
        // 2026-05-31). So promote FIRST, before any other check, so the
        // deadline can never be missed. TrackingPlugin already refuses
        // to start this service without location permission, so the
        // location-typed startForeground below succeeds.
        boolean promoted = startInForeground();
        if (!promoted || !hasLocationPermission()) {
            Log.e(TAG, "cannot run (promoted=" + promoted + ") — stopping");
            stopSelf();
            return START_NOT_STICKY;
        }
        startLocationUpdates();
        return START_STICKY;
    }

    private boolean hasLocationPermission() {
        boolean fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        boolean coarse = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        return fine || coarse;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "Location tracking", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Keeps your field location updating for the team map.");
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private Notification buildNotification(String text) {
        Intent open = new Intent(this, MainActivity.class);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) piFlags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, piFlags);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Untitled OS")
                .setContentText(text)
                .setSmallIcon(getApplicationInfo().icon)
                .setOngoing(true)
                .setContentIntent(pi)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    private void updateNotification(String text) {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIF_ID, buildNotification(text));
        } catch (Throwable t) {
            Log.w(TAG, "updateNotification failed: " + t.getMessage());
        }
    }

    private boolean startInForeground() {
        createChannel();
        // Production text — Android requires a persistent notification for
        // a foreground location service. Keep it plain + honest (reps see
        // it all day). The debug "N fixes · last HH:MM" counter is gone.
        Notification notif = buildNotification("Sharing your location with the office");
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIF_ID, notif);
            }
            Log.d(TAG, "startForeground OK");
            return true;
        } catch (Throwable t) {
            Log.e(TAG, "startForeground failed: " + t.getMessage());
            return false;
        }
    }

    private void startLocationUpdates() {
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (locationManager == null) {
            Log.e(TAG, "LocationManager unavailable");
            return;
        }
        listener = new LocationListener() {
            @Override
            public void onLocationChanged(Location loc) {
                // Phase 103.D.3 — log the fix + POST it to the ingest-gps
                // Edge so it lands in gps_pings even with the app closed.
                // The foreground notification stays the static production
                // line (no per-fix counter — that was a debug aid).
                fixCount++;
                Log.d(TAG, "FIX #" + fixCount + " lat=" + loc.getLatitude()
                        + " lng=" + loc.getLongitude()
                        + " acc=" + loc.getAccuracy()
                        + " provider=" + loc.getProvider());
                Integer acc = loc.hasAccuracy() ? Math.round(loc.getAccuracy()) : null;
                postPing(loc.getLatitude(), loc.getLongitude(), acc);
            }
            @Override public void onProviderEnabled(String p)  { Log.d(TAG, "provider enabled " + p); }
            @Override public void onProviderDisabled(String p) { Log.d(TAG, "provider disabled " + p); }
            @Override public void onStatusChanged(String p, int s, Bundle e) { }
        };
        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                        LocationManager.GPS_PROVIDER, MIN_TIME_MS, MIN_DIST_M, listener);
                Log.d(TAG, "requested GPS_PROVIDER updates");
            }
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                        LocationManager.NETWORK_PROVIDER, MIN_TIME_MS, MIN_DIST_M, listener);
                Log.d(TAG, "requested NETWORK_PROVIDER updates");
            }
        } catch (SecurityException se) {
            Log.e(TAG, "requestLocationUpdates SecurityException: " + se.getMessage());
        } catch (Throwable t) {
            Log.e(TAG, "requestLocationUpdates failed: " + t.getMessage());
        }
    }

    // Phase 103.D.3 Step 2 — POST one fix to the ingest-gps Edge on a
    // background thread (never the main thread → no NetworkOnMainThread
    // exception). Reads the endpoint + device token from SharedPreferences
    // (written by TrackingPlugin.setTrackingContext from JS). If unset
    // (not configured yet), this is a no-op and the service stays
    // log-only. Errors are swallowed — a failed POST never crashes the
    // service. The Edge maps the token → user and writes gps_pings.
    private void postPing(final double lat, final double lng, final Integer accuracy) {
        SharedPreferences prefs = getSharedPreferences("untitled_tracking", Context.MODE_PRIVATE);
        final String url = prefs.getString("ingest_url", null);
        final String token = prefs.getString("ingest_token", null);
        if (url == null || token == null) {
            return; // not configured — log-only
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection conn = null;
                try {
                    JSONObject payload = new JSONObject();
                    payload.put("token", token);
                    payload.put("lat", lat);
                    payload.put("lng", lng);
                    if (accuracy != null) payload.put("accuracy_m", (int) accuracy);
                    byte[] out = payload.toString().getBytes("UTF-8");

                    conn = (HttpURLConnection) new URL(url).openConnection();
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("content-type", "application/json");
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(15000);
                    conn.setDoOutput(true);
                    OutputStream os = conn.getOutputStream();
                    os.write(out);
                    os.flush();
                    os.close();
                    int code = conn.getResponseCode();
                    String resp = readResponse(conn, code);
                    Log.d(TAG, "ping POST -> " + code + " " + resp);
                    // Phase 103.D.8 — server STOP signal. When the rep is
                    // checked out for the day, ingest-gps writes NO ping and
                    // returns {"ok":true,"stop":true}. Stop the foreground
                    // service so it isn't tracking after the workday. This is
                    // the ONLY stop path that works with the app fully closed
                    // (the JS layer is dead, so it can't relay checkout). No
                    // hardcoded clock — fires at whatever time checkout lands.
                    if (resp != null && resp.contains("\"stop\":true")) {
                        Log.d(TAG, "server: checked-out -> stopSelf");
                        stopSelf();
                    }
                } catch (Throwable t) {
                    Log.w(TAG, "ping POST failed: " + t.getMessage());
                } finally {
                    if (conn != null) conn.disconnect();
                }
            }
        }).start();
    }

    // Phase 103.D.8 — read the small JSON response so postPing can see the
    // server's stop signal. Uses the error stream for >=400 so the signal
    // is never missed on a non-2xx. Best-effort: null on any failure.
    private String readResponse(HttpURLConnection conn, int code) {
        java.io.InputStream is = null;
        try {
            is = (code >= 200 && code < 400) ? conn.getInputStream() : conn.getErrorStream();
            if (is == null) return null;
            BufferedReader br = new BufferedReader(new InputStreamReader(is, "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) sb.append(line);
            br.close();
            return sb.toString();
        } catch (Throwable t) {
            return null;
        } finally {
            try { if (is != null) is.close(); } catch (Throwable ignored) {}
        }
    }

    @Override
    public void onDestroy() {
        Log.d(TAG, "onDestroy — removing updates");
        try {
            if (locationManager != null && listener != null) {
                locationManager.removeUpdates(listener);
            }
        } catch (Throwable t) {
            Log.w(TAG, "removeUpdates failed: " + t.getMessage());
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null; // not a bound service
    }
}
