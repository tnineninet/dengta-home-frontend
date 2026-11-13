import Foundation
import XCTest

/// Drives the product UI. Only the synthetic mode may acknowledge a fixture or
/// capture a screen; credentials stay in the private XCTest process environment.
final class BusinessFlowTests: XCTestCase {
    private enum BusinessFailure: Error { case acceptanceFailed }
    private final class AckResult: @unchecked Sendable { var passed = false }
    private final class NoRedirect: NSObject, URLSessionTaskDelegate {
        func urlSession(_ session: URLSession, task: URLSessionTask,
                        willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest,
                        completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(nil)
        }
    }

    private let app = XCUIApplication(bundleIdentifier: "home.dengta.app")
    private var environment: [String: String] = [:]
    private var mode = "synthetic"
    private var nonce = ""
    private var safeTop: CGFloat = 0
    private var safeBottom: CGFloat = 0
    private var settingsOpen = false
    private var personaTouched = false
    private var baselinePrompt = ""
    private var baselineDetails = ""
    private var editedPrompt = ""
    private var editedDetails = ""
    private var phases: [[String: Any]] = []
    private var evidence: [String: Any] = [:]

    private let firstToken = "DengTa 合成流式第一段 🧭"
    // WebKit AX may split a wrapped paragraph into several static texts. This
    // unique second-chunk prefix stays within one line; the runner separately
    // verifies the fixture's terminal event and persisted complete reply.
    private let finalToken = "DengTa 合成流式第二段"
    private let question = "This is a safe interface acceptance check. Please reply with one short, friendly sentence."

    override func setUpWithError() throws {
        // Throw fixed errors after recording a failure so cleanup can still run.
        continueAfterFailure = true
        XCUIDevice.shared.orientation = .portrait
        environment = ProcessInfo.processInfo.environment
        mode = environment["DENGTA_BUSINESS_MODE"] ?? "synthetic"
        try require(["synthetic", "live"].contains(mode), "Unsupported business acceptance mode.")
        nonce = try configured("DENGTA_BUSINESS_NONCE")
        try require(nonce.range(of: "^[A-Za-z0-9-]{16,80}$", options: .regularExpression) != nil,
                    "A bounded business run nonce is required.")
        _ = try configured("DENGTA_BUSINESS_EMAIL")
        _ = try configured("DENGTA_BUSINESS_PASSWORD")
        guard let prompt = environment["DENGTA_BUSINESS_PROMPT_BASELINE"],
              let details = environment["DENGTA_BUSINESS_DETAILS_BASELINE"],
              let top = Int(environment["DENGTA_UI_SAFE_TOP"] ?? ""),
              let bottom = Int(environment["DENGTA_UI_SAFE_BOTTOM"] ?? "") else {
            try require(false, "Business baseline and native safe-area metadata are required.")
            return
        }
        try require((0...200).contains(top) && (0...200).contains(bottom), "Invalid native safe-area metadata.")
        safeTop = CGFloat(top); safeBottom = CGFloat(bottom)
        baselinePrompt = prompt; baselineDetails = details
        editedPrompt = prompt + "\n[interface acceptance \(nonce)] Keep replies kind and safe.\n"
        editedDetails = details + "\n[interface acceptance \(nonce)] This line is temporary test data.\n"
        evidence = ["schemaVersion": 1, "runNonce": nonce, "mode": mode,
                    "login": false, "restoredSession": false, "chatSent": false,
                    "streamedBeforeTerminal": false, "streamComplete": false,
                    "personaSaved": false, "personaReadBack": false, "personaRestored": false,
                    "memoryOpened": false, "settingsOpened": false, "composerGeometry": false,
                    "logout": false, "screenshotCaptured": false]
    }

    private func configured(_ name: String) throws -> String {
        guard let value = environment[name], !value.isEmpty else {
            try require(false, "Required private business acceptance configuration is unavailable.")
            return ""
        }
        return value
    }

    private func require(_ condition: Bool, _ message: String) throws {
        guard condition else {
            XCTFail(message)
            throw BusinessFailure.acceptanceFailed
        }
    }

