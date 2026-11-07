package com.bbprojectfactory.ridgeline;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;

/** Debug builds only: adb shell am broadcast -n com.bbprojectfactory.ridgeline/.DebugHikeReceiver --es title ... --es text ... --ei progress 40 */
public class DebugHikeReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent in) {
        Intent i = new Intent(context, HikeService.class).setAction(HikeService.ACTION_START)
            .putExtra("title", in.getStringExtra("title"))
            .putExtra("text", in.getStringExtra("text"))
            .putExtra("progress", in.getIntExtra("progress", -1));
        ContextCompat.startForegroundService(context, i);
    }
}
