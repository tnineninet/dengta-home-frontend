import { apiRequest } from "./api.js";

function cleanText(value, maximum = 180) {
  return Array.from(String(value || "").trim()).slice(0, maximum).join("");
}

function cleanNumber(value, maximum = 604800) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(maximum, Math.max(0, Math.round(number)));
}

export function normalizeCoWatchSession(value) {
  if (!value?.id) return null;
  return Object.freeze({
    id: cleanText(value.id, 80),
    conversationId: cleanText(value.conversation_id, 80),
    status: value.status === "ended" ? "ended" : "active",
    sessionMode: cleanText(value.session_mode, 40) || "screen",
    title: cleanText(value.title),
    sourceApp: cleanText(value.source_app, 100),
    cadenceSeconds: Math.min(
      10_800,
      Math.max(60, cleanNumber(value.cadence_seconds, 10_800) || 90),
    ),
    mediaPositionSeconds: cleanNumber(value.media_position_seconds),
    mediaDurationSeconds: cleanNumber(value.media_duration_seconds),
    revision: cleanNumber(value.revision, 1_000_000_000),
    playbackState: value.playback_state === "playing" ? "playing" : "paused",
    musicPlaylistId: cleanText(value.music_playlist_id, 100),
    musicPlaylistItemId: cleanText(value.music_playlist_item_id, 100),
    frameCount: cleanNumber(value.frame_count, 1_000_000),
    reactionCount: cleanNumber(value.reaction_count, 1_000_000),
    lastFrameAt: value.last_frame_at || "",
    lastReactionAt: value.last_reaction_at || "",
    startedAt: value.started_at || "",
    endedAt: value.ended_at || "",
  });
}

export async function readActiveCoWatchSession() {
  const data = await apiRequest("/api/v2/co-watch/sessions/active", {
    timeoutMs: 12_000,
  });
  return normalizeCoWatchSession(data?.session);
}

export async function createCoWatchSession(input = {}) {
  const data = await apiRequest("/api/v2/co-watch/sessions", {
    method: "POST",
    timeoutMs: 15_000,
    body: JSON.stringify({
      title: cleanText(input.title),
      session_mode: ["screen", "direct", "listening"].includes(input.sessionMode) ? input.sessionMode : "screen",
      source_app: cleanText(input.sourceApp, 100),
      media_duration_seconds: cleanNumber(input.mediaDurationSeconds),
      media_position_seconds: cleanNumber(input.mediaPositionSeconds),
      music_playlist_id: cleanText(input.musicPlaylistId, 100),
      music_playlist_item_id: cleanText(input.musicPlaylistItemId, 100),
      cadence_seconds: Math.min(
        10_800,
        Math.max(60, cleanNumber(input.cadenceSeconds, 10_800) || 90),
      ),
    }),
  });
  return normalizeCoWatchSession(data?.session);
}

export async function endCoWatchSession(sessionId, input = {}) {
  const data = await apiRequest(
    `/api/v2/co-watch/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "PATCH",
      timeoutMs: 15_000,
      body: JSON.stringify({
        status: "ended",
        title: cleanText(input.title),
        media_position_seconds: cleanNumber(input.mediaPositionSeconds),
      }),
    },
  );
  return normalizeCoWatchSession(data?.session);
}

export async function patchCoWatchPlayback(sessionId, input = {}) {
  const data = await apiRequest(`/api/v2/co-watch/sessions/${encodeURIComponent(sessionId)}/playback`, {
    method: "PATCH", timeoutMs: 15_000,
    body: JSON.stringify({
      revision: cleanNumber(input.revision, 1_000_000_000),
      playback_state: input.playbackState === "playing" ? "playing" : "paused",
      music_playlist_id: cleanText(input.musicPlaylistId, 100),
      music_playlist_item_id: cleanText(input.musicPlaylistItemId, 100),
      media_position_seconds: cleanNumber(input.mediaPositionSeconds),
      media_duration_seconds: cleanNumber(input.mediaDurationSeconds),
    }),
  });
  return normalizeCoWatchSession(data?.session || data);
}

export async function readCoWatchDialog(session) {
  if (!session?.conversationId || !session?.id) return [];
  const data = await apiRequest(
    `/api/v2/sessions/${encodeURIComponent(session.conversationId)}/messages`,
    { timeoutMs: 12_000 },
  );
  return (Array.isArray(data?.messages) ? data.messages : [])
    .filter((message) => {
      const metadata = message?.tool_calls || {};
      return (
        metadata.is_co_watch === true &&
        String(metadata.co_watch_session_id || "") === session.id
      );
    })
    .slice(-24)
    .map((message) => ({
      id: cleanText(message.id, 100),
      role: message.role === "user" ? "user" : "assistant",
      text: cleanText(message.content, 600),
      at: message.created_at || "",
    }))
    .filter((message) => message.id && message.text);
}

export async function sendCoWatchReply(sessionId, text, positionSeconds = 0) {
  const requestId = globalThis.crypto?.randomUUID?.() ||
    `co-watch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const data = await apiRequest(
    `/api/v2/co-watch/sessions/${encodeURIComponent(sessionId)}/reply`,
    {
      method: "POST",
      timeoutMs: 90_000,
      body: JSON.stringify({
        text: cleanText(text, 500),
        request_id: requestId,
        media_position_seconds: cleanNumber(positionSeconds),
      }),
    },
  );
  return Object.freeze({
    requestId,
    reaction: cleanText(data?.reaction, 600),
    assistantMessage: data?.assistant_message || null,
    session: normalizeCoWatchSession(data?.session),
  });
}

export function formatMediaTime(value) {
  const seconds = cleanNumber(value);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}
