package com.bbprojectfactory.ridgeline;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.JSObject;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

/**
 * Foreground service (type location) that keeps GPS running while the screen is off during a hike,
 * with a persistent high-contrast notification the web layer can update.
 */
public class HikeService extends Service {
    public interface Sink {
        void onFix(JSObject fix);
        void onError(int code, String message);
    }

    static final String ACTION_START = "com.bbprojectfactory.ridgeline.START";
    private static final String CHANNEL = "hike";
    private static final int NOTIFICATION_ID = 7101;

    static volatile HikeService instance;
    static volatile Sink sink;

    private FusedLocationProviderClient fused;
    private LocationCallback fusedCallback;
    private LocationManager manager;
    private LocationListener managerListener;
    private String title = "Ridgeline hike";
    private String text = "";
    private int progress = -1;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Hike navigation", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Shows your next direction while a hike is running.");
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        ch.setShowBadge(false);
        getSystemService(NotificationManager.class).createNotificationChannel(ch);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            title = intent.getStringExtra("title") != null ? intent.getStringExtra("title") : title;
            text = intent.getStringExtra("text") != null ? intent.getStringExtra("text") : text;
            progress = intent.getIntExtra("progress", -1);
        }
        Notification n = build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        else startForeground(NOTIFICATION_ID, n);
        startUpdates();
        return START_NOT_STICKY; // a hike the user started; do not restart it behind their back
    }

    /** Called from the plugin; works while the app is in the background. */
    void update(String newTitle, String newText, int newProgress) {
        title = newTitle;
        text = newText;
        progress = newProgress;
        getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, build());
    }

    private Notification build() {
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher_monochrome)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setColor(0xFF111111) // black background, white text (colorized) like the Maps lock-screen card
            .setColorized(true)
            .setContentIntent(pi)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);
        if (progress >= 0) b.setProgress(100, Math.min(100, progress), false);
        return b.build();
    }

    private void startUpdates() {
        if (fusedCallback != null || managerListener != null) return;
        try {
            if (GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(this) == ConnectionResult.SUCCESS) {
                fused = LocationServices.getFusedLocationProviderClient(this);
                LocationRequest req = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1000)
                    .setMinUpdateIntervalMillis(500)
                    .setWaitForAccurateLocation(false)
                    .build();
                fusedCallback = new LocationCallback() {
                    @Override
                    public void onLocationResult(@NonNull LocationResult result) {
                        for (Location l : result.getLocations()) emit(l);
                    }
                };
                fused.requestLocationUpdates(req, fusedCallback, Looper.getMainLooper());
            } else {
                // Phones without Google Play services: plain GPS from the system
                manager = (LocationManager) getSystemService(LOCATION_SERVICE);
                managerListener = new LocationListener() {
                    @Override public void onLocationChanged(@NonNull Location l) { emit(l); }
                    @Override public void onStatusChanged(String provider, int status, android.os.Bundle extras) {}
                    @Override public void onProviderEnabled(@NonNull String provider) {}
                    @Override public void onProviderDisabled(@NonNull String provider) { error(2, "GPS is turned off."); }
                };
                manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, managerListener, Looper.getMainLooper());
            }
        } catch (SecurityException e) {
            error(1, "Location permission is missing.");
            stopSelf();
        } catch (RuntimeException e) {
            error(2, "Could not start GPS: " + e.getMessage());
            stopSelf();
        }
    }

    private void error(int code, String message) {
        Sink s = sink;
        if (s != null) s.onError(code, message);
    }

    private void emit(Location l) {
        Sink s = sink;
        if (s == null) return;
        JSObject o = new JSObject();
        o.put("lat", l.getLatitude());
        o.put("lon", l.getLongitude());
        o.put("accuracy", l.hasAccuracy() ? l.getAccuracy() : 9999);
        if (l.hasAltitude()) o.put("altitude", l.getAltitude());
        if (Build.VERSION.SDK_INT >= 26 && l.hasVerticalAccuracy()) o.put("altitudeAccuracy", l.getVerticalAccuracyMeters());
        if (l.hasSpeed()) o.put("speed", l.getSpeed());
        if (l.hasBearing()) o.put("heading", l.getBearing());
        o.put("t", l.getTime());
        s.onFix(o);
    }

    /** The app was swiped away: end the hike service and its notification with it. */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        if (fused != null && fusedCallback != null) fused.removeLocationUpdates(fusedCallback);
        if (manager != null && managerListener != null) manager.removeUpdates(managerListener);
        fusedCallback = null;
        managerListener = null;
        stopForeground(STOP_FOREGROUND_REMOVE);
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
