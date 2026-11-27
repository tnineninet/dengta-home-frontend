package home.dengta.app;

import android.Manifest;
import android.content.pm.PackageManager;
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
 * Native Android runtime permission helper for DengTa Live Perception.
 * Android remembers CAMERA and RECORD_AUDIO permanently once granted by the user;
 * exposing an explicit check/request bridge lets LivePerceptionBar seamlessly
 * re-arm sensors across app switches and restarts without falsely clearing user toggles.
 */
@CapacitorPlugin(
    name = "MediaPermissions",
    permissions = {
        @Permission(alias = "camera", strings = { Manifest.permission.CAMERA }),
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public final class MediaPermissionsPlugin extends Plugin {
    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(buildStatus());
    }

    @PluginMethod
    public void requestMedia(PluginCall call) {
        boolean wantCamera = Boolean.TRUE.equals(call.getBoolean("camera", false));
        boolean wantMic = Boolean.TRUE.equals(call.getBoolean("microphone", false));
        boolean camGranted = isGranted(Manifest.permission.CAMERA);
        boolean micGranted = isGranted(Manifest.permission.RECORD_AUDIO);

        if ((!wantCamera || camGranted) && (!wantMic || micGranted)) {
            call.resolve(buildStatus());
            return;
        }
        if (wantCamera && wantMic && !camGranted && !micGranted) {
            requestPermissionForAliases(new String[] { "camera", "microphone" }, call, "onMediaPermissionResult");
            return;
        }
        if (wantCamera && !camGranted) {
            requestPermissionForAlias("camera", call, "onMediaPermissionResult");
            return;
        }
        if (wantMic && !micGranted) {
            requestPermissionForAlias("microphone", call, "onMediaPermissionResult");
            return;
        }
        call.resolve(buildStatus());
    }

    @PermissionCallback
    private void onMediaPermissionResult(PluginCall call) {
        call.resolve(buildStatus());
    }

    private boolean isGranted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission)
            == PackageManager.PERMISSION_GRANTED;
    }

    private JSObject buildStatus() {
        JSObject result = new JSObject();
        boolean cam = isGranted(Manifest.permission.CAMERA);
        boolean mic = isGranted(Manifest.permission.RECORD_AUDIO);
        PermissionState camState = getPermissionState("camera");
        PermissionState micState = getPermissionState("microphone");
        result.put("camera", cam ? "granted" : (camState == PermissionState.DENIED ? "denied" : "prompt"));
        result.put("microphone", mic ? "granted" : (micState == PermissionState.DENIED ? "denied" : "prompt"));
        result.put("cameraGranted", cam);
        result.put("microphoneGranted", mic);
        return result;
    }
}
