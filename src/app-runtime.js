import { Capacitor, registerPlugin } from "@capacitor/core";

const AppNavigation = registerPlugin("AppNavigation");

// 后端连接卡死时，单纯 reload 仍可能复用旧的 WebView 进程；这里让原生层
// 结束当前进程并由系统闹钟重新拉起 MainActivity，等价于用户手动清后台再打开。
export async function restartDengTa() {
  if (Capacitor.getPlatform() !== "android") {
    globalThis.location?.reload();
    return false;
  }
  try {
    await AppNavigation.restart();
    return true;
  } catch {
    globalThis.location?.reload();
    return false;
  }
}
