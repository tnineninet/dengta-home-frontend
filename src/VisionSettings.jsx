import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api";

const EMPTY_PROFILE = {
  configured: false,
  enabled: false,
  name: "自定义视觉接口",
  base_url: "",
  model: "",
  auth_type: "bearer",
  has_secret: false,
  last_status: "untested",
  last_error_code: null,
  last_checked_at: null,
};

function statusLabel(profile) {
  if (!profile?.configured) return "尚未配置";
  if (!profile.enabled) return "已关闭";
  if (profile.last_status === "connected") return "已连通";
  if (profile.last_status === "error") return "连接失败";
  return "待测试";
}

export default function VisionSettings() {
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest("/api/v2/vision-provider");
      setProfile({ ...EMPTY_PROFILE, ...(data?.profile || {}) });
    } catch (cause) {
      setError(cause?.message || "视觉接口设置读取失败。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Loading on mount is intentional; the API state is initialized after this render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function patch(key, value) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setBusy("save");
    setFeedback("");
    setError("");
    try {
      const data = await apiRequest("/api/v2/vision-provider", {
        method: "PUT",
        body: JSON.stringify({
          name: profile.name,
          base_url: profile.base_url,
          model: profile.model,
          auth_type: profile.auth_type,
          enabled: profile.enabled,
          ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
        }),
      });
      setProfile({ ...EMPTY_PROFILE, ...(data?.profile || {}) });
      setApiKey("");
      setFeedback("视觉接口设置已保存。");
    } catch (cause) {
      setError(cause?.message || "保存失败。");
    } finally {
      setBusy("");
    }
  }

  async function test() {
    setBusy("test");
    setFeedback("");
    setError("");
    try {
      const data = await apiRequest("/api/v2/vision-provider/test", { method: "POST" });
      setFeedback(data?.message || (data?.ok ? "视觉接口已连通。" : "视觉接口未连通。"));
      await load();
    } catch (cause) {
      setError(cause?.message || "测试失败。");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="settings-card">
      <h3>自定义视觉接口</h3>
      <p className="card-hint">
        当前聊天模型没有视觉能力时，DengTa 可以把图片交给这里配置的视觉接口描述，再把描述交给当前 AI。
        接口需兼容 OpenAI Chat Completions：请求会发到「接口地址 + /chat/completions」，使用 <code>model</code> 和图片输入。
        留空 API Key 表示沿用已保存的 Key。密钥只加密保存在服务端，不会回传浏览器。
      </p>

      <div className="settings-card" style={{ marginBottom: 12 }}>
        <strong>状态：{statusLabel(profile)}</strong>
        {profile.last_error_code ? <p className="card-hint">最近错误：{profile.last_error_code}</p> : null}
        {profile.last_checked_at ? <p className="card-hint">最近检查：{new Date(profile.last_checked_at).toLocaleString("zh-CN")}</p> : null}
      </div>

      <label className="settings-field">
        <span>名称</span>
        <input
          value={profile.name || ""}
          maxLength={80}
          onChange={(event) => patch("name", event.target.value)}
          placeholder="例如：我的视觉模型"
        />
      </label>

      <label className="settings-field">
        <span>接口地址</span>
        <input
          value={profile.base_url || ""}
          onChange={(event) => patch("base_url", event.target.value)}
          placeholder="https://api.example.com/v1"
          inputMode="url"
          autoComplete="off"
        />
      </label>

      <label className="settings-field">
        <span>模型名称</span>
        <input
          value={profile.model || ""}
          onChange={(event) => patch("model", event.target.value)}
          placeholder="例如：qwen-vl-plus 或 gpt-4o-mini"
          autoComplete="off"
        />
      </label>

      <label className="settings-field">
        <span>API Key</span>
        <input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={profile.has_secret ? "已保存，留空表示不修改" : "填写视觉接口的 API Key"}
          autoComplete="new-password"
        />
      </label>

      <label className="settings-field">
        <span>认证方式</span>
        <select value={profile.auth_type || "bearer"} onChange={(event) => patch("auth_type", event.target.value)}>
          <option value="bearer">Bearer Token</option>
          <option value="none">无需认证</option>
        </select>
      </label>

      <label className="chat-skin-toggle">
        <span>
          <strong>启用视觉描述</strong>
          <small>启用后，发送图片时如果当前模型不支持视觉，会先调用这里配置的视觉接口。</small>
        </span>
        <input type="checkbox" checked={profile.enabled === true} onChange={(event) => patch("enabled", event.target.checked)} />
      </label>

      {error ? <p className="settings-error" role="alert">{error}</p> : null}
      {feedback ? <p className="settings-success" role="status">{feedback}</p> : null}

      <div className="settings-actions">
        <button type="button" onClick={() => void save()} disabled={Boolean(busy) || loading}>
          {busy === "save" ? "保存中…" : "保存"}
        </button>
        <button type="button" onClick={() => void test()} disabled={Boolean(busy) || loading || !profile.configured}>
          {busy === "test" ? "测试中…" : "测试连接"}
        </button>
        <button type="button" onClick={() => void load()} disabled={Boolean(busy) || loading}>
          重新读取
        </button>
      </div>
    </div>
  );
}
