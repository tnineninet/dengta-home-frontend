import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CircleStop,
  Heart,
  ListMusic,
  ListPlus,
  Music2,
  Pause,
  Play,
  RefreshCw,
  Repeat2,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
} from "lucide-react";
import {
  applyCoWatchMusicQueueOperation,
  formatMediaTime,
  readCoWatchMusicQueue,
} from "./co-watch.js";
import {
  connectNeteaseMcp,
  cookieGetDailyRecommend,
  cookieGetMyPlaylists,
  cookieGetPlayHistory,
  cookieGetPlaylistTracks,
  cookieLikeSong,
  cookieSearchNetease,
  deleteMusicFavorite,
  getMusicPlaylist,
  importNeteaseShare,
  clearNeteaseCookieSession,
  readNeteaseCookieSession,
  saveNeteaseCookieSession,
  listNeteaseConnections,
  listMusicFavorites,
  listMusicPlaylists,
  putMusicFavorite,
  requestExternalMusicPlayback,
} from "./music-listening.js";
import { MUSIC_PLAYBACK_MODES, musicPlaybackIsInternal, resolveMusicPlayback } from "./music-playback.js";
import { openNeteasePlayback } from "./netease-playback.js";
import { browserLauncherAvailable, openBuiltInBrowser, readBrowserCookie } from "./browser-launcher.js";

import MusicSettings from "./MusicSettings.jsx";

const ERROR_MESSAGE = "音频无法播放。链接可能已过期、需要登录、受到防盗链限制，或使用了 DRM。DengTa 不会绕过这些限制。";
const REPEAT_LABELS = Object.freeze({ off: "不循环", all: "列表循环", one: "单曲循环" });

function queueConflict(error) {
  return error?.status === 409 && error?.code === "music_queue_revision_conflict";
}

