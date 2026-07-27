import { Capacitor, registerPlugin } from "@capacitor/core";
import { apiRequest } from "./api.js";
import { AUTH_STATUS } from "./auth-session.js";

const DEVICE_ID_KEY = "dengta_android_installation_id_v1";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const BackgroundNotifications = registerPlugin(
  "BackgroundNotifications",
);

export function readOrCreateNotificationDeviceId(
  storage = globalThis.localStorage,
  randomUUID = globalThis.crypto?.randomUUID,
) {
  try {
    const current = String(storage?.getItem?.(DEVICE_ID_KEY) || "");
    if (UUID_PATTERN.test(current)) return current;
    if (typeof randomUUID !== "function") return "";
    const created = randomUUID.call(globalThis.crypto);
    if (!UUID_PATTERN.test(created)) return "";
    storage?.setItem?.(DEVICE_ID_KEY, created);
    return created;
  } catch {
    return "";
  }
}

async function registerInstallation(deviceId) {
  return apiRequest("/api/v2/notification-installations/register", {
    method: "POST",
    body: JSON.stringify({
      device_id: deviceId,
      platform: "android",
    }),
  });
}

export async function resolveBackgroundNotificationIdentity(
  snapshot,
  sessionManager,
  {
    storage = globalThis.localStorage,
    randomUUID = globalThis.crypto?.randomUUID,
    register = registerInstallation,
  } = {},
) {
  if (
    snapshot?.status !== AUTH_STATUS.authenticated ||
    !snapshot?.user?.id
  ) {
    return { method: "clear", payload: {} };
  }

  const context = await sessionManager.getRequestContext();
  const deviceId = readOrCreateNotificationDeviceId(storage, randomUUID);
  if (!context?.accessToken || !context?.companionId || !deviceId) {
    return { method: "clear", payload: {} };
  }
  const registration = await register(deviceId);
  if (
    !registration?.installation_token ||
    registration?.companion_id !== context.companionId
  ) {
    throw new Error("后端没有返回匹配当前伴侣的安装令牌。");
  }

  return {
    method: "configure",
    payload: {
      installationToken: registration.installation_token,
      expiresAt: Date.parse(registration.expires_at) || 0,
      deviceId,
      companionId: context.companionId,
      userId: snapshot.user.id,
    },
  };
}

export function startBackgroundNotificationIdentitySync(
  sessionManager,
  {
    capacitor = Capacitor,
    plugin = BackgroundNotifications,
    storage = globalThis.localStorage,
    randomUUID = globalThis.crypto?.randomUUID,
    register = registerInstallation,
    onError = (error) =>
      console.warn(
        "后台通知身份同步失败：",
        error?.message || "原生通知桥返回未知错误",
      ),
  } = {},
) {
  if (
    !capacitor.isNativePlatform() ||
    !capacitor.isPluginAvailable("BackgroundNotifications")
  ) {
    return () => {};
  }

  let stopped = false;
  let revision = 0;
  let queue = Promise.resolve();
  const unsubscribe = sessionManager.subscribe((snapshot) => {
    revision += 1;
    const targetRevision = revision;
    queue = queue
      .then(async () => {
        if (stopped) return;
        const action = await resolveBackgroundNotificationIdentity(
          snapshot,
          sessionManager,
          {
            storage,
            randomUUID,
            register,
          },
        );
        if (stopped || targetRevision !== revision) return;
        await plugin[action.method](action.payload);
      })
      .catch((error) => {
        if (!stopped) onError(error);
      });
  });

  return () => {
    stopped = true;
    revision += 1;
    unsubscribe();
  };
}
