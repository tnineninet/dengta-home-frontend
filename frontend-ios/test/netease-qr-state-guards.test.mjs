import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "NeteaseQrLogin.jsx"), "utf8");

test("unmount invalidates in-flight QR attempts before stopping polling", () => {
    assert.match(source, /useEffect\(\(\) => \(\) => \{[\s\S]*loginAttemptRef\.current \+= 1;[\s\S]*stopPolling\(\);/);
});

test("poll callback re-checks the attempt after await", () => {
    assert.match(source, /const result = await checkNeteaseQrLogin\(session\.key\);\s*\n\s*if \(attempt !== loginAttemptRef\.current\) return;/);
});

test("auto-refresh excludes confirmed, risk_blocked and scanned", () => {
    assert.match(source, /result\?\.status !== "confirmed" && result\?\.status !== "risk_blocked" && result\?\.status !== "scanned"/);
});

test("cancel clears busy and confirms/risk invalidate in-flight begins", () => {
    assert.match(source, /const cancelLogin = useCallback\(\(\) => \{[\s\S]*loginAttemptRef\.current \+= 1;[\s\S]*setBusy\(false\);/);
    assert.match(source, /setQrStatus\("confirmed"\);|setQrStatus\("risk_blocked"\);/);
});