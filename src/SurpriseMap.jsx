import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Bot, Bookmark, Check, ChevronRight, Compass, Copy, Heart, Info, LocateFixed, LockKeyhole, Mail, MapPin, PenLine, RefreshCw, Send, Sparkles, Waves, X } from "lucide-react";
import { useMemoryUiRequest } from "./memory-ui-feedback.js";
import { locateForSurpriseMap, surpriseMapError } from "./surprise-map.js";
import { recordOperationFailure } from "./operation-diagnostics.js";
import { useBackLayer } from "./useAppBackNavigation.js";
import SurpriseLetterMap from "./SurpriseLetterMap.jsx";
import { displayMapArea, publicAuthorLabel, selectedPublicMapPoint } from "./surprise-map-display.js";
import { TILE_SOURCE_PRESETS, normalizeTileSource, readTileSourcePreference, saveTileSourcePreference } from "./map-tile-sources.js";
import "./surprise-map.css";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalidReceipt = () => Object.assign(new Error("Invalid map receipt"), { code: "surprise_map_receipt_invalid" });
const newDraft = () => ({ title: "", body: "", place_label: "", radius_m: 100 });
const newFeed = () => ({ items: [], status: "idle", error: "", next: null });
const tabs = [{ id: "private", label: "私人来信", icon: LockKeyhole }, { id: "public", label: "公共惊喜", icon: Compass }, { id: "collection", label: "已拆收藏", icon: Bookmark }];
function validLetter(letter, collection = false) {
  if (!letter || !UUID.test(letter.id) || typeof letter.title !== "string" || !letter.title.trim()) return false;
  if (collection && !["private", "public"].includes(letter.kind)) return false;
  if (collection && letter.unavailable === true) return letter.claimed === true && ["withdrawn", "not_found"].includes(letter.unavailable_reason);
  return Boolean(displayMapArea(letter.area)) && (!letter.claimed || (typeof letter.body === "string" && letter.body.trim()));
}
function readPage(data, collection, offset = 0) {
  if (data?.ok !== true || !Array.isArray(data.letters) || !data.letters.every(letter => validLetter(letter, collection))) throw invalidReceipt();
  if (data.page && (typeof data.page.has_more !== "boolean" || (data.page.has_more && (!Number.isSafeInteger(data.page.next_offset) || data.page.next_offset <= offset)))) throw invalidReceipt();
  return { items: data.letters, next: data.page?.has_more ? data.page.next_offset : null };
}
function distanceLabel(letter, position) {
  if (!position || !letter.area) return "位置已模糊";
  const radians = Math.PI / 180, lat = (letter.area.latitude - position.latitude) * radians, lng = (letter.area.longitude - position.longitude) * radians;
  const arc = Math.sin(lat / 2) ** 2 + Math.cos(position.latitude * radians) * Math.cos(letter.area.latitude * radians) * Math.sin(lng / 2) ** 2;
  const meters = 6371000 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(Math.max(0, 1 - arc)));
  return meters < 1000 ? `模糊中心约 ${Math.round(meters / 50) * 50 || 50} 米` : `模糊中心约 ${(meters / 1000).toFixed(1)} 公里`;
}