    private func wait(_ timeout: TimeInterval = 30, until condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.15))
        } while Date() < deadline
        return condition()
    }

    private func button(_ label: String, containing: Bool = false) -> XCUIElement {
        let predicate = NSPredicate(format: containing ? "label CONTAINS %@" : "label == %@", label)
        let matches = app.buttons.matching(predicate)
        return matches.allElementsBoundByIndex.first(where: { $0.exists && $0.isHittable }) ?? matches.firstMatch
    }

    private func text(_ value: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", value)).firstMatch
    }

    private func visible(_ element: XCUIElement, aboveKeyboard: Bool) -> Bool {
        guard element.exists, element.isHittable else { return false }
        let frame = element.frame, window = app.windows.firstMatch.frame
        let top = scrollTop(for: element, window: window)
        let bottom = aboveKeyboard
            ? min(app.keyboards.firstMatch.frame.minY, window.maxY - safeBottom)
            : window.maxY - safeBottom
        return frame.width > 0 && frame.height > 0 && frame.minX >= window.minX - 1 &&
            frame.maxX <= window.maxX + 1 && frame.minY >= top && frame.maxY <= bottom - 2
    }

    private func scrollTop(for element: XCUIElement, window: CGRect) -> CGFloat {
        let safe = window.minY + safeTop
        // The settings header stays fixed while its body scrolls. A downward
        // gesture beginning at safeTop + 22 lands on that header on iPhone 17.
        // Keep body controls/gestures below it; Done itself belongs to the header.
        if settingsOpen && element.label != "Done" {
            let done = button("Done")
            if done.exists { return max(safe, done.frame.maxY + 24) }
        }
        return safe
    }

    private func reveal(_ element: XCUIElement, aboveKeyboard: Bool = false) throws {
        try require(element.waitForExistence(timeout: 20), "Required business control did not appear.")
        let avoidKeyboard = aboveKeyboard || app.keyboards.firstMatch.exists
        for _ in 0..<12 {
            if visible(element, aboveKeyboard: avoidKeyboard) { return }
            let window = app.windows.firstMatch.frame
            let availableBottom = avoidKeyboard ? app.keyboards.firstMatch.frame.minY : window.maxY - safeBottom
            let top = scrollTop(for: element, window: window) + 12
            let bottom = max(top + 90, availableBottom - 45)
            let down = element.frame.minY < top
            let from = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: window.maxX - 24, dy: down ? top + 10 : bottom))
            let to = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: window.maxX - 24, dy: down ? bottom : top + 10))
            from.press(forDuration: 0.05, thenDragTo: to)
        }
        try require(visible(element, aboveKeyboard: avoidKeyboard), "Business control must be fully visible in its scrollport.")
    }

    private func tap(_ label: String, containing: Bool = false) throws {
        let target = button(label, containing: containing)
        try reveal(target)
        target.tap()
    }

    private func dismissKeyboard() {
        guard app.keyboards.firstMatch.exists else { return }
        for label in ["Done", "完成", "收起键盘"] {
            for query in [app.keyboards.buttons.matching(identifier: label), app.toolbars.buttons.matching(identifier: label)] {
                if let target = query.allElementsBoundByIndex.first(where: { $0.exists && $0.isHittable }) {
                    target.tap(); return
                }
            }
        }
        let submitted = text(question)
        if !settingsOpen && submitted.exists && submitted.isHittable { submitted.tap(); return }
        // Both product headers have a non-editable title at this position.
        let window = app.windows.firstMatch.frame
        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: window.midX, dy: window.minY + safeTop + 30)).tap()
    }

    private func rect(_ frame: CGRect) -> [Int] {
        [Int(frame.minX.rounded()), Int(frame.minY.rounded()), Int(frame.width.rounded()), Int(frame.height.rounded())]
    }

    private func recordGeometry(_ phase: String, control: XCUIElement) throws {
        let keyboard = app.keyboards.firstMatch
        try require(keyboard.waitForExistence(timeout: 10), "A real native keyboard is required.")
        let windowBeforeReveal = app.windows.firstMatch.frame
        // Keyboard is an AX container and may have no hit point even when its
        // keys are on screen. Require real keys and its visible native frame.
        try require(keyboard.keys.count > 0 && keyboard.frame.height > 100 &&
                    keyboard.frame.intersection(windowBeforeReveal).height > 100,
                    "A visible native keyboard with real keys is required.")
        try reveal(control, aboveKeyboard: true)
        let window = app.windows.firstMatch.frame
        for frame in [window, keyboard.frame, control.frame] {
            try require([frame.minX, frame.minY, frame.width, frame.height].allSatisfy { $0.isFinite } &&
                        frame.width > 0 && frame.height > 0 && frame.width <= 2000 && frame.height <= 2000 &&
                        frame.minX >= window.minX - 1 && frame.minY >= window.minY - 1 &&
                        frame.maxX <= window.maxX + 1 && frame.maxY <= window.maxY + 1,
                        "Native business geometry must remain bounded by the app window.")
        }
        phases.append(["phase": phase, "control": rect(control.frame), "keyboard": rect(keyboard.frame),
                       "window": rect(window)])
    }

    private func relaunchAuthenticated() throws {
        app.terminate()
        settingsOpen = false
        app.launch()
        try require(app.textViews["聊天消息"].waitForExistence(timeout: 45), "Native session did not restore after relaunch.")
        try require(!app.textFields["邮箱"].exists, "Relaunch returned to the account form.")
    }

    private func openPersona() throws {
        dismissKeyboard()
        if !settingsOpen {
            // On a phone the desktop gear lives in a closed, offscreen sidebar.
            // Use the same status-sheet entry a person can actually tap.
            if !button("打开设置").isHittable {
                try tap("查看状态")
            }
            try tap("打开设置")
            try require(button("Done").waitForExistence(timeout: 15), "Settings sheet did not open.")
            settingsOpen = true
            evidence["settingsOpened"] = true
        }
        if !app.textViews["个性化指令"].exists {
            if button("返回设置分类").exists { try tap("返回设置分类") }
            try tap("个性化与记忆", containing: true)
        }
        try require(app.textViews["个性化指令"].waitForExistence(timeout: 20) &&
                    app.textViews["你的详情"].waitForExistence(timeout: 20), "Personalization controls did not open.")
    }

    private func closeSettings() throws {
        dismissKeyboard()
        try tap("Done")
        settingsOpen = false
    }

    private func valueMatches(_ element: XCUIElement, expected: String, label: String) -> Bool {
        let value = element.value as? String ?? ""
        if value == expected { return true }
        // WebKit may expose an empty textarea's placeholder as its AX value.
        let placeholders = ["个性化指令": "写清楚稳定身份、关系和表达习惯……",
                            "你的详情": "例如：称呼、长期偏好、重要背景，以及希望伴侣始终记得的个人详情……"]
        return expected.isEmpty && value == placeholders[label]
    }

    private func assertValue(_ label: String, _ expected: String) throws {
        let field = app.textViews[label]
        try reveal(field)
        try require(wait(10) { self.valueMatches(field, expected: expected, label: label) },
                    "Personalization value did not match the expected UI readback.")
    }

    private func selectAllMenu() -> XCUIElement? {
        for label in ["Select All", "全选"] {
            for query in [app.menuItems.matching(identifier: label), app.buttons.matching(identifier: label)] {
                if let target = query.allElementsBoundByIndex.first(where: { $0.exists && $0.isHittable }) { return target }
            }
        }
        return nil
    }

    private func replace(_ label: String, expected: String, with replacement: String) throws {
        let field = app.textViews[label]
        try assertValue(label, expected)
        try reveal(field)
        field.tap()
        if !expected.isEmpty {
            field.press(forDuration: 1.1)
            if !wait(3, until: { self.selectAllMenu() != nil }) {
                field.doubleTap()
                _ = wait(3, until: { self.selectAllMenu() != nil })
            }
            if let selectAll = selectAllMenu() {
                selectAll.tap()
                field.typeText(XCUIKeyboardKey.delete.rawValue)
            } else {
                // The synthetic markers are short. Tapping below their last
                // line places the caret at the end without clipboard access.
                try require(expected.count <= 256, "Native select-all was unavailable for the existing text.")
                field.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.90)).tap()
                field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: expected.count + 1))
            }
        }
        if !replacement.isEmpty { field.typeText(replacement) }
        try require(wait(10) { self.valueMatches(field, expected: replacement, label: label) },
                    "Native personalization editing did not preserve the intended text.")
        dismissKeyboard()
    }

    private func awaitSaved(prompt: String, details: String) throws {
        let promptCount = text("个性化指令 \(prompt.utf16.count) 字")
        let detailsCount = text("你的详情 \(details.utf16.count) 字")
        try reveal(promptCount)
        try require(wait(35) { promptCount.exists && detailsCount.exists && self.text("已自动保存").exists },
                    "The server save-and-readback receipt did not confirm both personalization fields.")
    }

    private func restorePersona() throws {
        try openPersona()
        var changed = false
        for (label, baseline, edited) in [("个性化指令", baselinePrompt, editedPrompt), ("你的详情", baselineDetails, editedDetails)] {
            let field = app.textViews[label]
            try reveal(field)
            if valueMatches(field, expected: baseline, label: label) { continue }
            try require(valueMatches(field, expected: edited, label: label), "Personalization changed outside this test; automatic restoration stopped.")
            try replace(label, expected: edited, with: baseline)
            changed = true
        }
        if changed { try awaitSaved(prompt: baselinePrompt, details: baselineDetails) }
        try closeSettings()
        try relaunchAuthenticated()
        try openPersona()
        try assertValue("个性化指令", baselinePrompt)
        try assertValue("你的详情", baselineDetails)
        evidence["personaRestored"] = true
        personaTouched = false
    }

    private func acknowledgeSyntheticStream() throws {
        try require(mode == "synthetic", "Fixture acknowledgement is restricted to synthetic mode.")
        let raw = try configured("DENGTA_BUSINESS_CONTROL_URL")
        guard var components = URLComponents(string: raw),
              ["http", "https"].contains(components.scheme ?? ""),
              ["127.0.0.1", "localhost", "::1"].contains(components.host ?? ""),
              components.user == nil, components.password == nil, components.query == nil,
              components.fragment == nil, ["", "/"].contains(components.path) else {
            try require(false, "Synthetic control must use a credential-free loopback origin.")
            return
        }
        components.path = "/__dengta_ci/ack-stream"
        guard let url = components.url else {
            try require(false, "Synthetic acknowledgement URL is invalid.")
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["runNonce": nonce])
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 15
        let session = URLSession(configuration: configuration, delegate: NoRedirect(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let completed = DispatchSemaphore(value: 0), result = AckResult()
        let task = session.dataTask(with: request) { data, response, error in
            if error == nil, (response as? HTTPURLResponse)?.statusCode == 200,
               let data, let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                result.passed = json["ok"] as? Bool == true
            }
            completed.signal()
        }
        task.resume()
        let finished = completed.wait(timeout: .now() + 20) == .success
        try require(finished && result.passed, "Synthetic stream acknowledgement was not confirmed.")
    }

    private func captureSyntheticScreenIfRequested() throws {
        guard mode == "synthetic", let path = environment["DENGTA_BUSINESS_SCREENSHOT_PATH"] else { return }
        try require(path == "__TEST_RUNNER_TMP__/dengta-ci-business.png", "Synthetic screenshot must use the fixed private runner destination.")
        let url = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("dengta-ci-business.png")
        try app.screenshot().pngRepresentation.write(to: url, options: [.atomic])
        evidence["screenshotCaptured"] = true
    }

    private func printEvidence() {
        evidence["phases"] = phases
        if let data = try? JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys]),
           let line = String(data: data, encoding: .utf8) {
            print("DENGTA_BUSINESS_EVIDENCE:" + line)
        }
    }

    func testCoreBusinessFlow() throws {
        defer { printEvidence(); app.terminate() }
        do {
            // No auth seeding, callback approval, credential arguments or JS.
            app.launchArguments = []
            app.launchEnvironment = [:]
            app.launch()
            let email = app.textFields["邮箱"], password = app.secureTextFields["密码"]
            try reveal(email)
            email.tap(); email.typeText(try configured("DENGTA_BUSINESS_EMAIL"))
            try reveal(password, aboveKeyboard: true)
            password.tap(); password.typeText(try configured("DENGTA_BUSINESS_PASSWORD"))
            try tap("回到我的伴侣身边")
            let composer = app.textViews["聊天消息"]
            try require(composer.waitForExistence(timeout: 60), "Authenticated product chat did not appear.")
            evidence["login"] = true

            try reveal(composer)
            composer.tap(); composer.typeText(question)
            try recordGeometry("composer", control: composer)
            let send = button("发送")
            try recordGeometry("send", control: send)
            try require(send.isEnabled, "The native send control is disabled for the acceptance message.")
            evidence["composerGeometry"] = true
            send.tap()
            if mode == "synthetic" {
                let firstChunk = text(firstToken)
                try require(firstChunk.waitForExistence(timeout: 45), "The first synthetic stream chunk did not reach the product UI.")
                try reveal(firstChunk)
                try require(!text(finalToken).exists && button("停止等待").exists,
                            "Synthetic terminal output appeared before the native UI acknowledgement.")
                evidence["streamedBeforeTerminal"] = true
                try acknowledgeSyntheticStream()
                try require(text(finalToken).waitForExistence(timeout: 30), "The completed synthetic reply did not reach the product UI.")
                try reveal(text(finalToken))
            }
            // Live mode intentionally does not infer incremental delivery from
            // a completed reply; streamedBeforeTerminal stays false there.
            try require(wait(90) { self.button("发送").exists && !self.button("停止等待").exists },
                        "Chat did not return to the successful terminal UI state.")
            try require(text(question).exists, "The submitted acceptance message is missing from the transcript.")
            evidence["chatSent"] = true
            // Live remains unavailable until a successful assistant reply and
            // its restoration are independently proven. Idle Send is insufficient.
            evidence["streamComplete"] = mode == "synthetic"
            dismissKeyboard()
            try captureSyntheticScreenIfRequested()

            try openPersona()
            try assertValue("个性化指令", baselinePrompt)
            try assertValue("你的详情", baselineDetails)
            personaTouched = true
            try replace("个性化指令", expected: baselinePrompt, with: editedPrompt)
            try replace("你的详情", expected: baselineDetails, with: editedDetails)
            try awaitSaved(prompt: editedPrompt, details: editedDetails)
            evidence["personaSaved"] = true
            try closeSettings()
            try relaunchAuthenticated()
            try require(text(question).waitForExistence(timeout: 30), "The saved conversation did not restore after relaunch.")
            if mode == "synthetic" {
                try require(text(finalToken).waitForExistence(timeout: 30), "The completed reply did not restore from conversation history.")
            }
            evidence["restoredSession"] = true
            try openPersona()
            try assertValue("个性化指令", editedPrompt)
            try assertValue("你的详情", editedDetails)
            evidence["personaReadBack"] = true
            try restorePersona()

            try tap("打开记忆页")
            settingsOpen = false
            try require(text("留在家里的事情").waitForExistence(timeout: 25), "The product memory page did not open.")
            try require(text("已读取当前账号与伴侣的摘要。").waitForExistence(timeout: 25), "The scoped memory list did not confirm its read.")
            evidence["memoryOpened"] = true

            if mode == "synthetic" {
                try tap("打开菜单")
                let account = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "账号：")).firstMatch
                try reveal(account); account.tap()
                let logoutButton = button("退出登录")
                if logoutButton.exists {
                    try reveal(logoutButton); logoutButton.tap()
                } else {
                    let item = app.menuItems["退出登录"]
                    try reveal(item); item.tap()
                }
                try require(app.textFields["邮箱"].waitForExistence(timeout: 30), "Synthetic logout did not return to the account form.")
                app.terminate(); app.launch()
                try require(app.textFields["邮箱"].waitForExistence(timeout: 30) && !app.textViews["聊天消息"].exists,
                            "Synthetic logout did not clear the restored native session.")
                evidence["logout"] = true
            }
        } catch {
            // The fixture contains synthetic data only. Live never captures a
            // failure screen, entered credentials, or a logout screen.
            if mode == "synthetic" {
                try? captureSyntheticScreenIfRequested()
                // Synthetic accounts and messages only. The accessibility tree
                // explains WebKit text grouping without inspecting page state.
                print("DENGTA_SYNTHETIC_AX_FAILURE:\n" + app.debugDescription)
            }
            if personaTouched {
                // Restoring is bounded to the exact values this test wrote.
                // A mismatched value stops cleanup rather than overwriting it.
                do { try restorePersona() } catch { XCTFail("Personalization baseline restoration remains unconfirmed.") }
            }
            throw BusinessFailure.acceptanceFailed
        }
    }
}