export default function TogetherMusic({ session, busy = false, onStart, onEnd, onPlaybackChange, onPositionChange }) {
  const audioRef = useRef(null);
  const mountedRef = useRef(true);
  const queueRef = useRef(null);
  const loadedPlaylistsRef = useRef({});
  const queueRunRef = useRef(Promise.resolve());
  const lastReportRef = useRef(0);
  const autoPlayNextRef = useRef(false);
  const [playlists, setPlaylists] = useState([]);
  const [loadedPlaylists, setLoadedPlaylists] = useState({});
  const [playlist, setPlaylist] = useState(null);
  const [localIndex, setLocalIndex] = useState(0);
  const [favorites, setFavorites] = useState([]);
  const [queue, setQueue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [queueBusy, setQueueBusy] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState("正在读取歌单与收藏…");
  const [error, setError] = useState("");
  const [connections, setConnections] = useState([]);
  const [connectionId, setConnectionId] = useState("");
  const [connectionName, setConnectionName] = useState("");
  const [connectionEndpoint, setConnectionEndpoint] = useState("");
  const [connectionToken, setConnectionToken] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerStatus, setProviderStatus] = useState("");
  const RANDOM_PLAY_KEY = "dengta_random_play_enabled";
  const [randomPlayEnabled, setRandomPlayEnabled] = useState(() => {
    try {
      return window.localStorage.getItem(RANDOM_PLAY_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleRandomPlay = useCallback((enabled) => {
    setRandomPlayEnabled(enabled);
    try {
      window.localStorage.setItem(RANDOM_PLAY_KEY, enabled ? "1" : "0");
    } catch {
      // 存储不可用时忽略
    }
  }, []);

  const [cookieStatus, setCookieStatus] = useState({
    checking: true,
    connected: false,
    account_name: "",
  });
  const [cookieBusy, setCookieBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const active = session?.status === "active" && session?.sessionMode === "listening";
  const sessionPlaylist = active ? loadedPlaylists[session?.musicPlaylistId] || null : null;
  const sessionItem = sessionPlaylist?.items.find((entry) => entry.id === session?.musicPlaylistItemId) || null;
  const currentQueueItem = active
    ? queue?.items.find((entry) => entry.id === queue.currentQueueItemId) || null
    : null;
  const queuedPlaylist = currentQueueItem ? loadedPlaylists[currentQueueItem.playlistId] : null;
  const queuedSourceItem = queuedPlaylist?.items.find((entry) => entry.id === currentQueueItem?.itemId) || null;
  const item = active
    ? queuedSourceItem || currentQueueItem || sessionItem
    : playlist?.items?.[localIndex] || null;
  const itemPlaylist = active ? queuedSourceItem ? queuedPlaylist : currentQueueItem ? loadedPlaylists[currentQueueItem.playlistId] || null : sessionPlaylist : playlist;
  const itemId = active ? currentQueueItem?.itemId || sessionItem?.id : item?.id;
  const itemPlaylistId = active ? currentQueueItem?.playlistId || sessionPlaylist?.id : itemPlaylist?.id;
  const favorite = Boolean(itemId && favorites.some((entry) => entry.itemId === itemId));
  const playback = resolveMusicPlayback(item);
  const internalPlayback = musicPlaybackIsInternal(playback);
  const externalSession = active && playback.mode === MUSIC_PLAYBACK_MODES.external;
  const playableItemUrl = internalPlayback ? playback.url : "";

  const rememberPlaylist = (next) => {
    if (!next?.id) return;
    setLoadedPlaylists((current) => {
      const updated = { ...current, [next.id]: next };
      loadedPlaylistsRef.current = updated;
      return updated;
    });
  };

  const loadQueuePlaylists = useCallback(async (nextQueue, preferredPlaylist = null) => {
    const ids = new Set((nextQueue?.items || []).map((entry) => entry.playlistId).filter(Boolean));
    if (preferredPlaylist?.id) ids.delete(preferredPlaylist.id);
    const missing = Array.from(ids).filter((id) => !loadedPlaylistsRef.current[id]);
    const results = await Promise.allSettled(missing.map((id) => getMusicPlaylist(id)));
    if (!mountedRef.current) return;
    const nextLoaded = {};
    if (preferredPlaylist?.id) nextLoaded[preferredPlaylist.id] = preferredPlaylist;
    for (const result of results) {
      if (result.status === "fulfilled" && result.value?.id) nextLoaded[result.value.id] = result.value;
    }
    if (Object.keys(nextLoaded).length) {
      setLoadedPlaylists((current) => {
        const updated = { ...current, ...nextLoaded };
        loadedPlaylistsRef.current = updated;
        return updated;
      });
    }
  }, []);

  const refreshQueue = async (sessionId = session?.id) => {
    if (!sessionId) return null;
    const next = await readCoWatchMusicQueue(sessionId);
    if (mountedRef.current) {
      queueRef.current = next;
      setQueue(next);
      await loadQueuePlaylists(next);
    }
    return next;
  };

  const runQueueOperation = (operation, { retryConflict = false, sessionId = session?.id } = {}) => {
    const run = async () => {
      if (!sessionId) throw new Error("请先开始一起听歌。");
      setQueueBusy(true);
      setError("");
      try {
        let current = queueRef.current;
        if (!current || current.sessionId !== sessionId) current = await refreshQueue(sessionId);
        try {
          const result = await applyCoWatchMusicQueueOperation(sessionId, {
            expectedRevision: current?.revision || 0,
            operation,
          });
          queueRef.current = result.queue;
          setQueue(result.queue);
          await loadQueuePlaylists(result.queue, playlist);
          return result.queue;
        } catch (caught) {
          if (!queueConflict(caught)) throw caught;
          const refreshed = await refreshQueue(sessionId);
          if (!retryConflict) throw caught;
          const retried = await applyCoWatchMusicQueueOperation(sessionId, {
            expectedRevision: refreshed?.revision || 0,
            operation,
          });
          queueRef.current = retried.queue;
          setQueue(retried.queue);
          await loadQueuePlaylists(retried.queue, playlist);
          return retried.queue;
        }
      } finally {
        if (mountedRef.current) setQueueBusy(false);
      }
    };
    const nextRun = queueRunRef.current.then(run, run);
    queueRunRef.current = nextRun.catch(() => {});
    return nextRun.catch((caught) => {
      if (mountedRef.current) setError(caught?.message || "播放队列同步失败。");
      throw caught;
    });
  };

  const refreshLibrary = useCallback(async ({ initial = false } = {}) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError("");
    try {
      const [playlistResult, favoriteResult, connectionResult] = await Promise.allSettled([listMusicPlaylists(), listMusicFavorites(), listNeteaseConnections()]);
      if (!mountedRef.current) return;
      if (playlistResult.status === "fulfilled") {
        setPlaylists(playlistResult.value);
        setStatus(playlistResult.value.length ? "选择歌单后即可开始。" : "还没有可播放歌单，请先在设置中导入。");
      }
      if (favoriteResult.status === "fulfilled") setFavorites(favoriteResult.value);
      if (connectionResult.status === "fulfilled") {
        const availableConnections = connectionResult.value.filter((connection) => connection.enabled && connection.auth_configured);
        setConnections(availableConnections);
        setConnectionId((current) => availableConnections.some((connection) => connection.id === current) ? current : availableConnections[0]?.id || "");
      }
      const failure = playlistResult.status === "rejected" ? playlistResult.reason : favoriteResult.status === "rejected" ? favoriteResult.reason : connectionResult.status === "rejected" ? connectionResult.reason : null;
      if (failure) setError(failure?.message || "部分音乐资料暂时无法读取，可稍后重试。");
    } finally {
      if (mountedRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void Promise.resolve().then(() => refreshLibrary({ initial: true }));
    return () => { mountedRef.current = false; };
  }, [refreshLibrary]);

  useEffect(() => {
    if (!active || !session?.musicPlaylistId || loadedPlaylistsRef.current[session.musicPlaylistId]) return;
    let cancelled = false;
    getMusicPlaylist(session.musicPlaylistId).then((next) => {
      if (!cancelled && mountedRef.current) rememberPlaylist(next);
    }).catch((caught) => {
      if (!cancelled) setError(caught?.message || "本场歌曲暂时无法读取。");
    });
    return () => { cancelled = true; };
  }, [active, session?.musicPlaylistId]);

  const [externalPlaying, setExternalPlaying] = useState(false);

  useEffect(() => {
    if (!active || !session.id) {
      queueRef.current = null;
      return;
    }
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) {
        setLoading(true);
        setStatus("正在同步这场一起听的队列…");
      }
      return readCoWatchMusicQueue(session.id);
    }).then(async (next) => {
      if (cancelled || !mountedRef.current) return;
      queueRef.current = next;
      setQueue(next);
      await loadQueuePlaylists(next);
      if (!cancelled) setStatus("队列已与服务端同步。");
    }).catch((caught) => {
      if (!cancelled) setError(caught?.message || "播放队列暂时无法读取。");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [active, session?.id, loadQueuePlaylists]);

  useEffect(() => {
    if (!item || !audioRef.current) return;
    const audio = audioRef.current;
    Promise.resolve().then(() => {
      if (!mountedRef.current) return;
      if (!internalPlayback) {
        autoPlayNextRef.current = false;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        setPlaying(false);
        setExternalPlaying(false);
        setPosition(0);
        setDuration(item.durationSeconds || 0);
        if (externalSession) setStatus("只进入 Together 元数据队列，不进入 App audio；切歌后请点击在网易云播放");
        return;
      }
      audio.load();
      setPosition(0);
      setDuration(item.durationSeconds || 0);
      if (autoPlayNextRef.current) {
        autoPlayNextRef.current = false;
        void audio.play().catch(() => setStatus("下一首已准备好，请点击播放。"));
      }
    });
  }, [externalSession, item, internalPlayback]);

  const report = (event, immediate = false) => {
    const audio = event?.currentTarget || audioRef.current;
    if (!audio || !session?.id || !item || !internalPlayback) return;
    const nextPosition = Number(audio.currentTime) || 0;
    const nextDuration = Number(audio.duration) || item.durationSeconds || 0;
    setPosition(nextPosition);
    setDuration(nextDuration);
    onPositionChange?.(nextPosition);
    if (immediate || Date.now() - lastReportRef.current >= 15_000) {
      lastReportRef.current = Date.now();
      onPlaybackChange?.({
        sessionId: session.id,
        playbackState: audio.paused ? "paused" : "playing",
        mediaPositionSeconds: nextPosition,
        mediaDurationSeconds: nextDuration,
        musicPlaylistId: itemPlaylistId,
        musicPlaylistItemId: itemId,
        revision: session.revision,
      });
    }
  };

  const selectPlaylist = async (id) => {
    if (!id) {
      setPlaylist(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const next = await getMusicPlaylist(id);
      setPlaylist(next);
      rememberPlaylist(next);
      setLocalIndex(0);
      setPosition(0);
      setStatus(`${next.name} · ${next.itemCount} 首`);
    } catch (caught) {
      setError(caught?.message || "歌单暂时无法读取。");
    } finally {
      setLoading(false);
    }
  };

  const advance = async (userInitiated = true) => {
    if (!active || queueBusy) return;
    const previousQueueItemId = queueRef.current?.currentQueueItemId;
    autoPlayNextRef.current = playing || !userInitiated;
    setPlaying(false);
    try {
      const next = await runQueueOperation({ type: "advance" }, { retryConflict: userInitiated });
      if (!next.currentQueueItemId) {
        autoPlayNextRef.current = false;
        setStatus("队列已经播放完了。");
      } else if (next.currentQueueItemId === previousQueueItemId && audioRef.current) {
        const shouldResume = autoPlayNextRef.current;
        autoPlayNextRef.current = false;
        audioRef.current.currentTime = 0;
        setPosition(0);
        if (shouldResume) {
          void audioRef.current.play().catch(() => setStatus("单曲已回到开头，请点击播放。"));
        }
      }
    } catch {
      autoPlayNextRef.current = false;
    }
  };
  const advanceFromMediaSession = useEffectEvent(() => void advance(true));

  const start = async () => {
    if (!item || !playlist) return;
    const validation = internalPlayback ? playback.validation || { ok: true, message: "" } : { ok: true, message: "" };
    if (internalPlayback && !validation.ok) {
      setError(validation.message);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const started = await onStart?.({
        title: item.title,
        sessionMode: "listening",
        musicPlaylistId: playlist.id,
        musicPlaylistItemId: item.id,
        mediaDurationSeconds: item.durationSeconds,
        mediaPositionSeconds: 0,
      });
      if (!started) return;
      const sessionId = started?.id || session?.id;
      const emptyQueue = await readCoWatchMusicQueue(sessionId);
      queueRef.current = emptyQueue;
      setQueue(emptyQueue);
      autoPlayNextRef.current = internalPlayback;
      const playbackOrder = [
        ...playlist.items.slice(localIndex),
        ...playlist.items.slice(0, localIndex),
      ];
      await runQueueOperation(
        { type: "replace", item_ids: playbackOrder.map((entry) => entry.id) },
        { retryConflict: true, sessionId },
      );
      if (internalPlayback) {
        void audioRef.current?.play().catch(() => setStatus("队列已保存，请点击播放开始聆听。"));
        setStatus("一起听歌已开始，队列已保存到服务端。音频仍由本机浏览器直连播放。");
      } else {
        setPlaying(false);
        setPosition(0);
        setDuration(item.durationSeconds || 0);
        setStatus("只进入 Together 元数据队列，不进入 App audio；切歌后请点击在网易云播放");
      }
    } catch (caught) {
      autoPlayNextRef.current = false;
      setError(caught?.message || "暂时无法开始一起听歌。");
    } finally {
      setLoading(false);
    }
  };

  const openExternal = async () => {
    if (playback.mode !== MUSIC_PLAYBACK_MODES.external) return;
    setError("");
    try {
      await Promise.all([
        requestExternalMusicPlayback(playback.resourceType, playback.resourceId),
        openNeteasePlayback(playback.resourceType, playback.resourceId),
      ]);
      setPosition(0);
      setDuration(item?.durationSeconds || 0);
      setExternalPlaying(true);
      setStatus("已交给网易云打开；普通歌曲、VIP 歌曲和版权可用性由网易云判断。");
    } catch (caught) { setError(caught?.message || "无法打开网易云播放。"); }
  };

  const connectProvider = async (event) => {
    event.preventDefault();
    if (providerBusy) return;
    setProviderBusy(true);
    setError("");
    setProviderStatus("正在协商协议并自动识别接口能力…");
    try {
      const connection = await connectNeteaseMcp({ name: connectionName, endpoint: connectionEndpoint, token: connectionToken });
      const nextConnections = (await listNeteaseConnections()).filter((entry) => entry.enabled && entry.auth_configured);
      setConnections(nextConnections);
      setConnectionId(connection.id);
      setConnectionToken("");
      setProviderStatus(`已自动识别并启用“${connection.name}”${connection.adapter_id ? `（${connection.adapter_id}）` : ""}，凭据已从页面清空。`);
    } catch (caught) {
      setError(caught?.message || "网易云 MCP 连接失败。");
      setProviderStatus("");
    } finally {
      setProviderBusy(false);
    }
  };


  const connectNeteaseCookie = async (options = {}) => {
    if (cookieBusy) return;
    if (!browserLauncherAvailable()) {
      setError("内置浏览器登录仅 Android App 可用。");
      return;
    }
    setCookieBusy(true);
    setError("");
    try {
      // 登录态长住的内置浏览器：打开网易云网页，登录后点「提取登录态」再返回，
      // Cookie 自动保存给 AI 使用（可复用手机版/桌面版两种网页）。
      const outcome = await openBuiltInBrowser({
        url: "https://music.163.com/",
        title: "网易云登录（内置浏览器）",
        site: "netease",
        desktop: options?.desktop === true,
      });
      // 用系统返回键关闭也会走到这里：只要点过「提取登录态」，
      // 登录态已保存在本机，必须继续读取，不能因为返回方式而丢失。
      const saved = await readBrowserCookie("netease");
      if (!saved.cookie) {
        setError(outcome.ok
          ? "没有提取到登录态。请重新打开，在页面里登录后点「提取登录态」，再返回。"
          : (outcome.error || "没有拿到登录状态。") + " 且没有提取到登录态，请重试。");
        return;
      }
      const savedSession = await saveNeteaseCookieSession(saved.cookie);
      setCookieStatus({
        checking: false,
        connected: true,
        account_name: savedSession?.session?.account_name || "",
      });
      setStatus("网易云账号已连接，可以搜歌和导入歌单了。");
      void refreshLibrary();
    } catch (caught) {
      setError(caught?.message || "连接网易云失败。");
    } finally {
      setCookieBusy(false);
    }
  };

  const disconnectNeteaseCookie = async () => {
    try {
      await clearNeteaseCookieSession();
    } catch {
      // 忽略清理失败。
    }
    setCookieStatus({ checking: false, connected: false, account_name: "" });
  };
  // ---------- 网易云音乐操作面板（Cookie 登录后可用） ----------
  const [cookiePanel, setCookiePanel] = useState("closed"); // closed | search | playlists | daily | history
  const [cookieSearchQuery, setCookieSearchQuery] = useState("");
  const [cookieSearchResults, setCookieSearchResults] = useState([]);
  const [cookieSearchBusy, setCookieSearchBusy] = useState(false);
  const [cookieMyPlaylists, setCookieMyPlaylists] = useState(null);
  const [cookiePlaylistDetail, setCookiePlaylistDetail] = useState(null);
  const [cookieDaily, setCookieDaily] = useState([]);
  const [cookieHistory, setCookieHistory] = useState([]);
  const [cookieOpBusy, setCookieOpBusy] = useState(false);
  const [cookieOpStatus, setCookieOpStatus] = useState("");

  const runCookieSearch = async (event) => {
    event?.preventDefault();
    if (cookieSearchBusy || !cookieSearchQuery.trim()) return;
    setCookieSearchBusy(true);
    setCookieOpStatus("");
    try {
      const items = await cookieSearchNetease(cookieSearchQuery, 12);
      setCookieSearchResults(items);
      setCookieOpStatus(items.length ? `找到 ${items.length} 首。` : "没有找到相关歌曲。");
    } catch (caught) {
      setCookieOpStatus(caught?.message || "搜索失败。");
    } finally {
      setCookieSearchBusy(false);
    }
  };

  const openCookiePlaylists = async () => {
    setCookiePanel("playlists");
    setCookieOpStatus("");
    try {
      const data = await cookieGetMyPlaylists();
      setCookieMyPlaylists(data);
      setCookiePlaylistDetail(null);
    } catch (caught) {
      setCookieOpStatus(caught?.message || "读取歌单失败。");
    }
  };

  const openCookiePlaylist = async (playlistId) => {
    if (!playlistId) return;
    setCookieOpBusy(true);
    setCookieOpStatus("");
    try {
      const data = await cookieGetPlaylistTracks(playlistId);
      setCookiePlaylistDetail({ id: playlistId, ...(data?.playlist || {}) });
    } catch (caught) {
      setCookieOpStatus(caught?.message || "读取歌单内容失败。");
    } finally {
      setCookieOpBusy(false);
    }
  };

  const openCookieDaily = async () => {
    setCookiePanel("daily");
    setCookieOpStatus("");
    try {
      const data = await cookieGetDailyRecommend();
      setCookieDaily(Array.isArray(data?.daily) ? data.daily : []);
      setCookieOpStatus("今日推荐已加载。");
    } catch (caught) {
      setCookieOpStatus(caught?.message || "每日推荐读取失败。");
    }
  };

  const openCookieHistory = async () => {
    setCookiePanel("history");
    setCookieOpStatus("");
    try {
      const data = await cookieGetPlayHistory(20);
      setCookieHistory(Array.isArray(data?.records) ? data.records : []);
      setCookieOpStatus("听歌记录已加载。");
    } catch (caught) {
      setCookieOpStatus(caught?.message || "听歌记录读取失败。");
    }
  };

  const cookieLikeTrack = async (songId, liked) => {
    setCookieOpBusy(true);
    setCookieOpStatus("");
    try {
      const result = await cookieLikeSong(songId, liked);
      setCookieOpStatus(result?.liked ? "已红心。♥" : "已取消红心。");
    } catch (caught) {
      setCookieOpStatus(caught?.message || "红心操作失败。");
    } finally {
      setCookieOpBusy(false);
    }
  };

  const cookieImportPlaylist = async (playlistId) => {
    if (!playlistId) return;
    setCookieOpBusy(true);
    setCookieOpStatus("");
    try {
      const imported = await importNeteaseShare("", `https://music.163.com/#/playlist?id=${playlistId}`);
      const nextPlaylists = await listMusicPlaylists();
      setPlaylists(nextPlaylists);
      setCookieOpStatus(`已导入“${imported.name}”${imported.itemCount} 首，可以开始听了。`);
    } catch (caught) {
      setCookieOpStatus(caught?.message || "导入失败。");
    } finally {
      setCookieOpBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    readNeteaseCookieSession()
      .then((data) => {
        if (cancelled) return;
        const session = data?.session || {};
        setCookieStatus({
          checking: false,
          connected: session.connected === true,
          account_name: session.account_name || "",
        });
      })
      .catch(() => {
        if (!cancelled) setCookieStatus({ checking: false, connected: false, account_name: "" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const importShare = async (event) => {
    event.preventDefault();
    if (providerBusy) return;
    setProviderBusy(true);
    setError("");
    setProviderStatus("正在通过网易云 MCP 导入歌单…");
    try {
      const imported = await importNeteaseShare(connectionId || "", shareUrl);
      const nextPlaylists = await listMusicPlaylists();
      const selected = await getMusicPlaylist(imported.id);
      setPlaylists(nextPlaylists);
      setPlaylist(selected);
      rememberPlaylist(selected);
      setLocalIndex(0);
      setPosition(0);
      setShareUrl("");
      setProviderStatus(`已导入“${selected.name}”，曲目现在可以直接查看。`);
    } catch (caught) {
      setError(caught?.message || "网易云歌单导入失败。");
      setProviderStatus("");
    } finally {
      setProviderBusy(false);
    }
  };

  const updateExternalPosition = (nextPosition) => {
    setPosition(nextPosition);
    onPositionChange?.(nextPosition);
    if (!active || !item) return;
    onPlaybackChange?.({
      sessionId: session.id,
      playbackState: "paused",
      mediaPositionSeconds: nextPosition,
      mediaDurationSeconds: duration || item.durationSeconds || 0,
      musicPlaylistId: itemPlaylistId,
      musicPlaylistItemId: itemId,
      revision: session.revision,
    });
  };

  const toggleFavorite = async () => {
    if (!itemId || favoriteBusy) return;
    setFavoriteBusy(true);
    setError("");
    try {
      if (favorite) {
        await deleteMusicFavorite(itemId);
        setFavorites((current) => current.filter((entry) => entry.itemId !== itemId));
        setStatus("已取消收藏当前曲目。");
      } else {
        const next = await putMusicFavorite(itemId);
        setFavorites((current) => [next, ...current.filter((entry) => entry.itemId !== itemId)]);
        setStatus("已收藏当前曲目。");
      }
    } catch (caught) {
      setError(caught?.message || "收藏状态暂时无法更新。");
    } finally {
      setFavoriteBusy(false);
    }
  };

  useEffect(() => {
    if (!item || typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    if (typeof globalThis.MediaMetadata === "function") {
      navigator.mediaSession.metadata = new globalThis.MediaMetadata({
        title: item.title,
        artist: item.artist || "",
        album: item.album || itemPlaylist?.name || "一起听歌",
      });
    }
    const handlers = {
      previoustrack: () => {
        if (!active) setLocalIndex((current) => Math.max(0, current - 1));
      },
      nexttrack: () => {
        if (active) advanceFromMediaSession();
        else setLocalIndex((current) => Math.min((playlist?.items.length || 1) - 1, current + 1));
      },
    };
    if (internalPlayback) {
      handlers.play = () => void audioRef.current?.play();
      handlers.pause = () => audioRef.current?.pause();
      handlers.seekto = (details) => {
        if (audioRef.current && Number.isFinite(details?.seekTime)) audioRef.current.currentTime = details.seekTime;
      };
    }
    for (const [action, handler] of Object.entries(handlers)) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Unsupported action. */ }
    }
    return () => {
      for (const action of Object.keys(handlers)) {
        try { navigator.mediaSession.setActionHandler(action, null); } catch { /* Unsupported action. */ }
      }
    };
  }, [active, internalPlayback, item, itemPlaylist, playlist]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    if (duration > 0 && navigator.mediaSession.setPositionState) {
      try {
        navigator.mediaSession.setPositionState({
          duration,
          playbackRate: audioRef.current?.playbackRate || 1,
          position: Math.min(position, duration),
        });
      } catch { /* Media position can race metadata changes. */ }
    }
  }, [duration, playing, position]);

  // 外部播放（跳到网易云 App）时，App 内没有真实音频流：
  // 用计时器模拟进度推进，让进度条和播报感知“正在播放”。切歌/暂停会重置。
  useEffect(() => {
    if (!externalSession || !externalPlaying || !item) {
      const resetTimer = window.setTimeout(() => setExternalPlaying(false), 0);
      return () => window.clearTimeout(resetTimer);
    }
    const timer = window.setInterval(() => {
      setPosition((current) => {
        const next = Math.min(current + 1, item?.durationSeconds || 0);
        if (next >= (item?.durationSeconds || 0)) setExternalPlaying(false);
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
     
  }, [externalSession, externalPlaying, item]);

  const currentQueueIndex = queue?.items.findIndex((entry) => entry.id === queue.currentQueueItemId) ?? -1;
  const localCanGoBack = !active && localIndex > 0;
  const controlsBusy = busy || loading || queueBusy;

  return <div className="together-setup together-music-setup" aria-busy={loading || queueBusy}>
    {!active && <section className="music-import-entry"><div><strong>把想听的歌带进来</strong><p>支持安全的文本歌单、本机音频与网易云分享链接。</p></div><button type="button" className="together-primary" aria-expanded={importOpen} aria-controls="together-music-import" onClick={() => setImportOpen((current) => !current)}><ListPlus aria-hidden="true" />{importOpen ? "收起导入" : "导入歌单"}</button></section>}
    {!active && importOpen && <div id="together-music-import"><MusicSettings /></div>}
    {!active && (
      <label className="music-random-play-toggle">
        <input
          type="checkbox"
          checked={randomPlayEnabled}
          onChange={(event) => toggleRandomPlay(event.target.checked)}
        />
        <span>
          <strong>打开软件后随机播放一首歌</strong>
          <small>在 DengTa 里已有的歌里随机挑一首内置播放（不跳转网易云）；没有可播的歌时会尝试抓取一首下载进来。勾选后每次打开 App 都会自动播放。</small>
        </span>
      </label>
    )}
      {!active && (
        <section className="music-provider-connect music-provider-cookie">
          <div className="music-provider-connect-heading">
            <div>
              <strong>内置浏览器登录网易云</strong>
              <span>
                {cookieStatus.checking
                  ? "正在检查登录状态…"
                  : cookieStatus.connected
                  ? `已连接：${cookieStatus.account_name || "网易云账号"}`
                  : "用内置浏览器打开网易云网页（登录态长期有效），登录后点「提取登录态」再返回，Cookie 自动保存给 AI 使用。手机版点不动时用桌面版（双指可放大扫码）。"}
              </span>
            </div>
            <div className="music-cookie-connect-actions">
              {cookieStatus.connected ? (
                <button type="button" disabled={cookieBusy} onClick={() => void disconnectNeteaseCookie()}>
                  断开
                </button>
              ) : (
                <>
                  <button type="button" className="music-cookie-connect-primary" disabled={cookieBusy} onClick={() => void connectNeteaseCookie()}>
                    {cookieBusy ? "处理中…" : "内置浏览器登录"}
                  </button>
                  <button type="button" disabled={cookieBusy} onClick={() => void connectNeteaseCookie({ desktop: true })}>
                    桌面版网页登录
                  </button>
                </>
              )}
            </div>
          </div>
          {!cookieStatus.connected && (
            <p className="music-cookie-desktop-hint">
              手机版和桌面版都走内置浏览器：登录态保存在 App 里长期有效；桌面版页面支持扫码登录，二维码可双指放大。
            </p>
          )}
          </section>
      )}
      {!active && cookieStatus.connected && (
        <section className="music-cookie-operations">
          <div className="music-cookie-operations-bar">
            <strong>网易云音乐操作</strong>
            <span className="music-cookie-operations-tabs">
              <button type="button" className={cookiePanel === "search" ? "is-active" : ""} onClick={() => setCookiePanel("search")}>搜歌</button>
              <button type="button" className={cookiePanel === "playlists" ? "is-active" : ""} onClick={() => void openCookiePlaylists()}>我的歌单</button>
              <button type="button" className={cookiePanel === "daily" ? "is-active" : ""} onClick={() => void openCookieDaily()}>每日推荐</button>
              <button type="button" className={cookiePanel === "history" ? "is-active" : ""} onClick={() => void openCookieHistory()}>听歌记录</button>
            </span>
          </div>
          {cookiePanel === "search" && (
            <div className="music-cookie-operations-body">
              <form className="music-cookie-search" onSubmit={runCookieSearch}>
                <input type="search" maxLength={120} value={cookieSearchQuery} onChange={(event) => setCookieSearchQuery(event.target.value)} placeholder="说个关键词找歌…" />
                <button type="submit" disabled={cookieSearchBusy || !cookieSearchQuery.trim()}>{cookieSearchBusy ? "搜索中…" : "搜歌"}</button>
              </form>
              {cookieSearchResults.length > 0 && (
                <ul className="music-cookie-track-list">
                  {cookieSearchResults.map((track) => (
                    <li key={track.providerTrackId}>
                      <span className="music-cookie-track-title">{track.title}<em>{track.artist}</em></span>
                      <span className="music-cookie-track-actions">
                        <button type="button" disabled={cookieOpBusy} onClick={() => void cookieLikeTrack(track.providerTrackId, true)} title="红心">♥</button>
                        <button type="button" disabled={cookieOpBusy} onClick={() => { setCookieOpStatus("正在交给网易云播放…"); void Promise.all([requestExternalMusicPlayback("song", track.providerTrackId), openNeteasePlayback("song", track.providerTrackId)]).then(() => setCookieOpStatus("已交给网易云播放这首。")).catch((caught) => setCookieOpStatus(caught?.message || "无法打开网易云播放。")); }}><Play aria-hidden="true" size={13} /><span style={{marginLeft:3}}>播放</span></button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {cookiePanel === "playlists" && (
            <div className="music-cookie-operations-body">
              {cookieMyPlaylists && (
                <div>
                  {(cookieMyPlaylists.owned?.length > 0 || cookieMyPlaylists.subscribed?.length > 0) ? (
                    <>
                      {cookieMyPlaylists.owned?.length > 0 && (
                        <div className="music-cookie-playlist-group">
                          <p className="music-cookie-playlist-group-title">自建歌单</p>
                          <ul className="music-cookie-playlist-list">
                            {cookieMyPlaylists.owned.map((item) => (
                              <li key={item.playlist_id}>
                                <button type="button" className="music-cookie-playlist-name" onClick={() => void openCookiePlaylist(item.playlist_id)}>{item.name}</button>
                                <span>{item.item_count} 首</span>
                                <button type="button" disabled={cookieOpBusy} onClick={() => void cookieImportPlaylist(item.playlist_id)}>导入</button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {cookieMyPlaylists.subscribed?.length > 0 && (
                        <div className="music-cookie-playlist-group">
                          <p className="music-cookie-playlist-group-title">收藏歌单</p>
                          <ul className="music-cookie-playlist-list">
                            {cookieMyPlaylists.subscribed.map((item) => (
                              <li key={item.playlist_id}>
                                <button type="button" className="music-cookie-playlist-name" onClick={() => void openCookiePlaylist(item.playlist_id)}>{item.name}</button>
                                <span>{item.item_count} 首</span>
                                <button type="button" disabled={cookieOpBusy} onClick={() => void cookieImportPlaylist(item.playlist_id)}>导入</button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  ) : (
                    <p>账号下还没有歌单。</p>
                  )}
                  {cookiePlaylistDetail && (
                    <div className="music-cookie-playlist-detail">
                      <button type="button" className="music-cookie-back" onClick={() => setCookiePlaylistDetail(null)}>← 返回歌单列表</button>
                      <p className="music-cookie-playlist-detail-title">{cookiePlaylistDetail.name}（{cookiePlaylistDetail.tracks?.length || 0} 首）</p>
                      <ul className="music-cookie-track-list">
                        {(cookiePlaylistDetail.tracks || []).slice(0, 60).map((track, index) => (
                          <li key={track.id || index}>
                            <span className="music-cookie-track-title">{index + 1}. {track.title}<em>{track.artist}</em></span>
                            <span className="music-cookie-track-actions">
                              <button type="button" disabled={cookieOpBusy} onClick={() => void cookieLikeTrack(track.id, true)} title="红心">♥</button>
                              <button type="button" disabled={cookieOpBusy} onClick={() => { setCookieOpStatus("正在交给网易云播放…"); void Promise.all([requestExternalMusicPlayback("song", track.id), openNeteasePlayback("song", track.id)]).then(() => setCookieOpStatus("已交给网易云播放这首。")).catch((caught) => setCookieOpStatus(caught?.message || "无法打开网易云播放。")); }}><Play aria-hidden="true" size={13} /><span style={{marginLeft:3}}>播放</span></button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {cookiePanel === "daily" && (
            <div className="music-cookie-operations-body">
              {cookieDaily.length > 0 ? (
                <ul className="music-cookie-track-list">
                  {cookieDaily.map((track) => (
                    <li key={track.id}>
                      <span className="music-cookie-track-title">{track.title}<em>{track.artist}{track.reason ? ` · ${track.reason}` : ""}</em></span>
                      <span className="music-cookie-track-actions">
                        <button type="button" disabled={cookieOpBusy} onClick={() => void cookieLikeTrack(track.id, true)} title="红心">♥</button>
                        <button type="button" disabled={cookieOpBusy} onClick={() => { setCookieOpStatus("正在交给网易云播放…"); void Promise.all([requestExternalMusicPlayback("song", track.id), openNeteasePlayback("song", track.id)]).then(() => setCookieOpStatus("已交给网易云播放这首。")).catch((caught) => setCookieOpStatus(caught?.message || "无法打开网易云播放。")); }}><Play aria-hidden="true" size={13} /><span style={{marginLeft:3}}>播放</span></button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>今天的推荐还没加载出来，稍后再试。</p>
              )}
            </div>
          )}
          {cookiePanel === "history" && (
            <div className="music-cookie-operations-body">
              {cookieHistory.length > 0 ? (
                <ul className="music-cookie-track-list">
                  {cookieHistory.map((track) => (
                    <li key={track.id}>
                      <span className="music-cookie-track-title">{track.title}<em>{track.artist}</em></span>
                      <span className="music-cookie-track-actions">{track.play_count > 0 && <small title={`播放 ${track.play_count} 次`}>播放 {track.play_count} 次</small>}
                        <button type="button" disabled={cookieOpBusy} onClick={() => void cookieLikeTrack(track.id, true)} title="红心">♥</button>
                        <button type="button" disabled={cookieOpBusy} onClick={() => { setCookieOpStatus("正在交给网易云播放…"); void Promise.all([requestExternalMusicPlayback("song", track.id), openNeteasePlayback("song", track.id)]).then(() => setCookieOpStatus("已交给网易云播放这首。")).catch((caught) => setCookieOpStatus(caught?.message || "无法打开网易云播放。")); }}><Play aria-hidden="true" size={13} /><span style={{marginLeft:3}}>播放</span></button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>还没有听歌记录。</p>
              )}
            </div>
          )}
          {cookieOpStatus && <p className="music-provider-feedback" role="status">{cookieOpStatus}</p>}
        </section>
      )}

    {!active && <details className="music-provider-connect">
      <summary>高级用户：连接自己的网易云接口</summary>
      <div className="music-provider-connect-body">
        <p>填写完整的公开 HTTPS MCP 地址即可；DengTa 会协商协议版本、读取工具并自动识别网易云能力，不依赖固定路径。你可以在自己的服务端配置网易云 Cookie，再用独立 Token 保护接口；Token 不是网易云 Cookie，Cookie、MUSIC_U、__csrf 或 NETEASE_COOKIE 不会上传到 DengTa。</p>
        <form onSubmit={connectProvider}>
          <label>显示名称<input value={connectionName} maxLength={80} autoComplete="off" onChange={(event) => setConnectionName(event.target.value)} placeholder="我的网易云 MCP" /></label>
          <label>完整 HTTPS MCP 地址<input type="url" inputMode="url" maxLength={1000} autoCapitalize="off" autoCorrect="off" spellCheck="false" autoComplete="off" value={connectionEndpoint} onChange={(event) => setConnectionEndpoint(event.target.value)} placeholder="https://music.example.com/mcp" /></label>
          <label>接口 Token（可选）<input type="password" maxLength={4096} autoComplete="new-password" value={connectionToken} onChange={(event) => setConnectionToken(event.target.value)} placeholder="无鉴权接口可留空；不要填写网易云 Cookie" /></label>
          <button type="submit" className="together-primary" disabled={providerBusy || !connectionName.trim() || !connectionEndpoint.trim()}>{providerBusy ? "正在识别…" : "自动识别、保存并启用"}</button>
        </form>
        <form className="music-provider-import" onSubmit={importShare}>
          <label>网易云 MCP 连接<select value={connectionId} disabled={providerBusy || !connections.length} onChange={(event) => setConnectionId(event.target.value)}><option value="">选择已启用连接</option>{connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select></label>
          <label>网易云分享歌单 URL<input type="url" inputMode="url" maxLength={4096} autoCapitalize="off" autoCorrect="off" spellCheck="false" value={shareUrl} onChange={(event) => setShareUrl(event.target.value)} placeholder="https://music.163.com/playlist?id=…" /></label>
          <button type="submit" disabled={providerBusy || !connectionId || !shareUrl.trim()}>导入并查看曲目</button>
        </form>
        {providerStatus && <p className="music-provider-feedback" role="status">{providerStatus}</p>}
      </div>
    </details>}
    <div className="music-player-title">
      {item?.coverUrl ? <img className="music-cover" src={item.coverUrl} alt="" referrerPolicy="no-referrer" /> : <Music2 aria-hidden="true" />}
      <div><strong>{item?.title || (loading ? "正在读取音乐档案…" : "选择一首歌")}</strong><span>{item?.artist || "一起听歌"}</span></div>
      <button type="button" className={favorite ? "is-favorite" : ""} aria-label={favorite ? "取消收藏当前曲目" : "收藏当前曲目"} aria-pressed={favorite} disabled={!item || favoriteBusy} onClick={() => void toggleFavorite()}><Heart aria-hidden="true" /></button>
      <button type="button" aria-label="刷新音乐资料" disabled={refreshing} onClick={() => void refreshLibrary()}><RefreshCw aria-hidden="true" />{refreshing ? "刷新中" : "刷新"}</button>
    </div>
    <label>{active ? "加入曲目的来源歌单" : "歌单"}<select value={playlist?.id || ""} disabled={loading} onChange={(event) => void selectPlaylist(event.target.value)}><option value="">选择已导入歌单</option>{playlists.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.itemCount} 首</option>)}</select></label>
    {!active && playlist && <label>曲目<select value={localIndex} onChange={(event) => setLocalIndex(Number(event.target.value))}>{playlist.items.map((entry, itemIndex) => <option key={entry.id || itemIndex} value={itemIndex}>{itemIndex + 1}. {entry.title}{entry.artist ? ` · ${entry.artist}` : ""}</option>)}</select></label>}
    <audio
      ref={audioRef}
      src={playableItemUrl}
      preload="metadata"
      controls={false}
      onLoadedMetadata={(event) => report(event)}
      onTimeUpdate={(event) => report(event)}
      onPlay={(event) => { setPlaying(true); report(event, true); }}
      onPause={(event) => { setPlaying(false); if (!event.currentTarget.ended) report(event, true); }}
      onSeeked={(event) => report(event, true)}
      onEnded={() => { setPlaying(false); void advance(false); }}
      onError={() => { setPlaying(false); setError(ERROR_MESSAGE); }}
      aria-label="一起听歌音频播放器"
    />
    <input className="music-progress-range" type="range" min="0" max={duration || 0} step="0.1" value={Math.min(position, duration || position)} disabled={!duration || (!internalPlayback && !externalSession)} onChange={(event) => { const next = Number(event.target.value); if (internalPlayback && audioRef.current) audioRef.current.currentTime = next; if (externalSession) updateExternalPosition(next); else setPosition(next); }} aria-label={externalSession ? "手动同步播放进度" : "播放进度"} />
    {!active && playback.mode === MUSIC_PLAYBACK_MODES.external && <button type="button" className="together-primary" disabled={!item || controlsBusy} onClick={() => void start()}><Music2 aria-hidden="true" />开始 AI 陪听</button>}
    <div className="music-player-actions">
      <button type="button" aria-label="上一首" disabled={!localCanGoBack || controlsBusy} onClick={() => setLocalIndex((current) => Math.max(0, current - 1))}><SkipBack aria-hidden="true" /></button>
      {playback.mode === MUSIC_PLAYBACK_MODES.external ? <button type="button" className="together-primary" disabled={!item || controlsBusy} onClick={() => void openExternal()}><Play aria-hidden="true" />在网易云播放</button> : <button type="button" className="together-primary" disabled={!item || controlsBusy} onClick={() => { if (playing) audioRef.current?.pause(); else if (active) void audioRef.current?.play().catch(() => setError("浏览器阻止了自动播放，请再次点击播放。")); else void start(); }}>{playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}{playing ? "暂停" : active ? "播放" : "开始一起听"}</button>}
      <button type="button" aria-label="下一首" disabled={active ? controlsBusy || !queue?.currentQueueItemId : controlsBusy || !playlist || localIndex >= playlist.items.length - 1} onClick={() => active ? void advance(true) : setLocalIndex((current) => current + 1)}><SkipForward aria-hidden="true" /></button>
    </div>
    {active && <>
      <div className="music-mode-actions" aria-label="播放方式">
        <button type="button" aria-pressed={queue?.shuffleEnabled || false} disabled={controlsBusy} onClick={() => { const enabled = !queue?.shuffleEnabled; void runQueueOperation({ type: "set_mode", shuffle_enabled: enabled }, { retryConflict: true }).then(() => setStatus(enabled ? "已开启随机播放。" : "已关闭随机播放。")).catch(() => {}); }}><Shuffle aria-hidden="true" />{queue?.shuffleEnabled ? "随机中" : "顺序"}</button>
        <button type="button" disabled={controlsBusy} onClick={() => { const modes = ["off", "all", "one"]; const next = modes[(modes.indexOf(queue?.repeatMode || "off") + 1) % modes.length]; void runQueueOperation({ type: "set_mode", repeat_mode: next }, { retryConflict: true }).then(() => setStatus(`播放方式：${REPEAT_LABELS[next]}。`)).catch(() => {}); }}><Repeat2 aria-hidden="true" />{REPEAT_LABELS[queue?.repeatMode || "off"]}</button>
      </div>
      <section className="music-queue" aria-labelledby="music-queue-title">
        <header><div><ListMusic aria-hidden="true" /><strong id="music-queue-title">本场队列</strong></div><span>{queue?.items.length || 0} 首 · revision {queue?.revision || 0}</span></header>
        {queue?.items.length ? <ol>{queue.items.map((entry, entryIndex) => <li key={entry.id} className={entry.id === queue.currentQueueItemId ? "is-current" : ""}>
          <div><span>{entry.id === queue.currentQueueItemId ? "正在播放" : `第 ${entryIndex + 1} 首`}</span><strong>{entry.title || "未命名曲目"}</strong><small>{entry.artist || "未知艺术家"}</small></div>
          <div className="music-queue-actions">
            <button type="button" aria-label={`上移 ${entry.title}`} disabled={controlsBusy || entryIndex === 0} onClick={() => void runQueueOperation({ type: "move", queue_item_id: entry.id, position: entryIndex - 1 }, { retryConflict: true }).catch(() => {})}><ArrowUp aria-hidden="true" /></button>
            <button type="button" aria-label={`下移 ${entry.title}`} disabled={controlsBusy || entryIndex === queue.items.length - 1} onClick={() => void runQueueOperation({ type: "move", queue_item_id: entry.id, position: entryIndex + 1 }, { retryConflict: true }).catch(() => {})}><ArrowDown aria-hidden="true" /></button>
            <button type="button" aria-label={`移除 ${entry.title}`} disabled={controlsBusy} onClick={() => void runQueueOperation({ type: "remove", queue_item_id: entry.id }, { retryConflict: true }).catch(() => {})}><Trash2 aria-hidden="true" /></button>
          </div>
        </li>)}</ol> : <p>队列是空的，可以从下面的歌单加入曲目。</p>}
      </section>
      {playlist && <section className="music-queue-picker" aria-label="从当前歌单加入队列"><strong>{playlist.name}</strong>{playlist.items.map((entry) => { const entryPlayback = resolveMusicPlayback(entry); const external = entryPlayback.mode === MUSIC_PLAYBACK_MODES.external; return <div key={entry.id}><span>{entry.title}{external && <small> · Together 元数据队列</small>}</span><button type="button" disabled={controlsBusy} onClick={() => void runQueueOperation({ type: "add", item_id: entry.id, position: Math.max(0, currentQueueIndex + 1) }, { retryConflict: true }).catch(() => {})}><Play aria-hidden="true" />下一首播放</button><button type="button" disabled={controlsBusy} onClick={() => void runQueueOperation({ type: "add", item_id: entry.id }, { retryConflict: true }).catch(() => {})}><ListPlus aria-hidden="true" />加入队尾</button>{external && <button type="button" onClick={() => { void Promise.all([requestExternalMusicPlayback(entryPlayback.resourceType, entryPlayback.resourceId), openNeteasePlayback(entryPlayback.resourceType, entryPlayback.resourceId)]).catch((caught) => setError(caught?.message || "无法打开网易云播放。")); }}><Play aria-hidden="true" />在网易云播放</button>}</div>; })}</section>}
    </>}
    {active && <button type="button" disabled={busy} onClick={() => void onEnd?.({ title: item?.title, mediaPositionSeconds: position, musicPlaylistId: itemPlaylistId, musicPlaylistItemId: itemId })}><CircleStop aria-hidden="true" />结束本场</button>}
    <p className="together-device-note">{formatMediaTime(position)} / {duration ? formatMediaTime(duration) : "等待媒体信息"}。{playback.mode === MUSIC_PLAYBACK_MODES.external ? "只进入 Together 元数据队列，不进入 App audio；切歌后请点击在网易云播放" : "队列不保存音频 URL，播放地址仅从本机已加载歌单解析；不代理、不下载、不绕过 DRM。"}</p>
    {status && <p className="together-feedback" role="status">{loading || queueBusy ? "正在处理 · " : ""}{status}</p>}
    {error && <p className="together-feedback is-error" role="alert">{error}</p>}
  </div>;
}
