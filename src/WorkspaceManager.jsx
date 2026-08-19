import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  workspaceAgentsMd,
  workspaceDeleteFile,
  workspaceReadFile,
  workspaceStats,
  workspaceTree,
  workspaceWriteFile,
} from "./workspace-api.js";
import {
  workspaceCacheClear,
  workspaceCacheList,
  workspaceCacheRead,
  workspaceCacheWrite,
} from "./workspace-cache.js";

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fileLabel(entry) {
  return String(entry?.name || "").replace(/\/$/, "");
}

function safeFileName(name) {
  return String(name || "")
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 180);
}

function downloadTextFile(name, text) {
  const blob = new Blob([String(text ?? "")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name || "workspace-file.txt";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export default function WorkspaceManager() {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState(null);
  const [openPath, setOpenPath] = useState("");
  const [content, setContent] = useState("");
  const [cachedAt, setCachedAt] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [cacheInfo, setCacheInfo] = useState({ files: 0, totalBytes: 0 });
  const [agentsMd, setAgentsMd] = useState(null);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef(null);
  const editorRef = useRef(null);

  const toast = useCallback((text, duration = 3500) => {
    setMessage(text);
    window.setTimeout(() => setMessage((current) => (current === text ? "" : current)), duration);
  }, []);

  const breadcrumbs = useMemo(() => {
    const parts = path ? path.split("/").filter(Boolean) : [];
    const crumbs = [{ label: "工作区根目录", target: "" }];
    let cumulative = "";
    parts.forEach((part) => {
      cumulative = cumulative ? `${cumulative}/${part}` : part;
      crumbs.push({ label: part, target: cumulative });
    });
    return crumbs;
  }, [path]);

  const refreshStats = useCallback(() => {
    workspaceStats().then(setStats).catch(() => setStats(null));
  }, []);

  const refreshCacheInfo = useCallback(() => {
    workspaceCacheList()
      .then((items) => {
        const files = Array.isArray(items) ? items.length : 0;
        const totalBytes = Array.isArray(items)
          ? items.reduce((sum, item) => sum + String(item.content || "").length, 0)
          : 0;
        setCacheInfo({ files, totalBytes });
      })
      .catch(() => setCacheInfo({ files: 0, totalBytes: 0 }));
  }, []);

  const loadTree = useCallback(async (targetPath) => {
    setLoading(true);
    setError("");
    try {
      const data = await workspaceTree(targetPath);
      if (!data?.ok) throw new Error(data?.error || "读取失败。");
      setEntries(data.entries || []);
      setPath(data.path || targetPath || "");
    } catch (caught) {
      setError(caught?.message || "工作区读取失败，请稍后重试。");
      setEntries(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTree("");
    refreshStats();
    refreshCacheInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigate = useCallback((target) => {
    setOpenPath("");
    setDirty(false);
    void loadTree(target);
  }, [loadTree]);

  async function openFile(entry) {
    const name = fileLabel(entry);
    if (!name) return;
    const full = path ? `${path}/${name}` : name;
    setOpenPath(full);
    setContent("");
    setCachedAt("");
    setDirty(false);
    setCopied(false);
    setBusy(`open:${full}`);
    setError("");
    try {
      const cached = await workspaceCacheRead(full).catch(() => null);
      if (cached?.content != null) {
        setContent(String(cached.content));
        setCachedAt(cached.savedAt ? `（本地缓存 ${new Date(cached.savedAt).toLocaleString()}）` : "（本地缓存）");
      }
      const data = await workspaceReadFile(full);
      if (data?.ok) {
        setContent(data.content || "");
        setCachedAt("");
        void workspaceCacheWrite(full, String(data.content || "")).catch(() => undefined);
        refreshCacheInfo();
      } else {
        if (!cached?.content) throw new Error(data?.error || "文件读取失败。");
      }
    } catch (caught) {
      setError(caught?.message || "文件读取失败。");
    } finally {
      setBusy("");
    }
  }

  function beginNewFile() {
    const raw = window.prompt("新建文件（输入文件名，可含子目录如 docs/note.md）：");
    if (raw == null) return;
    const name = safeFileName(raw);
    if (!name) return;
    const full = path ? `${path}/${name}` : name;
    setOpenPath(full);
    setContent("");
    setCachedAt("（新文件）");
    setDirty(false);
    setCopied(false);
    window.setTimeout(() => editorRef.current?.focus?.(), 100);
    toast("已打开新文件，输入内容后点「保存」。");
  }

  async function saveFile() {
    if (!openPath) return;
    setBusy("save");
    setError("");
    try {
      const data = await workspaceWriteFile({ path: openPath, content });
      if (data?.ok) {
        setDirty(false);
        toast(`已保存 ${openPath}（${formatBytes(data.chars)}）`);
        void workspaceCacheWrite(openPath, content).catch(() => undefined);
        refreshCacheInfo();
        refreshStats();
        void loadTree(path);
      } else {
        setDirty(true);
        if (data?.code === "confirmation_required") {
          // 覆盖确认：工作区页面由用户本人操作，视为已确认
          const confirmed = await workspaceWriteFile({ path: openPath, content, confirm: true });
          if (confirmed?.ok) {
            setDirty(false);
            toast(`已覆盖保存 ${openPath}。`);
            void workspaceCacheWrite(openPath, content).catch(() => undefined);
            refreshCacheInfo();
            refreshStats();
            void loadTree(path);
          } else {
            setError(confirmed?.error || "保存失败。");
          }
        } else {
          setError(data?.error || "保存失败。");
        }
      }
    } catch (caught) {
      setError(caught?.message || "保存失败。");
    } finally {
      setBusy("");
    }
  }

  async function removeFile(name) {
    const target = path ? `${path}/${name}` : name;
    if (!window.confirm(`确认删除工作区文件「${target}」？删除后不可恢复。`)) return;
    setBusy(`delete:${target}`);
    setError("");
    try {
      const data = await workspaceDeleteFile({ path: target, confirm: true });
      if (data?.ok) {
        toast(`已删除 ${target}`);
        if (openPath === target) {
          setOpenPath("");
          setContent("");
          setDirty(false);
        }
        void workspaceCacheWrite(target, "").catch(() => undefined);
        refreshCacheInfo();
        await loadTree(path);
      } else {
        setError(data?.error || "删除失败。");
      }
    } catch (caught) {
      setError(caught?.message || "删除失败。");
    } finally {
      setBusy("");
    }
  }

  async function clearLocalCache() {
    if (!window.confirm("确认清理工作区本地缓存？云端文件不会被删除，只是移除手机本地的离线副本。")) return;
    setBusy("clear-cache");
    try {
      await workspaceCacheClear();
      refreshCacheInfo();
      toast("本地缓存已清理。");
    } catch (caught) {
      setError(caught?.message || "缓存清理失败。");
    } finally {
      setBusy("");
    }
  }

  async function loadAgentsMd() {
    if (agentsMd) { setAgentsMd(null); return; }
    setBusy("agents-md");
    try {
      const data = await workspaceAgentsMd();
      if (data?.ok) {
        setAgentsMd({ chars: data.chars, content: data.content });
      } else {
        setError(data?.error || "agents.md 读取失败。");
      }
    } catch (caught) {
      setError(caught?.message || "agents.md 读取失败。");
    } finally {
      setBusy("");
    }
  }

  // —— 导入：从本地文件上传到当前目录 ——
  async function importFromFile(file) {
    if (!file?.name) return;
    const text = await file.text().catch(() => "");
    if (text === "" && file.size > 0) {
      setError("文件读取失败或为空。");
      return;
    }
    const name = safeFileName(file.name);
    const full = path ? `${path}/${name}` : name;
    setBusy(`import:${full}`);
    try {
      const data = await workspaceWriteFile({ path: full, content: text });
      if (data?.ok) {
        toast(`已导入 ${full}（${formatBytes(data.chars)}）`);
        refreshCacheInfo();
        refreshStats();
        await loadTree(path);
      } else if (data?.code === "confirmation_required") {
        const confirmed = await workspaceWriteFile({ path: full, content: text, confirm: true });
        if (confirmed?.ok) {
          toast(`已覆盖导入 ${full}。`);
          refreshCacheInfo();
          refreshStats();
          await loadTree(path);
        } else {
          setError(confirmed?.error || "导入失败。");
        }
      } else {
        setError(data?.error || "导入失败。");
      }
    } catch (caught) {
      setError(caught?.message || "导入失败。");
    } finally {
      setBusy("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // —— 导出：把已打开文件下载到本地 ——
  function exportOpenFile() {
    if (!openPath) return;
    const name = openPath.split("/").pop() || "workspace-file.txt";
    downloadTextFile(name, content);
    toast(`已导出 ${name}`);
  }

  // —— 复制：把编辑器内容复制到剪贴板 ——
  async function copyContent() {
    if (!openPath) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (caught) {
      try {
        editorRef.current?.select?.();
        document.execCommand("copy");
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      } catch (inner) {
        setError("复制失败，请手动选择后复制。");
      }
    }
  }

  // —— 粘贴：从剪贴板建一个新文件 ——
  async function pasteFromClipboard() {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch (caught) {
      setError("无法读取剪贴板。请先在系统里复制文本，再点此按钮。");
      return;
    }
    if (!text) {
      setError("剪贴板是空的。");
      return;
    }
    const raw = window.prompt("粘贴为文件（输入文件名）：", "clipboard.txt");
    if (raw == null) return;
    const name = safeFileName(raw);
    if (!name) return;
    const full = path ? `${path}/${name}` : name;
    setBusy(`paste:${full}`);
    try {
      const data = await workspaceWriteFile({ path: full, content: text });
      if (data?.ok) {
        toast(`已粘贴保存 ${full}（${formatBytes(data.chars)}）`);
        refreshCacheInfo();
        refreshStats();
        await loadTree(path);
      } else if (data?.code === "confirmation_required") {
        const confirmed = await workspaceWriteFile({ path: full, content: text, confirm: true });
        if (confirmed?.ok) {
          toast(`已覆盖粘贴保存 ${full}。`);
          refreshCacheInfo();
          refreshStats();
          await loadTree(path);
        } else {
          setError(confirmed?.error || "粘贴保存失败。");
        }
      } else {
        setError(data?.error || "粘贴保存失败。");
      }
    } catch (caught) {
      setError(caught?.message || "粘贴保存失败。");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="fun-view workspace-view">
      <header className="fun-view-header">
        <h2>📁 工作区</h2>
        <p>你和 AI 共用的文件空间 —— AI 写的代码、笔记都保存在这里，云端自动同步。</p>
      </header>

      <div className="notification-feature-panel device-activity-panel">
        <div className="device-activity-heading">
          <div>
            <strong>存放位置</strong>
            <span>{stats?.location || "云端用户工作区（Supabase Storage）"}</span>
          </div>
          <div className="device-activity-actions">
            <button type="button" onClick={() => { void loadTree(path); refreshStats(); }} disabled={loading}>刷新</button>
            <button type="button" onClick={() => void clearLocalCache()} disabled={Boolean(busy)}>清理缓存</button>
          </div>
        </div>
        <p className="workspace-stats-line">
          云端 {stats?.files ?? "…"} 个文件 · {formatBytes(stats?.bytes)}；本地缓存 {cacheInfo.files} 个 · {formatBytes(cacheInfo.totalBytes)}
        </p>
      </div>

      <div className="workspace-toolbar">
        <button type="button" onClick={beginNewFile} disabled={Boolean(busy)}>＋ 新建文件</button>
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={Boolean(busy)}>
          ⬆ 导入文件
        </button>
        <button type="button" onClick={() => void pasteFromClipboard()} disabled={Boolean(busy)}>
          📋 粘贴为文件
        </button>
        <input
          ref={fileInputRef}
          type="file"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importFromFile(file);
          }}
        />
        <span aria-hidden="true" className="workspace-toolbar-path">
          {path ? `当前目录：/${path}` : "当前目录：/（根目录）"}
        </span>
      </div>

      <button
        type="button"
        className="workspace-agents-md-toggle"
        onClick={() => void loadAgentsMd()}
        disabled={busy === "agents-md"}
      >
        {agentsMd ? "收起" : "预览"}每轮注入的 agents.md（个性化指令 + 记忆详情）
      </button>
      {agentsMd && (
        <div className="workspace-agents-md-preview">
          <pre>{agentsMd.content}</pre>
          <small>共 {agentsMd.chars} 字符 · 与聊天时注入到系统提示词最前的内容一致</small>
        </div>
      )}

      {error && <div className="media-settings-error" role="alert">{error}</div>}
      {message && <div className="workspace-saved-note" role="status">{message}</div>}

      <nav className="workspace-breadcrumbs" aria-label="工作区路径">
        {breadcrumbs.map((crumb, index) => (
          <span key={crumb.target}>
            {index > 0 && <span className="workspace-breadcrumb-sep">/</span>}
            <button type="button" disabled={path === crumb.target || Boolean(busy)} onClick={() => navigate(crumb.target)}>
              {crumb.label}
            </button>
          </span>
        ))}
      </nav>

      <section className="workspace-files" aria-busy={loading}>
        {loading ? (
          <p className="notification-feature-feedback busy" role="status">加载中…</p>
        ) : entries === null ? null : entries.length === 0 ? (
          <p className="media-empty-state">这个目录还是空的。可以让 AI 写代码或记笔记到这里。</p>
        ) : (
          <ul className="workspace-file-list">
            {entries.map((entry) => {
              const name = fileLabel(entry);
              const isDir = String(entry.type) === "dir" || name.endsWith("/");
              return (
                <li key={name} className="workspace-file-row">
                  <button
                    type="button"
                    className="workspace-file-name"
                    onClick={() => (isDir ? navigate(path ? `${path}/${name}` : name) : void openFile(entry))}
                  >
                    <span aria-hidden="true">{isDir ? "📂" : "📄"}</span>
                    <strong>{name}</strong>
                    {!isDir && <small>{formatBytes(entry.size)}</small>}
                  </button>
                  {!isDir && (
                    <div className="workspace-file-actions">
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => openFile(entry).then(() => exportOpenFile())}
                      >
                        下载
                      </button>
                      <button
                        type="button"
                        className="danger"
                        disabled={Boolean(busy)}
                        onClick={() => void removeFile(name)}
                      >
                        删除
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {openPath && (
        <section className="workspace-editor">
          <div className="workspace-editor-heading">
            <div>
              <strong>{openPath}</strong>
              <small>{cachedAt || "云端最新内容"}{dirty ? " · 有未保存修改" : ""}</small>
            </div>
            <div className="workspace-editor-actions">
              <button type="button" onClick={() => void copyContent()} disabled={Boolean(busy) || !openPath}>
                {copied ? "已复制 ✓" : "复制"}
              </button>
              <button type="button" onClick={exportOpenFile} disabled={Boolean(busy) || !openPath}>下载</button>
              <button type="button" disabled={busy === "save" || !dirty} onClick={() => void saveFile()}>
                {busy === "save" ? "保存中…" : "保存"}
              </button>
              <button type="button" disabled={Boolean(busy)} onClick={() => { setOpenPath(""); setDirty(false); setCopied(false); }}>关闭</button>
            </div>
          </div>
          <textarea
            ref={editorRef}
            value={content}
            onChange={(event) => { setContent(event.target.value); setDirty(true); }}
            spellCheck={false}
            placeholder="在这里输入或粘贴文件内容…"
            aria-label={`编辑 ${openPath}`}
          />
          <div className="workspace-editor-status">
            <span>{content.length.toLocaleString()} 字符</span>
            {dirty && <span className="workspace-editor-dirty">● 未保存</span>}
          </div>
        </section>
      )}
    </div>
  );
}