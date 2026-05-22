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
}
