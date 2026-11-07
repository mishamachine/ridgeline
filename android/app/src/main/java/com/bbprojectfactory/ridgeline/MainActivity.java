package com.bbprojectfactory.ridgeline;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HikePlugin.class); // local plugin: hike location + lock-screen notification
        super.onCreate(savedInstanceState);
    }
}
