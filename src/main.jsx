import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./refusal-banner.css";
import "./cozy-theme.css";
import "./auth.css";
import "./native-feel.css";
import "./apple-ui.css";
import "./sun-glass-ui.css";
import "./jelly-motion.css";
import "./sun-glass-chat.css";
import "./typography.css";
import "./apple-high.css";
import "./room-invite.css";
import "./settings-media-polish.css";
import "./interaction-polish.css";
import "./interface-polish.css";
import "./settings-night-contrast.css";
import "./android-compat.css";
import "./menu-interactions.css";
import "./force-mobile.css";
import LoadedApp from "./LoadedApp.jsx";
import AuthGate from "./AuthGate.jsx";
import { authSession } from "./auth-session.js";
import DengTaPrelude from "./DengTaPrelude.jsx";
import { prewarmBackend } from "./backend-prewarm.js";
import { installAndroidCompatibility } from "./android-compat.js";
import { pwaInstallController } from "./pwa-install.js";
import ReceiverApp from "./ReceiverApp.jsx";
import DownloadAppChip from "./DownloadAppChip.jsx";
import {
  AppLoadingScreen,
  AppStartupBoundary,
} from "./AppStartupBoundary.jsx";
import {
  installChunkRecovery,
} from "./app-startup-recovery.js";

const isReceiverRoute = window.location.pathname === "/receive";

// Some MIUI/HyperOS WebViews can leave a transparent first-screen layer above
// the app, or apply a broken start-up zoom. Give the user a native-looking,
// always-top escape hatch if the page received no touch for several seconds.
function installAndroidTouchRecovery() {
  if (!window.Capacitor?.isNativePlatform?.()) return;
  if (window.__dengtaTouchRecoveryInstalled) return;
  window.__dengtaTouchRecoveryInstalled = true;
  let recoveryButton = null;
  const removeButton = () => {
    recoveryButton?.remove();
    recoveryButton = null;
  };
  window.setTimeout(() => {
    if (document.querySelector(".dengta-touch-recovery")) return;
    const root = document.getElementById("root");
    const prelude = document.querySelector(".dengta-prelude");
    const startup = document.querySelector(".app-startup-page");
    const appEmpty = !root || root.childElementCount === 0;
    const topElement = document.elementFromPoint(
      Math.max(1, window.innerWidth / 2),
      Math.max(1, window.innerHeight / 2),
    );
    const topOutsideRoot = Boolean(topElement && root && !root.contains(topElement));
    if (!(prelude || startup || appEmpty || topOutsideRoot)) return;
    // A prelude/startup veil left behind by an interrupted first paint is the
    // most common invisible full-screen blocker. Removing it is harmless.
    prelude?.remove();
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dengta-touch-recovery";
    button.textContent = "界面点不动？点此重载";
    button.setAttribute("aria-label", "界面点不动，重新加载应用");
    button.style.cssText = [
      "position:fixed",
      "z-index:2147483647",
      "right:14px",
      "bottom:calc(18px + env(safe-area-inset-bottom))",
      "min-height:46px",
      "padding:10px 16px",
      "border:1px solid rgba(255,255,255,.32)",
      "border-radius:16px",
      "background:rgba(24,20,26,.92)",
      "color:#fff",
      "font:600 14px/1.25 system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif",
      "box-shadow:0 10px 30px rgba(0,0,0,.32)",
      "cursor:pointer",
      "touch-action:manipulation",
    ].join(";");
    button.addEventListener("click", () => {
      removeButton();
      window.location.reload();
    });
    document.body.appendChild(button);
    recoveryButton = button;
  }, 7000);
}

if (!isReceiverRoute) {
  installAndroidCompatibility();
  installChunkRecovery();
  installAndroidTouchRecovery();
  void prewarmBackend();
  pwaInstallController.start();
}

