import { useEffect, useRef, useState } from "react";
import { apiRequest } from "./api.js";

const ACTIONS = {
  kiwi_mem_not_configured: "服务器尚未配置 Kiwi。现有灯塔记忆仍可使用。",
  kiwi_mem_tenant_required: "账号或伴侣标识不完整，请重新登录并选择伴侣后检测。",
  kiwi_mem_tenant_unverified: "网关未返回匹配的租户回执。请更新支持 X-Tenant-Id 回执的 Kiwi 网关；本次不会使用未经确认的记忆。",
  kiwi_mem_http_401: "Kiwi 鉴权失败，请检查服务器配置的网关令牌。",
  kiwi_mem_http_403: "Kiwi 拒绝访问，请检查网关权限配置。",
  kiwi_mem_http_404: "Kiwi 接口不存在，请检查网关地址和版本。",
  kiwi_mem_timeout: "Kiwi 响应超时，请检查网关是否休眠或网络是否可达，再点击检测。",
  kiwi_mem_network_error: "无法连接 Kiwi，请检查服务器到网关的网络连接，再点击检测。",
  kiwi_mem_invalid_response: "Kiwi 未返回可用状态，请检查网关日志和记忆功能开关。",
  kiwi_mem_memory_disabled: "Kiwi 的记忆功能已关闭，请在网关管理面板开启后重新检测。",
};

export default function MemoryGatewayStatus() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const requestRef = useRef(null);
  useEffect(() => () => { requestRef.current?.abort(); requestRef.current = null; }, []);
  async function check() {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    try {
      const result = await apiRequest("/api/v2/memory/health", { timeoutMs: 10_000, retry: false, signal: controller.signal });
      if (requestRef.current === controller) setStatus(result);
    } catch (error) {
      if (requestRef.current === controller) setStatus({ error: error?.code || "kiwi_mem_network_error", message: error?.message });
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; setBusy(false); }
    }
  }
  return <section className="memory-gateway-status" aria-label="Kiwi 记忆连接检查">
    <div><strong>Kiwi 服务器记忆</strong><button type="button" onClick={() => void check()} disabled={busy}>{busy ? "检测中…" : "检测连接与账号范围"}</button></div>
    <p>按当前账号和伴侣检查连接，不读取记忆正文。连接通过后，还需在聊天中验证实际召回。</p>
    {status && <div role="status">
      {status.tenant_verified && status.reachable ? <>
        <p>连接成功 · 账号与伴侣范围已确认 · {status.total_memories || 0} 条记忆</p>
        <p>{status.embedding_available ? "嵌入服务可用" : "嵌入服务不可用，语义召回未通过；请检查 Kiwi 的嵌入模型配置。"}</p>
      </> : <><p>{ACTIONS[status.error] || status.message || "连接未通过，请检查网关状态后重试。"}</p><code>{status.error || "kiwi_mem_unreachable"}</code></>}
    </div>}
  </section>;
}
