import { musicErrorMessage } from "./music-operation-feedback.js";

const MAX_RECEIPTS = 100;
const MAX_AGE = 24 * 60 * 60 * 1000;
const requestId = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");

export function createAiMusicConsumer({ scope, list, report, open, storage, onFeedback = () => {}, now = Date.now }) {
  const identity = scope.capture().options;
  const key = `dengta:ai-music-results:v1:${JSON.stringify([identity.accountScope, identity.companionScope])}`;
  const receipts = new Map();
  let lastFeedback = "";
  try {
    const saved = JSON.parse(storage?.getItem(key) || "[]");
    if (Array.isArray(saved)) for (const entry of saved.slice(-MAX_RECEIPTS)) {
      if (requestId(entry?.id) && ["played", "failed"].includes(entry.status) && Number.isFinite(entry.at) && now() - entry.at < MAX_AGE) receipts.set(entry.id, { id: entry.id, status: entry.status, error: entry.status === "failed" ? "music_ai_open_failed" : "", at: entry.at, acknowledged: entry.acknowledged === true });
    }
  } catch { /* Storage is optional; the current instance still prevents repeated opens. */ }
  const remember = entry => {
    receipts.delete(entry.id); receipts.set(entry.id, entry);
    while (receipts.size > MAX_RECEIPTS) receipts.delete(receipts.keys().next().value);
    try { storage?.setItem(key, JSON.stringify([...receipts.values()])); } catch { /* Keep the in-memory receipt when storage is unavailable. */ }
  };
  const feedback = message => { if (message !== lastFeedback) { lastFeedback = message; onFeedback(message); } };
  async function acknowledge(entry, token) {
    scope.assertCurrent(token);
    try { await report(entry.id, { status: entry.status, error: entry.error }, token.options); }
    catch (error) {
      scope.assertCurrent(token);
      if (!["music_ai_request_not_found", "music_ai_request_superseded", "music_ai_result_conflict"].includes(error?.code)) throw error;
      feedback(musicErrorMessage(error, "旧点歌请求已结束，请在一起听中查看当前歌曲。"));
    }
    scope.assertCurrent(token); remember({ ...entry, acknowledged: true });
  }
  return {
    async drain() {
      const token = scope.begin("ai-play");
      if (!token) return;
      try {
        // Retry only the result when opening succeeded but its acknowledgement was lost.
        for (const entry of receipts.values()) if (!entry.acknowledged) await acknowledge(entry, token);
        const requests = await list(token.options);
        scope.assertCurrent(token);
        for (const request of requests.slice(0, 3)) {
          const id = String(request?.id || ""), songId = String(request?.song_id || "");
          if (!requestId(id)) throw Object.assign(new Error("点歌请求编号无效，请刷新后重试。"), { code: "music_ai_request_invalid" });
          const previous = receipts.get(id);
          if (previous) { await acknowledge(previous, token); continue; }
          scope.assertCurrent(token);
          let opened = false;
          if (/^\d{1,20}$/.test(songId)) {
            try { opened = (await open("song", songId))?.opened === true; } catch { opened = false; }
          }
          const entry = { id, status: opened ? "played" : "failed", error: opened ? "" : "music_ai_open_failed", at: now(), acknowledged: false };
          // The old identity's local technical receipt can be retained even if the native call returns after a switch.
          remember(entry);
          scope.assertCurrent(token);
          await acknowledge(entry, token);
          feedback(opened ? "AI 点歌已交给网易云打开，实际播放由网易云决定。" : "AI 点歌未能打开网易云，请在一起听中手动重试。（错误代码 / Code: music_ai_open_failed）");
        }
      } catch (error) {
        if (scope.current(token)) feedback(musicErrorMessage(error, "AI 点歌暂时无法处理，请检查网络或在一起听中手动打开。已尝试打开的歌曲只会补传结果。"));
      } finally { scope.finish(token); }
    },
    cancel() { scope.cancelKey("ai-play"); },
  };
}
