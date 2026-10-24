package home.dengta.app;

import android.speech.tts.TextToSpeech;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.function.Consumer;

/**
 * Free, on-device voice output. The server's expressive TTS remains the
 * primary path; this plugin only gives the app a local fallback/read-aloud
 * action that works without API keys or network access.
 */
@CapacitorPlugin(name = "DeviceTts")
public class DeviceTtsPlugin extends Plugin {
    private TextToSpeech tts;
    private boolean initializing = false;
    private boolean ready = false;
    private boolean failed = false;
    private final List<Pending> pending = new ArrayList<>();

    private static final class Pending {
        final PluginCall call;
        final Consumer<TextToSpeech> action;

        Pending(PluginCall call, Consumer<TextToSpeech> action) {
            this.call = call;
            this.action = action;
        }
    }

    @Override
    public void load() {
        ensureTts();
    }

    private void ensureTts() {
        if (ready || failed || initializing) return;
        initializing = true;
        try {
            tts = new TextToSpeech(getContext(), status -> {
                initializing = false;
                if (status != TextToSpeech.SUCCESS || tts == null) {
                    failed = true;
                    rejectPending("tts_init_failed");
                    return;
                }
                int language = tts.setLanguage(Locale.SIMPLIFIED_CHINESE);
                if (language == TextToSpeech.LANG_MISSING_DATA
                    || language == TextToSpeech.LANG_NOT_SUPPORTED) {
                    failed = true;
                    rejectPending("tts_language_unavailable");
                    return;
                }
                ready = true;
                flushPending();
            });
        } catch (Exception error) {
            initializing = false;
            failed = true;
            rejectPending("tts_init_failed");
        }
    }

    private void withTts(PluginCall call, Consumer<TextToSpeech> action) {
        if (ready && tts != null) {
            action.accept(tts);
            return;
        }
        if (failed) {
            call.reject("tts_unavailable");
            return;
        }
        pending.add(new Pending(call, action));
        ensureTts();
    }

    private void flushPending() {
        List<Pending> readyCalls = new ArrayList<>(pending);
        pending.clear();
        for (Pending item : readyCalls) {
            item.action.accept(tts);
        }
    }

    private void rejectPending(String code) {
        List<Pending> waiting = new ArrayList<>(pending);
        pending.clear();
        for (Pending item : waiting) {
            item.call.reject(code);
        }
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = String.valueOf(call.getString("text", "")).trim();
        if (text.isEmpty()) {
            call.reject("empty_text");
            return;
        }
        if (text.length() > 4000) text = text.substring(0, 4000);
        final String utterance = text;
        withTts(call, engine -> {
            engine.setSpeechRate(1.0f);
            int result = engine.speak(utterance, TextToSpeech.QUEUE_FLUSH, null, "dengta-" + System.nanoTime());
            if (result == TextToSpeech.ERROR) {
                call.reject("tts_speak_failed");
                return;
            }
            JSObject response = new JSObject();
            response.put("started", true);
            call.resolve(response);
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (tts != null) tts.stop();
        call.resolve();
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        withTts(call, engine -> {
            JSObject response = new JSObject();
            response.put("available", true);
            call.resolve(response);
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
        ready = false;
        failed = false;
        initializing = false;
        pending.clear();
        super.handleOnDestroy();
    }
}
