package com.bbprojectfactory.ridgeline;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * "RidgelineHike": position updates and the lock-screen navigation notification for a hike the user started.
 * Location goes to the web layer on this phone only; nothing is sent anywhere.
 */
@CapacitorPlugin(
    name = "RidgelineHike",
    permissions = {
        @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, alias = "location"),
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
    }
)
public class HikePlugin extends Plugin implements HikeService.Sink {

    @Override
    public void load() {
        HikeService.sink = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (HikeService.sink == this) HikeService.sink = null;
    }

    private boolean notificationsNeedPermission() {
        return Build.VERSION.SDK_INT >= 33;
    }

    private JSObject states() {
        JSObject o = new JSObject();
        boolean fine = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        o.put("location", fine ? "granted" : (getPermissionState("location") == PermissionState.DENIED ? "denied" : "prompt"));
        boolean notif = !notificationsNeedPermission()
            || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        o.put("notifications", notif ? "granted" : "prompt");
        return o;
    }

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        call.resolve(states());
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (!"granted".equals(states().getString("location"))) requestPermissionForAlias("location", call, "afterLocation");
        else afterLocation(call);
    }

    @PermissionCallback
    private void afterLocation(PluginCall call) {
        if (notificationsNeedPermission() && !"granted".equals(states().getString("notifications"))) {
            requestPermissionForAlias("notifications", call, "afterNotifications");
        } else {
            call.resolve(states());
        }
    }

    @PermissionCallback
    private void afterNotifications(PluginCall call) {
        call.resolve(states());
    }

    @PluginMethod
    public void startHike(PluginCall call) {
        if (!"granted".equals(states().getString("location"))) {
            call.reject("Precise location permission is not granted.");
            return;
        }
        Context c = getContext();
        Intent i = new Intent(c, HikeService.class).setAction(HikeService.ACTION_START)
            .putExtra("title", call.getString("title", "Ridgeline hike"))
            .putExtra("text", call.getString("text", ""))
            .putExtra("progress", call.getInt("progress", -1));
        try {
            ContextCompat.startForegroundService(c, i);
            call.resolve();
        } catch (RuntimeException e) {
            call.reject("Could not start the hike service: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopHike(PluginCall call) {
        Context c = getContext();
        c.stopService(new Intent(c, HikeService.class));
        call.resolve();
    }

    @PluginMethod
    public void updateNotification(PluginCall call) {
        HikeService s = HikeService.instance;
        if (s != null) s.update(call.getString("title", ""), call.getString("text", ""), call.getInt("progress", -1));
        call.resolve();
    }

    @Override
    public void onFix(JSObject fix) {
        notifyListeners("fix", fix);
    }

    @Override
    public void onError(int code, String message) {
        JSObject o = new JSObject();
        o.put("code", code);
        o.put("message", message);
        notifyListeners("locationError", o);
    }
}
