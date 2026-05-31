package in.untitledad.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
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
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

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
        // Android 14+ refuses to start a location-typed foreground
        // service without the permission already granted — so bail
        // cleanly if it's missing rather than crash.
        if (!hasLocationPermission()) {
            Log.e(TAG, "no location permission — stopping service");
            stopSelf();
            return START_NOT_STICKY;
        }
        startInForeground();
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

    private void startInForeground() {
        createChannel();
        Notification notif = buildNotification("Location active");
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIF_ID, notif);
            }
            Log.d(TAG, "startForeground OK");
        } catch (Throwable t) {
            Log.e(TAG, "startForeground failed: " + t.getMessage());
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
                // STEP 1 — log only (no server write yet; Step 2 POSTs
                // to gps_pings). Also stamp the foreground notification
                // with the fix count + time so the service can be
                // verified alive WHILE THE APP IS CLOSED without adb:
                // pull down the notification shade — the time advances
                // every ~2 min if the service survived close.
                fixCount++;
                String t = new SimpleDateFormat("HH:mm:ss", Locale.US).format(new Date());
                Log.d(TAG, "FIX #" + fixCount + " lat=" + loc.getLatitude()
                        + " lng=" + loc.getLongitude()
                        + " acc=" + loc.getAccuracy()
                        + " provider=" + loc.getProvider());
                updateNotification("Location active · " + fixCount + " fixes · last " + t);
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
