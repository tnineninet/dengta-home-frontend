import { Capacitor } from "@capacitor/core";

let installed = false;

/**
 * Runtime adaptation for Android WebViews that do not match the reference
 * device. Keep this deliberately small: the native shell owns zoom/text
 * scaling, while the web layer owns viewport variables and layer hygiene.
 */
export function installAndroidCompatibility() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const root = document.documentElement;
  const native = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  if (native) root.dataset.dengtaAndroid = "true";

  const syncViewport = () => {
    const height = Math.round(
      window.visualViewport?.height || window.innerHeight || 0,
    );
    if (height > 0) root.style.setProperty("--dengta-visible-height", `${height}px`);
  };

  syncViewport();
  window.addEventListener("resize", syncViewport, { passive: true });
  window.addEventListener("orientationchange", syncViewport, { passive: true });
  window.visualViewport?.addEventListener?.("resize", syncViewport, { passive: true });

  // A tap on Android can leave hover styling active until the next tap. A
  // one-time class lets the stylesheet avoid hover-only transforms.
  const markTouch = () => root.classList.add("dengta-touch");
  window.addEventListener("touchstart", markTouch, { once: true, passive: true });
  window.addEventListener("pointerdown", markTouch, { once: true, passive: true });

  if (!native) return;

  // After startup, remove accidental full-screen decoration from the hit-test
  // chain. App controls and dialogs are never in this selector list.
  window.setTimeout(() => {
    document
      .querySelectorAll(
        ".dengta-prelude, .celestial-backdrop, .coast-video-backdrop, .status-flow-field",
      )
      .forEach((node) => {
        if (node instanceof HTMLElement) node.style.pointerEvents = "none";
      });
  }, 3200);

  // Some OEM WebViews report a stale visual viewport after returning from a
  // long background pause. Nudge layout once without reloading the app.
  const onVisibility = () => {
    if (document.visibilityState !== "visible") return;
    syncViewport();
    window.dispatchEvent(new Event("resize"));
  };
  document.addEventListener("visibilitychange", onVisibility, { passive: true });
}
