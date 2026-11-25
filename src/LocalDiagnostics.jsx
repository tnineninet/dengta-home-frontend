import { useMemo, useState, useSyncExternalStore } from "react";
import {
  clearOperationFailures,
  readOperationFailures,
  subscribeOperationFailures,
  summarizeOperationFailures,
} from "./operation-diagnostics.js";
import {
  buildAiFixDiagnosticBundle,
  clearBreadcrumbs,
  copyDiagnosticText,
  readBreadcrumbs,
  subscribeBreadcrumbs,
} from "./client-diagnostics.js";
import { HorizontalBarChart } from "./DataVizPrimitives.jsx";
import "./error-log-ui.css";

export default function LocalDiagnostics({ scope }) {
  const entries = useSyncExternalStore(
    subscribeOperationFailures,
    () => readOperationFailures(scope),
    () => readOperationFailures(scope),
  );
  const breadcrumbs = useSyncExternalStore(
    subscribeBreadcrumbs,
    () => readBreadcrumbs(scope),
    () => readBreadcrumbs(scope),
  );
  const [moduleFilter, setModuleFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [copyState, setCopyState] = useState("");
  const [showBreadcrumbs, setShowBreadcrumbs] = useState(false);

  const summary = useMemo(() => summarizeOperationFailures(scope), [scope, entries]);
  const modules = useMemo(
    () => ["all", ...new Set(entries.map((item) => item.label || item.code))],
    [entries],
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (moduleFilter !== "all" && (entry.label || entry.code) !== moduleFilter) return false;
      if (!q) return true;
      const haystack = [
        entry.code,
        entry.label,
        entry.reasonCode,
        entry.traceId,
        entry.fingerprint,
        entry.location,
        entry.route,
        entry.kind,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [entries, moduleFilter, search]);

  async function copyBundle(entry = null) {
    const bundle = buildAiFixDiagnosticBundle({
      localEntry: entry || filtered[0] || entries[0] || null,
      breadcrumbs,
      summary,
    });
    const ok = await copyDiagnosticText(bundle.markdown);
    setCopyState(ok ? "已复制 AI 精准修复诊断包" : "复制失败，请手动导出 JSON");
  }

  function exportJson() {
    const bundle = buildAiFixDiagnosticBundle({
      localEntry: entries[0] || null,
      breadcrumbs,
      summary,
    });
    const blob = new Blob(
      [JSON.stringify({ exported_at: new Date().toISOString(), entries, ...bundle.payload }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `dengta-client-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setCopyState("已导出诊断 JSON");
  }

  function handleClear() {
    clearOperationFailures(scope);
    clearBreadcrumbs(scope);
    setCopyState("");
  }

  return (
    <section className="settings-card error-logs-card local-diag-studio" aria-label="本机操作诊断">
      <div className="local-diag-head">
        <div>
          <h3>本机操作诊断与精准定位台</h3>
          <p className="card-hint">
            自动抓取接口失败、前端运行异常与最近操作面包屑，附加 Trace ID 与模块分布可视化。严格脱敏，不记录聊天正文与密钥。
          </p>
        </div>
      </div>

      <div className="local-diag-kpis" aria-label="诊断统计概览">
        <div className="local-diag-kpi">
          <span>拦截异常</span>
          <strong>{summary.total}</strong>
        </div>
        <div className="local-diag-kpi">
          <span>前端运行异常</span>
          <strong>{summary.runtimeCount}</strong>
        </div>
        <div className="local-diag-kpi">
          <span>操作面包屑</span>
          <strong>{breadcrumbs.length}</strong>
        </div>
        <div className="local-diag-kpi">
          <span>平均失败耗时</span>
          <strong>{summary.avgDurationMs !== null ? `${summary.avgDurationMs} ms` : "—"}</strong>
        </div>
      </div>

      {summary.byModule.length > 0 && (
        <div className="local-diag-chart-box">
          <strong className="local-diag-section-title">按模块故障分布</strong>
          <HorizontalBarChart items={summary.byModule} unit=" 次" accent="danger" />
        </div>
      )}

      <div className="error-logs-actions">
        <button
          type="button"
          data-dt-tip="一键复制含 Trace ID、故障指纹、代码行号与最近面包屑的结构化报告，发给 AI 可直接定位修复"
          disabled={!entries.length && !breadcrumbs.length}
          onClick={() => void copyBundle()}
        >
          {copyState || "复制 AI 修复诊断包"}
        </button>
        <button
          type="button"
          data-dt-tip="导出完整脱敏客户端诊断 JSON 文件"
          disabled={!entries.length && !breadcrumbs.length}
          onClick={exportJson}
        >
          导出诊断 JSON
        </button>
        <button
          type="button"
          data-dt-tip="展开或收起最近 40 条脱敏路由、接口耗时与操作轨迹"
          onClick={() => setShowBreadcrumbs((current) => !current)}
        >
          {showBreadcrumbs ? `收起面包屑 (${breadcrumbs.length})` : `查看面包屑 (${breadcrumbs.length})`}
        </button>
        <button
          type="button"
          data-dt-tip="清空本次会话的本机诊断记录与面包屑缓存"
          disabled={!entries.length && !breadcrumbs.length}
          onClick={handleClear}
        >
          清空本机诊断
        </button>
      </div>

      {entries.length > 0 && (
        <div className="local-diag-filters">
          <input
            type="search"
            className="local-diag-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="按错误码、Trace ID、指纹或代码位置筛选…"
            aria-label="筛选本机诊断记录"
          />
          <div className="local-diag-chips" role="group" aria-label="按模块筛选">
            {modules.map((name) => (
              <button
                key={name}
                type="button"
                className={`local-diag-chip${moduleFilter === name ? " is-active" : ""}`}
                onClick={() => setModuleFilter(name)}
              >
                {name === "all" ? "全部模块" : name}
              </button>
            ))}
          </div>
        </div>
      )}

      {!entries.length ? (
        <p className="error-logs-empty">本次打开尚未记录接口或运行异常。</p>
      ) : !filtered.length ? (
        <p className="error-logs-empty">当前筛选条件下没有匹配记录。</p>
      ) : (
        <ul className="error-logs-list">
          {filtered.map((entry) => (
            <li className="error-log-item local-diag-entry" key={entry.id}>
              <div className="local-diag-entry-head">
                <strong>{entry.code} · {entry.label}</strong>
                <span className={`local-diag-pill${entry.code === "DT-RUNTIME" || (entry.status && entry.status >= 500) ? " is-high" : ""}`}>
                  {entry.kind}{entry.status ? ` · HTTP ${entry.status}` : ""}
                </span>
              </div>
              {entry.reasonCode && <p className="local-diag-line">具体代码：<code>{entry.reasonCode}</code></p>}
              {entry.location && <p className="local-diag-line">代码位置：<code>{entry.location}</code></p>}
              {(entry.traceId || entry.fingerprint || entry.durationMs !== undefined) && (
                <p className="local-diag-meta">
                  {entry.traceId ? <span>Trace: <code>{entry.traceId}</code></span> : null}
                  {entry.fingerprint ? <span>指纹: <code>{entry.fingerprint}</code></span> : null}
                  {entry.durationMs !== undefined ? <span>耗时: {entry.durationMs} ms</span> : null}
                </p>
              )}
              <div className="local-diag-entry-foot">
                <small>{new Date(entry.at).toLocaleTimeString("zh-CN")} · {entry.route || entry.source}</small>
                <button
                  type="button"
                  className="local-diag-mini-copy"
                  data-dt-tip="只复制这一条异常的精准定位包"
                  onClick={() => void copyBundle(entry)}
                >
                  复制单条定位包
                </button>
              </div>
              {entry.logId && <p className="local-diag-line">服务端日志编号：<code>{entry.logId}</code></p>}
            </li>
          ))}
        </ul>
      )}

      {showBreadcrumbs && (
        <div className="local-diag-breadcrumbs" aria-label="最近操作面包屑时间轴">
          <strong className="local-diag-section-title">操作与接口面包屑时间轴（脱敏）</strong>
          {!breadcrumbs.length ? (
            <p className="error-logs-empty">暂无操作轨迹。</p>
          ) : (
            <ol className="local-diag-crumb-list">
              {breadcrumbs.slice(0, 20).map((crumb) => (
                <li key={crumb.id} className={crumb.ok ? "is-ok" : "is-fail"}>
                  <span className="local-diag-crumb-kind">{crumb.kind}</span>
                  <span className="local-diag-crumb-target">{crumb.target || "—"}</span>
                  {crumb.detail ? <small>{crumb.detail}</small> : null}
                  {crumb.durationMs !== null ? <em>{crumb.durationMs}ms</em> : null}
                  <time>{new Date(crumb.at).toLocaleTimeString("zh-CN")}</time>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
