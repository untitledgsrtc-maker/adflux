package in.untitledad.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.telephony.TelephonyManager;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Phase 228 Part A — real-time incoming-call listener.
 *
 * WHY THIS EXISTS (CLAUDE.md §92): the app used to capture calls by reading the
 * Android device call log and TRUSTING the OEM's TYPE integer to decide the
 * direction. Every phone brand numbers calls differently (§220 standard 0s
 * incoming, §227 type-7 answered-externally, §227.1 Realme 100/101), so capture
 * broke on every new brand and got yet another per-type patch. This receiver
 * replaces that: it reads the LIVE phone state (ring → answer → hangup) and
 * records each incoming call — answered vs missed, with a duration WE compute —
 * INDEPENDENT of how the brand logs it afterward. Type-patching is banned (§92);
 * this is the permanent fix.
 *
 * A manifest-registered PHONE_STATE receiver fires even when the app is
 * backgrounded or killed (PHONE_STATE is on the implicit-broadcast allowlist).
 * Each broadcast may hit a fresh receiver instance / process, so the in-progress
 * call state is persisted in SharedPreferences (commit(), not apply(), so it
 * survives a kill between broadcasts). On a completed incoming call the row is
 * appended to a "pending_calls" JSON queue; the JS call-history scan
 * (callHistoryIngest.js drainPendingCalls) drains + ingests it through the SAME
 * dedup as the device-log scan, so a real-time row + a later call-log-scan row
 * for the same physical call MERGE (§220 exact-call_at + direction-aware window)
 * — never a double.
 *
 * Outgoing calls are IGNORED here (OFFHOOK with no preceding RINGING) — they are
 * already captured by the in-app tel-tap audit + the outgoing device scan
 * (§173/§220); recording them here would double them.
 *
 * Native side holds NO Supabase credentials — it only queues locally; JS does the
 * writes (same split as TrackingPlugin).
 */
public class CallStateReceiver extends BroadcastReceiver {

    private static final String TAG = "UntitledTracking";
    // Same SharedPreferences file TrackingPlugin uses, so drainPendingCalls()
    // reads the same "pending_calls" queue this writes.
    private static final String PREF_FILE = "untitled_tracking";
    private static final int MAX_QUEUE = 200;

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (ctx == null || intent == null) return;
        if (!TelephonyManager.ACTION_PHONE_STATE_CHANGED.equals(intent.getAction())) return;

        String state = intent.getStringExtra(TelephonyManager.EXTRA_STATE);
        if (state == null) return;

        long now = System.currentTimeMillis();
        SharedPreferences p;
        try {
            p = ctx.getSharedPreferences(PREF_FILE, Context.MODE_PRIVATE);
        } catch (Throwable t) {
            Log.w(TAG, "CallStateReceiver prefs unavailable: " + t.getMessage());
            return;
        }

        try {
            if (TelephonyManager.EXTRA_STATE_RINGING.equals(state)) {
                // Incoming call started ringing. The number arrives on RINGING
                // (needs READ_CALL_LOG / READ_PHONE_NUMBERS); a second RINGING
                // broadcast can carry an empty number — don't clobber a good one.
                String incoming = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER);
                boolean already = "RINGING".equals(p.getString("cs_state", ""));
                SharedPreferences.Editor e = p.edit();
                if (!already) {
                    e.putString("cs_state", "RINGING");
                    e.putLong("cs_ring_ms", now);
                    e.putLong("cs_offhook_ms", 0L);
                    e.putBoolean("cs_incoming", true);
                }
                if (incoming != null && !incoming.isEmpty()) {
                    e.putString("cs_number", incoming);
                } else if (!already) {
                    e.putString("cs_number", "");
                }
                e.commit();

            } else if (TelephonyManager.EXTRA_STATE_OFFHOOK.equals(state)) {
                String prev = p.getString("cs_state", "");
                SharedPreferences.Editor e = p.edit();
                if ("RINGING".equals(prev)) {
                    // The ringing incoming call was answered.
                    e.putString("cs_state", "OFFHOOK");
                    e.putLong("cs_offhook_ms", now);
                } else {
                    // OFFHOOK with no preceding RINGING = an outgoing dial → mark
                    // not-incoming so IDLE ignores it (outgoing is captured via the
                    // in-app tap + outgoing scan; §173/§220).
                    e.putString("cs_state", "OFFHOOK");
                    e.putBoolean("cs_incoming", false);
                }
                e.commit();

            } else if (TelephonyManager.EXTRA_STATE_IDLE.equals(state)) {
                String prev = p.getString("cs_state", "");
                boolean wasIncoming = p.getBoolean("cs_incoming", false);
                if (!prev.isEmpty() && wasIncoming) {
                    long ringMs = p.getLong("cs_ring_ms", 0L);
                    long offhookMs = p.getLong("cs_offhook_ms", 0L);
                    String num = p.getString("cs_number", "");
                    String direction;
                    int dur;
                    if (offhookMs > 0L) {
                        // RINGING → OFFHOOK → IDLE = answered incoming; duration =
                        // hangup − answer (our own timing, not the flaky device read).
                        direction = "incoming";
                        dur = (int) Math.max(0L, (now - offhookMs) / 1000L);
                    } else {
                        // RINGING → IDLE, never answered = missed incoming.
                        direction = "missed";
                        dur = 0;
                    }
                    appendPendingCall(p, num, direction, dur, ringMs > 0L ? ringMs : now);
                }
                // Reset for the next call.
                p.edit()
                    .remove("cs_state")
                    .remove("cs_number")
                    .remove("cs_ring_ms")
                    .remove("cs_offhook_ms")
                    .remove("cs_incoming")
                    .commit();
            }
        } catch (Throwable t) {
            Log.w(TAG, "CallStateReceiver onReceive failed: " + t.getMessage());
        }
    }

    private static void appendPendingCall(SharedPreferences p, String number,
                                          String direction, int durationSeconds, long atMs) {
        try {
            String rawJson = p.getString("pending_calls", "[]");
            JSONArray arr;
            try {
                arr = new JSONArray(rawJson);
            } catch (Throwable t) {
                arr = new JSONArray();
            }
            JSONObject o = new JSONObject();
            o.put("number", number == null ? "" : number);
            o.put("direction", direction);
            o.put("durationSeconds", durationSeconds);
            o.put("atMs", atMs);
            arr.put(o);
            // Cap the queue so a long offline stretch (JS never draining) can't
            // grow it unbounded; drop the oldest.
            while (arr.length() > MAX_QUEUE) {
                arr.remove(0);
            }
            p.edit().putString("pending_calls", arr.toString()).commit();
            Log.d(TAG, "CallStateReceiver queued " + direction + " call dur=" + durationSeconds + "s");
        } catch (Throwable t) {
            Log.w(TAG, "appendPendingCall failed: " + t.getMessage());
        }
    }
}
