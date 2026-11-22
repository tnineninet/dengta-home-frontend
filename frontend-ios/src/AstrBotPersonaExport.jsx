import { useRef, useState } from "react";
import { authSession } from "./auth-session.js";
import { settingsSaveScope } from "./settings-save-scope.js";
import { useMemoryUiRequest as useScopedUiRequest } from "./memory-ui-feedback.js";
import { settingsServiceErrorMessage } from "./settings-service-errors";

export default function AstrBotPersonaExport({ disabled, scopeKey = settingsSaveScope(authSession.getSnapshot()) }) {
  const [includeDetails, setIncludeDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef(null);
  const { request, isCurrent } = useScopedUiRequest(scopeKey);

  async function download() {
    if (active.current || disabled || !isCurrent()) return;
    const operation = {};
    active.current = operation;
    setBusy(true);
    setMessage("");
    try {
      const payload = await request(
        `/settings/astrbot-persona?include_user_details=${includeDetails}`,
      );
      if (!isCurrent() || active.current !== operation) return;
      const filename = "DengTa-AstrBot-persona.json";
      const content = JSON.stringify(payload, null, 2);
      if (typeof window.DengTaFileBridge?.saveExport === "function") {
        const bytes = new TextEncoder().encode(content);
        const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
        window.DengTaFileBridge.saveExport("data:text/plain;charset=utf-8;base64," + btoa(binary), filename);
      } else {
        const blob = new Blob([content], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
      setMessage("已生成文件，可导入你自己的 AstrBot。");
    } catch (error) {
      if (isCurrent() && active.current === operation) {
        setMessage(error?.code === "request_timeout" ? "等待人格文件超时，请重新下载。" : settingsServiceErrorMessage(error, "人格导出失败，请稍后重试。"));
      }
    } finally {
      if (active.current === operation) {
        active.current = null;
        if (isCurrent()) setBusy(false);
      }
    }
  }

  return (
    <div className="prompt-layer">
      <strong>导出给 AstrBot</strong>
      <p>下载当前伴侣已保存的人格，用在自己的大肥鱼或 QQ 机器人。导出范围仅包括人格，下面可选附上你的详情。</p>
      <label>
        <input type="checkbox" checked={includeDetails} disabled={busy || disabled}
          onChange={(event) => setIncludeDetails(event.target.checked)} />
        同时导出「你的详情」
      </label>
      <button type="button" disabled={busy || disabled} onClick={() => void download()}>
        {busy ? "正在导出…" : "下载人格文件"}
      </button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
