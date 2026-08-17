import { Capacitor, registerPlugin } from "@capacitor/core";
import { apiRequest } from "./api.js";

export const OrderBrowser = registerPlugin("OrderBrowser");
export const TAKEOUT_POLL_MS = 12 * 1000;

export function takeoutPluginAvailable(capacitor = Capacitor) {
  return (
    capacitor.isNativePlatform() &&
    capacitor.isPluginAvailable("OrderBrowser")
  );
}

export const TAKEOUT_PLATFORMS = [
  { id: "eleme", label: "饿了么", url: "https://h5.ele.me/msite/" },
  { id: "meituan", label: "美团", url: "https://i.meituan.com/" },
  { id: "jd", label: "京东到家", url: "https://daojia.jd.com/" },
];

export async function openTakeoutLogin({ plugin = OrderBrowser, url = "" } = {}) {
  if (!takeoutPluginAvailable()) {
    return { ok: false, error: "外卖执行器仅在 Android App 中可用。" };
  }
  try {
    const value = await plugin.openLogin({ url });
    return { ok: true, ...(value || {}) };
  } catch (error) {
    return { ok: false, error: String(error?.message || "打开登录页失败。") };
  }
}

// 外卖平台登录状态（读 WebView 持久化的登录 Cookie）。
export async function readTakeoutLoginState({ plugin = OrderBrowser } = {}) {
  if (!takeoutPluginAvailable()) {
    return { loggedIn: false, hasCookie: false };
  }
  try {
    const value = await plugin.getLoginState();
    return {
      loggedIn: value?.loggedIn === true,
      hasCookie: value?.hasCookie === true,
    };
  } catch {
    return { loggedIn: false, hasCookie: false };
  }
}

export async function readPendingTakeoutCommands({ client = apiRequest } = {}) {
  try {
    const data = await client("/api/v2/takeout/pending", { timeoutMs: 12_000 });
    return Array.isArray(data?.commands) ? data.commands : [];
  } catch {
    return [];
  }
}

async function postTakeoutProgress(id, progress, { client = apiRequest } = {}) {
  try {
    await client(`/api/v2/takeout/${id}/progress`, {
      method: "POST",
      timeoutMs: 10_000,
      body: JSON.stringify({ progress }),
    });
  } catch {
    // 进度上报失败不阻塞主流程。
  }
}

export async function executeTakeoutCommand(
  command,
  { client = apiRequest, plugin = OrderBrowser, onProgress = () => {} } = {}
) {
  const id = command?.id;
  const payload = command?.command || {};
  if (!id) return null;
  try {
    await client(`/api/v2/takeout/${id}/ack`, {
      method: "POST",
      timeoutMs: 12_000,
      body: JSON.stringify({}),
    });
  } catch {
    return null; // 已被处理或已过期。
  }
  const report = (text) => {
    onProgress(text);
    void postTakeoutProgress(id, text, { client });
  };
  try {
    if (payload.action === "search") {
      report("正在打开外卖页面搜索…");
      const value = await plugin.searchShops({ keyword: payload.requirement });
      const result = {
        action: "search",
        keyword: payload.requirement,
        shops: Array.isArray(value?.shops) ? value.shops : [],
      };
      await client(`/api/v2/takeout/${id}/result`, {
        method: "POST",
        timeoutMs: 15_000,
        body: JSON.stringify({ result }),
      });
      return result;
    }
    report("正在打开外卖页面选品加购…");
    const value = await plugin.orderProduct({
      shopName: payload.shop_name || payload.requirement,
      product: payload.requirement,
      quantity: Number(payload.quantity) || 1,
    });
    const result = {
      action: "order",
      ...(value || {}),
      shop_name: payload.shop_name || "",
      product: payload.requirement,
      quantity: Number(payload.quantity) || 1,
    };
    await client(`/api/v2/takeout/${id}/result`, {
      method: "POST",
      timeoutMs: 15_000,
      body: JSON.stringify({ result }),
    });
    return result;
  } catch (error) {
    const message = String(error?.message || "外卖执行失败。").slice(0, 300);
    try {
      await client(`/api/v2/takeout/${id}/failure`, {
        method: "POST",
        timeoutMs: 15_000,
        body: JSON.stringify({ message }),
      });
    } catch {
      // 结果上报失败不阻塞。
    }
    return null;
  }
}

export function startTakeoutRunner({
  client = apiRequest,
  plugin = OrderBrowser,
  pollMs = TAKEOUT_POLL_MS,
  onCommandDone = () => {},
} = {}) {
  if (!takeoutPluginAvailable()) {
    return () => {};
  }
  let stopped = false;
  let running = false;
  // 崩溃护栏:执行前写入本地标记。若上次执行时应用崩溃,
  // 下次启动会看到同一命令的标记,直接上报失败,不再触发原生页面。
  const markerKey = "dengta_takeout_attempted_v1";
  const readMarker = () => {
    try {
      return JSON.parse(window.localStorage.getItem(markerKey) || "{}");
    } catch {
      return {};
    }
  };
  const tick = async () => {
    if (stopped || running) return;
    const commands = await readPendingTakeoutCommands({ client });
    if (stopped || commands.length === 0) return;
    running = true;
    try {
      const command = commands[0];
      const marker = readMarker();
      if (marker.id === command.id) {
        window.localStorage.removeItem(markerKey);
        try {
          await client(`/api/v2/takeout/${command.id}/failure`, {
            method: "POST",
            timeoutMs: 12_000,
            body: JSON.stringify({ message: "上次执行时应用异常退出，已自动取消。" }),
          });
        } catch {
          // 上报失败不阻塞。
        }
        onCommandDone(command);
        return;
      }
      try {
        window.localStorage.setItem(markerKey, JSON.stringify({ id: command.id }));
      } catch {
        // 存储不可用时仍然继续,由服务端 pending 状态兜底。
      }
      try {
        await executeTakeoutCommand(command, { client, plugin });
      } finally {
        // 无论成功失败都清除崩溃护栏标记，
        // 否则页面被取消/异常退出后下次会误报“自动取消”。
        try {
          window.localStorage.removeItem(markerKey);
        } catch {
          // 忽略。
        }
      }
      onCommandDone(command);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => {
    void tick();
  }, pollMs);
  // 延迟启动:避免 App 一打开就弹出外卖页面,留给启动流程喘息空间。
  const firstTimer = setTimeout(() => {
    void tick();
  }, 10_000);
  return () => {
    stopped = true;
    clearInterval(timer);
    clearTimeout(firstTimer);
  };
}