// 缺陷 1 修复：接收 dengta://auth... 深度链接回跳（邮箱验证 / 密码重置）。
// 原生 App 无法通过 WebView URL 感知 fragment，必须监听 @capacitor/app 事件。
// 放映厅邀请深链：dengta://room/join?code=XXXXXX 或 https://dengtahome.com/room/join?code=XXXXXX
if (!isReceiverRoute) {
  let lastHandledDeepLink = "";
  const handleDeepLink = (rawValue) => {
    const rawUrl = String(rawValue || "");
    if (!rawUrl || rawUrl === lastHandledDeepLink) return;
    lastHandledDeepLink = rawUrl;
    if (rawUrl.startsWith("dengta://auth")) {
      void authSession
        .handleAuthCallbackUrl(rawUrl)
        .catch(() => {
          // 回跳失败会发布 error 快照，由 AuthGate 显示给用户
        });
    } else if (
      rawUrl.includes("room/join") ||
      /[?&]room_code=/.test(rawUrl)
    ) {
      // 放映厅邀请：把邀请码存入本地，App 加载完成后弹出接受/拒绝邀请
      import("./room-invite.js")
        .then((m) => m.acceptRoomInviteUrl(rawUrl))
        .catch(() => {});
    }
  };
  import("@capacitor/app")
    .then(({ App }) => {
      App.addListener("appUrlOpen", (data) => handleDeepLink(data?.url));
      // 冷启动只通过 getLaunchUrl() 提供首个深链，不会触发 appUrlOpen。
      Promise.resolve(App.getLaunchUrl?.())
        .then((data) => handleDeepLink(data?.url))
        .catch(() => {});
    })
    .catch(() => {
      // @capacitor/app 在纯 Web 构建中不可用时静默跳过，邮箱验证走 Web URL 回跳
    });
}

// Pause decorative animations while the app is hidden or the user is actively
// scrolling. Android WebView keeps compositing animations off-screen otherwise.
const htmlRoot = document.documentElement;
// Save the 7.4MB CJK webfont on data-saver / low-memory phones; system fonts
// already cover Chinese and avoid a large first-load font decode.
if (navigator.connection?.saveData || (Number(navigator.deviceMemory) || 8) <= 4) {
  htmlRoot.dataset.dengtaLowData = "1";
}
function syncDocumentHidden() {
  htmlRoot.dataset.dengtaHidden =
    document.visibilityState === "hidden" ? "1" : "";
}
syncDocumentHidden();
document.addEventListener("visibilitychange", syncDocumentHidden);
let scrollPauseTimer = 0;
let lastUserScrollAt = 0;
const markUserScroll = () => {
  lastUserScrollAt = performance.now();
};
document.addEventListener("wheel", markUserScroll, {
  capture: true,
  passive: true,
});
document.addEventListener("touchmove", markUserScroll, {
  capture: true,
  passive: true,
});
document.addEventListener(
  "keydown",
  (event) => {
    if (
      [
        "ArrowUp",
        "ArrowDown",
        "PageUp",
        "PageDown",
        "Home",
        "End",
        " ",
      ].includes(event.key)
    ) {
      markUserScroll();
    }
  },
  { capture: true },
);
document.addEventListener(
  "scroll",
  () => {
    // Programmatic chat auto-scroll (streaming, scrollIntoView, route changes)
    // must not pause decorative animations. Only treat scroll as a user
    // gesture when a wheel/touch/keyboard gesture happened just before it.
    if (performance.now() - lastUserScrollAt > 260) return;
    htmlRoot.dataset.dengtaScrolling = "1";
    window.clearTimeout(scrollPauseTimer);
    scrollPauseTimer = window.setTimeout(() => {
      htmlRoot.dataset.dengtaScrolling = "";
    }, 140);
  },
  { capture: true, passive: true },
);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {isReceiverRoute ? <ReceiverApp /> : <>
      <DengTaPrelude />
      <AuthGate>
        {({ accountControl, snapshot }) => (
          <AppStartupBoundary
            accountScope={snapshot.user?.id || ""}
            sessionManager={authSession}
          >
            <Suspense fallback={<AppLoadingScreen />}>
              <LoadedApp key={JSON.stringify([snapshot.user?.id, snapshot.activeCompanionId])} accountControl={accountControl} accountScope={snapshot.user?.id || ""} userName={snapshot.user?.displayName} companionScope={snapshot.activeCompanionId || ""} />
            </Suspense>
          </AppStartupBoundary>
        )}
      </AuthGate>
      <DownloadAppChip />
    </>}
  </StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Service Worker 注册失败：", error);
    });
  });
} else if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) =>
      Promise.all(registrations.map((registration) => registration.unregister())),
    )
    .catch(() => {
      // 开发环境清理失败不会影响页面调试。
    });
}
