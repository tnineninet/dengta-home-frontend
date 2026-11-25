import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  BookOpen,
  CheckCircle2,
  Clapperboard,
  Cpu,
  Download,
  ExternalLink,
  FileArchive,
  FileAudio,
  FileCode2,
  FileText,
  Film,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Laptop,
  Loader2,
  MessageSquarePlus,
  Play,
  QrCode,
  RefreshCw,
  Scissors,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  Upload,
  Wifi,
  Zap,
} from "lucide-react";
import { pwaInstallController } from "./pwa-install.js";
import {
  SCOPE_DESCRIPTIONS,
  buildDownloadUrl,
  createJianyingDraftClient,
  createMotionProjectClient,
  fetchLocalAgentOverview,
  getSavedBridgeBaseUrl,
  inspectLocalPathOnPc,
  kbAddDocumentClient,
  kbCreateCollectionClient,
  kbDeleteDocumentClient,
  kbSearchClient,
  launchJianyingClient,
  runAdudirAnalyze,
  runAgentTaskClient,
  setSavedBridgeBaseUrl,
  updateLocalAgentPolicy,
  uploadAndInspectFile,
  writeWorkspaceFileClient,
} from "./local-agent-client.js";
import "./local-agent-studio.css";

const TABS = [
  { id: "editor", label: "剪映 & 阿杜导演", Icon: Clapperboard },
  { id: "files", label: "全格式文件/资源包", Icon: FileArchive },
  { id: "workspace_kb", label: "AI 工作区 & 知识库", Icon: BookOpen },
  { id: "tasks", label: "Antigravity 任务流", Icon: Zap },
  { id: "mobile", label: "手机安装 & 跨端联动", Icon: Smartphone },
];

const QUICK_TASKS = [
  {
    label: "一键剪辑全流程",
    goal: "读取视频素材，运行 adudir-open 画质与响度体检，生成 .motion 工程并同步到本机剪映草稿箱",
  },
  {
    label: "文档建知识库 + 出脚本",
    goal: "把已读取的文档与资源包写入我的默认知识库，检索核心要点并生成口播 .motion 工程",
  },
  {
    label: "口播画质与音效精修",
    goal: "检查素材黑屏/模糊/静止帧、计算统一响度 LUFS 增益，并匹配开场与转场音效",
  },
];

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fileIconFor(kind) {
  if (kind === "video") return Film;
  if (kind === "audio") return FileAudio;
  if (kind === "motion_pack" || kind === "resource_pack") return FileArchive;
  if (kind === "text" || kind === "subtitle") return FileCode2;
  return FileText;
}

