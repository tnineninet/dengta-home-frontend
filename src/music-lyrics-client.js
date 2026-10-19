import { apiRequest } from "./api.js";

export async function fetchMusicLyrics(trackId) {
  const data = await apiRequest("/api/v2/music/chat-lyric?track_id=" + encodeURIComponent(String(trackId || "")), {
    method: "GET",
    timeoutMs: 15_000,
  });
  return data?.ok === true ? data : null;
}
