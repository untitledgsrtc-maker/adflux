package in.untitledad.app;

// Phase 56c — custom Capacitor plugin for reading the Android system
// call log so the app can auto-fill `call_logs.duration_seconds`
// after the rep finishes a call placed via tel: link.
//
// Owner directive (18 May 2026):
//   "we want to add custom domain so should i add now or later?
//    i want all day background fetched data with call n any other
//    requirement without any big setup on time setup"
//   ...and:
//   "just match by phone+time, no SIM picker"
//
// Approach:
//   When the rep taps Call on a lead, the React side writes a
//   call_logs row immediately (Phase 35.0 callAudit) with
//   outcome='no_answer' (Phase 54 F2 default). The exact lead phone
//   + tel-tap timestamp are stored. Once the rep saves the
//   PostCallOutcomeModal, the JS shim calls this plugin with
//   (number, sinceTimestamp). The plugin queries the Android
//   CallLog content provider, finds the most recent matching call
//   row, and returns durationSeconds. JS then updates the matching
//   call_logs row in Supabase.
//
// Permission: READ_CALL_LOG. Declared in AndroidManifest. Plugin
// requests it at runtime via Capacitor's permissions API.
//
// SIM slot: not filtered. We match by phone number + time window.
// Per owner directive, no SIM picker.

import android.Manifest;
import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CallLog;
import android.telephony.PhoneNumberUtils;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "CallLogReader",
    permissions = {
        @Permission(
            alias = "callLog",
            strings = { Manifest.permission.READ_CALL_LOG }
        )
    }
)
public class CallLogPlugin extends Plugin {

    /**
     * Look up the most recent call to / from the given phone number
     * since the given epoch-millis timestamp.
     *
     * Inputs (JSObject):
     *   number          string  — phone number the rep called (lead.phone)
     *   sinceTimestamp  long    — epoch-millis lower bound (tel-tap time)
     *   windowMinutes   int     — optional, default 60 — upper bound
     *
     * Outputs (JSObject) on success:
     *   found            boolean
     *   durationSeconds  number  (when found)
     *   number           string  (the normalised number from CallLog)
     *   type             string  ('outgoing' | 'incoming' | 'missed' | ...)
     *   date             long    (epoch-millis from CallLog)
     */
    @PluginMethod
    public void lookupCall(PluginCall call) {
        // Runtime permission check. Capacitor will prompt the user
        // once if not granted; the JS side can also call
        // checkPermissions / requestPermissions explicitly via the
        // standard plugin API.
        if (getPermissionState("callLog") != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias("callLog", call, "callLogPermissionCallback");
            return;
        }
        doLookup(call);
    }

    @PermissionCallback
    private void callLogPermissionCallback(PluginCall call) {
        if (getPermissionState("callLog") == com.getcapacitor.PermissionState.GRANTED) {
            doLookup(call);
        } else {
            call.reject("READ_CALL_LOG permission denied");
        }
    }

    private void doLookup(PluginCall call) {
        String number          = call.getString("number");
        Long   sinceTimestamp  = call.getLong("sinceTimestamp");
        Integer windowMinutes  = call.getInt("windowMinutes", 60);

        if (number == null || sinceTimestamp == null) {
            call.reject("number and sinceTimestamp are required");
            return;
        }

        long upperBound = sinceTimestamp + (long) windowMinutes * 60_000L;

        ContentResolver resolver = getContext().getContentResolver();
        Uri uri = CallLog.Calls.CONTENT_URI;
        String[] projection = new String[] {
            CallLog.Calls.NUMBER,
            CallLog.Calls.TYPE,
            CallLog.Calls.DATE,
            CallLog.Calls.DURATION
        };
        // Pull calls in the time window, newest first. We'll filter
        // by phone-number match in code because CallLog stores
        // numbers in varying formats (with/without country code,
        // with/without spaces) and PhoneNumberUtils.compare is the
        // canonical way to match.
        String selection = CallLog.Calls.DATE + " >= ? AND " + CallLog.Calls.DATE + " <= ?";
        String[] selectionArgs = new String[] {
            String.valueOf(sinceTimestamp),
            String.valueOf(upperBound)
        };
        String sortOrder = CallLog.Calls.DATE + " DESC";

        Cursor cursor = null;
        try {
            cursor = resolver.query(uri, projection, selection, selectionArgs, sortOrder);
            if (cursor == null) {
                JSObject ret = new JSObject();
                ret.put("found", false);
                call.resolve(ret);
                return;
            }

            int numIdx = cursor.getColumnIndex(CallLog.Calls.NUMBER);
            int typIdx = cursor.getColumnIndex(CallLog.Calls.TYPE);
            int datIdx = cursor.getColumnIndex(CallLog.Calls.DATE);
            int durIdx = cursor.getColumnIndex(CallLog.Calls.DURATION);

            while (cursor.moveToNext()) {
                String logNumber = cursor.getString(numIdx);
                if (logNumber == null) continue;
                if (!PhoneNumberUtils.compare(logNumber, number)) continue;

                int type = cursor.getInt(typIdx);
                long date = cursor.getLong(datIdx);
                int duration = cursor.getInt(durIdx);

                JSObject ret = new JSObject();
                ret.put("found", true);
                ret.put("number", logNumber);
                ret.put("type", typeLabel(type));
                ret.put("date", date);
                ret.put("durationSeconds", duration);
                call.resolve(ret);
                return;
            }

            // No matching row.
            JSObject ret = new JSObject();
            ret.put("found", false);
            call.resolve(ret);
        } catch (SecurityException se) {
            call.reject("READ_CALL_LOG permission denied at query time", se);
        } catch (Exception e) {
            call.reject("call log query failed: " + e.getMessage(), e);
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    private String typeLabel(int type) {
        switch (type) {
            case CallLog.Calls.OUTGOING_TYPE: return "outgoing";
            case CallLog.Calls.INCOMING_TYPE: return "incoming";
            case CallLog.Calls.MISSED_TYPE:   return "missed";
            case CallLog.Calls.VOICEMAIL_TYPE: return "voicemail";
            case CallLog.Calls.REJECTED_TYPE: return "rejected";
            case CallLog.Calls.BLOCKED_TYPE:  return "blocked";
            default:                          return "unknown";
        }
    }
}
