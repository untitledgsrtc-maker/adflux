package in.untitledad.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Phase 56c — register custom inline plugin BEFORE
        // super.onCreate so Capacitor's plugin loader picks it up.
        registerPlugin(CallLogPlugin.class);
        // Phase 76.2 — UntitledTracking plugin: GPS toggle +
        // network state + force-stop detection. Native side fires
        // events; JS writes them to Phase 76.1 tables.
        registerPlugin(TrackingPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onResume() {
        super.onResume();
        // Phase 76.2.2 — bump force-stop heartbeat from the Activity
        // lifecycle every time the user brings the app to foreground.
        // JS-side setInterval (60s) pauses when the WebView is
        // backgrounded, so without this hook a multi-minute idle
        // would falsely flag as force_stop on next foreground.
        TrackingPlugin.bumpHeartbeatFromActivity(this);
    }
}
