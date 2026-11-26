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

function upgradeNeteaseCdnHttps(value) {
  const raw = String(value || "").trim();
  if (/^http:\/\/[^/]*\.(?:music\.126\.net|music\.163\.com)\//i.test(raw)) {
    return raw.replace(/^http:\/\//i, "https://");
  }
  return raw;
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
  let currentPublished = null;
  const update = entry => {
    if (!alive || current !== entry || !scope.current(entry.owner)) return;
    if (localPlayback?.phase !== "playing") {
      currentPublished = { ...entry.song, isPlaying: !entry.audio.paused && !entry.audio.ended };
      onSong(currentPublished);
    }
  };
  const makeEntry = (song, owner) => {
    const url = validateDirectMediaUrl(upgradeNeteaseCdnHttps(song?.url));
    if (!url.ok || !song?.title) throw new Error("music_random_unavailable");
    const entry = { audio: createAudio(url.url), owner, listeners: [], wantsPlayback: false, song: {
      title: song.title, artist: song.artist || "", cover: song.cover || song.cover_url || "", source: "dengta",
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
      if (current !== entry || !alive || !scope.current(entry.owner)) return;
      current = null; release(entry); onSong(null);
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
  async function select(token) {
    const data = await request("/api/v2/music/providers/netease/random-playable", { ...token.options, timeoutMs: 15000 }).catch(() => null);
    if (!owned(token)) throw CANCELLED;
    if (data?.playable === true && data.song?.url && neteaseUrlFresh(data.song.url)) return data.song;
    // Stored NetEase CDN URLs are signed and often expired; download a durable
    // copy. The endpoint picks one random song and can hit a VIP/encrypted
    // track, so retry a few times before giving up.
    let lastMessage = "";
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const fetched = await request("/api/v2/music/providers/netease/random-fetch", {
        ...token.options, method: "POST", timeoutMs: 45000, body: JSON.stringify({}),
      });
      if (!owned(token)) throw CANCELLED;
      if (fetched?.ok && fetched.song?.url) return fetched.song;
      lastMessage = String(fetched?.message || "").trim();
    }
    const unavailable = new Error(lastMessage || "music_random_unavailable");
    unavailable.userMessage = lastMessage;
    throw unavailable;
  }
  async function run(action, expectedSong, { startup = false } = {}) {
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
        const song = await select(token);
        if (!owned(token) || current !== previous || localBlocked()) throw CANCELLED;
        candidate = attemptCandidate = makeEntry(song, scope.capture());
        const next = candidate;
        next.audio.muted = !!previous;
        await play(next, token);
        if (!owned(token) || current !== previous || localBlocked()) throw CANCELLED;
        current = next; candidate = null; attemptCandidate = null;
        release(previous);
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
      else onFeedback(action === "next" ? "已播放下一首。" : action === "pause" ? "已暂停。" : "已播放。");
    } catch (error) {
      release(attemptCandidate); if (candidate === attemptCandidate) candidate = null;
      if (owned(token) && error !== CANCELLED) {
        const backendMessage = String(error?.userMessage || "").trim();
        const message = error?.name === "NotAllowedError" ? "自动播放被浏览器拦截，请手动开始播放。"
          : error?.message === "music_audio_timeout" ? startup ? "播放器响应超时，未开始播放。请在一起听中手动选歌。"
            : action === "next" && previous ? "下一首等待播放超时，已保留当前歌曲。你可以重试下一首。" : "播放器响应超时，已保持暂停。点播放重试。"
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
    start: () => run("next", null, { startup: true }),
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
      onBusy(false);
    },
    dispose() {
      if (!alive) return;
      alive = false; scope.cancelKey(JOB_KEY); release(candidate); release(current); candidate = null; current = null;
    },
  };
}
