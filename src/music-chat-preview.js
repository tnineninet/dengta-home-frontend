import { apiRequest } from "./api.js";
import { extractMusicRequest } from "./music-request-intent.js";

export async function fetchEarlyMusicCard(message) {
  const keyword = extractMusicRequest(message);
  if (!keyword) return null;
  const data = await apiRequest("/api/v2/music/chat-card", {
    method: "POST",
    body: JSON.stringify({ message }),
    timeoutMs: 20_000,
  });
  return data?.ok === true && data.music ? data.music : null;
}

export { extractMusicRequest };
