import { useEffect, useRef, useState } from "react";
import { apiRequest } from "./api";
import { settingsServiceErrorMessage } from "./settings-service-errors";

const ENDPOINT = "/api/v2/qq-cloud";

export default function QQCloudConnect({ onReady, onConfigureSync }) {
  const [connection, setConnection] = useState(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef(null);
  const revision = useRef(0);

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
            setConnection(result);
            onReady(result.state === "active" && result.online === true);
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
  }, [onReady]);

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
        setConnection(result);
        onReady(result.state === "active" && result.online === true);
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
      setMessage("已复制，到 QQ 私聊粘贴并发送。");
    } catch {
      setMessage("请长按配对指令手动复制。");
    }
  }

  const state = connection?.state;
  const scanning = ["scanning", "saving"].includes(state);
  const enrolled = ["active", "awaiting_owner"].includes(state);
  return (
    <section className="channel-hub-card" aria-labelledby="qq-cloud-title">
      <h3 id="qq-cloud-title">扫码接入自己的 QQ 机器人</h3>
      <p>绑定当前伴侣后，可以和机器人文字私聊。QQ 会使用你为这个通道保存的人设、说话风格和记忆。</p>
      {!connection && <p>正在读取状态…</p>}
      {connection && !connection.enabled && <p>QQ 云接入暂未开放。</p>}
      {connection?.enabled && !scanning && !enrolled && (
        <button type="button" disabled={working} onClick={() => void act("/start", "POST")}>
          {state === "failed" || state === "already_linked" ? "重新扫码" : "用 QQ 扫码连接"}
        </button>
      )}
      {state === "already_linked" && <p>这个 QQ 机器人已连接到其他账号或伴侣。请从原来绑定的位置断开，或选择另一个机器人。</p>}
      {state === "failed" && <p>本次绑定未完成，请重新获取二维码。</p>}
      {scanning && !connection.qr_image && <p>{state === "saving" ? "正在保存连接…" : "正在生成腾讯二维码…"}</p>}
      {scanning && connection.qr_image && (
        <>
          <img src={connection.qr_image} alt="腾讯 QQ 机器人绑定二维码" width="232" height="232" />
          <p>用手机 QQ 扫码并确认。手机上也可以打开 <a href={connection.qr_url} target="_blank" rel="noopener noreferrer">腾讯绑定页</a>。</p>
        </>
      )}
      {state === "awaiting_owner" && (
        <>
          <p>扫码已完成。打开机器人私聊，发送这条一次性指令确认 QQ 身份。</p>
          {connection.pair_code ? (
            <>
              <code>{connection.pair_code}</code>
              <button type="button" onClick={() => void copyPairCode()}>复制指令</button>
            </>
          ) : <button type="button" disabled={working} onClick={() => void act("/pair-code", "POST")}>重新生成指令</button>}
          {!connection.online && <p>正在连接 QQ，请等机器人上线再发送。</p>}
        </>
      )}
      {state === "active" && <p>{connection.online
        ? "已连接。在手机 QQ 的「联系人 → 机器人」打开私聊即可。"
        : "已授权，正在连接 QQ。连接完成后这里会更新。"}</p>}
      {state === "active" && <button type="button" onClick={onConfigureSync}>设置 QQ 人设与记忆</button>}
      {(scanning || enrolled) && <button type="button" disabled={working} onClick={() => void act("", "DELETE")}>
        {scanning ? "取消扫码" : "断开连接"}
      </button>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