function MapDialog({ title, children, onClose, className = "" }) {
  const titleId = useId(), panel = useRef(null), latestClose = useRef(onClose);
  useEffect(() => { latestClose.current = onClose; }, [onClose]);
  useBackLayer(true, onClose, 320);
  const keydown = useCallback(event => {
    if (event.isComposing || event.keyCode === 229 || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); latestClose.current(); }
    if (event.key !== "Tab") return;
    const nodes = [...(panel.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]') || [])].filter(node => node.getClientRects().length);
    const first = nodes[0], last = nodes.at(-1), documentObject = globalThis.document;
    if (!first) { event.preventDefault(); panel.current?.focus(); }
    else if (event.shiftKey && (documentObject?.activeElement === first || !panel.current?.contains(documentObject?.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (documentObject?.activeElement === last || !panel.current?.contains(documentObject?.activeElement))) { event.preventDefault(); first.focus(); }
  }, []);
  useEffect(() => {
    const documentObject = globalThis.document;
    if (!documentObject?.body) return undefined;
    const previous = documentObject.activeElement, overflow = documentObject.body.style.overflow;
    documentObject.body.style.overflow = "hidden"; panel.current?.focus();
    documentObject.addEventListener("keydown", keydown, true);
    return () => { documentObject.body.style.overflow = overflow; documentObject.removeEventListener("keydown", keydown, true); if (previous?.isConnected) previous.focus(); };
  }, [keydown]);
  const dialog = <div className="surprise-map-dialog-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}><section className={`surprise-map-dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={panel} onKeyDown={globalThis.document ? undefined : keydown}><header className="surprise-map-dialog-header"><h2 id={titleId}>{title}</h2><button type="button" aria-label="关闭窗口" onClick={onClose}><X size={22} aria-hidden="true" /></button></header>{children}</section></div>;
  return globalThis.document?.body ? createPortal(dialog, document.body) : dialog;
}

export default function SurpriseMap({ scopeKey, aiName = "伴侣" }) {
  const { request, isCurrent } = useMemoryUiRequest(scopeKey);
  return <SurpriseMapContent key={scopeKey} request={request} isCurrent={isCurrent} aiName={aiName} scopeKey={scopeKey} />;
}

export function SurpriseMapContent({ request, isCurrent, aiName = "伴侣", scopeKey = "", locatePosition = locateForSurpriseMap }) {
  const [feeds, setFeeds] = useState(() => ({ private: newFeed(), public: newFeed(), collection: newFeed() }));
  const feedsRef = useRef(feeds); useEffect(() => { feedsRef.current = feeds; }, [feeds]);
  const [view, setView] = useState("private"), [busy, setBusy] = useState(""), [feedback, setFeedback] = useState("");
  const [position, setPosition] = useState(null), [opened, setOpened] = useState(null), [selectedId, setSelectedId] = useState(null);
  const [basemap, setBasemap] = useState(false), [mapConsent, setMapConsent] = useState(false), [mapAllowed, setMapAllowed] = useState(false), [guide, setGuide] = useState(false);
  const [composer, setComposer] = useState(false), [step, setStep] = useState(1), [draft, setDraft] = useState(newDraft);
  const [publication, setPublication] = useState(null), [confirmPublic, setConfirmPublic] = useState(false), [viewport, setViewport] = useState("");
  const [publicPicker, setPublicPicker] = useState(false), [publicCandidate, setPublicCandidate] = useState(null);
  const [authorFilter, setAuthorFilter] = useState("");
  const [mcpOpen, setMcpOpen] = useState(false), [mcpTokens, setMcpTokens] = useState([]), [mcpToken, setMcpToken] = useState(""), [mcpBusy, setMcpBusy] = useState(false), [mcpError, setMcpError] = useState("");
  const [tileSource, setTileSource] = useState(() => readTileSourcePreference(globalThis.localStorage, scopeKey));
  const [tileDraft, setTileDraft] = useState(() => ({ id: tileSource.id, key: tileSource.key, template: tileSource.template, attribution: tileSource.attribution }));
  const createReceipt = useRef(null), loadSequence = useRef({ private: 0, public: 0, collection: 0 }), operation = useRef(null), alive = useRef(false), mapArea = useRef(null), viewportRef = useRef("");
  useEffect(() => { viewportRef.current = viewport; }, [viewport]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; operation.current = null; }; }, []);
  const current = useCallback(() => alive.current && isCurrent(), [isCurrent]);
  function applyTileSource(candidate) {
    const normalized = normalizeTileSource(candidate);
    setTileSource(normalized);
    setTileDraft({ id: normalized.id, key: normalized.key, template: normalized.template, attribution: normalized.attribution });
    saveTileSourcePreference(globalThis.localStorage, scopeKey, normalized);
  }
  function chooseTilePreset(id) {
    const preset = TILE_SOURCE_PRESETS[id] || TILE_SOURCE_PRESETS.osm;
    setTileDraft({ id: preset.id, key: "", template: preset.template, attribution: preset.attribution });
  }
  const mcpEndpoint = String(import.meta.env?.VITE_API_URL || globalThis.location?.origin || "").replace(/\/$/, "") + "/api/v2/surprise-map/mcp";
  async function loadMcpTokens() {
    setMcpError("");
    try {
      const data = await request("/api/v2/surprise-map/mcp/tokens");
      if (!current()) return;
      if (data?.ok !== true || !Array.isArray(data.tokens)) throw Object.assign(new Error("Invalid MCP token receipt"), { code: "surprise_map_receipt_invalid" });
      setMcpTokens(data.tokens);
    } catch (error) { if (current()) setMcpError(surpriseMapError(error, { operation: "read" })); }
  }
  function openMcp() { setMcpOpen(true); setMcpToken(""); void loadMcpTokens(); }
  async function createMcpToken() {
    if (mcpBusy) return;
    setMcpBusy(true); setMcpError("");
    try {
      const data = await request("/api/v2/surprise-map/mcp/tokens", { method: "POST", body: { label: "灯塔邮局 MCP" } });
      if (!current()) return;
      if (data?.ok !== true || typeof data.token !== "string" || !data.token.startsWith("dengta_map_")) throw Object.assign(new Error("Invalid MCP token receipt"), { code: "surprise_map_receipt_invalid" });
      setMcpToken(data.token);
      await loadMcpTokens();
    } catch (error) { if (current()) setMcpError(surpriseMapError(error)); }
    finally { if (current()) setMcpBusy(false); }
  }
  async function revokeMcpToken(id) {
    if (!id || mcpBusy) return;
    setMcpBusy(true); setMcpError("");
    try {
      await request(`/api/v2/surprise-map/mcp/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
      setMcpToken("");
      if (current()) await loadMcpTokens();
    } catch (error) { if (current()) setMcpError(surpriseMapError(error)); }
    finally { if (current()) setMcpBusy(false); }
  }
  async function copyMcpValue(value) {
    try { await globalThis.navigator?.clipboard?.writeText(String(value || "")); if (current()) setMcpError("已复制到剪贴板。"); }
    catch { if (current()) setMcpError("无法自动复制，请长按手动复制。"); }
  }
  async function importTileManifest(file) {
    try {
      const value = JSON.parse(await file.text());
      const template = String(value?.template || value?.tiles || "").trim();
      if (!template) throw new Error("missing template");
      applyTileSource({ id: "custom", template, attribution: String(value?.attribution || ""), key: String(value?.key || "") });
      setFeedback("离线地图清单已导入，仅保存在当前账号这台上。");
    } catch {
      setFeedback("这份离线地图清单无法读取，请确认是包含 template 与 attribution 的 JSON。");
    }
  }
  const load = useCallback(async (target, { append = false } = {}) => {
    const offset = append ? feedsRef.current[target].next : 0;
    if (append && offset === null) return;
    const sequence = ++loadSequence.current[target];
    setFeeds(previous => ({ ...previous, [target]: { ...previous[target], status: append ? "more" : "loading", error: "" } }));
    const params = new URLSearchParams({ offset: String(offset), limit: "40" });
    if (target === "public" && viewportRef.current) params.set("bbox", viewportRef.current);
    if (target === "public" && authorFilter) params.set("author", authorFilter);
    const path = `/api/v2/surprise-map/${target === "private" ? "letters" : target}${target === "private" ? "" : `?${params}`}`;
    try {
      const page = readPage(await request(path), target === "collection", offset);
      if (!current() || sequence !== loadSequence.current[target]) return;
      setFeeds(previous => {
        const items = append ? [...previous[target].items, ...page.items] : page.items;
        const unique = [...new Map(items.map(item => [`${item.kind || target}:${item.id}`, item])).values()];
        return { ...previous, [target]: { items: unique, status: "ready", error: "", next: page.next } };
      });
    } catch (error) {
      if (!current() || sequence !== loadSequence.current[target]) return;
      setFeeds(previous => ({ ...previous, [target]: { ...previous[target], status: "error", error: surpriseMapError(error, { operation: "read" }) } }));
      recordOperationFailure(scopeKey, path, error);
    }
  }, [current, request, scopeKey, authorFilter]);
  const publicViewport = view === "public" ? viewport : "";
  useEffect(() => { void load(view); }, [load, view, publicViewport, authorFilter]);
  async function perform(name, action) {
    if (!current() || operation.current) return;
    const token = {}; operation.current = token; setBusy(name); setFeedback("");
    const owns = () => current() && operation.current === token;
    try { await action(owns); }
    catch (error) { if (owns()) { recordOperationFailure(scopeKey, "/api/v2/surprise-map", error); setFeedback(surpriseMapError(error)); } }
    finally { if (owns()) { operation.current = null; setBusy(""); } }
  }
  async function locate(owns) { const value = await locatePosition(); if (!owns()) return null; setPosition(value); return value; }
  const feed = feeds[view], items = feed.items, selected = items.find(letter => letter.id === selectedId);
  const mapItems = useMemo(() => items.filter(item => !item.unavailable), [items]);
  const hasDialog = Boolean(opened || composer || publication || mapConsent || guide || publicPicker);
  const switchView = id => { setView(id); setSelectedId(null); setFeedback(""); if (id !== "public") setAuthorFilter(""); };
  const choosePublication = letter => { setFeedback(""); setConfirmPublic(false); setPublication({ id: letter.id, public_title: "", public_text: "", public_place: "", public_latitude: "", public_longitude: "", source: "human" }); };
  const closeComposer = () => { if (busy !== "create") { setComposer(false); setFeedback(""); } };
  const closePublication = () => { if (busy !== "publish") { setPublication(null); setFeedback(""); } };
  const openPublicPicker = () => { setFeedback(""); setPublicCandidate(null); if (mapAllowed) setPublicPicker(true); else setMapConsent("publish"); };
  const hasPublicPoint = publication && publication.public_latitude !== "" && publication.public_longitude !== "" &&
    Number.isFinite(Number(publication.public_latitude)) && Math.abs(Number(publication.public_latitude)) <= 90 &&
    Number.isFinite(Number(publication.public_longitude)) && Math.abs(Number(publication.public_longitude)) <= 180;
  function openLetter(letter) {
    if (letter.unavailable) return;
    void perform(`claim:${letter.id}`, async owns => {
      if (letter.claimed && typeof letter.body === "string") { setOpened({ letter, sealed: false }); return; }
      const fresh = await locate(owns); if (!fresh) return;
      const kind = view === "collection" ? letter.kind : view;
      const data = await request(`/api/v2/surprise-map/${kind === "private" ? "letters" : "public"}/${encodeURIComponent(letter.id)}/claim`, { method: "POST", body: fresh });
      if (!owns()) return;
      if (data?.ok !== true || !validLetter(data.letter) || data.letter.id !== letter.id || data.letter.claimed !== true) throw invalidReceipt();
      setOpened({ letter: data.letter, sealed: true }); await load(view);
    });
  }
  async function saveLetter(owns) {
    const fingerprint = JSON.stringify(draft);
    if (createReceipt.current?.fingerprint !== fingerprint) {
      const fresh = await locate(owns); if (!fresh) return;
      createReceipt.current = { fingerprint, body: { ...draft, ...fresh, client_request_id: crypto.randomUUID() } };
    } else if (createReceipt.current.refreshPosition) {
      const fresh = await locate(owns); if (!fresh) return;
      createReceipt.current = { ...createReceipt.current, body: { ...createReceipt.current.body, ...fresh }, refreshPosition: false };
    }
    const receipt = createReceipt.current; let saved;
    try { saved = await request("/api/v2/surprise-map/letters", { method: "POST", body: receipt.body }); }
    catch (error) { if (owns() && ["surprise_map_location_stale", "surprise_map_location_invalid", "surprise_map_location_inaccurate"].includes(error?.code)) receipt.refreshPosition = true; throw error; }
    if (!owns()) return;
    if (saved?.ok !== true || !validLetter(saved.letter) || saved.letter.title !== receipt.body.title || saved.published !== false) throw invalidReceipt();
    createReceipt.current = null; setDraft(previous => JSON.stringify(previous) === fingerprint ? newDraft() : previous);
    setComposer(false); setStep(1); setView("private"); await load("private");
    if (owns()) setFeedback(saved.replayed ? "已确认上次选择的落点和来信，没有重复留信或更换地点。" : "信已经藏好，只有当前账号和伴侣能发现。下次路过时，再把它拆开吧。");
  }
  const draftPublicLetter = () => void perform("public-draft", async owns => {
    const data = await request("/api/v2/surprise-map/draft", { method: "POST", timeoutMs: 90000, body: {
      place_label: publication?.public_place || "一处公共地点", mood: "写给偶然路过这里的人", audience: "public" } });
    if (!owns() || !publication) return;
    if (data?.audience !== "public" || typeof data?.draft?.title !== "string" || !data.draft.title.trim() ||
        typeof data?.draft?.body !== "string" || !data.draft.body.trim()) throw Object.assign(new Error("Invalid public draft"), { code: "surprise_map_draft_invalid" });
    setConfirmPublic(false);
    setPublication(value => value ? { ...value, public_title: data.draft.title, public_text: data.draft.body, source: "ai" } : value);
  });
  const draftLetter = () => void perform("draft", async owns => {
    const fingerprint = JSON.stringify(draft);
    const data = await request("/api/v2/surprise-map/draft", { method: "POST", timeoutMs: 90000, body: { place_label: draft.place_label || "沿途的一处地方", mood: "沿途的小惊喜" } });
    if (!owns()) return;
    if (typeof data?.draft?.title !== "string" || !data.draft.title.trim() || typeof data?.draft?.body !== "string" || !data.draft.body.trim()) throw Object.assign(new Error("Invalid draft"), { code: "surprise_map_draft_invalid" });
    setDraft(value => JSON.stringify(value) === fingerprint ? { ...value, title: data.draft.title, body: data.draft.body } : value);
  });
  const withdraw = id => void perform(`withdraw:${id}`, async owns => {
    const data = await request(`/api/v2/surprise-map/public/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!owns()) return;
    if (data?.ok !== true || data.id !== id || data.state !== "withdrawn") throw invalidReceipt();
    if (opened?.letter.id === id) setOpened(null);
    await Promise.all([load("private"), load("public"), load("collection")]);
    if (owns()) setFeedback("公开版本已撤回，私人来信仍在你的空间里。");
  });
  return <section className="feature-page surprise-map-page" aria-label="灯塔邮局">
    <div className="surprise-map-main" inert={hasDialog || undefined}>
      <header className="surprise-map-hero"><div className="surprise-map-hero-top"><span className="surprise-map-kicker">DENGTA · LETTERS BY THE SEA</span><button type="button" className="surprise-map-icon-button" aria-label="查看邮局玩法" onClick={() => setGuide(true)}><Info size={20} aria-hidden="true" /></button></div><h2>灯塔邮局</h2><p>把惊喜留在某个地方</p><span className="surprise-map-hero-caption"><Waves size={14} aria-hidden="true" /> 海风会替你，保管这份期待</span></header>
      <nav className="surprise-map-tabs" aria-label="来信分类">{tabs.map(({ id, label, icon: Icon }) => <button type="button" key={id} aria-pressed={view === id} onClick={() => switchView(id)}><Icon size={17} aria-hidden="true" />{label}</button>)}</nav>
      <div className="surprise-map-toolbar"><p>{view === "private" ? "只属于你们的沿途惊喜" : view === "public" ? "和路过的人，交换一点温柔" : "把相遇，收进自己的信箱"}</p>{view === "public" && authorFilter && <button type="button" className="surprise-map-author-filter" onClick={() => setAuthorFilter("")} aria-label="清除笔名筛选">只看 {authorFilter} ×</button>}<button type="button" className="surprise-map-icon-button" aria-label="MCP 接口" onClick={openMcp}><Bot size={18} aria-hidden="true" /></button><button type="button" className="surprise-map-icon-button" aria-label="刷新当前来信" disabled={feed.status === "loading" || feed.status === "more"} onClick={() => void load(view)}><RefreshCw size={18} aria-hidden="true" /></button></div>
      {view !== "collection" && <div className="surprise-map-geography" ref={mapArea}>
        <SurpriseLetterMap items={mapItems} position={position} selectedId={selected?.id || null} onSelect={setSelectedId} onViewport={setViewport} tileSource={tileSource} tiles={basemap} />
        <div className="surprise-map-layer-switch"><button type="button" aria-label={basemap ? "切换到雷达图" : "打开街道地图"} onClick={() => { if (basemap) { setBasemap(false); setViewport(""); } else if (mapAllowed) setBasemap(true); else setMapConsent("browse"); }}>{basemap ? <><Compass size={14} aria-hidden="true" />雷达图</> : <><MapPin size={14} aria-hidden="true" />街道地图</>}</button></div>
        {!basemap && <div className="surprise-map-radar-badge"><Compass size={12} aria-hidden="true" />雷达图 · 只显示模糊范围</div>}
        <div className="surprise-map-map-caption"><LockKeyhole size={13} aria-hidden="true" />信件只显示模糊范围</div>
      </div>}
      {selected && <div className="surprise-map-selected"><div><MapPin size={18} aria-hidden="true" /><strong>{selected.title}</strong></div><p>{selected.place_label || selected.public_place || "沿途的一处地方"} · 模糊范围，走近后重新定位领取。</p><button type="button" onClick={() => openLetter(selected)} disabled={Boolean(busy)}>{selected.claimed ? "再读这封信" : "走近了，打开信"}<ChevronRight size={16} aria-hidden="true" /></button><button type="button" className="surprise-map-icon-button" aria-label="收起地图选中项" onClick={() => setSelectedId(null)}><X size={18} aria-hidden="true" /></button></div>}
      <div className="surprise-map-location-row"><span><LocateFixed size={14} aria-hidden="true" />{position ? `本次定位 · 精度约 ${Math.ceil(position.accuracy)} 米` : "定位仅在你点击时进行，不持续记录轨迹"}</span><button type="button" disabled={Boolean(busy)} onClick={() => void perform("locate", locate)}>{busy === "locate" ? "定位中…" : "定位附近"}</button></div>
      {feedback && !hasDialog && <p role="status" className="surprise-map-feedback">{feedback}</p>}
      <div className="surprise-map-list" aria-busy={feed.status === "loading" || feed.status === "more"}>
        {feed.status === "loading" && <div className="surprise-map-state" role="status"><Mail size={24} aria-hidden="true" /><p>正在整理{view === "collection" ? "收藏" : "沿途的来信"}…</p></div>}
        {feed.error && <div className="surprise-map-state surprise-map-state-error" role="alert"><p>{feed.error}</p>{items.length > 0 && <p>下面保留的是上次加载的来信。</p>}<button type="button" onClick={() => void load(view)}>重新加载此页</button></div>}
        {feed.status !== "loading" && !feed.error && !items.length && <article className="surprise-map-envelope surprise-map-empty"><span className="surprise-map-letter-eyebrow"><Mail size={15} aria-hidden="true" />{view === "collection" ? "属于你的相遇" : "沿途有信"}</span><h3>{view === "private" ? "下一封惊喜，等你开始" : view === "public" ? "这片风景，还在等第一封信" : "拆过的信，会留在这里"}</h3><p>{view === "private" ? `让${aiName}写一句想对你说的话，藏在下次会经过的地方。` : view === "public" ? "私人来信不会自动公开。你也可以另写一份，送给偶然路过的人。" : "走近一处惊喜，打开来信后，它就会自动收入收藏。"}</p><button type="button" className="surprise-map-primary" onClick={() => { if (view === "collection") switchView("private"); else { setFeedback(""); setComposer(true); setStep(1); } }}>{view === "collection" ? "去找一封信" : "让伴侣留一封"}<ChevronRight size={17} aria-hidden="true" /></button></article>}
        {items.map(letter => <article className={`surprise-map-letter-card ${letter.unavailable ? "is-unavailable" : ""} ${letter.claimed ? "is-opened" : ""}`} key={`${letter.kind || view}:${letter.id}`}>
          <div className="surprise-map-card-seal" aria-hidden="true">{letter.unavailable ? "·" : letter.claimed ? "✓" : "✦"}</div>
          <div className="surprise-map-card-main">
            <div className="surprise-map-card-meta"><span className="surprise-map-letter-eyebrow">{letter.unavailable ? <Info size={14} aria-hidden="true" /> : letter.claimed ? <Bookmark size={14} aria-hidden="true" /> : <Mail size={14} aria-hidden="true" />}{letter.unavailable ? "公开版本已失效" : letter.claimed ? "已收进你的信箱" : "有一封信，正在等你"}</span>{(view === "public" || letter.kind === "public") && !letter.unavailable && <span className={`surprise-map-source ${letter.source === "ai" ? "is-ai" : ""}`}>{publicAuthorLabel(letter)}</span>}</div>
            <h3>{letter.title}</h3>
            <p className="surprise-map-card-description">{letter.unavailable ? "原作者已撤回这份公开惊喜，或来信已不存在。这里不再展示原文与位置。" : letter.claimed ? "有些话，值得在后来的一天再读一次。" : (view === "public" || letter.kind === "public") ? `${publicAuthorLabel(letter)} 在这里留下了一点温柔，正等你亲自发现。` : `${aiName}把一些想对你说的话，留在了沿途。`}</p>
            {!letter.unavailable && <div className="surprise-map-card-footer"><div className="surprise-map-place"><MapPin size={14} aria-hidden="true" /><span>{letter.place_label || letter.public_place || "沿途的一处地方"}</span><small>{distanceLabel(letter, position)}</small></div><button type="button" className="surprise-map-card-open" disabled={Boolean(busy)} onClick={() => openLetter(letter)}>{busy === `claim:${letter.id}` ? "正在确认距离…" : letter.claimed ? "再读这封信" : "走近了，打开信"}<ChevronRight size={16} aria-hidden="true" /></button></div>}
            {letter.unavailable && <button type="button" className="surprise-map-card-open" disabled>这封来信已不可查看</button>}
            {!letter.unavailable && view !== "collection" && <div className="surprise-map-card-secondary"><button type="button" aria-pressed={selectedId === letter.id} onClick={() => { setSelectedId(letter.id); if (view === "collection") setView(letter.kind === "public" ? "public" : "private"); mapArea.current?.scrollIntoView({ block: "center", behavior: "auto" }); }}><Compass size={14} aria-hidden="true" />查看这封信的范围</button>{view === "private" && <button type="button" disabled={Boolean(busy)} onClick={() => choosePublication(letter)}>另写公开版本</button>}{view === "public" && letter.author_alias && <button type="button" onClick={() => { setSelectedId(null); setAuthorFilter(letter.author_alias); }}>看看 TA 的其他信</button>}{((view === "private" && letter.publication?.state === "published") || (view === "public" && letter.owned === true)) && <button type="button" disabled={Boolean(busy)} onClick={() => withdraw(view === "private" ? letter.publication.id : letter.id)}>撤回公开</button>}</div>}
          </div>
        </article>)}
        {feed.next !== null && <button type="button" className="surprise-map-load-more" disabled={feed.status === "more"} onClick={() => void load(view, { append: true })}>{feed.status === "more" ? "正在找更多来信…" : "再看看更多来信"}</button>}
      </div>
      {view !== "collection" && items.length > 0 && <button type="button" className="surprise-map-create" onClick={() => { setFeedback(""); setComposer(true); setStep(1); }}><PenLine size={18} aria-hidden="true" />让伴侣留一封</button>}
      <footer className="surprise-map-footer"><Heart size={13} aria-hidden="true" /><span>私人来信只属于当前账号与伴侣。<br />公开的，始终由你亲自决定。</span></footer>
    </div>
    {mapConsent && <MapDialog title="开启沿途的地图" onClose={() => setMapConsent(false)}>
      <div className="surprise-map-dialog-body">
        <Compass size={34} aria-hidden="true" />
        <p>底图由你选择的来源提供，会向该服务请求你正在查看区域的地图图片，服务方可获得 IP 和查看区域。</p>
        <p>不会发送信件正文或精确定位回执。精确位置仅在你点击定位、领取或藏信时使用。</p>
        <div className="surprise-map-tile-settings">
          <label>底图来源<select value={tileDraft.id} onChange={event => chooseTilePreset(event.target.value)}><option value="osm">OpenStreetMap</option><option value="amap">高德地图（GCJ-02 自动换算）</option><option value="maptiler">MapTiler（需要 Key）</option><option value="custom">自定义 / 离线瓦片</option></select></label>
          {tileDraft.id === "maptiler" && <label>MapTiler Key<input value={tileDraft.key} onChange={event => setTileDraft({ ...tileDraft, key: event.target.value })} placeholder="只保存在本机当前账号" /></label>}
          {tileDraft.id === "custom" && <>
            <label>瓦片模板<input value={tileDraft.template} onChange={event => setTileDraft({ ...tileDraft, template: event.target.value })} placeholder="https://你的瓦片服务/{z}/{x}/{y}.png" /></label>
            <label>署名<input value={tileDraft.attribution} onChange={event => setTileDraft({ ...tileDraft, attribution: event.target.value })} placeholder="© 你的地图数据来源" /></label>
            <label>导入离线地图清单<input type="file" accept="application/json,.json" onChange={event => { const file = event.target.files?.[0]; if (file) void importTileManifest(file); }} /></label>
          </>}
          <div className="surprise-map-tile-actions"><button type="button" className="surprise-map-secondary" onClick={() => applyTileSource(tileDraft)}>{tileSource.usable ? "当前：" + tileSource.label : "应用底图"}</button><small>{tileDraft.id === "amap" ? "高德底图使用 GCJ-02，信件显示和选点会自动换算；领取仍以 WGS84 定位为准。" : "底图地址与 Key 只保存在本机当前账号。"}</small></div>
        </div>
        <button type="button" className="surprise-map-primary" onClick={() => { applyTileSource(tileDraft); setMapAllowed(true); if (mapConsent === "publish") setPublicPicker(true); else setBasemap(true); setMapConsent(false); }}>本次开启街道地图<ArrowRight size={17} aria-hidden="true" /></button>
      </div>
    </MapDialog>}
    {mcpOpen && <MapDialog title="把地图接到你的 AI" onClose={() => setMcpOpen(false)}><div className="surprise-map-dialog-body surprise-map-mcp">
      <p>生成一个只属于当前账号和伴侣的 MCP 令牌。外部 AI 客户端可以用它藏私人信、列出信件；令牌只显示一次，可随时撤回。</p>
      <div className="surprise-map-mcp-endpoint"><code>{mcpEndpoint}</code><button type="button" className="surprise-map-icon-button" aria-label="复制 MCP 地址" onClick={() => void copyMcpValue(mcpEndpoint)}><Copy size={16} aria-hidden="true" /></button></div>
      {mcpToken && <div className="surprise-map-mcp-token" role="status"><span>新令牌（只显示这一次）</span><code>{mcpToken}</code><button type="button" onClick={() => void copyMcpValue(mcpToken)}>复制</button></div>}
      <button type="button" className="surprise-map-primary" disabled={mcpBusy} onClick={() => void createMcpToken()}><Bot size={17} aria-hidden="true" />{mcpBusy ? "正在生成…" : "生成新令牌"}</button>
      {mcpError && <p role="alert" className="surprise-map-feedback">{mcpError}</p>}
      {mcpTokens.length > 0 && <ul className="surprise-map-mcp-list">{mcpTokens.map(token => <li key={token.id}><span><strong>{token.label || "未命名令牌"}</strong><small>{new Date(token.created_at).toLocaleString()} · {token.last_used_at ? "最近使用过" : "尚未使用"}</small></span><button type="button" disabled={mcpBusy} onClick={() => void revokeMcpToken(token.id)}>撤回</button></li>)}</ul>}
      <p className="surprise-map-mcp-hint">工具：hide_letter / list_letters / list_public_letters。藏信需要 confirm:true；不会返回未拆开的正文或精确坐标。</p>
    </div></MapDialog>}
    {guide && <MapDialog title="灯塔邮局 · 三步" onClose={() => setGuide(false)}>
      <div className="surprise-map-dialog-body surprise-map-guide-v2">
        <p className="surprise-map-guide-lead">不必赶路。把一句话留在某个地方，等下一次经过时再拆开。</p>
        <div className="surprise-map-guide-grid">
          <article><span className="is-map"><MapPin size={22} aria-hidden="true" /></span><strong>藏在沿途</strong><p>选一个会经过的地方，让伴侣写一封信。</p></article>
          <article><span className="is-letter"><Mail size={22} aria-hidden="true" /></span><strong>走近，再拆开</strong><p>地图只显示模糊范围。到附近后，用本次定位打开。</p></article>
          <article><span className="is-book"><Bookmark size={22} aria-hidden="true" /></span><strong>把相遇收藏</strong><p>拆过的信会自动收藏；想分享时，另写一份公开版本。</p></article>
        </div>
        <button type="button" className="surprise-map-primary" onClick={() => setGuide(false)}>开始散步<Check size={18} aria-hidden="true" /></button>
        <small>公开版本始终由你亲自确认；定位只在你点击时使用。</small>
      </div>
    </MapDialog>}
    {opened && <MapDialog title={opened.sealed ? "一封等到你的信" : opened.letter.title} className="surprise-map-letter-dialog" onClose={() => setOpened(null)}>
      <article className={`surprise-map-letter-stage ${opened.sealed ? "is-sealed" : "is-open"}`}>
        {opened.sealed ? <>
          <div className="surprise-map-envelope-visual" aria-hidden="true">
            <img src="/assets/surprise-map/letter-envelope.webp" alt="" />
          </div>
          <span className="surprise-map-letter-eyebrow">距离已确认 · 现在属于你</span>
          <h3>{opened.letter.title}</h3>
          <p>这一次相遇，可以慢一点拆开。</p>
          <button type="button" className="surprise-map-primary surprise-map-unseal" onClick={() => setOpened(value => ({ ...value, sealed: false }))}><Mail size={19} aria-hidden="true" />拆开这封信</button>
        </> : <>
          <div className="surprise-map-paper">
            <span className="surprise-map-letter-eyebrow"><Bookmark size={15} aria-hidden="true" />已收入收藏</span>
            <h3>{opened.letter.title}</h3>
            <p className="surprise-map-letter-body">{opened.letter.body}</p>
            <div className="surprise-map-letter-signature"><Waves size={18} aria-hidden="true" /><span>灯塔邮局，替你保管</span></div>
          </div>
          <button type="button" className="surprise-map-secondary" onClick={() => setOpened(null)}>收起信件</button>
        </>}
      </article>
    </MapDialog>}
    {composer && <MapDialog title="让伴侣留一封" onClose={closeComposer}><form className="surprise-map-form" aria-label="藏一封新信" onSubmit={event => { event.preventDefault(); if (step < 3) { setStep(value => value + 1); return; } void perform("create", saveLetter); }}><ol className="surprise-map-steps" aria-label="留信进度">{["选个地方", "写一封信", "藏好惊喜"].map((label,index) => <li key={label} aria-current={step === index + 1 ? "step" : undefined}><span>{index + 1}</span>{label}</li>)}</ol>
      {step === 1 && <><div className="surprise-map-form-intro"><MapPin size={28} aria-hidden="true" /><h3>下一次，会在哪里路过？</h3><p>保存时会重新定位，将信留在你当前的位置。现在可以先写好。</p></div><label>地点提示<input disabled={Boolean(busy)} value={draft.place_label} maxLength={120} placeholder="例如：下次散步的公园" onChange={event => setDraft({ ...draft, place_label: event.target.value })} /></label><label>靠近多少米可打开<select disabled={Boolean(busy)} value={draft.radius_m} onChange={event => setDraft({ ...draft, radius_m: Number(event.target.value) })}><option value={50}>50 米 · 就在身边</option><option value={100}>100 米 · 慢慢走近</option><option value={300}>300 米 · 街角相遇</option><option value={1000}>1000 米 · 一片风景</option></select></label><small>定位需要你的允许；不持续记录行程，也不会公开你的位置。</small></>}
      {step === 2 && <><div className="surprise-map-form-intro"><PenLine size={27} aria-hidden="true" /><h3>把想说的话，留给未来</h3><p>让{aiName}写，也可以亲手改成你喜欢的样子。</p></div><button type="button" className="surprise-map-secondary" disabled={Boolean(busy)} onClick={draftLetter}><Sparkles size={17} aria-hidden="true" />{busy === "draft" ? "正在写信…" : `请${aiName}写一封`}</button><label>信的标题<input disabled={Boolean(busy)} required value={draft.title} maxLength={120} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label><label>信里写着<textarea disabled={Boolean(busy)} required rows={6} value={draft.body} maxLength={6000} onChange={event => setDraft({ ...draft, body: event.target.value })} /></label><small>伴侣写信会使用当前模型接口。未保存的草稿，关闭后仍留在本页。</small></>}
      {step === 3 && <><div className="surprise-map-form-intro"><LockKeyhole size={27} aria-hidden="true" /><h3>先只藏给我们</h3><p>这封信默认只属于当前账号和伴侣。公开分享需要另外填写与确认。</p></div><div className="surprise-map-draft-preview"><strong>{draft.title}</strong><p>{draft.body}</p><small><MapPin size={14} aria-hidden="true" />{draft.place_label || "当前所在的位置"} · 靠近 {draft.radius_m} 米可打开</small></div><small>接下来会请求一次精确位置。网络未确认时重试，会沿用同一封信和原来的地点。</small></>}
      {feedback && <p role="alert" className="surprise-map-feedback">{feedback}</p>}<div className="surprise-map-form-navigation">{step > 1 && <button type="button" className="surprise-map-secondary" disabled={Boolean(busy)} onClick={() => setStep(value => value - 1)}><ArrowLeft size={16} aria-hidden="true" />上一步</button>}<button className="surprise-map-primary" disabled={Boolean(busy) || (step === 2 && (!draft.title.trim() || !draft.body.trim()))}>{step === 3 ? busy === "create" ? "正在藏好…" : "在这里藏好，只给我们" : "下一步"}{step === 3 ? <Send size={16} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}</button></div></form></MapDialog>}
    {publicPicker && publication && <MapDialog title="在地图上选公共地点" onClose={() => { setPublicPicker(false); setPublicCandidate(null); }}><div className="surprise-map-public-picker">
      <p>拖动地图，或点一下方便到达的公园、广场等公共地点。公开地图只显示模糊范围，领取以你实际点选的位置为准。不使用私人落点或本次定位。</p>
      <SurpriseLetterMap items={[]} position={null} selectedId={null} picker pickerPoint={publicCandidate} tileSource={tileSource} onPick={value => { const point = selectedPublicMapPoint(value); if (point) setPublicCandidate(point); }} />
      <div className="surprise-map-picker-candidate" role="status"><MapPin size={17} aria-hidden="true" />{publicCandidate ? `已选公共地点 · 公开地图约显示：${publicCandidate.latitude.toFixed(2)}, ${publicCandidate.longitude.toFixed(2)}` : "先拖动地图或点选一个公共地点"}</div>
      <button type="button" className="surprise-map-primary" disabled={!publicCandidate} onClick={() => { if (!publicCandidate) return; setPublication(value => value ? { ...value, public_latitude: String(publicCandidate.latitude), public_longitude: String(publicCandidate.longitude) } : value); setConfirmPublic(false); setPublicPicker(false); setPublicCandidate(null); }}>使用这个公共落点<Check size={17} aria-hidden="true" /></button>
      <small>确认后仍需核对公开文案并勾选发布；本次选点不会直接发布。</small>
    </div></MapDialog>}
    {publication && !publicPicker && mapConsent !== "publish" && <MapDialog title="送给偶然路过的人" onClose={closePublication}><form className="surprise-map-form" aria-label="公开信预览" onSubmit={event => {
      event.preventDefault(); if (!confirmPublic || !hasPublicPoint) return;
      void perform("publish", async owns => {
        const { id, ...publicDraft } = publication;
        const data = await request(`/api/v2/surprise-map/letters/${encodeURIComponent(id)}/publish`, { method: "POST", body: { ...publicDraft, public_latitude: Number(publication.public_latitude), public_longitude: Number(publication.public_longitude), confirm_publication: confirmPublic } });
        if (!owns()) return;
        if (data?.ok !== true || !validLetter(data.publication) || data.publication.title !== publicDraft.public_title) throw invalidReceipt();
        setPublication(null); setView("public"); await load("public");
      });
    }}>
      <p className="surprise-map-public-notice">重新写一份可公开的文案，选择公共地点。不会复制私人信件或本次精确位置。发布后，其他已登录用户可以发现。</p>
      <button type="button" className="surprise-map-secondary surprise-map-public-ai" disabled={Boolean(busy)} onClick={draftPublicLetter}><Sparkles size={17} aria-hidden="true" />{busy === "public-draft" ? "正在写给路过的人…" : "让 AI 写给路过的人"}</button>
      {publication.source === "ai" && <small className="surprise-map-ai-note">由 AI 起草：只用公共地点与氛围，不读取私人记忆，也不含账号或伴侣称呼。发布前请改成你愿意负责的内容。</small>}
      {[["public_title","公开标题"],["public_text","公开文案"],["public_place","公共地点名称"]].map(([field,label]) => <label key={field}>{label}{field === "public_text" ? <textarea disabled={Boolean(busy)} required rows={4} value={publication[field]} maxLength={2000} onChange={event => { setConfirmPublic(false); setPublication({ ...publication, [field]: event.target.value }); }} /> : <input disabled={Boolean(busy)} required type="text" value={publication[field]} maxLength={120} onChange={event => { setConfirmPublic(false); setPublication({ ...publication, [field]: event.target.value }); }} />}</label>)}
      <div className="surprise-map-public-location"><span><MapPin size={18} aria-hidden="true" />{hasPublicPoint ? `已选公共地点 · 公开地图约显示：${Number(publication.public_latitude).toFixed(2)}, ${Number(publication.public_longitude).toFixed(2)}` : "还没选择公开的地点"}</span><button type="button" className="surprise-map-secondary" disabled={Boolean(busy)} onClick={openPublicPicker}>在地图上选公共地点<Compass size={17} aria-hidden="true" /></button><small>请选择公园、广场等公共地点，不要选择住所。公开地图模糊显示约 1 公里范围；领取以你实际点选的位置为准。</small></div>
      <details className="surprise-map-coordinate-fallback"><summary>高级：手动填写公共坐标</summary><p>地图不可用时，可自行填写公共地点坐标。不是你当前的定位。</p>{[["public_latitude","公共地点纬度"],["public_longitude","公共地点经度"]].map(([field,label]) => <label key={field}>{label}<input disabled={Boolean(busy)} required type="number" step="any" min={field === "public_latitude" ? -90 : -180} max={field === "public_latitude" ? 90 : 180} value={publication[field]} onChange={event => { setConfirmPublic(false); setPublication({ ...publication, [field]: event.target.value }); }} /></label>)}</details>
      <label className="surprise-map-consent"><input disabled={Boolean(busy)} type="checkbox" checked={confirmPublic} onChange={event => setConfirmPublic(event.target.checked)} />我已核对上述公开文案和公共地点，同意公开发布</label>
      {!hasPublicPoint && <small>请先在地图上选一个公共落点，再确认发布。</small>}
      {feedback && <p role="alert" className="surprise-map-feedback">{feedback}</p>}
      <button className="surprise-map-primary" disabled={Boolean(busy) || !confirmPublic || !hasPublicPoint}>{busy === "publish" ? "正在确认发布…" : "确认发布公开版本"}<Send size={17} aria-hidden="true" /></button>
    </form></MapDialog>}
  </section>;
}
