import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "./api";
import { settingsServiceErrorMessage } from "./settings-service-errors";

const ENDPOINT = "/api/v2/qq-cloud";

export default function QQCloudConnect({ onReady, onStatusChange, onConfigureSync }) {
  const [connection, setConnection] = useState(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef(null);
  const revision = useRef(0);

  const reportStatus = useCallback((result) => {
    setConnection(result);
    onReady?.(result?.state === "active" && result?.online === true);
    onStatusChange?.(result || null);
  }, [onReady, onStatusChange]);

  const checkNow = useCallback(async () => {
    if (active.current) return;
    setWorking(true);
    setMessage("");
    try {
      const result = await apiRequest(ENDPOINT);
      reportStatus(result);
      setMessage(
        result?.state === "active" && result?.online
          ? "检测通过：官方 QQ 机器人当前在线，可以直接去 QQ 私聊（发送「/同步状态」可核对人设与记忆）。"
          : result?.state === "awaiting_owner"
            ? "扫码已完成，请复制下方 12 位「灯塔绑定 …」指令发给 QQ 机器人确认主人身份。"
            : result?.state === "active"
              ? "已授权但网关正在重连，请稍候 3 秒再次检测。"
              : "当前尚未连接官方 QQ 机器人，请点击「用 QQ 扫码连接」。",
      );
    } catch (error) {
      setMessage(settingsServiceErrorMessage(error, "暂时读取不到 QQ 云接入状态。"));
    } finally {
      setWorking(false);
    }
  }, [reportStatus]);

  useEffect(() => {
    const lifetime = new AbortController();
    let timer;
    async function refresh() {
      let delay = 8000;
      if (!active.current) {
        const atStart = revision.current;
        try {
          const result = await apiRequest(ENDPOINT, { signal: lifetime.signal });
          if (!lifetime.signal.aborted && !active.current && revision.current === atStart) {
            reportStatus(result);
            if (!result.enabled) return;
            if (["scanning", "saving", "awaiting_owner"].includes(result.state) ||
                (result.state === "active" && !result.online)) delay = 2500;
          }
        } catch (error) {
          if (!lifetime.signal.aborted && !active.current) {
            setMessage(settingsServiceErrorMessage(error, "暂时读取不到 QQ 云接入状态。"));
          }
        }
      }
      if (!lifetime.signal.aborted) timer = setTimeout(refresh, delay);
    }
    void refresh();
    return () => {
      clearTimeout(timer);
      lifetime.abort();
      active.current?.abort();
    };
  }, [reportStatus]);

  async function act(path, method) {
    if (active.current) return;
    const operation = new AbortController();
    revision.current += 1;
    active.current = operation;
    setWorking(true);
    setMessage("");
    try {
      const result = await apiRequest(ENDPOINT + path, { method, signal: operation.signal });
      if (!operation.signal.aborted) {
        reportStatus(result);
      }
    } catch (error) {
      if (!operation.signal.aborted) setMessage(settingsServiceErrorMessage(error, "操作失败，请重试。"));
    } finally {
      active.current = null;
      if (!operation.signal.aborted) setWorking(false);
    }
  }

  async function copyPairCode() {
    try {
      await navigator.clipboard.writeText(connection.pair_code);
      setMessage("已复制 12 位官方配对指令，到 QQ 机器人私聊粘贴并发送即可完成确认。");
    } catch {
      setMessage("请长按配对指令手动复制。");
    }
  }

  const state = connection?.state;
  const scanning = ["scanning", "saving"].includes(state);
  const enrolled = ["active", "awaiting_owner"].includes(state);
  const isOnline = state === "active" && connection?.online === true;
  const badgeTone = isOnline ? "is-online" : (enrolled || scanning) ? "is-pending" : "is-offline";
  const badgeText = !connection
    ? "检测中…"
    : !connection.enabled
      ? "云接入未开启"
      : isOnline
        ? "● 已连接 · 在线运行中"
        : state === "active"
          ? "◌ 已授权 · 网关重连中"
          : state === "awaiting_owner"
            ? "◌ 等待发送 12 位配对指令"
            : scanning
              ? "◌ 等待手机 QQ 扫码确认"
              : "○ 未连接";

  return (
    <section className={`channel-hub-card qq-cloud-card ${badgeTone}`} aria-labelledby="qq-cloud-title">
      <div className="channel-hub-card-heading">
        <div>
          <span className="eyebrow">QQ OFFICIAL CLOUD BOT · 推荐（免小号）</span>
          <h3 id="qq-cloud-title">扫码接入自己的 QQ 机器人</h3>
        </div>
        <span className={`qq-cloud-badge ${badgeTone}`}>{badgeText}</span>
      </div>
      <p className="channel-hub-copy">绑定当前伴侣后，在手机 QQ「联系人 → 机器人」即可私聊，自动同步你在「人设与记忆」保存的真实人设、称呼与记忆（在 QQ 里发送 <code>/同步状态</code> 可即时验明）。</p>
      {!connection && <p className="channel-hub-empty-line">正在读取官方 QQ 机器人状态…</p>}
      {connection && !connection.enabled && <p className="channel-hub-inline-error">QQ 云接入暂未在后端开启（需设置 QQ_CLOUD_ENABLED=true）。</p>}
      <div className="qq-cloud-actions">
        {connection?.enabled && !scanning && !enrolled && (
          <button type="button" className="channel-hub-primary" disabled={working} onClick={() => void act("/start", "POST")}>
            {state === "failed" || state === "already_linked" ? "重新扫码连接" : "用 QQ 扫码连接"}
          </button>
        )}
        {connection?.enabled && (
          <button type="button" className="channel-hub-secondary" disabled={working} onClick={() => void checkNow()}>
            {working ? "检测中…" : "检查连接状态"}
          </button>
        )}
        {state === "active" && (
          <button type="button" className="channel-hub-primary" onClick={onConfigureSync}>
            检查 / 设置人设与记忆
          </button>
        )}
        {(scanning || enrolled) && (
          <button type="button" className="channel-hub-secondary is-danger" disabled={working} onClick={() => void act("", "DELETE")}>
            {scanning ? "取消扫码" : "断开连接"}
          </button>
        )}
      </div>
      {state === "already_linked" && <p className="channel-hub-inline-error">这个 QQ 机器人已连接到其他账号或伴侣。请从原来绑定的位置断开，或选择另一个机器人。</p>}
      {state === "failed" && <p className="channel-hub-inline-error">本次绑定未完成，请重新获取二维码。</p>}
      {scanning && !connection.qr_image && <p className="channel-hub-empty-line">{state === "saving" ? "正在保存连接…" : "正在生成腾讯二维码…"}</p>}
      {scanning && connection.qr_image && (
        <div className="qq-cloud-qr-box">
          <img src={connection.qr_image} alt="腾讯 QQ 机器人绑定二维码" width="232" height="232" />
          <p>用手机 QQ 扫码并确认。手机上也可以直接打开 <a href={connection.qr_url} target="_blank" rel="noopener noreferrer">腾讯绑定页</a>。</p>
        </div>
      )}
      {state === "awaiting_owner" && (
        <div className="channel-hub-code" role="status">
          <small>官方 QQ 机器人一次性配对指令（注意是「灯塔绑定 + 12位数字」，不是下方旧版 6 位码）</small>
          {connection.pair_code ? (
            <div className="channel-hub-code-row">
              <strong style={{ fontSize: "18px", letterSpacing: "0.04em" }}>{connection.pair_code}</strong>
              <button type="button" className="channel-hub-copy" onClick={() => void copyPairCode()}>复制指令</button>
            </div>
          ) : (
            <button type="button" className="channel-hub-secondary" disabled={working} onClick={() => void act("/pair-code", "POST")}>重新生成指令</button>
          )}
          <span>{connection.online ? "机器人已上线，复制上方整条指令发给 QQ 机器人即可完成绑定。" : "正在连接 QQ 网关，请等机器人上线后再发送。"}</span>
        </div>
      )}
      {state === "active" && (
        <p className={isOnline ? "channel-hub-saved" : "channel-hub-inline-error"}>
          {isOnline
            ? "✅ 官方 QQ 机器人已在线。直接打开手机 QQ「联系人 → 机器人」私聊即可，无需再输入下方旧版 6 位绑定码。"
            : "已授权，正在重连 QQ 网关。稍候几秒点「检查连接状态」刷新。"}
        </p>
      )}
      {message && <p className="channel-hub-saved" role="status">{message}</p>}
    </section>
  );
}
