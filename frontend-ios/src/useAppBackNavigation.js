import { useEffect, useLayoutEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { appBackLayers, createAppBackController } from "./app-back-navigation.js";
import { AppNavigation } from "./app-navigation.js";

export function useBackLayer(isOpen, onClose, priority = 100) {
  const live = useRef(onClose);
  useLayoutEffect(() => { live.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!isOpen) return undefined;
    return appBackLayers.register(() => live.current(), priority);
  }, [isOpen, priority]);
}

export function useAppBackNavigation({ scope, view, layerKey, closeLayer, changeView, showNotice }) {
  const live = useRef(null);
  const history = useRef({ scope, view, stack: [], returning: false });
  const controller = useRef(null);
  useLayoutEffect(() => {
    live.current = { closeLayer, changeView, showNotice };
    const previous = history.current;
    if (previous.scope !== scope) {
      history.current = { scope, view, stack: [], returning: false };
      controller.current?.reset();
    } else if (previous.view !== view) {
      if (!previous.returning) previous.stack.push(previous.view);
      if (view === "chat") previous.stack = [];
      previous.stack = previous.stack.slice(-32);
      previous.returning = false;
      previous.view = view;
      controller.current?.reset();
    }
  }, [scope, view, closeLayer, changeView, showNotice]);
  useEffect(() => { controller.current?.reset(); }, [layerKey]);

  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") return undefined;
    let disposed = false;
    const handles = [];
    const subject = createAppBackController({
      dismissKeyboard: async () => {
        try {
          return (await AppNavigation.dismissKeyboard()).hidden === true;
        } catch {
          const active = globalThis.document?.activeElement;
          if (active?.matches?.("input, textarea, [contenteditable='true']")) {
            active.blur();
            return true;
          }
          return false;
        }
      },
      closeLayer: () => appBackLayers.closeTop() || live.current.closeLayer(),
      goBack: () => {
        const navigation = history.current;
        if (navigation.view === "chat") return false;
        const destination = navigation.stack.at(-1) || (navigation.view !== "chat" ? "chat" : null);
        if (!destination) return false;
        // A busy workspace may decline navigation. Keep its history until it accepts.
        if (live.current.changeView(destination) !== false) {
          navigation.stack.pop();
          navigation.returning = true;
        }
        return true;
      },
      showExitHint: () => live.current.showNotice("再滑一次返回桌面"),
      exit: () => App.exitApp(),
    });
    controller.current = subject;
    const unsubscribeLayers = appBackLayers.subscribe(() => subject.reset());
    const reset = () => subject.reset();
    document.addEventListener("focusin", reset);
    const dispatchBack = () => {
      void subject.back().catch(() => live.current.showNotice("返回操作未完成，请再试一次。"));
    };
    // 手机侧边返回和 Android 13+ 预测性返回由 MainActivity 统一发这个事件；
    // Capacitor 的 backButton 只作为旧系统/插件回调的兜底。
    globalThis.window?.addEventListener?.("dengta:native-back", dispatchBack);
    void AppNavigation.setBackHandlerReady?.({ ready: true })?.catch?.(() => {});
    const listen = (name, callback) => {
      void App.addListener(name, callback).then(handle => {
        if (disposed) void handle.remove(); else handles.push(handle);
      }).catch(() => { if (!disposed) live.current.showNotice("返回手势暂时不可用，请重新打开界面。"); });
    };
    listen("backButton", dispatchBack);
    listen("appStateChange", () => subject.reset());
    return () => {
      disposed = true;
      subject.dispose();
      unsubscribeLayers();
      document.removeEventListener("focusin", reset);
      globalThis.window?.removeEventListener?.("dengta:native-back", dispatchBack);
      void AppNavigation.setBackHandlerReady?.({ ready: false })?.catch?.(() => {});
      if (controller.current === subject) controller.current = null;
      for (const handle of handles) void handle.remove();
    };
  }, []);
}
