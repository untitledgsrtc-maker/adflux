package in.untitledad.app;

// Phase 162 (16 Jun 2026) — direct share-to-app so a quote PDF goes
// STRAIGHT into Gmail (recipient pre-filled) or WhatsApp (number
// pre-filled) WITH the PDF attached as a real file, and opens that app
// DIRECTLY (no "which app?" chooser). Capacitor @capacitor/share fires a
// generic ACTION_SEND chooser with no recipient; mailto: pre-fills the
// recipient but can't attach a file. Only an explicit package-targeted
// ACTION_SEND carrying a FileProvider content:// URI can do all three.
//
// JS falls back to the existing flows (Share.share / wa.me / mailto) when
// completed=false (app not installed) — so nothing regresses.

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

@CapacitorPlugin(name = "ShareDirect")
public class ShareDirect extends Plugin {

    // Matches AndroidManifest <provider> android:authorities=
    // "${applicationId}.fileprovider", applicationId = in.untitledad.app.
    private static final String FILE_AUTHORITY = "in.untitledad.app.fileprovider";

    // Convert a Capacitor file:// URI to a grantable content:// URI. A raw
    // file:// in EXTRA_STREAM throws FileUriExposedException on Android 7+.
    private Uri toContentUri(String fileUri) {
        String path = Uri.parse(fileUri).getPath();
        File f = new File(path);
        return FileProvider.getUriForFile(getContext(), FILE_AUTHORITY, f);
    }

    @PluginMethod
    public void email(PluginCall call) {
        if (getContext() == null || getActivity() == null) {
            call.reject("Plugin context unavailable");
            return;
        }
        String to      = call.getString("to", "");
        String subject = call.getString("subject", "");
        String body    = call.getString("body", "");
        String fileUri = call.getString("fileUri");
        JSObject ret = new JSObject();
        try {
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("application/pdf");
            if (to != null && !to.isEmpty()) i.putExtra(Intent.EXTRA_EMAIL, new String[]{ to });
            i.putExtra(Intent.EXTRA_SUBJECT, subject);
            i.putExtra(Intent.EXTRA_TEXT, body);
            if (fileUri != null && !fileUri.isEmpty()) {
                i.putExtra(Intent.EXTRA_STREAM, toContentUri(fileUri));
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
            i.setPackage("com.google.android.gm");   // Gmail directly
            getActivity().startActivity(i);
            ret.put("completed", true);
        } catch (ActivityNotFoundException e) {
            ret.put("completed", false);             // Gmail not installed → JS falls back
        } catch (Exception e) {
            ret.put("completed", false);
            ret.put("error", e.getMessage());
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void whatsapp(PluginCall call) {
        if (getContext() == null || getActivity() == null) {
            call.reject("Plugin context unavailable");
            return;
        }
        String phone   = call.getString("phone", "");   // digits incl. country code, no '+'
        String text    = call.getString("text", "");
        String fileUri = call.getString("fileUri");
        JSObject ret = new JSObject();
        try {
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("application/pdf");
            if (text != null && !text.isEmpty()) i.putExtra(Intent.EXTRA_TEXT, text);
            // jid targets a specific WhatsApp chat by number.
            if (phone != null && !phone.isEmpty()) i.putExtra("jid", phone + "@s.whatsapp.net");
            if (fileUri != null && !fileUri.isEmpty()) {
                i.putExtra(Intent.EXTRA_STREAM, toContentUri(fileUri));
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
            i.setPackage("com.whatsapp");            // WhatsApp directly
            getActivity().startActivity(i);
            ret.put("completed", true);
        } catch (ActivityNotFoundException e) {
            ret.put("completed", false);             // WhatsApp not installed → JS falls back
        } catch (Exception e) {
            ret.put("completed", false);
            ret.put("error", e.getMessage());
        }
        call.resolve(ret);
    }
}
