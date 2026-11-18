# Goldfish Annotated Review Report

**Target:** logged-in core iOS paths and feature diff against main f8fa26ae (full relevant files).

Real fresh-context, read-only reviewers: `ios_loggedin_capabilities`, `ios_core_transport_review`. Root alone implements/tests. This additional round examines code paths absent from anonymous CI; it supplies source findings, not authenticated runtime acceptance.

## Prioritized Findings & AI Suggestions

### R6-01 — iOS settings offer web installation [logged-in capability audit] — P3

- **Affected Scope:** `src/App.jsx`, settings-app-actions; `WebInstallButton.jsx` and `pwa-install.js` standalone detection.
- **Discrepancy Description:** The WebInstallButton rendered before the iOS APK/update guard. Its PWA standalone check does not identify a native WKWebView, so the installed iOS app could offer installation/Add to Home Screen guidance.
- **Rationale:** Misleading installation UI conflicts with the intended native iOS experience; it is not an APK download or core crash.
- **AI Suggestion:** PROPOSE FIX.
- **Resolution:** Include the PWA control in the existing iOS guard alongside APK/update actions. Keep existing Web/Android behavior to honor the current product baseline; no Android rewrite.
- **Verification:** `test:pwa-install` and nine update/platform cases passed in `round6-install-controls.log`; Web compilation/current native CI follows this source change. Actual authenticated settings UI remains unverified.

## Checked paths without a confirmed introduced core finding

The capability reviewer traced App mount, text/voice preparation, persona copying, memory/settings, permission startup and Android callbacks. Missing DeviceActivity/Signals/ScreenGlance/BackgroundNotifications/DLNA/BrowserLauncher/Netease/Whereabouts bridges are guarded. Registering a proxy alone does not make Capacitor isPluginAvailable true. iOS startup checks notification permission without requesting it.

The transport reviewer traced POST FormData through apiFetch/browser fetch/ReadableStream reader/streaming TextDecoder/cancellation/terminal checks; no native HTTP interception was added. Core settings/personality/memory wrappers retain original context; chat events also fence current scope. The viewport sizing algorithm is preserved with ref-counted ownership. No introduced P1/P2 core blocker was confirmed from source.

## Existing optional gaps retained explicitly

Some direct capture/invalidation forwards in `voice.js` and `CompanionCreativeStudio.jsx` omit originating context. The same omission existed before this feature; those optional paths are outside Scope A hard acceptance. Root documented follow-up rather than claiming universal request isolation or silently expanding implementation scope. This is not evidence of a reproduced iOS failure.

No P0/P1 found in this additional review. Logged-in companion/SSE/personality/memory/settings and composer behavior still require actual local-Mac business acceptance.
