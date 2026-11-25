import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, Link2, Loader2, MessageCircle, RefreshCw, ShieldCheck, Trash2, Unlink } from "lucide-react";
import { apiRequest } from "./api";
import { settingsServiceErrorMessage } from "./settings-service-errors";
import "./channel-hub.css";
import QQCloudConnect from "./QQCloudConnect.jsx";

const CHANNEL_META = {
  wechat: {
    label: "微信",
    english: "WECHAT CHANNEL",
    hint: "把 DengTa 的人设小节、说话风格和长期记忆，按你的勾选同步给微信 ClawBot。",
    bridge: "微信 iLink / wxb",
    icon: "微",
  },
  qq: {
    label: "QQ",
    english: "QQ CHANNEL",
    hint: "给当前伴侣绑定 QQ 机器人，选择它在私聊里可以用的人设、说话风格和长期记忆。",
    bridge: "QQ / SnowLuma",
    icon: "Q",
  },
};

const CATEGORY_LABELS = { normal: "日常", private: "私密", nsfw: "NSFW", style: "风格" };
const MEMORY_MODES = [
  ["none", "不同步"],
  ["recent", "最近记忆"],
  ["selected", "手动选择"],
  ["all", "全部"],
];

function normalizePrefs(value, channel) {
  return {
    channel,
    persona_mode: value?.persona_mode || "selected",
    persona_section_ids: Array.isArray(value?.persona_section_ids) ? value.persona_section_ids : [],
    ...(channel === "qq" ? {
      qq_include_persona_prompt: value?.qq_include_persona_prompt === true,
      qq_receive_memory_candidates: value?.qq_receive_memory_candidates === true,
    } : {}),
    style_enabled: value?.style_enabled === true,
    style_text: String(value?.style_text || ""),
    memory_mode: value?.memory_mode || "none",
    memory_ids: Array.isArray(value?.memory_ids) ? value.memory_ids : [],
    memory_keywords: Array.isArray(value?.memory_keywords) ? value.memory_keywords : [],
    memory_limit: Number(value?.memory_limit) || 0,
    media_enabled: value?.media_enabled === true,
  };
}

function QQMemoryCandidates() {
  const [candidates, setCandidates] = useState([]);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  async function refresh() {
    setWorking(true);
    setNotice("");
    try {
      const result = await apiRequest("/api/v2/channel-sync/qq-memory-candidates");
      setCandidates(result.candidates || []);
      if (!result.candidates?.length) setNotice("目前没有到期的候选记忆。");
    } catch (error) {
      setNotice(settingsServiceErrorMessage(error, "暂时读不到 QQ 候选记忆。"));
    } finally {
      setWorking(false);
    }
  }
  async function decide(id, accept) {
    setWorking(true);
    setNotice("");
    try {
      await apiRequest("/api/v2/channel-sync/qq-memory-candidates/" + encodeURIComponent(id) + "/decision", {
        method: "POST", body: JSON.stringify({ accept })
      });
      setCandidates((rows) => rows.filter((row) => row.id !== id));
      setNotice(accept ? "已保存到当前伴侣的长期记忆。" : "已忽略这条候选记忆。");
    } catch (error) {
      setNotice(settingsServiceErrorMessage(error, "处理失败，请刷新后重试。"));
    } finally {
      setWorking(false);
    }
  }
  return (
    <div>
      <button type="button" disabled={working} onClick={() => void refresh()}>刷新 QQ 记忆候选</button>
      {notice && <p role="status">{notice}</p>}
      {candidates.map((candidate) => (
        <div key={candidate.id}>
          <p>{candidate.summary}</p>
          <button type="button" disabled={working} onClick={() => void decide(candidate.id, true)}>加入长期记忆</button>
          <button type="button" disabled={working} onClick={() => void decide(candidate.id, false)}>忽略</button>
        </div>
      ))}
    </div>
  );
}

