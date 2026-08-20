import { apiRequest } from "./api.js";
import { authSession } from "./auth-session.js";

/**
 * 放映厅（多人联机一起看房间）前端 API。
 *
 * 对应于后端 routes/co-watch-rooms.js + services/co-watch-rooms.js。
 */

export async function createWatchRoom(input = {}) {
  const data = await apiRequest("/api/v2/co-watch/rooms", {
    method: "POST",
    body: input,
    timeoutMs: 10_000,
  });
  return data?.room || null;
}

export async function joinWatchRoom(joinCode, input = {}) {
  const data = await apiRequest("/api/v2/co-watch/rooms/join", {
    method: "POST",
    body: { join_code: joinCode, ...input },
    timeoutMs: 10_000,
  });
  return data?.room || null;
}

export async function readWatchRoom(roomId) {
  const data = await apiRequest(`/api/v2/co-watch/rooms/${encodeURIComponent(roomId)}`, {
    timeoutMs: 10_000,
  });
  return data || null;
}

export async function updateRoomPlayback(roomId, input = {}) {
  const data = await apiRequest(`/api/v2/co-watch/rooms/${encodeURIComponent(roomId)}/playback`, {
    method: "PATCH",
    body: input,
    timeoutMs: 10_000,
  });
  return data?.room || null;
}

export async function sendRoomMessage(roomId, content, mediaPositionSeconds = 0) {
  const data = await apiRequest(`/api/v2/co-watch/rooms/${encodeURIComponent(roomId)}/messages`, {
    method: "POST",
    body: { content, media_position_seconds: mediaPositionSeconds },
    timeoutMs: 10_000,
  });
  return data?.message || null;
}

export async function sendRoomAiMessage(roomId, content, mediaPositionSeconds = 0, aiName = "") {
  const data = await apiRequest(`/api/v2/co-watch/rooms/${encodeURIComponent(roomId)}/ai-messages`, {
    method: "POST",
    body: { content, media_position_seconds: mediaPositionSeconds, ai_name: aiName },
    timeoutMs: 10_000,
  });
  return data?.message || null;
}

export async function readRoomMessages(roomId, limit = 50, beforeId = null) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (beforeId) query.set("before_id", String(beforeId));
  const data = await apiRequest(
    `/api/v2/co-watch/rooms/${encodeURIComponent(roomId)}/messages?${query}`,
    { timeoutMs: 10_000 },
  );
  return Array.isArray(data?.messages) ? data.messages : [];
}

export async function leaveWatchRoom(roomId) {
  const data = await apiRequest(`/api/v2/co-watch/rooms/${encodeURIComponent(roomId)}/leave`, {
    method: "POST",
    timeoutMs: 10_000,
  });
  return data;
}

export async function endWatchRoom(roomId) {
  const data = await apiRequest(`/api/v2/co-watch/rooms/${encodeURIComponent(roomId)}/end`, {
    method: "POST",
    timeoutMs: 10_000,
  });
  return data;
}

/**
 * 放映厅实时事件订阅（SSE，通过 fetch + 手动解析，支持 Bearer 鉴权）。
 *
 * 返回一个 abort 函数，调用后断开连接。
 * 回调：
 *   onPlaybackSync(room)    — 播放状态、进度、revision 变化
 *   onMessage(msg)          — 新聊天消息
 *   onParticipantJoin(info) — 有人加入
 *   onParticipantLeave(info)- 有人离开
 *   onRoomEnded({roomId})   — 放映厅结束
 *   onError(error)          — 连接出错
 */
export function subscribeRoomEvents(roomId, handlers = {}) {
  const controller = new AbortController();
  const url = `/api/v2/co-watch/rooms/${encodeURIComponent(roomId)}/events`;

  let buffer = "";
  let currentEvent = "";

  async function run() {
    try {
      const authContext = await authSession?.getRequestContext?.();
      const headers = {};
      if (authContext?.accessToken) {
        headers.Authorization = `Bearer ${authContext.accessToken}`;
      }
      if (authContext?.companionId) {
        headers["X-DengTa-Companion-Id"] = authContext.companionId;
      }
      const response = await fetch(url, {
        signal: controller.signal,
        headers,
      });
      if (!response.ok) {
        handlers.onError?.(new Error(`SSE HTTP ${response.status}`));
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              switch (currentEvent) {
                case "playback_sync": handlers.onPlaybackSync?.(parsed); break;
                case "message": handlers.onMessage?.(parsed); break;
                case "participant_join": handlers.onParticipantJoin?.(parsed); break;
                case "participant_leave": handlers.onParticipantLeave?.(parsed); break;
                case "room_ended": handlers.onRoomEnded?.(parsed); break;
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        handlers.onError?.(err);
      }
    }
  }

  run();
  return () => { controller.abort(); };
}