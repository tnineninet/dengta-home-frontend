import UIKit
import WebKit

@main
final class TransportDelegate: UIResponder, UIApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    var window: UIWindow?
    private var webView: WKWebView?
    private var nonce = ""
    private var sourceSha = ""
    private var origin: URL?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let args = ProcessInfo.processInfo.arguments
        func value(_ flag: String) -> String? {
            guard let index = args.firstIndex(of: flag), index + 1 < args.count else { return nil }
            return args[index + 1]
        }
        guard let raw = value("--fixture-url"), let url = URL(string: raw),
              url.scheme == "http", url.host == "127.0.0.1", url.path == "/fixture",
              let port = url.port, port > 1024, port <= 65535,
              let run = value("--run-nonce"), UUID(uuidString: run) != nil,
              let sha = value("--source-sha"), sha.range(of: "^[a-f0-9]{40}$", options: .regularExpression) != nil
        else { return false }
        nonce = run; sourceSha = sha; origin = url
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.add(self, name: "transport")
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = self
        webView = view
        let controller = UIViewController()
        controller.view = view
        let appWindow = UIWindow(frame: UIScreen.main.bounds)
        appWindow.rootViewController = controller
        appWindow.makeKeyAndVisible()
        window = appWindow
        view.load(URLRequest(url: url))
        return true
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, let expected = origin,
              url.scheme == expected.scheme, url.host == expected.host, url.port == expected.port,
              url.path == "/fixture" else { decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "transport", message.frameInfo.isMainFrame,
              let body = message.body as? [String: Any] else { return }
        let keys = ["streamedBeforeTerminal", "utf8", "postForm", "truncatedRejected", "abortRejected", "cancelledNoMoreEvents"]
        var receipt: [String: Any] = ["schemaVersion": 1, "nonce": nonce, "sourceSha": sourceSha,
            "runtime": "iOS Simulator WKWebView", "businessFlows": "not-exercised",
            "osVersion": ProcessInfo.processInfo.operatingSystemVersionString]
        for key in keys { receipt[key] = body[key] as? Bool ?? false }
        guard let data = try? JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys]) else { return }
        try? data.write(to: FileManager.default.temporaryDirectory.appendingPathComponent("transport-receipt.json"), options: .atomic)
    }
}
