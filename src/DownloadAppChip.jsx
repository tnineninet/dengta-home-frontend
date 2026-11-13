import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { offersAndroidDownload } from "./pwa-install.js";
import "./download-app-chip.css";

const DISMISS_KEY = "dengta.download-chip.dismissed.v1";

function isNativeApp() {
  try {
    return Capacitor.isNativePlatform() === true;
  } catch {
    return false;
  }
}

export default function DownloadAppChip() {
  const [visible, setVisible] = useState(() => {
    if (isNativeApp() || !offersAndroidDownload()) return false;
    if (typeof window === "undefined") return false;
    if (/^\/(?:download|install)(?:\/|$)/.test(window.location.pathname)) {
      return false;
    }
    try {
      return window.localStorage.getItem(DISMISS_KEY) !== "1";
    } catch {
      return true;
    }
  });

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // The banner can still be dismissed for this page.
    }
  };

  return (
    <aside className="download-app-chip" aria-label="下载 DengTa App">
      <a href="/download" className="download-app-chip-link">
        <span className="download-app-chip-icon" aria-hidden="true">↓</span>
        <span className="download-app-chip-copy">
          <strong>下载 DengTa App</strong>
          <small>安卓安装包 · 手机直接用</small>
        </span>
        <span className="download-app-chip-arrow" aria-hidden="true">›</span>
      </a>
      <button
        type="button"
        className="download-app-chip-close"
        aria-label="关闭下载提示"
        onClick={dismiss}
      >
        ×
      </button>
    </aside>
  );
}
