import { apiRequest } from "./api.js";

export function newXhsIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `xhs-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function previewXhsWrite(input, { client = apiRequest } = {}) {
  const receipt = await client("/api/v2/xhs/actions/preview", {
    method: "POST",
    timeoutMs: 20_000,
    body: JSON.stringify(input),
  });
  return receipt?.preview || null;
}

export async function confirmXhsWrite(
  { confirmationToken, idempotencyKey },
  { client = apiRequest } = {},
) {
  if (!confirmationToken) throw new Error("缺少小红书确认令牌。");
  if (!idempotencyKey) throw new Error("缺少小红书幂等键。");
  return client("/api/v2/xhs/actions/confirm", {
    method: "POST",
    timeoutMs: 45_000,
    body: JSON.stringify({
      confirmation_token: confirmationToken,
      idempotency_key: idempotencyKey,
    }),
  });
}

export async function readXhsNotifications({ client = apiRequest } = {}) {
  return client("/api/v2/xhs/notifications", { timeoutMs: 20_000 });
}
