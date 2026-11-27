import { validateDirectMediaUrl } from "./direct-media.js";

const JOB_KEY = "built-in-now-playing";
const CANCELLED = Object.assign(new Error("music_scope_changed"), { code: "music_scope_changed" });

export function chooseNowPlayingCard(current, external) {
  return current?.source === "dengta" && (external?.isPlaying !== true || external?.playbackStateKnown === false) ? current : external;
}

export function shouldYieldStartupToExternal(song) {
  return Boolean(song?.title && song.isPlaying === true);
}

export function compactPlaybackFeedback(backendMessage, fallback) {
  const text = String(backendMessage || "").trim();
  return text && text.length <= 80 ? text : String(fallback || "");
}

export function upgradeNeteaseCdnHttps(value) {
  const raw = String(value || "").trim();
  if (/^http:\/\/[^/]*\.(?:music\.126\.net|music\.163\.com)\//i.test(raw)) {
    return raw.replace(/^http:\/\//i, "https://");
  }
  return raw;
}

export function normalizeNowPlayingCoverUrl(raw) {
  let url = String(raw || "").trim();
  if (!url) return "";
  if (url.startsWith("//")) url = `https:${url}`;
  url = upgradeNeteaseCdnHttps(url);
  if (/^data:image\//i.test(url) || /^blob:/i.test(url) || /^https:\/\//i.test(url)) {
    return url;
  }
  return "";
}

export function createBuiltInNowPlaying({ scope, request, createAudio = url => new Audio(url), onSong, onBusy, onFeedback, onStartupFeedback }) {
  let alive = true, current = null, candidate = null, sequence = 0, localPlayback = null;
  const closedOwners = new WeakSet();
  const localBlocked = () => localPlayback?.phase === "pending" || localPlayback?.phase === "playing";
  const owned = token => alive && scope.current(token);
  const release = entry => {
    if (!entry) return;
    entry.wantsPlayback = false;
    entry.listeners.forEach(([name, listener]) => entry.audio.removeEventListener(name, listener));
    entry.audio.pause();
    entry.audio.removeAttribute("src");
    entry.audio.load();
  };
  const syncMediaSession = entry => {
    if (localBlocked()) return;
    const ms = globalThis.navigator?.mediaSession;
    if (!ms) return;
    try {
      if (entry && typeof globalThis.MediaMetadata === "function") {
        const cover = normalizeNowPlayingCoverUrl(entry.song.cover);
        ms.metadata = new globalThis.MediaMetadata({
          title: entry.song.title || "",
          artist: entry.song.artist || "DengTa 音乐",
          album: entry.song.album || "",
          ...(cover ? { artwork: [{ src: cover, sizes: "512x512", type: "image/jpeg" }] } : {}),
        });
      }
      ms.playbackState = entry ? (!entry.audio.paused && !entry.audio.ended ? "playing" : "paused") : "none";
      if (typeof ms.setActionHandler === "function") {
        ms.setActionHandler("play", entry ? () => { if (current) void run("play", current.song); } : null);
        ms.setActionHandler("pause", entry ? () => { if (current) void run("pause", current.song); } : null);
        ms.setActionHandler("nexttrack", entry ? () => { if (current) void run("next", current.song); } : null);
      }
    } catch { /* 某些 WebView 暂不支持全部 MediaSession action */ }
  };
  let currentPublished = null;
  const update = entry => {
    if (!alive || current !== entry || !scope.current(entry.owner)) return;
    if (localPlayback?.phase !== "playing") {
      currentPublished = { ...entry.song, isPlaying: !entry.audio.paused && !entry.audio.ended };
      onSong(currentPublished);
      syncMediaSession(entry);
    }
  };
  const attachEntry = (audio, song, owner) => {
    const entry = { audio, owner, listeners: [], wantsPlayback: false, endedHandled: false, song: {
      title: song.title, artist: song.artist || "", album: song.album || "", songId: song.song_id || song.provider_track_id || "",
      cover: upgradeNeteaseCdnHttps(song.cover || song.cover_url || ""), source: "dengta",
      playbackId: `dengta-${++sequence}`, playbackStateKnown: true,
    } };
    for (const name of ["play", "pause"]) {
      const listener = () => {
        if (name === "play" && !entry.wantsPlayback) { entry.audio.pause(); return; }
        if (name === "pause") entry.wantsPlayback = false;
        update(entry);
      };
      entry.listeners.push([name, listener]); entry.audio.addEventListener(name, listener);
    }
    const ended = () => {
      if (current !== entry || !alive || !scope.current(entry.owner) || entry.endedHandled) return;
      entry.endedHandled = true;
      if (localBlocked()) {
        current = null; release(entry); onSong(null);
        return;
      }
      // 一首歌播完后立刻自动切到下一首，实现无缝连播
      void run("next", entry.song, { autoAdvance: true });
    };
    entry.listeners.push(["ended", ended]); entry.audio.addEventListener("ended", ended);
    const error = () => {
      if (current !== entry || !alive || !scope.current(entry.owner)) return;
      entry.audio.pause(); update(entry);
      onFeedback("歌曲播放中断，已暂停。你可以点播放重试。");
    };
    entry.listeners.push(["error", error]); entry.audio.addEventListener("error", error);
    return entry;
  };
  const makeEntry = (song, owner) => {
    const url = validateDirectMediaUrl(upgradeNeteaseCdnHttps(song?.url));
    if (!url.ok || !song?.title) throw new Error("music_random_unavailable");
    return attachEntry(createAudio(url.url), song, owner);
  };
  const play = (entry, token) => new Promise((resolve, reject) => {
    const audio = entry.audio;
    entry.wantsPlayback = true;
    const signal = token.options.signal;
    let timer, settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal.removeEventListener("abort", abort);
      if (callback === reject) { entry.wantsPlayback = false; audio.pause(); }
      callback(value);
    };
    const abort = () => finish(reject, CANCELLED);
    signal.addEventListener("abort", abort, { once: true });
    if (!owned(token)) { abort(); return; }
    timer = setTimeout(() => finish(reject, new Error("music_audio_timeout")), 15000);
    try { Promise.resolve(audio.play()).then(value => {
      if (settled) { if (!entry.wantsPlayback) audio.pause(); return; }
      if (!owned(token) || localBlocked()) { audio.pause(); finish(reject, CANCELLED); return; }
      finish(resolve, value);
    }, error => finish(reject, error)); }
    catch (error) { finish(reject, error); }
  });
  function neteaseUrlFresh(url) {
    const match = String(url || "").match(/\/(20\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\//);
    if (!match) return true;
    const issued = Date.UTC(
      Number(match[1]), Number(match[2]) - 1, Number(match[3]),
      Number(match[4]), Number(match[5]), Number(match[6]),
    );
    return Number.isFinite(issued) && Date.now() - issued < 15 * 60 * 1000;
  }
  async function select(token, exclude = "") {
    const cleanExclude = String(exclude || "").trim();
    const playablePath = cleanExclude
      ? `/api/v2/music/providers/netease/random-playable?exclude=${encodeURIComponent(cleanExclude)}`
      : "/api/v2/music/providers/netease/random-playable";
    const data = await request(playablePath, { ...token.options, timeoutMs: 15000 }).catch(() => null);
    if (!owned(token)) throw CANCELLED;
    if (data?.playable === true && data.song?.url && neteaseUrlFresh(data.song.url)) return data.song;
    // Stored NetEase CDN URLs are signed and often expired; download a durable
    // copy. The endpoint picks one random song and can hit a VIP/encrypted
    // track, so retry a few times before giving up.
    let lastMessage = "";
    const fetchBody = cleanExclude ? JSON.stringify({ exclude: cleanExclude }) : JSON.stringify({});
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const fetched = await request("/api/v2/music/providers/netease/random-fetch", {
        ...token.options, method: "POST", timeoutMs: 45000, body: fetchBody,
      });
      if (!owned(token)) throw CANCELLED;
      if (fetched?.ok && fetched.song?.url) return fetched.song;
      lastMessage = String(fetched?.message || "").trim();
    }
    const unavailable = new Error(lastMessage || "music_random_unavailable");
    unavailable.userMessage = lastMessage;
    throw unavailable;
  }
  async function run(action, expectedSong, { startup = false, autoAdvance = false, exclude: explicitExclude = "" } = {}) {
    if (!alive || (action !== "next" && !["play", "pause"].includes(action))) return;
    if (!startup && (!current || expectedSong?.source !== "dengta" || current.song.playbackId !== expectedSong.playbackId)) return;
    if (action !== "pause" && localBlocked()) return;
    const token = scope.begin(JOB_KEY);
    if (!token) return;
    const previous = current;
    let attemptCandidate = null;
    onBusy(true);
    try {
      if (action === "next") {
        const exclude = String(explicitExclude || previous?.song?.songId || previous?.song?.title || "").trim();
        const song = await select(token, exclude);
        if (!owned(token) || current !== previous || localBlocked()) throw CANCELLED;
        candidate = attemptCandidate = makeEntry(song, scope.capture());
        let next = candidate;
        let reusedPrevious = false;
        next.audio.muted = !!previous && !autoAdvance;
        try {
          await play(next, token);
        } catch (playError) {
          // 移动端浏览器策略可能拦截自动连播时新建 Audio 的 play()，复用已解锁的旧 audio 元素继续播下一首
          if (autoAdvance && playError?.name === "NotAllowedError" && previous?.audio && typeof previous.audio.play === "function") {
            const validated = validateDirectMediaUrl(upgradeNeteaseCdnHttps(song?.url));
            if (validated.ok && owned(token) && current === previous && !localBlocked()) {
              release(attemptCandidate);
              candidate = attemptCandidate = null;
              previous.listeners.forEach(([name, listener]) => previous.audio.removeEventListener(name, listener));
              previous.listeners = [];
              previous.audio.src = validated.url;
              previous.audio.muted = false;
              previous.audio.ended = false;
              if ("currentTime" in previous.audio) previous.audio.currentTime = 0;
              if (typeof previous.audio.load === "function") previous.audio.load();
              next = candidate = attemptCandidate = attachEntry(previous.audio, song, scope.capture());
              reusedPrevious = true;
              await play(next, token);
            } else {
              throw playError;
            }
          } else {
            throw playError;
          }
        }
        if (!owned(token) || current !== previous || localBlocked()) throw CANCELLED;
        current = next; candidate = null; attemptCandidate = null;
        if (!reusedPrevious) release(previous);
        next.audio.muted = false;
        update(next);
      } else if (action === "pause") {
        previous.wantsPlayback = false;
        previous.audio.pause(); update(previous);
      } else {
        if (previous.audio.error) previous.audio.load();
        await play(previous, token);
        if (!owned(token) || current !== previous || localBlocked()) throw CANCELLED;
        update(previous);
      }
      if (!owned(token)) return;
      if (startup) onStartupFeedback({ status: "success", message: `正在播放：${current.song.title}（DengTa 内置播放）` });
      else if (autoAdvance) onFeedback(`已自动播放下一首：《${current.song.title}》`);
      else onFeedback(action === "next" ? "已播放下一首。" : action === "pause" ? "已暂停。" : "已播放。");
    } catch (error) {
      release(attemptCandidate); if (candidate === attemptCandidate) candidate = null;
      if (autoAdvance && previous && current === previous) {
        current = null;
        release(previous);
        onSong(null);
        syncMediaSession(null);
      }
      if (owned(token) && error !== CANCELLED) {
        const backendMessage = String(error?.userMessage || "").trim();
        const message = error?.name === "NotAllowedError"
          ? (autoAdvance ? "自动连播被浏览器拦截，请点击随心听继续播放。" : "自动播放被浏览器拦截，请手动开始播放。")
          : error?.message === "music_audio_timeout"
            ? startup ? "播放器响应超时，未开始播放。请在一起听中手动选歌。"
              : autoAdvance ? "下一首加载超时，已停止连播。点随心听可继续播放。"
                : action === "next" && previous ? "下一首等待播放超时，已保留当前歌曲。你可以重试下一首。" : "播放器响应超时，已保持暂停。点播放重试。"
            : autoAdvance ? "这首歌播完啦，下一首暂时无法加载，点随心听可重试。"
              : action === "next" && previous ? "下一首暂时无法播放，已保留当前歌曲。" : "歌曲暂时无法播放，请稍后重试。";
        // Backend music errors can be long multi-line setup guidance. Keep the
        // compact player toast actionable instead of pasting the whole message.
        const visibleMessage = compactPlaybackFeedback(backendMessage, message);
        if (startup) onStartupFeedback({ status: "error", message: visibleMessage }); else onFeedback(visibleMessage);
      }
    } finally {
      scope.finish(token);
      if (owned(token)) onBusy(false);
    }
  }
  return {
    control: (action, song) => run(action, song),
    start: (options = {}) => run("next", null, { startup: true, exclude: options?.exclude || "" }),
    localPlaybackChanged(event) {
      const stamp = scope.capture(), owner = stamp.options;
      if (!owned(stamp) || !event?.owner || typeof event.owner !== "object" || closedOwners.has(event.owner)
        || !["pending", "playing", "paused", "ended", "error", "released"].includes(event.phase)
        || event.accountScope !== owner.accountScope || event.companionScope !== owner.companionScope) return;
      if (["pending", "playing"].includes(event.phase)) {
        localPlayback = event;
        if (event.phase === "playing") {
          scope.cancelKey(JOB_KEY); release(candidate); candidate = null;
          current?.audio.pause(); onSong(null); onBusy(false);
        }
      } else {
        if (["paused", "ended", "error", "released"].includes(event.phase)) closedOwners.add(event.owner);
        if (localPlayback?.owner !== event.owner) return;
        localPlayback = null;
        if (current) update(current);
      }
    },
    yieldToExternal() {
      if (!alive || (!current && !candidate && !scope.busy(JOB_KEY))) return;
      scope.cancelKey(JOB_KEY); release(candidate); release(current); candidate = null; current = null;
      syncMediaSession(null);
      onBusy(false);
    },
    dispose() {
      if (!alive) return;
      alive = false; scope.cancelKey(JOB_KEY); release(candidate); release(current); candidate = null; current = null;
      syncMediaSession(null);
    },
  };
}
