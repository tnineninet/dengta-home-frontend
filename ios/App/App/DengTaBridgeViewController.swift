import Capacitor
import UIKit

@objc(DengTaBridgeViewController)
final class DengTaBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        CAPLog.enableLogging = false
        bridge?.registerPluginInstance(DengTaKeychainPlugin())
        DengTaCIKeychainDiagnostics.record("bridge-created")
        DengTaCIKeychainDiagnostics.record(bridge?.plugin(withName: "DengTaKeychain") != nil ? "bridge-keychain-available" : "bridge-keychain-missing")
        DengTaCIKeychainDiagnostics.record(UIApplication.shared.isProtectedDataAvailable ? "protected-data-available" : "protected-data-unavailable")
        DengTaCIKeychainDiagnostics.runRoundTripProbe()
        #if DEBUG && targetEnvironment(simulator)
        captureReadiness(attempt: 0)
        #endif
    }

    #if DEBUG && targetEnvironment(simulator)
    private func captureReadiness(attempt: Int) {
        guard let nonce = DengTaCIKeychainDiagnostics.runNonce, attempt < 120 else { return }
        // Enum/boolean/geometry only. No DOM text, input values, HTML, URLs or
        // account state are exported. This does not authenticate a test user.
        let script = """
        (() => {
          const d = document, r = d.documentElement;
          const states = ['unconfigured','loading','anonymous','authenticating','recovery','authenticated','expired','error'];
          const state = states.includes(r.dataset.authStatus) ? r.dataset.authStatus : 'unknown';
          const form = d.querySelector('.auth-form');
          const email = form?.querySelector('input[type="email"]');
          const password = form?.querySelector('input[type="password"]');
          const submit = form?.querySelector('button[type="submit"]');
          const visible = e => !!e && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0;
          const controls = [email, password, submit].every(e => visible(e) && !e.disabled);
          const blocked = !!d.querySelector('.auth-loading-page,.auth-configuration-page,.auth-secure-cleanup-page,.auth-feedback[role="alert"]');
          const v = window.visualViewport;
          return { state, ready: state === 'anonymous' && controls && !blocked,
            controls, blocked, keyboardOpen: r.dataset.keyboardOpen === 'true',
            viewportHeight: Math.round(v?.height || innerHeight), viewportOffsetTop: Math.round(v?.offsetTop || 0),
            innerHeight: Math.round(innerHeight), androidMarker: r.dataset.dengtaAndroid === 'true',
            apkEntry: !!d.querySelector('a[href="/download"]') };
        })()
        """
        webView?.evaluateJavaScript(script) { [weak self] result, _ in
            guard let self else { return }
            if let value = result as? [String: Any] {
                let states = ["unconfigured", "loading", "anonymous", "authenticating", "recovery", "authenticated", "expired", "error", "unknown"]
                var receipt: [String: Any] = ["schemaVersion": 1, "runNonce": nonce]
                receipt["state"] = states.contains(value["state"] as? String ?? "") ? value["state"] : "unknown"
                for key in ["ready", "controls", "blocked", "keyboardOpen", "androidMarker", "apkEntry"] {
                    receipt[key] = value[key] as? Bool ?? false
                }
                for key in ["viewportHeight", "viewportOffsetTop", "innerHeight"] {
                    receipt[key] = max(0, min(10000, (value[key] as? NSNumber)?.intValue ?? 0))
                }
                receipt["safeAreaTop"] = Int(self.view.safeAreaInsets.top.rounded())
                receipt["safeAreaBottom"] = Int(self.view.safeAreaInsets.bottom.rounded())
                if let data = try? JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys]) {
                    let url = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("dengta-ci-ui-diagnostics.json")
                    try? data.write(to: url, options: [.atomic])
                }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.captureReadiness(attempt: attempt + 1) }
        }
    }
    #endif
}
