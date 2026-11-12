import XCTest

/// Anonymous UI exercise only. Never submit any form or use a real account.
final class KeyboardSmokeTests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "home.dengta.app")
    private var phases: [[String: Any]] = []

    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
    }

    private func launchAnonymous(_ nonce: String) {
        app.terminate()
        app.launchArguments = ["--dengta-ci-keychain-diagnostics", "--dengta-ci-run", nonce]
        app.launch()
        XCTAssertTrue(app.textFields["邮箱"].waitForExistence(timeout: 45))
    }

    private func rect(_ value: CGRect) -> [Int] {
        [Int(value.minX.rounded()), Int(value.minY.rounded()), Int(value.width.rounded()), Int(value.height.rounded())]
    }

    private func visible(_ element: XCUIElement, aboveKeyboard: Bool) -> Bool {
        guard element.exists, element.isHittable else { return false }
        let frame = element.frame, window = app.windows.firstMatch.frame
        let bottom = aboveKeyboard ? app.keyboards.firstMatch.frame.minY : window.maxY
        return frame.width > 0 && frame.height > 0 && frame.minX >= window.minX - 1 &&
            frame.maxX <= window.maxX + 1 && frame.minY >= window.minY && frame.maxY <= bottom - 2
    }

    private func reveal(_ element: XCUIElement, aboveKeyboard: Bool = false) {
        XCTAssertTrue(element.waitForExistence(timeout: 15))
        for _ in 0..<8 {
            if visible(element, aboveKeyboard: aboveKeyboard) { return }
            let window = app.windows.firstMatch.frame
            let availableBottom = aboveKeyboard ? app.keyboards.firstMatch.frame.minY : window.maxY
            let top = window.minY + 90, bottom = max(top + 90, availableBottom - 45)
            let down = element.frame.minY < top
            let from = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: window.maxX - 24, dy: down ? top + 10 : bottom))
            let to = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: window.maxX - 24, dy: down ? bottom : top + 10))
            from.press(forDuration: 0.05, thenDragTo: to)
        }
        XCTAssertTrue(visible(element, aboveKeyboard: aboveKeyboard), "Control must be fully visible in the scrollport")
    }

    private func record(_ phase: String, control: XCUIElement) {
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 10))
        XCTAssertTrue(keyboard.isHittable)
        reveal(control, aboveKeyboard: true)
        phases.append(["phase": phase, "keyboardVisible": true, "controlVisible": true,
            "control": rect(control.frame), "keyboard": rect(keyboard.frame), "window": rect(app.windows.firstMatch.frame)])
    }

    func testAnonymousKeyboardLayout() throws {
        let nonce = UUID().uuidString
        launchAnonymous(nonce)
        let email = app.textFields["邮箱"], password = app.secureTextFields["密码"]
        reveal(email); email.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        email.typeText("keyboard-smoke@example.invalid")
        record("login-email", control: email)
        reveal(password, aboveKeyboard: true); password.tap()
        password.typeText("Synthetic-Keyboard-Only-123")
        record("login-password", control: password)
        record("login-submit", control: app.buttons["回到我的伴侣身边"])

        // Relaunch clears unsaved input and keyboard, without contacting auth.
        launchAnonymous(nonce)
        let register = app.buttons["注册"]
        reveal(register); register.tap()
        let confirmation = app.secureTextFields["再次输入密码"]
        reveal(confirmation); confirmation.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        confirmation.typeText("Synthetic-Keyboard-Only-123")
        record("register-confirmation", control: confirmation)
        record("register-submit", control: app.buttons["创建我的空间"])

        launchAnonymous(nonce)
        let forgot = app.buttons["忘记密码"]
        reveal(forgot); forgot.tap()
        let recoveryEmail = app.textFields["邮箱"]
        reveal(recoveryEmail); recoveryEmail.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        recoveryEmail.typeText("keyboard-smoke@example.invalid")
        record("forgot-email", control: recoveryEmail)
        record("forgot-submit", control: app.buttons["发送重置邮件"])

        let receipt: [String: Any] = ["schemaVersion": 1, "runNonce": nonce, "phases": phases, "submitted": false]
        let data = try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys])
        print("DENGTA_KEYBOARD_EVIDENCE:" + String(decoding: data, as: UTF8.self))
        app.terminate()
    }
}
