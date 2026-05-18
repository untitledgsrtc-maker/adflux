package in.untitledad.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Phase 56c — register custom inline plugin BEFORE
        // super.onCreate so Capacitor's plugin loader picks it up.
        registerPlugin(CallLogPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
