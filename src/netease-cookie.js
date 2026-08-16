import { Capacitor, registerPlugin } from "@capacitor/core";

export const NeteaseCookie = registerPlugin("NeteaseCookie");

export function neteaseCookiePluginAvailable(capacitor = Capacitor) {
  return (
    capacitor.isNativePlatform() &&
    capacitor.isPluginAvailable("NeteaseCookie")
  );
}

export async function openNeteaseCookieLogin({ plugin = NeteaseCookie } = {}) {
  if (!neteaseCookiePluginAvailable()) {
    return { ok: false, error: "一键连接仅 Android App 可用。" };
  }
  try {
    const value = await plugin.openLogin();
    return { ok: true, ...(value || {}) };
  } catch (error) {
    return { ok: false, error: String(error?.message || "打开网易云登录页失败。") };
  }
}
