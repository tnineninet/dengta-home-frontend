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
    private lazy var readinessScript: String? = {
        guard let url = Bundle.main.url(forResource: "DengTaReadiness", withExtension: "js") else { return nil }
        return try? String(contentsOf: url, encoding: .utf8)
    }()

    private func captureReadiness(attempt: Int) {
        guard let nonce = DengTaCIKeychainDiagnostics.runNonce, let script = readinessScript, attempt < 240 else { return }
        // Enum/boolean/geometry only. No DOM text, input values, HTML, URLs or
        // account state are exported. This does not authenticate a test user.
        webView?.evaluateJavaScript(script) { [weak self] result, _ in
            guard let self else { return }
            if let value = result as? [String: Any] {
                let states = ["unconfigured", "loading", "anonymous", "authenticating", "recovery", "authenticated", "expired", "error", "unknown"]
                var receipt: [String: Any] = ["schemaVersion": 2, "runNonce": nonce, "sample": attempt]
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
