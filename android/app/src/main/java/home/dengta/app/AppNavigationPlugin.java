package home.dengta.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AppNavigation")
public class AppNavigationPlugin extends Plugin {
    @PluginMethod
    public void dismissKeyboard(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            View root = getActivity().getWindow().getDecorView();
            WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(root);
            boolean visible = insets != null && insets.isVisible(WindowInsetsCompat.Type.ime());
            InputMethodManager inputMethod = (InputMethodManager) getActivity().getSystemService(Context.INPUT_METHOD_SERVICE);
            boolean acceptingText = inputMethod != null && inputMethod.isAcceptingText();
            View focused = getActivity().getCurrentFocus();
            boolean editable = focused instanceof android.widget.EditText;
            if (visible || acceptingText) {
                new WindowInsetsControllerCompat(getActivity().getWindow(), root).hide(WindowInsetsCompat.Type.ime());
            }
            if (editable) {
                focused.clearFocus();
            }
            JSObject result = new JSObject();
            result.put("hidden", visible || acceptingText || editable);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void setBackHandlerReady(PluginCall call) {
        MainActivity.setWebBackReady(call.getBoolean("ready", false));
        call.resolve();
    }

    @PluginMethod
    public void restart(PluginCall call) {
        Context context = getContext();
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch == null) {
            call.reject("launch intent unavailable");
            return;
        }
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        PendingIntent pending = PendingIntent.getActivity(
            context,
            7102,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarm == null) {
            call.reject("alarm unavailable");
            return;
        }
        long triggerAt = SystemClock.elapsedRealtime() + 700;
        try {
            if (android.os.Build.VERSION.SDK_INT >= 31 && alarm.canScheduleExactAlarms()) {
                alarm.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME, triggerAt, pending);
            } else {
                alarm.set(AlarmManager.ELAPSED_REALTIME, triggerAt, pending);
            }
        } catch (SecurityException error) {
            alarm.set(AlarmManager.ELAPSED_REALTIME, triggerAt, pending);
        }
        JSObject result = new JSObject();
        result.put("scheduled", true);
        call.resolve(result);
        getActivity().runOnUiThread(() -> {
            getActivity().finishAffinity();
            android.os.Process.killProcess(android.os.Process.myPid());
        });
    }
}