const API_BASE_URL = (
  import.meta.env?.VITE_API_URL || "http://localhost:3000"
).replace(/\/$/, "");

export const RECEIVER_TOKEN_KEY = "dengta.cast.receiver-token.v1";

function cleanText(value, maximum = 180) {
  return Array.from(String(value || "").trim()).slice(0, maximum).join("");
}

async function receiverRequest(path, { method = "GET", body, token = "" } = {}) {
  const headers = new Headers({ Accept: "application/json" });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(cleanText(data?.message, 300) || "接收端暂时无法连接服务。");
    error.status = response.status;
    error.code = cleanText(data?.code, 80) || "cast_receiver_request_failed";
    throw error;
  }
  return data;
}

export function storeReceiverToken(storage, token) {
  const value = cleanText(token, 2048);
  if (value) storage?.setItem(RECEIVER_TOKEN_KEY, value);
  return value;
}

export function readReceiverToken(storage) {
  return cleanText(storage?.getItem(RECEIVER_TOKEN_KEY), 2048);
}

export function clearReceiverToken(storage) {
  storage?.removeItem(RECEIVER_TOKEN_KEY);
}

export async function pairCastReceiver(sessionId, pairingCode, receiverName) {
  return receiverRequest("/api/v2/cast/pair", {
    method: "POST",
    body: {
      session_id: cleanText(sessionId, 80),
      pairing_code: cleanText(pairingCode, 20),
      receiver_name: cleanText(receiverName, 100),
    },
  });
}

export function readCastReceiverSession(token) {
  return receiverRequest("/api/v2/cast/session", { token });
}

export function acknowledgeCastReceiver(token, input = {}) {
  return receiverRequest("/api/v2/cast/ack", {
    method: "POST",
    token,
    body: {
      revision: Number(input.revision) || 0,
      sequence: Math.max(0, Number(input.sequence) || 0),
      state: input.playbackState === "playing" ? "playing" : "paused",
      position_seconds: Math.max(0, Number(input.mediaPositionSeconds) || 0),
      event: cleanText(input.event, 40) || "heartbeat",
    },
  });
}
