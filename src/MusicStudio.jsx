import { useCallback, useEffect, useRef, useState } from "react";
import {
  Disc3,
  ExternalLink,
  Globe,
  ListMusic,
  Loader2,
  Maximize2,
  Music2,
  Play,
  QrCode,
  RefreshCw,
  Search,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { apiRequest } from "./api";
import { settingsServiceErrorMessage } from "./settings-service-errors";
import NeteaseQrLogin from "./NeteaseQrLogin.jsx";
import {
  getNeteaseQrSongUrl,
  getNeteaseQrStatus,
  importNeteaseQrPlaylist,
  listNeteaseQrPlaylists,
} from "./netease-qr-login.js";
import {
  readNeteaseCookieSession,
  saveNeteaseCookieSession,
} from "./music-listening.js";
import {
  neteaseCookiePluginAvailable,
  openNeteaseCookieLogin,
} from "./netease-cookie.js";
import "./music-studio.css";

export default function MusicStudio({ onOpenSync, visualPreview = false }) {
  // 默认使用「直连扫码工作台」（首屏直接展示二维码/歌单，手机端永不白屏）；
  // 用户仍可随时一键切到「外置完整播放器」或浏览器打开。
  const [mode, setMode] = useState("direct"); // direct | external
  const [embedState, setEmbedState] = useState(() => ({ loading: false, url: "", error: "" }));
  const [reloadKey, setReloadKey] = useState(0);
  const [frameReady, setFrameReady] = useState(false);
  const [frameSlow, setFrameSlow] = useState(false);
  const iframeRef = useRef(null);

  const [connection, setConnection] = useState(null);
  const [authLoading, setAuthLoading] = useState(!visualPreview);
  const [cookieBusy, setCookieBusy] = useState(false);
  const [directTab, setDirectTab] = useState("playlists"); // playlists | daily | search
  const [playlists, setPlaylists] = useState([]);
  const [dailySongs, setDailySongs] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchSongs, setSearchSongs] = useState([]);
  const [activePlaylist, setActivePlaylist] = useState(null);
  const [dataBusy, setDataBusy] = useState(false);
  const [importBusyId, setImportBusyId] = useState("");
  const [studioMessage, setStudioMessage] = useState("");
  const [studioError, setStudioError] = useState("");
  const [nowPlaying, setNowPlaying] = useState(null); // { id, title, artist, cover, url }

  const refreshConnection = useCallback(async () => {
    if (visualPreview) {
      setAuthLoading(false);
      return null;
    }
    setAuthLoading(true);
    try {
      const [qrRes, cookieRes] = await Promise.allSettled([
        getNeteaseQrStatus(),
        readNeteaseCookieSession(),
      ]);
      if (qrRes.status === "fulfilled" && qrRes.value?.connected === true) {
        const next = {
          connected: true,
          nickname: qrRes.value.nickname || "网易云用户",
          uid: qrRes.value.uid || "",
          source: qrRes.value.source || "qr_login",
        };
        setConnection(next);
        return next;
      }
      const sess = cookieRes.status === "fulfilled" ? cookieRes.value?.session : null;
      if (sess?.connected === true) {
        const next = {
          connected: true,
          nickname: sess.account_name || "网易云用户",
          uid: sess.account_id || "",
          source: "cookie_session",
        };
        setConnection(next);
        return next;
      }
      setConnection(null);
      return null;
    } catch {
      setConnection(null);
      return null;
    } finally {
      setAuthLoading(false);
    }
  }, [visualPreview]);

  useEffect(() => {
    if (visualPreview) return undefined;
    let cancelled = false;
    Promise.allSettled([getNeteaseQrStatus(), readNeteaseCookieSession()])
      .then(([qrRes, cookieRes]) => {
        if (cancelled) return;
        if (qrRes.status === "fulfilled" && qrRes.value?.connected === true) {
          setConnection({
            connected: true,
            nickname: qrRes.value.nickname || "网易云用户",
            uid: qrRes.value.uid || "",
            source: qrRes.value.source || "qr_login",
          });
          return;
        }
        const sess = cookieRes.status === "fulfilled" ? cookieRes.value?.session : null;
        if (sess?.connected === true) {
          setConnection({
            connected: true,
            nickname: sess.account_name || "网易云用户",
            uid: sess.account_id || "",
            source: "cookie_session",
          });
          return;
        }
        setConnection(null);
      })
      .catch(() => {
        if (!cancelled) setConnection(null);
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false);
      });
    return () => { cancelled = true; };
  }, [visualPreview]);

  // 预取外置播放器地址（用于“浏览器打开”按钮或切换到外置模式）
  useEffect(() => {
    if (visualPreview) return undefined;
    let cancelled = false;
    apiRequest("/api/v2/music/embed-url")
      .then((data) => {
        if (cancelled) return;
        if (data?.url) setEmbedState({ loading: false, url: data.url, error: "" });
      })
      .catch((error) => {
        if (cancelled) return;
        setEmbedState({
          loading: false,
          url: "",
          error: settingsServiceErrorMessage(error) || error?.message || "外置播放器地址暂不可用。",
        });
      });
    return () => { cancelled = true; };
  }, [reloadKey, visualPreview]);

  const loadPlaylists = useCallback(async () => {
    setDataBusy(true);
    setStudioError("");
    try {
      const list = await listNeteaseQrPlaylists();
      setPlaylists(list);
      if (!list.length) setStudioMessage("已连接网易云，暂未读取到公开歌单，可去「搜歌」或「日推」听歌。");
    } catch (error) {
      setStudioError(error?.message || "歌单读取失败，请点刷新重试。");
    } finally {
      setDataBusy(false);
    }
  }, []);

  const loadDaily = useCallback(async () => {
    setDataBusy(true);
    setStudioError("");
    try {
      const data = await apiRequest("/api/v2/music/providers/netease/cookie/daily");
      const list = Array.isArray(data?.daily)
        ? data.daily
        : Array.isArray(data?.songs)
          ? data.songs
          : [];
      setDailySongs(list);
    } catch (error) {
      setStudioError(error?.message || "每日推荐读取失败，可先浏览我的歌单或搜歌。");
    } finally {
      setDataBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!connection?.connected || mode !== "direct" || visualPreview) return undefined;
    let cancelled = false;
    if (directTab === "playlists" && playlists.length === 0) {
      listNeteaseQrPlaylists()
        .then((list) => {
          if (cancelled) return;
          setPlaylists(list);
          if (!list.length) setStudioMessage("已连接网易云，暂未读取到公开歌单，可去「搜歌」或「日推」听歌。");
        })
        .catch((error) => {
          if (!cancelled) setStudioError(error?.message || "歌单读取失败，请点刷新重试。");
        });
    }
    if (directTab === "daily" && dailySongs.length === 0) {
      apiRequest("/api/v2/music/providers/netease/cookie/daily")
        .then((data) => {
          if (cancelled) return;
          const list = Array.isArray(data?.daily)
            ? data.daily
            : Array.isArray(data?.songs)
              ? data.songs
              : [];
          setDailySongs(list);
        })
        .catch((error) => {
          if (!cancelled) setStudioError(error?.message || "每日推荐读取失败，可先浏览我的歌单或搜歌。");
        });
    }
    return () => { cancelled = true; };
  }, [connection, dailySongs.length, directTab, mode, playlists.length, visualPreview]);

  useEffect(() => {
    if (mode !== "external" || !embedState.url || frameReady) return undefined;
    const timer = window.setTimeout(() => setFrameSlow(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [embedState.url, frameReady, mode]);

  const handleSearch = async (event) => {
    event?.preventDefault?.();
    const q = searchQuery.trim();
    if (!q) return;
    setDataBusy(true);
    setStudioError("");
    try {
      const data = await apiRequest(
        `/api/v2/music/providers/netease/cookie/search?q=${encodeURIComponent(q)}&limit=20`,
      );
      const list = Array.isArray(data?.songs) ? data.songs : [];
      setSearchSongs(list);
      if (!list.length) setStudioMessage(`没有搜到「${q}」相关曲目。`);
    } catch (error) {
      setStudioError(error?.message || "搜索失败，请稍后重试。");
    } finally {
      setDataBusy(false);
    }
  };

  const handleOpenPlaylist = async (pl) => {
    setDataBusy(true);
    setStudioError("");
    try {
      const data = await apiRequest(
        `/api/v2/music/providers/netease/cookie/playlist?id=${encodeURIComponent(pl.provider_playlist_id)}`,
      );
      const tracks = Array.isArray(data?.playlist?.tracks)
        ? data.playlist.tracks
        : Array.isArray(data?.tracks)
          ? data.tracks
          : [];
      setActivePlaylist({ ...pl, tracks });
    } catch (error) {
      setStudioError(error?.message || "歌单曲目读取失败。");
    } finally {
      setDataBusy(false);
    }
  };

  const handleImportToSync = async (pl) => {
    setImportBusyId(pl.provider_playlist_id);
    setStudioError("");
    try {
      const res = await importNeteaseQrPlaylist(pl.provider_playlist_id);
      setStudioMessage(`已将「${res.name || pl.name}」导入一起听同步（${res.playable_count}/${res.total} 首可直接播放）。`);
    } catch (error) {
      setStudioError(error?.message || "导入歌单失败。");
    } finally {
      setImportBusyId("");
    }
  };

  const handlePlayTrack = async (track) => {
    const trackId = String(track?.provider_track_id || track?.id || "").trim();
    if (!trackId) return;
    setStudioError("");
    setStudioMessage(`正在获取《${track.title || track.name}》播放直链…`);
    try {
      const pb = await getNeteaseQrSongUrl(trackId);
      if (!pb?.url) {
        setStudioError("该曲目暂时无法获取播放直链（可能需要网易云会员或版权受限）。");
        setStudioMessage("");
        return;
      }
      setNowPlaying({
        id: trackId,
        title: track.title || track.name || "未知曲目",
        artist: track.artist || "",
        cover: track.cover_url || "",
        url: pb.url,
      });
      setStudioMessage("");
    } catch (error) {
      setStudioError(error?.message || "播放地址解析失败。");
      setStudioMessage("");
    }
  };

  const handleNativeCookieLogin = async (desktop = false) => {
    setCookieBusy(true);
    setStudioError("");
    setStudioMessage("");
    try {
      const saved = await openNeteaseCookieLogin({ desktop });
      await saveNeteaseCookieSession(saved.cookie);
      setStudioMessage("已自动抓取网易云登录态并同步回灯塔！");
      await refreshConnection();
    } catch (error) {
      setStudioError(error?.message || "网页登录未完成。");
    } finally {
      setCookieBusy(false);
    }
  };

  const reload = () => {
    if (visualPreview) return;
    if (mode === "direct") {
      void refreshConnection();
      if (connection?.connected) {
        if (directTab === "playlists") void loadPlaylists();
        if (directTab === "daily") void loadDaily();
      }
      return;
    }
    setFrameReady(false);
    setFrameSlow(false);
    setEmbedState((prev) => ({ ...prev, loading: true, error: "" }));
    setReloadKey((current) => current + 1);
  };

  const openExternal = () => {
    if (embedState.url) window.open(embedState.url, "_blank", "noopener,noreferrer");
  };

  const enterFullscreen = () => {
    const frame = iframeRef.current;
    if (!frame) return;
    const request = frame.requestFullscreen?.bind(frame);
    if (request) request().catch(() => {});
  };

  const renderTrackList = (tracks = []) => (
    <div className="ms-track-list">
      {tracks.map((track, idx) => {
        const id = String(track.provider_track_id || track.id || idx);
        const active = nowPlaying?.id === id;
        return (
          <button
            type="button"
            key={`${id}-${idx}`}
            className={`ms-track-row${active ? " is-active" : ""}`}
            onClick={() => void handlePlayTrack(track)}
          >
            <span className="ms-track-idx">{active ? <Play size={13} /> : idx + 1}</span>
            <span className="ms-track-meta">
              <strong>{track.title || track.name}</strong>
              <small>{track.artist || "未知歌手"}{track.recommend_reason ? ` · ${track.recommend_reason}` : ""}</small>
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <section className="music-studio-page" aria-labelledby="music-studio-title">
      <header className="music-studio-header">
        <div className="music-studio-heading">
          <span className="music-studio-icon" aria-hidden="true"><Music2 /></span>
          <div>
            <span className="music-studio-kicker">MUSIC STUDIO</span>
            <h2 id="music-studio-title">音乐工作室</h2>
            <p>直连网易云二维码扫码 · 歌单/日推/搜索播放 · 手机零白屏</p>
          </div>
        </div>
        <div className="music-studio-actions">
          <button
            type="button"
            className={mode === "direct" ? "music-studio-sync" : ""}
            onClick={() => setMode("direct")}
          >
            <QrCode aria-hidden="true" />
            <span>扫码/歌单</span>
          </button>
          <button
            type="button"
            className={mode === "external" ? "music-studio-sync" : ""}
            onClick={() => {
              setFrameReady(false);
              setFrameSlow(false);
              setMode("external");
            }}
          >
            <Globe aria-hidden="true" />
            <span>外置播放器</span>
          </button>
          {onOpenSync ? (
            <button type="button" onClick={onOpenSync}>
              <span>一起听同步</span>
            </button>
          ) : null}
          <button type="button" aria-label="刷新音乐工作室" onClick={reload}>
            <RefreshCw aria-hidden="true" />
            <span>刷新</span>
          </button>
          {mode === "external" && (
            <>
              <button type="button" aria-label="全屏音乐工作室" onClick={enterFullscreen}>
                <Maximize2 aria-hidden="true" />
                <span>全屏</span>
              </button>
              <button type="button" aria-label="在浏览器打开音乐工作室" onClick={openExternal} disabled={!embedState.url}>
                <ExternalLink aria-hidden="true" />
                <span>浏览器打开</span>
              </button>
            </>
          )}
        </div>
      </header>

      <div className="music-studio-frame-shell">
        {mode === "direct" ? (
          <div className="ms-direct-shell">
            {visualPreview ? (
              <div className="ms-direct-card">
                <QrCode size={32} />
                <h3>网易云音乐 · 直连扫码登录</h3>
                <p>在真实登录态下，进入音乐工作室会直接渲染高清网易云登录二维码，支持一键保存到相册、跳网易云扫码、切回自动抓取登录态并直读你的歌单与每日推荐。</p>
                {onOpenSync ? (
                  <button type="button" className="ms-btn-primary" onClick={onOpenSync}>前往一起听同步</button>
                ) : null}
              </div>
            ) : authLoading ? (
              <div className="music-studio-state" role="status">
                <Loader2 className="is-spinning" aria-hidden="true" />
                <strong>正在检查你的网易云登录状态…</strong>
                <small>已登录将直接展示歌单与日推，未登录将立即呈现二维码。</small>
              </div>
            ) : !connection ? (
              <div className="ms-login-stage">
                <NeteaseQrLogin
                  inline
                  autoStart
                  hidePlaylists
                  onConnected={(conn) => {
                    if (conn?.connected) {
                      setConnection(conn);
                      setStudioMessage(`欢迎回来，${conn.nickname || "网易云用户"}！正在载入你的歌单…`);
                    }
                  }}
                />
                {neteaseCookiePluginAvailable() && (
                  <div className="ms-native-fallback">
                    <span>也可以用手机 App 内置登录（扫码/验证码登录成功后自动抓取并同步回灯塔）：</span>
                    <div className="ms-native-fallback-btns">
                      <button
                        type="button"
                        disabled={cookieBusy}
                        onClick={() => void handleNativeCookieLogin(false)}
                      >
                        {cookieBusy ? "正在同步…" : "App 内网页登录（自动抓登录态）"}
                      </button>
                      <button
                        type="button"
                        disabled={cookieBusy}
                        onClick={() => void handleNativeCookieLogin(true)}
                      >
                        桌面版网页扫码登录
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="ms-library-stage">
                <div className="ms-account-bar">
                  <div className="ms-account-pill">
                    <Disc3 size={16} />
                    <strong>{connection.nickname || "网易云用户"}</strong>
                    {connection.uid && <small>ID {connection.uid}</small>}
                  </div>
                  <div className="ms-tabs">
                    <button
                      type="button"
                      className={directTab === "playlists" ? "is-active" : ""}
                      onClick={() => { setDirectTab("playlists"); setActivePlaylist(null); }}
                    >
                      <ListMusic size={14} /> 我的歌单
                    </button>
                    <button
                      type="button"
                      className={directTab === "daily" ? "is-active" : ""}
                      onClick={() => { setDirectTab("daily"); setActivePlaylist(null); }}
                    >
                      <Sparkles size={14} /> 每日推荐
                    </button>
                    <button
                      type="button"
                      className={directTab === "search" ? "is-active" : ""}
                      onClick={() => { setDirectTab("search"); setActivePlaylist(null); }}
                    >
                      <Search size={14} /> 搜歌
                    </button>
                  </div>
                </div>

                {studioMessage && <div className="ms-banner" role="status">{studioMessage}</div>}
                {studioError && <div className="ms-banner is-error" role="alert">{studioError}</div>}

                {directTab === "playlists" && !activePlaylist && (
                  <div className="ms-playlist-grid">
                    {dataBusy && playlists.length === 0 ? (
                      <div className="ms-loading-inline"><Loader2 className="is-spinning" size={18} /> 正在读取你的网易云歌单…</div>
                    ) : playlists.map((pl) => (
                      <div className="ms-playlist-card" key={pl.provider_playlist_id}>
                        <button type="button" className="ms-playlist-open" onClick={() => void handleOpenPlaylist(pl)}>
                          <strong>{pl.name}</strong>
                          <small>{pl.item_count} 首{pl.creator_nickname ? ` · ${pl.creator_nickname}` : ""}</small>
                        </button>
                        <button
                          type="button"
                          className="ms-playlist-import"
                          disabled={importBusyId === pl.provider_playlist_id}
                          onClick={() => void handleImportToSync(pl)}
                        >
                          {importBusyId === pl.provider_playlist_id ? "导入中…" : "导入一起听"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {directTab === "playlists" && activePlaylist && (
                  <div className="ms-playlist-detail">
                    <div className="ms-detail-head">
                      <button type="button" onClick={() => setActivePlaylist(null)}>← 返回歌单</button>
                      <strong>{activePlaylist.name}</strong>
                      <button
                        type="button"
                        disabled={importBusyId === activePlaylist.provider_playlist_id}
                        onClick={() => void handleImportToSync(activePlaylist)}
                      >
                        {importBusyId === activePlaylist.provider_playlist_id ? "导入中…" : "整单导入一起听"}
                      </button>
                    </div>
                    {renderTrackList(activePlaylist.tracks || [])}
                  </div>
                )}

                {directTab === "daily" && (
                  dataBusy && dailySongs.length === 0
                    ? <div className="ms-loading-inline"><Loader2 className="is-spinning" size={18} /> 正在拉取今日日推…</div>
                    : renderTrackList(dailySongs)
                )}

                {directTab === "search" && (
                  <div className="ms-search-wrap">
                    <form className="ms-search-form" onSubmit={handleSearch}>
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="输入歌名、歌手或专辑名…"
                      />
                      <button type="submit" disabled={dataBusy || !searchQuery.trim()}>
                        {dataBusy ? "搜索中…" : "搜索"}
                      </button>
                    </form>
                    {renderTrackList(searchSongs)}
                  </div>
                )}

                {nowPlaying && (
                  <div className="ms-mini-player">
                    <div className="ms-mini-meta">
                      <strong>{nowPlaying.title}</strong>
                      <small>{nowPlaying.artist || "网易云音乐"}</small>
                    </div>
                    <audio src={nowPlaying.url} controls autoPlay playsInline />
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            {!visualPreview && !embedState.url && embedState.error ? (
              <div className="music-studio-state is-error" role="alert">
                <TriangleAlert aria-hidden="true" />
                <strong>外置播放器暂时不可用</strong>
                <small>{embedState.error}</small>
                <div>
                  <button type="button" onClick={() => setMode("direct")}>切回直连扫码/歌单</button>
                  <button type="button" onClick={reload}>重试</button>
                </div>
              </div>
            ) : null}

            {embedState.url && !frameReady ? (
              <div className="music-studio-frame-overlay" role="status" aria-live="polite">
                <Loader2 className="is-spinning" aria-hidden="true" />
                <strong>{frameSlow ? "外置播放器加载较慢" : "正在连接外置播放器"}</strong>
                <small>{frameSlow ? "如果手机端内嵌页受第三方 Cookie 限制，可直接切回「扫码/歌单」直连模式或浏览器打开。" : "正在加载独立播放器…"}</small>
                <div>
                  <button type="button" onClick={() => setMode("direct")}>切回直连扫码模式</button>
                  <button type="button" onClick={openExternal}>浏览器打开</button>
                </div>
              </div>
            ) : null}

            {embedState.url ? (
              <iframe
                ref={iframeRef}
                className="music-studio-frame"
                src={embedState.url}
                title="DengTa 外置音乐播放器"
                allow="autoplay; clipboard-write; fullscreen; microphone; encrypted-media"
                referrerPolicy="strict-origin-when-cross-origin"
                onLoad={() => setFrameReady(true)}
                onError={() => setEmbedState({ loading: false, url: "", error: "外置播放器加载失败，已建议切回直连模式。" })}
              />
            ) : null}
          </>
        )}
      </div>

      <p className="music-studio-note">
        已默认启用「直连扫码与歌单工作台」：打开即展示清晰二维码，支持保存到相册、切去网易云扫码确认后自动抓回登录态；需要独立完整网页播放器可点右上角「外置播放器」。
      </p>
    </section>
  );
}