export default function ChannelHub({ channel = "wechat", aiName = "伴侣", visualPreview = false }) {
  const meta = CHANNEL_META[channel] || CHANNEL_META.wechat;
  const [tab, setTab] = useState("sync");
  const [loading, setLoading] = useState(!visualPreview);
  const [error, setError] = useState("");
  const [sections, setSections] = useState(() => (
    visualPreview
      ? [
          { id: "preview-sec-1", category: "normal", title: "日常相处节奏", content: "温柔、直接、不敷衍，优先倾听与陪伴。" },
          { id: "preview-sec-2", category: "style", title: "通道短句风格", content: "移动端回复尽量精炼自然，保留口语温度。" },
        ]
      : []
  ));
  const [prefs, setPrefs] = useState(() => normalizePrefs(null, channel));
  const [memories, setMemories] = useState([]);
  const [bindings, setBindings] = useState([]);
  const [qqCloudReady, setQQCloudReady] = useState(false);
  const hasBinding = qqCloudReady || bindings.some((item) => item.status === "active");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");
  const [bindingCode, setBindingCode] = useState(null);
  const [bindingBusy, setBindingBusy] = useState("");
  const [bindingError, setBindingError] = useState("");
  const [bindingRemainingMs, setBindingRemainingMs] = useState(0);
  const [copied, setCopied] = useState(false);
  const bindingExpired =
    Boolean(bindingCode?.code) && bindingRemainingMs <= 0;

  const selectedSections = useMemo(() => new Set(prefs.persona_section_ids), [prefs.persona_section_ids]);
  const selectedMemories = useMemo(() => new Set(prefs.memory_ids), [prefs.memory_ids]);
  const groupedSections = useMemo(() => {
    const groups = new Map();
    for (const section of sections) {
      const category = section.category || "normal";
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(section);
    }
    return [...groups.entries()];
  }, [sections]);

  const load = useCallback(async () => {
    if (visualPreview) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [sectionData, prefsData, memoryData, bindingData] = await Promise.all([
        apiRequest("/api/v2/channel-sync/persona-sections"),
        apiRequest(`/api/v2/channel-sync/preferences?channel=${encodeURIComponent(channel)}`),
        apiRequest(`/api/v2/channel-sync/memories?channel=${encodeURIComponent(channel)}&limit=80`),
        apiRequest(`/api/v2/channel-sync/bind/status?channel=${encodeURIComponent(channel)}`).catch(() => ({ bindings: [] })),
      ]);
      setSections(sectionData?.sections || []);
      setPrefs(normalizePrefs(prefsData?.preferences, channel));
      setMemories(memoryData?.memories || []);
      setBindings(bindingData?.bindings || []);
    } catch (caught) {
      setError(settingsServiceErrorMessage(caught, `${meta.label}通道暂时读不到。`));
    } finally {
      setLoading(false);
    }
  }, [channel, meta.label, visualPreview]);

  useEffect(() => {
    if (visualPreview) return undefined;
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, visualPreview]);

  // Keep the one-time code honest: count down to expiry and poll the bridge
  // automatically so the user does not have to guess when binding succeeded.
  useEffect(() => {
    if (!bindingCode?.expiresAt) return undefined;
    const update = () => {
      const left = new Date(bindingCode.expiresAt).getTime() - Date.now();
      setBindingRemainingMs(Math.max(0, left));
    };
    const initial = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 1000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [bindingCode]);

  useEffect(() => {
    if (!bindingCode?.code || bindingExpired) return undefined;
    if (!bindingCode.id) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const data = await apiRequest(
          `/api/v2/channel-sync/bind/status?channel=${encodeURIComponent(channel)}`
        );
        const next = data?.bindings || [];
        setBindings(next);
        if (next.some((item) => item.id === bindingCode.id && item.status === "active")) setBindingCode(null);
      } catch {
        // The manual refresh button remains available; keep polling.
      }
    }, 4000);
    return () => window.clearInterval(timer);
  }, [bindingCode, channel, bindingExpired]);

  function updatePrefs(patch) {
    setSaved("");
    setPrefs((current) => ({ ...current, ...patch }));
  }

  function toggleSection(id) {
    const next = new Set(prefs.persona_section_ids);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    updatePrefs({ persona_mode: next.size ? "selected" : prefs.persona_mode, persona_section_ids: [...next] });
  }

  function toggleMemory(id) {
    const next = new Set(prefs.memory_ids);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    updatePrefs({ memory_mode: next.size ? "selected" : prefs.memory_mode, memory_ids: [...next] });
  }

  function setPersonaMode(mode) {
    if (mode === "selected") {
      updatePrefs({ persona_mode: mode });
      return;
    }
    const ids = mode === "normal_only"
      ? sections.filter((section) => (section.category || "normal") === "normal").map((section) => section.id)
      : sections.map((section) => section.id);
    updatePrefs({ persona_mode: mode, persona_section_ids: ids });
  }

  async function savePreferences() {
    if (visualPreview) {
      setSaved("当前为无登录本地预览模式，请前往主入口登录后保存真实通道同步设置。");
      return;
    }
    if (saving) return;
    setSaving(true);
    setSaved("");
    setError("");
    try {
      const selected = new Set(prefs.persona_mode === "all"
        ? sections.map((section) => section.id)
        : prefs.persona_mode === "normal_only"
          ? sections.filter((section) => (section.category || "normal") === "normal").map((section) => section.id)
          : prefs.persona_section_ids);
      const data = await apiRequest("/api/v2/channel-sync/preferences", {
        method: "PUT",
        body: JSON.stringify({
          ...prefs,
          channel,
          persona_section_ids: [...selected],
        }),
      });
      setPrefs(normalizePrefs(data?.preferences, channel));
      
      setSaved("已保存，桥接端下一轮会按新勾选组装人设与记忆。");
    } catch (caught) {
      setError(settingsServiceErrorMessage(caught, "通道同步设置没有保存成功。"));
    } finally {
      setSaving(false);
    }
  }

  async function startBinding() {
    if (visualPreview) {
      setBindingError("当前为无登录本地预览模式，请前往主入口登录后再生成一次性绑定码。");
      return;
    }
    if (bindingBusy) return;
    setBindingBusy("start");
    setBindingError("");
    try {
      const data = await apiRequest("/api/v2/channel-sync/bind/start", {
        method: "POST",
        body: JSON.stringify({ channel }),
      });
      setBindingCode({ id: data?.binding?.id, code: data?.code || "", expiresAt: data?.expires_at || "" });
      await refreshBindings();
    } catch (caught) {
      setBindingError(settingsServiceErrorMessage(caught, "绑定码没有生成成功。"));
    } finally {
      setBindingBusy("");
    }
  }

  async function refreshBindings() {
    const data = await apiRequest(`/api/v2/channel-sync/bind/status?channel=${encodeURIComponent(channel)}`).catch(() => null);
    if (data) setBindings(data.bindings || []);
  }

  async function copyBindingCode() {
    const code = bindingCode?.code;
    if (!code || bindingExpired) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setBindingError("复制失败，请长按上面的绑定码手动复制。");
    }
  }

  async function removeBinding(id) {
    setBindingBusy(id);
    setBindingError("");
    try {
      await apiRequest(`/api/v2/channel-sync/bind/${id}`, { method: "DELETE" });
      await refreshBindings();
    } catch (caught) {
      setBindingError(settingsServiceErrorMessage(caught, "绑定没有解除。"));
    } finally {
      setBindingBusy("");
    }
  }

  return (
    <section className="feature-page channel-hub" aria-label={`${meta.label}通道`}>
      <header className="channel-hub-hero">
        <span className="channel-hub-mark" aria-hidden="true">{meta.icon}</span>
        <div>
          <span className="eyebrow">{meta.english}</span>
          <h2>{meta.label}通道</h2>
          <p>{meta.hint} 当前伴侣：{aiName || "伴侣"}。</p>
        </div>
        <span className={`channel-hub-status ${hasBinding ? "is-ready" : ""}`}>
          {hasBinding ? "已绑定" : "待绑定"}
        </span>
      </header>

      <div className="channel-hub-tabs" role="tablist" aria-label={`${meta.label}通道功能`}>
        <button type="button" role="tab" aria-selected={tab === "sync"} className={tab === "sync" ? "is-active" : ""} onClick={() => setTab("sync")}>人设与记忆</button>
        <button type="button" role="tab" aria-selected={tab === "bind"} className={tab === "bind" ? "is-active" : ""} onClick={() => setTab("bind")}>绑定与状态</button>
      </div>

      {loading ? (
        <div className="channel-hub-loading" role="status"><Loader2 className="spin" aria-hidden="true" />正在读取 {meta.label} 同步设置…</div>
      ) : error && !sections.length ? (
        <div className="channel-hub-error" role="alert">
          <strong>通道设置暂时没有读到</strong>
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>重新读取</button>
        </div>
      ) : tab === "sync" ? (
        <>
          <section className="channel-hub-card" aria-labelledby="channel-persona-title">
            <div className="channel-hub-card-heading">
              <div><span className="eyebrow">PERSONA</span><h3 id="channel-persona-title">同步哪些人设</h3></div>
              <MessageCircle aria-hidden="true" />
            </div>
            <label className="channel-hub-field">
              <span>人设小节模式</span>
              <select value={prefs.persona_mode} onChange={(event) => setPersonaMode(event.target.value)}>
                <option value="normal_only">只同步日常小节</option>
                <option value="selected">只同步我勾选的小节</option>
                <option value="all">同步全部小节</option>
              </select>
            </label>
            {channel === "qq" && (
              <label className="channel-hub-switch">
                <input type="checkbox" checked={prefs.qq_include_persona_prompt} onChange={(event) => updatePrefs({ qq_include_persona_prompt: event.target.checked })} />
                <span><strong>同步灯塔里已保存的人设</strong><small>开启后，QQ 回复会使用当前伴侣的个性化指令。「你的详情」单独保留。</small></span>
              </label>
            )}
            <div className="channel-hub-sections">
              {groupedSections.length ? groupedSections.map(([category, items]) => (
                <div className="channel-hub-section-group" key={category}>
                  <h4>{CATEGORY_LABELS[category] || category} <small>{items.length}</small></h4>
                  {items.map((section) => (
                    <label className={`channel-hub-check ${selectedSections.has(section.id) ? "is-selected" : ""}`} key={section.id}>
                      <input
                        type="checkbox"
                        checked={selectedSections.has(section.id)}
                        onChange={() => toggleSection(section.id)}
                        disabled={prefs.persona_mode !== "selected"}
                      />
                      <span>
                        <strong>{section.title || "未命名小节"}</strong>
                        <small>{String(section.content || "").slice(0, 68) || "空白小节"}</small>
                      </span>
                      <Check aria-hidden="true" />
                    </label>
                  ))}
                </div>
              )) : <p className="channel-hub-empty-line">还没有人设小节；先在「个性化与记忆」里整理人设。</p>}
            </div>
            <label className="channel-hub-switch">
              <input type="checkbox" checked={prefs.style_enabled} onChange={(event) => updatePrefs({ style_enabled: event.target.checked })} />
              <span><strong>同步说话风格</strong><small>只影响通道回复，不改变 DengTa 网页设置。</small></span>
            </label>
            {prefs.style_enabled ? (
              <textarea
                value={prefs.style_text}
                onChange={(event) => updatePrefs({ style_text: event.target.value.slice(0, 4000) })}
                placeholder="例如：短句、口语化、少用感叹号"
                aria-label="通道说话风格"
                rows={3}
              />
            ) : null}
          </section>

          <section className="channel-hub-card" aria-labelledby="channel-memory-title">
            <div className="channel-hub-card-heading">
              <div><span className="eyebrow">MEMORY</span><h3 id="channel-memory-title">同步哪些记忆</h3></div>
              <ShieldCheck aria-hidden="true" />
            </div>
            {channel === "qq" && <p>同步的是选中的长期记忆。网页聊天记录和知识库留在原渠道。保存后，QQ 的下一条回复会使用新设置。</p>}
            <div className="channel-hub-mode-row">
              {MEMORY_MODES.map(([value, label]) => (
                <button type="button" key={value} className={prefs.memory_mode === value ? "is-selected" : ""} onClick={() => updatePrefs({ memory_mode: value })}>{label}</button>
              ))}
            </div>
            {prefs.memory_mode === "selected" ? (
              <div className="channel-hub-memory-list">
                {memories.length ? memories.slice(0, 40).map((memory) => (
                  <label className={`channel-hub-check ${selectedMemories.has(memory.id) ? "is-selected" : ""}`} key={memory.id}>
                    <input type="checkbox" checked={selectedMemories.has(memory.id)} onChange={() => toggleMemory(memory.id)} />
                    <span><small>{String(memory.summary || "").slice(0, 110)}</small></span>
                    <Check aria-hidden="true" />
                  </label>
                )) : <p className="channel-hub-empty-line">当前账号还没有可同步的长期记忆。</p>}
              </div>
            ) : null}
            {["recent", "all"].includes(prefs.memory_mode) ? (
              <label className="channel-hub-field">
                <span>最多同步条数</span>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={prefs.memory_limit || ""}
                  placeholder="例如 10"
                  onChange={(event) => updatePrefs({ memory_limit: Math.max(0, Math.min(50, Number(event.target.value) || 0)) })}
                />
              </label>
            ) : null}
            <label className="channel-hub-switch">
              <input type="checkbox" checked={prefs.media_enabled} onChange={(event) => updatePrefs({ media_enabled: event.target.checked })} />
              <span>
                <strong>允许同步媒体</strong>
                <small>
                  {channel === "wechat"
                    ? "支持图片与 MP4 / MOV 短视频（对齐 wechat-ilink-bridge-hardened 媒体发送能力）；请留意微信 iLink 频率与连接风控，默认关闭。"
                    : "图片/语音/视频收发受桥接端能力限制；默认关闭。"}
                </small>
              </span>
            </label>
          </section>

          {channel === "qq" && (
            <section className="channel-hub-card" aria-labelledby="qq-memory-candidates-title">
              <h3 id="qq-memory-candidates-title">QQ 记忆候选</h3>
              <label className="channel-hub-switch">
                <input type="checkbox" checked={prefs.qq_receive_memory_candidates} onChange={(event) => updatePrefs({ qq_receive_memory_candidates: event.target.checked })} />
                <span><strong>接收 QQ 私聊提交的记忆</strong><small>开启并保存后，在已绑定的 QQ 私聊发送「记住：内容」。约 5 分钟后可在这里刷新和确认。</small></span>
              </label>
              <QQMemoryCandidates />
            </section>
          )}
          {error ? <div className="channel-hub-inline-error" role="alert">{error}</div> : null}
          {saved ? <div className="channel-hub-saved" role="status">{saved}</div> : null}
          <div className="channel-hub-actions">
            <button type="button" className="channel-hub-primary" disabled={saving} onClick={() => void savePreferences()}>
              {saving ? <Loader2 className="spin" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
              {saving ? "保存中…" : "保存同步设置"}
            </button>
            <button type="button" className="channel-hub-secondary" onClick={() => void load()} disabled={saving}><RefreshCw aria-hidden="true" />重新读取</button>
          </div>
        </>
      ) : (
        <>
          <section className="channel-hub-card" aria-labelledby="channel-bind-title">
            {channel === "qq" && !visualPreview && <QQCloudConnect onReady={setQQCloudReady} onConfigureSync={() => setTab("sync")} />}
            {channel === "qq" && (
              <p className="channel-hub-note" role="note">
                上游维护提示：GitHub 仓库 Derpyu520/qq-bridge 已归档（v0.2.2-final），SnowLuma 公开上游仓库已不可访问（404）。建议优先使用灯塔云端通道或已核验的本机 SnowLuma 安装包，勿引入已归档桥接插件。
              </p>
            )}
            <div className="channel-hub-card-heading">
              <div><span className="eyebrow">BINDING</span><h3 id="channel-bind-title">绑定 {meta.label}</h3></div>
              <Link2 aria-hidden="true" />
            </div>
            <p className="channel-hub-copy">此区域用于已有桥接服务的用户。先生成一次性绑定码，再用已登录的 {meta.bridge} 给 DengTa 发送这串数字。绑定成功后，桥接端才会按当前账号和伴侣同步人设与记忆。</p>
            <ol className="channel-hub-steps">
              <li>在手机或电脑登录 <strong>{meta.label}</strong>（{meta.bridge}）。</li>
              <li>给 DengTa 机器人发送下面的 6 位绑定码。</li>
              <li>看到「已绑定」即可返回这里同步人设与记忆。</li>
            </ol>
            <button type="button" className="channel-hub-primary" disabled={bindingBusy === "start"} onClick={() => void startBinding()}>
              {bindingBusy === "start" ? <Loader2 className="spin" aria-hidden="true" /> : <Link2 aria-hidden="true" />}
              {bindingCode?.code ? "重新生成绑定码" : "生成绑定码"}
            </button>
            {bindingCode?.code ? (
              <div className="channel-hub-code" role="status">
                <small>
                  绑定码 ·{" "}
                  {bindingRemainingMs > 0
                    ? `剩 ${Math.floor(bindingRemainingMs / 60000)}:${String(Math.floor((bindingRemainingMs % 60000) / 1000)).padStart(2, "0")}`
                    : "已过期，请重新生成"}
                </small>
                <div className="channel-hub-code-row">
                  <strong>{bindingCode.code}</strong>
                  <button type="button" className="channel-hub-copy" onClick={() => void copyBindingCode()} aria-label="复制绑定码" disabled={bindingExpired}>
                    {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                    {bindingExpired ? "已过期" : copied ? "已复制" : "复制"}
                  </button>
                </div>
                <span>
                  {bindings.some((item) => item.status === "active")
                    ? "已检测到绑定成功"
                    : "发送后会自动检测；也可以点下方刷新状态。"}
                </span>
              </div>
            ) : null}
            {bindingError ? <div className="channel-hub-inline-error" role="alert">{bindingError}</div> : null}
          </section>

          <section className="channel-hub-card" aria-labelledby="channel-bindings-title">
            <div className="channel-hub-card-heading">
              <div><span className="eyebrow">STATUS</span><h3 id="channel-bindings-title">绑定状态</h3></div>
              <button type="button" className="channel-hub-icon-button" onClick={() => void refreshBindings()} aria-label="刷新绑定状态"><RefreshCw aria-hidden="true" /></button>
            </div>
            {bindings.length ? bindings.map((binding) => (
              <div className="channel-hub-binding" key={binding.id}>
                <span className={`channel-hub-binding-dot ${binding.status === "active" ? "is-active" : ""}`} />
                <div>
                  <strong>{binding.status === "active" ? "已绑定" : binding.status === "pending" ? "等待确认" : "已停用"}</strong>
                  <small>{binding.external_id?.startsWith("pending-") ? "等待桥接端确认" : binding.external_id}</small>
                </div>
                <button type="button" aria-label="解除绑定" disabled={bindingBusy === binding.id} onClick={() => void removeBinding(binding.id)}>
                  {bindingBusy === binding.id ? <Loader2 className="spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
                </button>
              </div>
            )) : <p className="channel-hub-empty-line">还没有绑定记录。生成绑定码后在这里查看状态。</p>}
            <p className="channel-hub-note"><Unlink aria-hidden="true" />解除绑定只停止通道回复；不会删除 DengTa 账号、聊天或记忆。</p>
          </section>
        </>
      )}
    </section>
  );
}
