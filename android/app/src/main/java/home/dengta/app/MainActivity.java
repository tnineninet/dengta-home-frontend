package home.dengta.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        PushNotificationWorker.ensureNotificationChannel(this);
        PushNotificationWorker.schedule(this);
        PushNotificationWorker.markAppVisible(this);
    }

    @Override
    protected void onResume() {
        super.onResume();
        PushNotificationWorker.markAppVisible(this);
    }

    @Override
    protected void onPause() {
        PushNotificationWorker.markAppVisible(this);
        super.onPause();
    }
}