export default function LocalAgentStudio({
  aiName = "小灯",
  onSendToChat,
  onOpenDeviceCenter,
}) {
  const [activeTab, setActiveTab] = useState("editor");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const [overview, setOverview] = useState(null);
  const mode = overview?.mode || "browser_local";
  const policy = overview?.policy || { authorized: true, scopes: {} };
  const jianying = overview?.jianying || {};
  const adudir = overview?.adudir || {};
  const kb = overview?.kb || { collections: [], documents: [], documentCount: 0, chunkCount: 0 };
  const workspace = overview?.workspace || { entries: [] };
  const taskHistory = overview?.tasks?.tasks || [];

  // Editor state
  const [mediaPath, setMediaPath] = useState(
    "D:\\GZdeepseek\\dengta-creator-bridge-mcp\\data\\videos\\vplan_local_mwvorar1_abbf.mp4",
  );
  const [bgmSample, setBgmSample] = useState("温暖治愈背景.mp3");
  const [sfxQuery, setSfxQuery] = useState("卡片翻面 门砰地关上");
  const [editTitle, setEditTitle] = useState("DengTa × 阿杜导演 · AI 剪辑实测");
  const [editSubtitle, setEditSubtitle] = useState("自动画质体检 + 统一响度 + 一键同步剪映");
  const [editLines, setEditLines] = useState(
    "第一步：一键授权读取本地视频与文档资源包\n第二步：用 adudir-open 检测画质并自动归一化响度\n第三步：生成 .motion 工程并一键写入本机剪映草稿箱",
  );
  const [layout, setLayout] = useState("landscape");
  const [adudirResult, setAdudirResult] = useState(null);
  const [motionResult, setMotionResult] = useState(null);
  const [jianyingResult, setJianyingResult] = useState(null);

  // File reader state
  const [inspectedFiles, setInspectedFiles] = useState([]);
  const [localPathInput, setLocalPathInput] = useState("");
  const [uploadAutoKb, setUploadAutoKb] = useState(true);
  const [browserFolderSummary, setBrowserFolderSummary] = useState(null);
  const fileInputRef = useRef(null);

  // Workspace & KB state
  const [wsRelPath, setWsRelPath] = useState("projects/clip-brief.md");
  const [wsContent, setWsContent] = useState(
    "# 本期剪辑简报\n\n- 主题：用 DengTa 串联阿杜导演与剪映\n- 风格：温暖治愈、节奏明快\n- 要求：保留 AI 辅助创作标识\n",
  );
  const [newKbName, setNewKbName] = useState("");
  const [selectedKbName, setSelectedKbName] = useState("我的默认知识库");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [kbQuery, setKbQuery] = useState("");
  const [kbHits, setKbHits] = useState(null);

  // Task Runner state
  const [taskGoal, setTaskGoal] = useState(QUICK_TASKS[0].goal);
  const [taskSyncJianying, setTaskSyncJianying] = useState(true);
  const [taskAddToKb, setTaskAddToKb] = useState(true);
  const [latestTaskReceipt, setLatestTaskReceipt] = useState(null);

  // Mobile & LAN Pairing state
  const [bridgeUrlInput, setBridgeUrlInput] = useState(() => getSavedBridgeBaseUrl());
  const [lanQrDataUrl, setLanQrDataUrl] = useState("");
  const [apkQrDataUrl, setApkQrDataUrl] = useState("");
  const [pwaMessage, setPwaMessage] = useState("");

  const refreshOverview = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const data = await fetchLocalAgentOverview();
      setOverview(data);
      const firstKb = data?.kb?.collections?.[0]?.name;
      if (firstKb) setSelectedKbName((cur) => cur || firstKb);
    } catch (err) {
      setError(err?.message || "读取本机工作台状态失败。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetchLocalAgentOverview()
      .then((data) => {
        if (!active) return;
        setOverview(data);
        const firstKb = data?.kb?.collections?.[0]?.name;
        if (firstKb) setSelectedKbName((cur) => cur || firstKb);
      })
      .catch((err) => {
        if (active) setError(err?.message || "读取本机工作台状态失败。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const primaryLanUrl = useMemo(() => {
    const urls = overview?.lanUrls || [];
    return (
      urls.find((u) => /^http:\/\/192\.168\./.test(u)) ||
      urls.find((u) => /^http:\/\/10\./.test(u)) ||
      urls.find((u) => !u.includes("127.0.0.1") && !u.includes("198.18.")) ||
      urls[0] ||
      "http://127.0.0.1:18088"
    );
  }, [overview?.lanUrls]);

  useEffect(() => {
    let active = true;
    const downloadUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}/download.html`
        : "https://www.dengtahome.com/download";
    QRCode.toDataURL(primaryLanUrl, { width: 160, margin: 1 })
      .then((u) => { if (active) setLanQrDataUrl(u); })
      .catch(() => {});
    QRCode.toDataURL(downloadUrl, { width: 160, margin: 1 })
      .then((u) => { if (active) setApkQrDataUrl(u); })
      .catch(() => {});
    return () => { active = false; };
  }, [primaryLanUrl]);

  function flashNotice(msg) {
    setError("");
    setNotice(msg);
  }

  async function handleToggleScope(scopeKey, nextValue) {
    setBusy(`scope:${scopeKey}`);
    try {
      const nextPolicy = await updateLocalAgentPolicy(mode, {
        scopes: { [scopeKey]: nextValue },
      });
      setOverview((cur) => (cur ? { ...cur, policy: nextPolicy } : cur));
      flashNotice(`已${nextValue ? "一键授权" : "关闭"}权限「${scopeKey}」。`);
    } catch (err) {
      setError(err?.message || "更新授权状态失败。");
    } finally {
      setBusy("");
    }
  }

  async function handleGrantAll(grant) {
    setBusy("scope:all");
    try {
      const all = Object.fromEntries(SCOPE_DESCRIPTIONS.map((s) => [s.key, grant]));
      const nextPolicy = await updateLocalAgentPolicy(mode, { authorized: grant, scopes: all });
      setOverview((cur) => (cur ? { ...cur, policy: nextPolicy } : cur));
      flashNotice(grant ? "已一键授权全部本机剪辑、工作区与知识库能力！" : "已暂停全部本机写入与剪映控制权限。");
    } catch (err) {
      setError(err?.message || "切换一键授权失败。");
    } finally {
      setBusy("");
    }
  }

  async function handleRunAdudir() {
    setBusy("adudir");
    setError("");
    try {
      const res = await runAdudirAnalyze(mode, {
        mediaPath: mediaPath.trim(),
        mode: "temperate",
        role: "dialogue",
        bgmFiles: bgmSample.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean),
        sfxQueries: sfxQuery.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean),
      });
      setAdudirResult(res);
      flashNotice("adudir-open 5 项算法分析完成（画质 / 响度 / 近重复 / BGM / SFX）！");
    } catch (err) {
      setError(err?.message || "运行 adudir-open 分析失败。");
    } finally {
      setBusy("");
    }
  }

  async function handleCreateMotion() {
    setBusy("motion");
    setError("");
    try {
      const lines = editLines.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const res = await createMotionProjectClient(mode, {
        projectName: editTitle.trim() || "DengTa_Motion",
        title: editTitle.trim() || "DengTa 代码式剪辑工程",
        subtitle: editSubtitle.trim(),
        lines,
        layout,
        sourceVideo: mediaPath.trim(),
      });
      setMotionResult(res);
      flashNotice(`已按 adudir-open 规范生成 .motion 工程：${res.projectName}！`);
      void refreshOverview({ silent: true });
    } catch (err) {
      setError(err?.message || "创建 .motion 工程失败。");
    } finally {
      setBusy("");
    }
  }

  async function handleSyncJianying() {
    setBusy("jianying");
    setError("");
    try {
      const lines = editLines.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const res = await createJianyingDraftClient(mode, {
        draftName: editTitle.trim() || "DengTa_AI草稿",
        videoPaths: [mediaPath.trim()],
        title: editTitle.trim(),
        subtitles: lines,
        layout,
        runAdudirAudit: true,
        registerMeta: true,
      });
      setJianyingResult(res);
      flashNotice(`已成功写入本机剪映草稿「${res.draftName}」（同步导出 FCPXML + SRT 并备份 root_meta_info.json）！`);
      void refreshOverview({ silent: true });
    } catch (err) {
      setError(err?.message || "同步剪映草稿失败。");
    } finally {
      setBusy("");
    }
  }

  async function handleLaunchJianying(openFolder, launchApp) {
    setBusy("launch");
    setError("");
    try {
      await launchJianyingClient(mode, { openFolder, launchApp });
      flashNotice(launchApp ? "正在本机唤起剪映专业版…" : "已打开剪映草稿目录。");
    } catch (err) {
      setError(err?.message || "唤起本机剪映失败。");
    } finally {
      setBusy("");
    }
  }

  async function handleUploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setBusy("upload");
    setError("");
    try {
      const results = [];
      for (const file of files.slice(0, 8)) {
        const res = await uploadAndInspectFile(mode, file, {
          addToKb: uploadAutoKb,
          kbName: selectedKbName || "我的默认知识库",
        });
        results.push(res);
        if (res.parsed?.kind === "video" && res.savedAbsPath && mode === "pc_bridge") {
          setMediaPath(res.savedAbsPath);
        }
      }
      setInspectedFiles((prev) => [...results, ...prev].slice(0, 20));
      flashNotice(`已成功解析 ${results.length} 个文件/资源包${uploadAutoKb ? "并自动索引进知识库" : ""}！`);
      void refreshOverview({ silent: true });
    } catch (err) {
      setError(err?.message || "读取文件失败。");
    } finally {
      setBusy("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleInspectLocalPath() {
    if (!localPathInput.trim()) return;
    setBusy("inspect-path");
    setError("");
    try {
      const res = await inspectLocalPathOnPc(localPathInput.trim(), {
        addToKb: uploadAutoKb,
        kbName: selectedKbName || "我的默认知识库",
      });
      setInspectedFiles((prev) => [res, ...prev].slice(0, 20));
      if (res.parsed?.kind === "video") setMediaPath(res.savedAbsPath || localPathInput.trim());
      flashNotice(`已深度读取本机文件：${res.parsed?.name}`);
      void refreshOverview({ silent: true });
    } catch (err) {
      setError(err?.message || "读取本机路径失败。");
    } finally {
      setBusy("");
    }
  }

  async function handleMountBrowserFolder() {
    if (typeof window === "undefined" || typeof window.showDirectoryPicker !== "function") {
      setError("当前浏览器不支持 File System Access 目录挂载，请改用上方多文件/资源包上传或电脑本机网关。");
      return;
    }
    setBusy("mount-dir");
    setError("");
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: "read" });
      const items = [];
      for await (const [name, handle] of dirHandle.entries()) {
        items.push({ name, kind: handle.kind });
        if (items.length >= 60) break;
      }
      setBrowserFolderSummary({ name: dirHandle.name, count: items.length, items });
      flashNotice(`已授权挂载本地文件夹「${dirHandle.name}」（读取到 ${items.length} 项）！`);
    } catch (err) {
      if (err?.name !== "AbortError") setError(err?.message || "目录授权未完成。");
    } finally {
      setBusy("");
    }
  }

  async function handleSaveWorkspaceFile() {
    setBusy("ws-write");
    setError("");
    try {
      const res = await writeWorkspaceFileClient(mode, wsRelPath.trim(), wsContent);
      flashNotice(`已保存到本机 AI 工作区：${res.relPath}（${formatBytes(res.sizeBytes)}）`);
      void refreshOverview({ silent: true });
    } catch (err) {
      setError(err?.message || "保存工作区文件失败。");
    } finally {
      setBusy("");
    }
  }

  async function handleCreateKbCollection() {
    if (!newKbName.trim()) return;
    setBusy("kb-create");
    setError("");
    try {
      const nextKb = await kbCreateCollectionClient(mode, newKbName.trim(), "用户自定义 DengTa 知识库");
      setOverview((cur) => (cur ? { ...cur, kb: nextKb } : cur));
      setSelectedKbName(newKbName.trim());
      setNewKbName("");
      flashNotice(`已创建知识库「${newKbName.trim()}」！`);
    } catch (err) {
      setError(err?.message || "创建知识库失败。");
    } finally {
      setBusy("");
    }
  }

  async function handleAddKbNote() {
    if (!noteTitle.trim() || !noteBody.trim()) {
      setError("请填写知识条目名称和正文内容。");
      return;
    }
    setBusy("kb-add");
    setError("");
    try {
      const res = await kbAddDocumentClient(mode, {
        kbName: selectedKbName || "我的默认知识库",
        title: noteTitle.trim(),
        content: noteBody.trim(),
        tags: ["用户手记"],
      });
      setNoteTitle("");
      setNoteBody("");
      flashNotice(`已写入知识库「${res.kbName}」（共切分 ${res.chunkCount} 个语义块）！`);
      void refreshOverview({ silent: true });
    } catch (err) {
      setError(err?.message || "写入知识库失败。");
    } finally {
      setBusy("");
    }
  }

  async function handleDeleteKbDoc(docId) {
    setBusy(`kb-del:${docId}`);
    try {
      await kbDeleteDocumentClient(mode, docId);
      flashNotice("已从本地知识库移除该条目。");
      void refreshOverview({ silent: true });
    } catch (err) {
      setError(err?.message || "删除知识库条目失败。");
    } finally {
      setBusy("");
    }
  }

  async function handleSearchKb() {
    if (!kbQuery.trim()) return;
    setBusy("kb-search");
    setError("");
    try {
      const res = await kbSearchClient(mode, { query: kbQuery.trim(), topK: 6 });
      setKbHits(res);
    } catch (err) {
      setError(err?.message || "检索知识库失败。");
    } finally {
      setBusy("");
    }
  }

  async function handleRunTask() {
    if (!taskGoal.trim()) return;
    setBusy("run-task");
    setError("");
    try {
      const filePaths = [
        ...(mediaPath.trim() ? [mediaPath.trim()] : []),
        ...inspectedFiles.map((f) => f.savedAbsPath).filter((p) => p && !p.startsWith("opfs://")),
      ];
      const uniquePaths = [...new Set(filePaths)];
      const receipt = await runAgentTaskClient(mode, {
        goal: taskGoal.trim(),
        filePaths: uniquePaths,
        layout,
        syncJianying: taskSyncJianying,
        addToKb: taskAddToKb,
        kbName: selectedKbName || "我的默认知识库",
      });
      setLatestTaskReceipt(receipt);
      flashNotice(`Antigravity 任务 ${receipt.taskId} 已完成（共 ${receipt.steps?.length || 0} 步，用时 ${receipt.elapsedSec}s）！`);
      void refreshOverview({ silent: true });
    } catch (err) {
      setError(err?.message || "执行多步 AI 任务失败。");
    } finally {
      setBusy("");
    }
  }

  function handleSaveLanBridge() {
    setSavedBridgeBaseUrl(bridgeUrlInput);
    flashNotice(bridgeUrlInput.trim() ? `已保存电脑本机网关地址：${bridgeUrlInput.trim()}，正在重新连接…` : "已恢复默认本机地址，正在重新检测…");
    void refreshOverview();
  }

  async function handlePwaInstall() {
    const out = await pwaInstallController.install();
    setPwaMessage(out.message || "请按浏览器提示添加到手机主屏幕。");
  }

  function sendInspectedToChat(item) {
    const parsed = item?.parsed || item;
    if (!parsed) return;
    const text = `我刚让 DengTa 读取了本地素材「${parsed.name}」（类型：${parsed.kind}，格式：${parsed.format}）：\n${String(parsed.text || "").slice(0, 1200)}\n\n请帮我结合这些内容整理重点，或者给出下一步剪映/阿杜导演剪辑方案！`;
    onSendToChat?.(text);
  }

  function sendKbHitsToChat() {
    if (!kbHits?.hits?.length) return;
    const body = kbHits.hits
      .slice(0, 4)
      .map((h, i) => `${i + 1}. 《${h.title}》(相关度 ${h.score})：${h.snippet.slice(0, 260)}`)
      .join("\n");
    onSendToChat?.(`我在本地知识库检索了「${kbHits.query}」，命中以下参考资料：\n${body}\n\n请基于这些知识库资料回答我的问题！`);
  }

  return (
    <section className="local-agent-studio" aria-label="DengTa 本机 AI 工作台与剪映控制中心">
      <header className="las-hero">
        <div className="las-hero-title">
          <div className="las-hero-badge" aria-hidden="true">
            <Cpu size={22} />
          </div>
          <div>
            <h2>AI 工作台 · 本机剪映 / 阿杜导演 / 知识库</h2>
            <p>
              一键授权 {aiName} 操控本机剪映与开源 <code>adudir-open</code>，读取音视频/文档/资源包，在电脑与手机端创建 AI 工作区与知识库。
            </p>
          </div>
        </div>
        <div className="las-status-pills">
          <span className={`las-pill ${mode === "pc_bridge" ? "is-online" : "is-warn"}`}>
            <HardDrive size={13} />
            {mode === "pc_bridge" ? "电脑本机网关已连接" : "端侧离线模式（手机/浏览器）"}
          </span>
          <span className={`las-pill ${jianying.installed ? "is-online" : ""}`}>
            <Scissors size={13} />
            {jianying.installed ? `剪映 v${jianying.version}` : "未连电脑剪映"}
          </span>
          <span className={`las-pill ${adudir.ok ? "is-online" : ""}`}>
            <Sparkles size={13} />
            adudir-open {adudir.ok ? "5 算法就绪" : "轻量模式"}
          </span>
          <button type="button" className="las-btn" onClick={() => void refreshOverview()} disabled={loading}>
            <RefreshCw size={14} /> 刷新状态
          </button>
        </div>
      </header>

      <nav className="las-tabs" role="tablist" aria-label="AI 工作台模块切换">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            className={`las-tab ${activeTab === id ? "is-active" : ""}`}
            onClick={() => setActiveTab(id)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </nav>

      {notice && <div className="las-banner" role="status">{notice}</div>}
      {error && <div className="las-banner is-error" role="alert">{error}</div>}

      {/* TAB 1: JIANYING + ADUDIR-OPEN + ONE-CLICK AUTH */}
      {activeTab === "editor" && (
        <>
          <article className="las-card">
            <div className="las-card-head">
              <h3><ShieldCheck size={17} /> 懒人一键授权中心（可控、可随时撤回）</h3>
              <div className="las-row">
                <button type="button" className="las-btn is-primary" onClick={() => void handleGrantAll(true)} disabled={Boolean(busy)}>
                  <CheckCircle2 size={14} /> 一键全部授权
                </button>
                <button type="button" className="las-btn" onClick={() => void handleGrantAll(false)} disabled={Boolean(busy)}>
                  暂停写入授权
                </button>
              </div>
            </div>
            <p className="las-muted">
              当前工作区：<span className="las-code">{policy.workspaceRoot || "D:\\GZdeepseek\\dengta-ai-workspace"}</span>
              {jianying.compatibilityNote ? ` · ${jianying.compatibilityNote}` : ""}
            </p>
            <div className="las-scope-list">
              {SCOPE_DESCRIPTIONS.map((item) => {
                const checked = Boolean(policy?.authorized && policy?.scopes?.[item.key]);
                return (
                  <label key={item.key} className="las-scope-item">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={Boolean(busy)}
                      onChange={(e) => void handleToggleScope(item.key, e.target.checked)}
                    />
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </span>
                  </label>
                );
              })}
            </div>
          </article>

          <div className="las-grid">
            <article className="las-card">
              <div className="las-card-head">
                <h3><Clapperboard size={17} /> 阿杜导演 (adudir-open) × 剪映一键出草稿</h3>
              </div>
              <div className="las-field">
                <label htmlFor="las-media-path">视频/音频源文件路径（可在「全格式文件」页上传自动填入）</label>
                <input
                  id="las-media-path"
                  className="las-input"
                  value={mediaPath}
                  onChange={(e) => setMediaPath(e.target.value)}
                  placeholder="D:\...\video.mp4"
                />
              </div>
              <div className="las-row">
                <div className="las-field" style={{ flex: 1, minWidth: 150 }}>
                  <label htmlFor="las-title">工程 / 剪映草稿名称</label>
                  <input id="las-title" className="las-input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                </div>
                <div className="las-field" style={{ width: 130 }}>
                  <label htmlFor="las-layout">画幅比例</label>
                  <select id="las-layout" className="las-select" value={layout} onChange={(e) => setLayout(e.target.value)}>
                    <option value="landscape">横屏 16:9</option>
                    <option value="portrait">竖屏 9:16</option>
                  </select>
                </div>
              </div>
              <div className="las-field">
                <label htmlFor="las-sub">副标题</label>
                <input id="las-sub" className="las-input" value={editSubtitle} onChange={(e) => setEditSubtitle(e.target.value)} />
              </div>
              <div className="las-field">
                <label htmlFor="las-lines">口播台词 / 自动字幕（每行一句，同步写入 .motion 与剪映字幕轨）</label>
                <textarea id="las-lines" className="las-textarea" value={editLines} onChange={(e) => setEditLines(e.target.value)} />
              </div>
              <div className="las-row">
                <div className="las-field" style={{ flex: 1 }}>
                  <label htmlFor="las-bgm">BGM 格式校验（逗号分隔）</label>
                  <input id="las-bgm" className="las-input" value={bgmSample} onChange={(e) => setBgmSample(e.target.value)} />
                </div>
                <div className="las-field" style={{ flex: 1 }}>
                  <label htmlFor="las-sfx">动作描述 → SFX 智能推荐</label>
                  <input id="las-sfx" className="las-input" value={sfxQuery} onChange={(e) => setSfxQuery(e.target.value)} />
                </div>
              </div>
              <div className="las-row">
                <button type="button" className="las-btn" onClick={() => void handleRunAdudir()} disabled={Boolean(busy)}>
                  {busy === "adudir" ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
                  1. adudir-open 5 项体检
                </button>
                <button type="button" className="las-btn" onClick={() => void handleCreateMotion()} disabled={Boolean(busy)}>
                  {busy === "motion" ? <Loader2 size={14} className="spin" /> : <FileArchive size={14} />}
                  2. 生成 .motion 工程
                </button>
                <button type="button" className="las-btn is-primary" onClick={() => void handleSyncJianying()} disabled={Boolean(busy)}>
                  {busy === "jianying" ? <Loader2 size={14} className="spin" /> : <Scissors size={14} />}
                  3. 一键同步本机剪映草稿
                </button>
              </div>
            </article>

            <article className="las-card">
              <div className="las-card-head">
                <h3><Play size={17} /> 实时体检与剪映同步结果</h3>
                {jianying.installed && (
                  <button
                    type="button"
                    className="las-btn"
                    onClick={() => void handleLaunchJianying(jianyingResult?.draftDir || jianying.activeDraftDir, true)}
                    disabled={Boolean(busy)}
                  >
                    <ExternalLink size={14} /> 唤起剪映专业版
                  </button>
                )}
              </div>

              {adudirResult && (
                <div className="las-list-item">
                  <div className="las-item-top">
                    <strong>adudir-open 体检报告</strong>
                    <span className="las-code">OpenCV + FFmpeg LUFS</span>
                  </div>
                  {adudirResult.quality && (
                    <p className="las-muted">
                      画质检测：采样 {adudirResult.quality.sampledFrames} 帧，发现 {adudirResult.quality.marksCount} 处标记（
                      {adudirResult.quality.marks?.slice(0, 3).map((m) => `${m.startSec}-${m.endSec}s ${m.description}`).join("；") || "画面干净"}）
                    </p>
                  )}
                  {adudirResult.loudness?.gainPlan && (
                    <p className="las-muted">
                      统一响度：实测 {adudirResult.loudness.gainPlan.measuredLufs} LUFS → 目标 {adudirResult.loudness.gainPlan.targetLufs} LUFS，建议增益{" "}
                      <strong>{Number(adudirResult.loudness.gainPlan.gainDb).toFixed(2)} dB</strong>（动态范围 {adudirResult.loudness.gainPlan.dynamicRangeFlag}）
                    </p>
                  )}
                  {adudirResult.audioHelpers?.sfx?.length > 0 && (
                    <p className="las-muted">
                      推荐音效：
                      {adudirResult.audioHelpers.sfx
                        .flatMap((s) => s.recommendations.slice(0, 2).map((r) => `${r.title}(${Math.round(r.score * 100)}%)`))
                        .join(" · ")}
                    </p>
                  )}
                </div>
              )}

              {motionResult && (
                <div className="las-list-item">
                  <div className="las-item-top">
                    <strong>.motion 工程已打包并校验</strong>
                    <span className="las-pill is-online">SHA-256 ✓</span>
                  </div>
                  <p className="las-muted">
                    工程：<span className="las-code">{motionResult.motionArchivePath || motionResult.projectId}</span>
                  </p>
                  {motionResult.motionArchivePath && mode === "pc_bridge" && (
                    <div className="las-row">
                      <a className="las-btn" href={buildDownloadUrl(motionResult.motionArchivePath)} download>
                        <Download size={14} /> 下载 .motion 包
                      </a>
                      {motionResult.srtPath && (
                        <a className="las-btn" href={buildDownloadUrl(motionResult.srtPath)} download>
                          <Download size={14} /> 下载 SRT 字幕
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}

              {jianyingResult && (
                <div className="las-list-item">
                  <div className="las-item-top">
                    <strong>剪映草稿已写入：{jianyingResult.draftName}</strong>
                    <span className="las-pill is-online">pyJianYingDraft + FCPXML</span>
                  </div>
                  <p className="las-muted">
                    路径：<span className="las-code">{jianyingResult.draftDir}</span>
                  </p>
                  <div className="las-row">
                    <button type="button" className="las-btn" onClick={() => void handleLaunchJianying(jianyingResult.draftDir, false)}>
                      <FolderOpen size={14} /> 打开草稿目录
                    </button>
                    {jianyingResult.fcpxmlPath && (
                      <a className="las-btn" href={buildDownloadUrl(jianyingResult.fcpxmlPath)} download>
                        <Download size={14} /> 下载 FCPXML
                      </a>
                    )}
                  </div>
                </div>
              )}

              <div className="las-list-item">
                <div className="las-item-top">
                  <strong>本机剪映草稿箱（{overview?.jianyingDrafts?.diskDraftsCount ?? 0} 个本地目录 / {overview?.jianyingDrafts?.rootMetaRegisteredCount ?? 0} 条登记）</strong>
                </div>
                <p className="las-muted">
                  草稿根目录：<span className="las-code">{jianying.activeDraftDir || "等待连接本机网关"}</span>
                </p>
                {(overview?.jianyingDrafts?.drafts || []).slice(0, 4).map((d) => (
                  <div key={d.folder} className="las-item-top">
                    <span>{d.createdByDengTa ? "✨ " : "🎞️ "}{d.name}</span>
                    <button type="button" className="las-btn" onClick={() => void handleLaunchJianying(d.folder, false)}>打开</button>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </>
      )}

      {/* TAB 2: UNIVERSAL AUDIO/VIDEO/DOCUMENT/RESOURCE-PACK READER */}
      {activeTab === "files" && (
        <div className="las-grid">
          <article className="las-card">
            <div className="las-card-head">
              <h3><Upload size={17} /> 上传 / 拖入任意音视频、文档与资源包</h3>
            </div>
            <div className="las-dropzone">
              <FileArchive size={28} color="#2f6f6a" />
              <strong>支持 MP4 / MOV / MKV / MP3 / WAV / PDF / Word / Excel / PPT / SRT / ZIP / .motion</strong>
              <p className="las-muted">电脑端自动调用 FFprobe + PyMuPDF + python-docx + openpyxl + ZIP 安全解析；手机端支持离线元数据与文本/压缩包解析。</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                style={{ display: "none" }}
                onChange={(e) => void handleUploadFiles(e.target.files)}
              />
              <div className="las-row">
                <button type="button" className="las-btn is-primary" onClick={() => fileInputRef.current?.click()} disabled={Boolean(busy)}>
                  {busy === "upload" ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
                  选择音视频 / 文档 / 资源包
                </button>
                <button type="button" className="las-btn" onClick={() => void handleMountBrowserFolder()} disabled={Boolean(busy)}>
                  <FolderOpen size={14} /> 授权挂载本地文件夹
                </button>
              </div>
              <label className="las-row" style={{ fontSize: "0.82rem", cursor: "pointer" }}>
                <input type="checkbox" checked={uploadAutoKb} onChange={(e) => setUploadAutoKb(e.target.checked)} />
                解析完成后自动切片写入当前知识库（{selectedKbName}）
              </label>
            </div>

            {mode === "pc_bridge" && (
              <div className="las-field">
                <label htmlFor="las-local-path">或直接读取电脑本机路径（免复制大视频/资源包）</label>
                <div className="las-row">
                  <input
                    id="las-local-path"
                    className="las-input"
                    style={{ flex: 1 }}
                    value={localPathInput}
                    onChange={(e) => setLocalPathInput(e.target.value)}
                    placeholder="例如：D:\GZdeepseek\_tools\adudir-open\README.md"
                  />
                  <button type="button" className="las-btn" onClick={() => void handleInspectLocalPath()} disabled={Boolean(busy)}>
                    直接读取
                  </button>
                </div>
              </div>
            )}

            {browserFolderSummary && (
              <div className="las-list-item">
                <strong>已挂载文件夹：{browserFolderSummary.name}（{browserFolderSummary.count} 项）</strong>
                <p className="las-muted">{browserFolderSummary.items.slice(0, 15).map((i) => `${i.kind === "directory" ? "📁" : "📄"}${i.name}`).join(" · ")}</p>
              </div>
            )}
          </article>

          <article className="las-card">
            <div className="las-card-head">
              <h3><FileText size={17} /> 已读取的素材与资源包（{inspectedFiles.length}）</h3>
            </div>
            {inspectedFiles.length === 0 ? (
              <p className="las-muted">上传或指定任意音视频、PDF/Word/Excel/PPT、字幕或 ZIP/`.motion` 资源包后，DengTa 会在此展示完整结构与文本摘要，并支持一键送进对话或剪映。</p>
            ) : (
              <div className="las-list">
                {inspectedFiles.map((item, idx) => {
                  const p = item.parsed || item;
                  const Icon = fileIconFor(p.kind);
                  return (
                    <div key={`${p.name}-${idx}`} className="las-list-item">
                      <div className="las-item-top">
                        <strong><Icon size={14} style={{ verticalAlign: "-2px" }} /> {p.name}</strong>
                        <span className="las-code">{p.kind} · {formatBytes(p.sizeBytes)}</span>
                      </div>
                      <pre className="las-preview-box">{String(p.text || "").slice(0, 700)}</pre>
                      <div className="las-row">
                        <button type="button" className="las-btn is-primary" onClick={() => sendInspectedToChat(item)}>
                          <MessageSquarePlus size={14} /> 送进对话让 {aiName} 读
                        </button>
                        {p.kind === "video" && item.savedAbsPath && !item.savedAbsPath.startsWith("opfs://") && (
                          <button
                            type="button"
                            className="las-btn"
                            onClick={() => {
                              setMediaPath(item.savedAbsPath);
                              setActiveTab("editor");
                              flashNotice(`已把「${p.name}」载入剪映/阿杜导演时间线！`);
                            }}
                          >
                            <Scissors size={14} /> 送进剪映/阿杜
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </article>
        </div>
      )}

      {/* TAB 3: LOCAL AI WORKSPACE + USER KNOWLEDGE BASE */}
      {activeTab === "workspace_kb" && (
        <div className="las-grid">
          <article className="las-card">
            <div className="las-card-head">
              <h3><FolderPlus size={17} /> 本机 AI 工作区（电脑磁盘 / 手机 OPFS）</h3>
            </div>
            <p className="las-muted">
              根目录：<span className="las-code">{workspace.workspaceRoot}</span>
            </p>
            <div className="las-field">
              <label htmlFor="las-ws-path">新建 / 写入工作区文件</label>
              <input id="las-ws-path" className="las-input" value={wsRelPath} onChange={(e) => setWsRelPath(e.target.value)} />
            </div>
            <textarea className="las-textarea" value={wsContent} onChange={(e) => setWsContent(e.target.value)} />
            <button type="button" className="las-btn is-primary" onClick={() => void handleSaveWorkspaceFile()} disabled={Boolean(busy)}>
              写入本机工作区
            </button>
            <div className="las-list">
              {(workspace.entries || []).map((entry) => (
                <div key={entry.relPath} className="las-list-item">
                  <div className="las-item-top">
                    <span>{entry.type === "dir" ? "📁" : "📄"} <strong>{entry.relPath}</strong></span>
                    <span className="las-code">{entry.type === "dir" ? "目录" : formatBytes(entry.sizeBytes)}</span>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="las-card">
            <div className="las-card-head">
              <h3><BookOpen size={17} /> 用户个人知识库（{kb.documentCount || 0} 文档 · {kb.chunkCount || 0} 切片）</h3>
            </div>
            <div className="las-row">
              <select className="las-select" style={{ flex: 1 }} value={selectedKbName} onChange={(e) => setSelectedKbName(e.target.value)}>
                {(kb.collections || []).map((c) => (
                  <option key={c.id || c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
              <input
                className="las-input"
                style={{ flex: 1 }}
                value={newKbName}
                onChange={(e) => setNewKbName(e.target.value)}
                placeholder="新建知识库名称…"
              />
              <button type="button" className="las-btn" onClick={() => void handleCreateKbCollection()} disabled={Boolean(busy)}>新建库</button>
            </div>

            <div className="las-row">
              <input
                className="las-input"
                style={{ flex: 1 }}
                value={kbQuery}
                onChange={(e) => setKbQuery(e.target.value)}
                placeholder="中英文混合检索知识库（例如：motion 模板 响度）…"
                onKeyDown={(e) => { if (e.key === "Enter") void handleSearchKb(); }}
              />
              <button type="button" className="las-btn is-primary" onClick={() => void handleSearchKb()} disabled={Boolean(busy)}>
                <Search size={14} /> 检索
              </button>
            </div>

            {kbHits && (
              <div className="las-list-item">
                <div className="las-item-top">
                  <strong>命中 {kbHits.hits?.length || 0} 条切片</strong>
                  {kbHits.hits?.length > 0 && (
                    <button type="button" className="las-btn" onClick={sendKbHitsToChat}>
                      <MessageSquarePlus size={14} /> 带着结果去聊天
                    </button>
                  )}
                </div>
                {(kbHits.hits || []).map((h, i) => (
                  <div key={`${h.docId}-${h.chunkIndex}-${i}`} className="las-preview-box">
                    <strong>《{h.title}》</strong>（得分 {h.score}）{"\n"}{h.snippet.slice(0, 260)}
                  </div>
                ))}
              </div>
            )}

            <div className="las-field">
              <label htmlFor="las-note-title">手动写入知识条目</label>
              <input id="las-note-title" className="las-input" value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} placeholder="条目标题（如：我的短视频剪辑风格规范）" />
              <textarea className="las-textarea" value={noteBody} onChange={(e) => setNoteBody(e.target.value)} placeholder="正文内容，支持 Markdown，保存后自动切片供 AI 检索…" />
              <button type="button" className="las-btn" onClick={() => void handleAddKbNote()} disabled={Boolean(busy)}>加入「{selectedKbName}」</button>
            </div>

            <div className="las-list">
              {(kb.documents || []).slice(0, 10).map((doc) => (
                <div key={doc.id} className="las-list-item">
                  <div className="las-item-top">
                    <strong>{doc.title}</strong>
                    <div className="las-row">
                      <span className="las-code">{doc.kbName} · {doc.chunkCount} 块</span>
                      <button type="button" className="las-btn" onClick={() => void handleDeleteKbDoc(doc.id)} aria-label={`删除 ${doc.title}`}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <p className="las-muted">{doc.preview}</p>
                </div>
              ))}
            </div>
          </article>
        </div>
      )}

      {/* TAB 4: ANTIGRAVITY-STYLE AUTONOMOUS TASK RUNNER */}
      {activeTab === "tasks" && (
        <div className="las-grid">
          <article className="las-card">
            <div className="las-card-head">
              <h3><Zap size={17} /> Antigravity 式本机多步任务执行</h3>
            </div>
            <p className="las-muted">
              输入你的自然语言目标，DengTa 会在你授权的工作区内自动拆步执行：读取文件 → 建/查知识库 → adudir-open 体检 → 生成 <code>.motion</code> → 同步剪映草稿 → 输出 Markdown 报告。
            </p>
            <div className="las-row">
              {QUICK_TASKS.map((qt) => (
                <button key={qt.label} type="button" className="las-btn" onClick={() => setTaskGoal(qt.goal)}>
                  {qt.label}
                </button>
              ))}
            </div>
            <textarea className="las-textarea" value={taskGoal} onChange={(e) => setTaskGoal(e.target.value)} />
            <div className="las-row">
              <label style={{ fontSize: "0.82rem", display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={taskAddToKb} onChange={(e) => setTaskAddToKb(e.target.checked)} />
                自动沉淀进知识库
              </label>
              <label style={{ fontSize: "0.82rem", display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={taskSyncJianying} onChange={(e) => setTaskSyncJianying(e.target.checked)} />
                同步写入本机剪映草稿
              </label>
            </div>
            <button type="button" className="las-btn is-primary" onClick={() => void handleRunTask()} disabled={Boolean(busy)}>
              {busy === "run-task" ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
              立即执行授权任务
            </button>
          </article>

          <article className="las-card">
            <div className="las-card-head">
              <h3><CheckCircle2 size={17} /> 任务执行回执与历史（{taskHistory.length}）</h3>
            </div>
            {(latestTaskReceipt ? [latestTaskReceipt, ...taskHistory.filter((t) => t.taskId !== latestTaskReceipt.taskId)] : taskHistory)
              .slice(0, 6)
              .map((rec) => (
                <div key={rec.taskId} className="las-list-item">
                  <div className="las-item-top">
                    <strong>{rec.goal?.slice(0, 42)}</strong>
                    <span className="las-code">{rec.elapsedSec}s</span>
                  </div>
                  {(rec.steps || []).map((s, idx) => (
                    <p key={`${rec.taskId}-${idx}`} className="las-muted">
                      ✅ <strong>{s.title}</strong>：{s.summary}
                    </p>
                  ))}
                  {rec.artifacts?.length > 0 && (
                    <div className="las-row">
                      {rec.artifacts.map((art, i) =>
                        mode === "pc_bridge" && !String(art.path).endsWith(rec.jianyingDraft?.draftName || "___") && !String(art.type).includes("jianying_draft") ? (
                          <a key={i} className="las-btn" href={buildDownloadUrl(art.path)} download>
                            <Download size={13} /> {art.label}
                          </a>
                        ) : (
                          <span key={i} className="las-code">{art.label}: {art.path}</span>
                        ),
                      )}
                      <button
                        type="button"
                        className="las-btn"
                        onClick={() => onSendToChat?.(`任务 ${rec.taskId} 已执行完成：\n目标：${rec.goal}\n结果：\n${(rec.steps || []).map((s) => `- ${s.title}：${s.summary}`).join("\n")}\n\n请帮我复盘并建议下一步优化！`)}
                      >
                        <MessageSquarePlus size={13} /> 发给 {aiName} 复盘
                      </button>
                    </div>
                  )}
                </div>
              ))}
          </article>
        </div>
      )}

      {/* TAB 5: MOBILE APP INSTALL (LIKE DOUBAO / DEEPSEEK) + LAN PC PAIRING */}
      {activeTab === "mobile" && (
        <>
          <div className="las-grid">
            <article className="las-card">
              <div className="las-card-head">
                <h3><Smartphone size={17} /> 像豆包 / DeepSeek 一样装进手机</h3>
              </div>
              <p className="las-muted">
                DengTa 已内置 <strong>Android 原生 Capacitor APK</strong> 与 <strong>iOS/鸿蒙/Android 独立 PWA（支持系统「分享文件到 DengTa」）</strong>，装到桌面后全屏独立运行，可直接在手机相册/微信/文件管理里把视频和文档分享给 {aiName}。
              </p>
              <div className="las-qr-wrap">
                {apkQrDataUrl && <img className="las-qr-img" src={apkQrDataUrl} alt="DengTa 手机安装页二维码" />}
                <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 8 }}>
                  <a className="las-btn is-primary" href="/download.html" target="_blank" rel="noreferrer">
                    <Download size={14} /> 下载 Android 安装包 (APK)
                  </a>
                  <button type="button" className="las-btn" onClick={() => void handlePwaInstall()}>
                    <Smartphone size={14} /> 一键安装到手机桌面 (PWA)
                  </button>
                  {pwaMessage && <p className="las-muted">{pwaMessage}</p>}
                </div>
              </div>
            </article>

            <article className="las-card">
              <div className="las-card-head">
                <h3><Wifi size={17} /> 手机 ↔ 电脑局域网配对（远程控剪映）</h3>
              </div>
              <p className="las-muted">
                由于 Android / iOS 系统沙盒禁止第三方 App 直接篡改手机版剪映私有目录，推荐在电脑双击运行{" "}
                <span className="las-code">dengta-creator-bridge-mcp\一键启动DengTa本机AI助手.bat</span>，然后手机填下方同一 Wi-Fi 地址，即可用手机指挥电脑上的剪映与 FFmpeg！
              </p>
              <div className="las-qr-wrap">
                {lanQrDataUrl && <img className="las-qr-img" src={lanQrDataUrl} alt="局域网电脑网关配对二维码" />}
                <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div className="las-field">
                    <label htmlFor="las-bridge-url">电脑本机 AI 网关地址（留空默认本机代理）</label>
                    <input
                      id="las-bridge-url"
                      className="las-input"
                      value={bridgeUrlInput}
                      onChange={(e) => setBridgeUrlInput(e.target.value)}
                      placeholder={primaryLanUrl}
                    />
                  </div>
                  <div className="las-row">
                    <button type="button" className="las-btn is-primary" onClick={handleSaveLanBridge}>
                      <QrCode size={14} /> 保存并连接网关
                    </button>
                    {onOpenDeviceCenter && (
                      <button type="button" className="las-btn" onClick={onOpenDeviceCenter}>
                        <Laptop size={14} /> 打开 MCP 设备中心
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </article>
          </div>

          <article className="las-card">
            <div className="las-card-head">
              <h3><Sparkles size={17} /> DengTa 手机端 / 电脑端能力路线对照（对标豆包 · DeepSeek · Antigravity）</h3>
            </div>
            <table className="las-compare-table">
              <thead>
                <tr>
                  <th>核心能力</th>
                  <th>手机独立安装（APK / PWA）</th>
                  <th>连接电脑本机网关（局域网 / 本机）</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>系统级安装与快捷入口</strong></td>
                  <td>独立桌面图标、全屏无地址栏、长按图标快捷直达聊天/工作台/知识库、支持「分享文件到 DengTa」</td>
                  <td>桌面浏览器 + MCP 网关一键批处理启动，自动暴露 `/mcp` 标准协议</td>
                </tr>
                <tr>
                  <td><strong>读取音视频 / 文档 / 资源包</strong></td>
                  <td>原生读取 MP4/MP3/字幕/Markdown/ZIP/`.motion` 元数据与文本，直接送入对话</td>
                  <td>深度调用 FFprobe + PyMuPDF (PDF) + python-docx + openpyxl + python-pptx 解析任意大文件</td>
                </tr>
                <tr>
                  <td><strong>AI 工作区 & 用户知识库</strong></td>
                  <td>基于浏览器 OPFS + 本地存储建私有工作区与离线中英文 BM25 知识库</td>
                  <td>读写电脑真实目录 `dengta-ai-workspace/`，持久切片索引与实时 RAG 检索</td>
                </tr>
                <tr>
                  <td><strong>控制剪映 & adudir-open</strong></td>
                  <td>生成标准 `.motion` 清单 + 字幕，通过系统分享给剪映 App 或远程触发电脑剪映</td>
                  <td>直接运行 `adudir-open` 5 大算法 + `pyJianYingDraft` 写入本机剪映草稿箱 + 导出 FCPXML/SRT + 唤起剪映</td>
                </tr>
              </tbody>
            </table>
          </article>
        </>
      )}
    </section>
  );
}
