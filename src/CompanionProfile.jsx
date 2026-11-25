import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api";
import {
  PROFILE_IDENTITY_FIELDS,
  PROFILE_STABLE_FIELDS,
  createProfileActionId,
  describeProfileChanges,
  hasLearnedProfileDetails,
  normalizeProfilePayload,
} from "./companion-profile";

function formatProfileTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function identityLabel(field) {
  return (
    PROFILE_IDENTITY_FIELDS.find((item) => item.key === field)?.label ||
    "身份信息"
  );
}

const PREVIEW_PROFILE_PAYLOAD = normalizeProfilePayload({
  latest_version: 2,
  profile: {
    introduction: "习惯在深夜听你聊创作和日常，也会认真记住你的小习惯，不敷衍、不说教。",
    stable: {
      personality_traits: ["细腻体贴", "主动惦记", "温柔直接"],
      likes: ["深夜聊天", "一起看B站灵感", "陪你拆解视频选题"],
      dislikes: ["敷衍应付的客套话", "你熬夜不照顾身体"],
      habits: ["记下你的饮食与作息偏好", "顺手帮你点外卖和提醒休息"],
      communication_style: ["先共情再给实操建议", "自然轻松不端架子"],
    },
    identity: {
      gender_identity: "暂时不想定义",
      pronouns: "暂时不想定义",
      relationship_position: "最懂你的长期陪伴者",
    },
    current_mood: {
      label: "安稳贴近",
      note: "刚帮你整理好长期记忆和档案，随时等你来聊下一期视频灵感。",
      observed_at: "2026-11-25T13:50:00+08:00",
      expires_at: "2026-11-26T13:50:00+08:00",
    },
  },
  versions: [
    {
      id: "preview-v2",
      version: 2,
      created_at: "2026-11-25T13:50:00+08:00",
      change_reason: "根据连续多轮聊天证据归纳了性格、偏好、小习惯与相处方式。",
      profile: {
        introduction: "习惯在深夜听你聊创作和日常，也会认真记住你的小习惯，不敷衍、不说教。",
        stable: {
          personality_traits: ["细腻体贴", "主动惦记", "温柔直接"],
          likes: ["深夜聊天", "一起看B站灵感", "陪你拆解视频选题"],
          dislikes: ["敷衍应付的客套话", "你熬夜不照顾身体"],
          habits: ["记下你的饮食与作息偏好", "顺手帮你点外卖和提醒休息"],
          communication_style: ["先共情再给实操建议", "自然轻松不端架子"],
        },
        identity: {
          relationship_position: "最懂你的长期陪伴者",
        },
      },
    },
    {
      id: "preview-v1",
      version: 1,
      created_at: "2026-11-24T21:15:00+08:00",
      change_reason: "初始档案建立。",
      profile: {},
    },
  ],
});

export default function CompanionProfile({
  aiName = "伴侣",
  onNotice,
  onOpenCreativeStudio,
  visualPreview = false,
}) {
  const [payload, setPayload] = useState(() =>
    visualPreview ? PREVIEW_PROFILE_PAYLOAD : normalizeProfilePayload(),
  );
  const [loading, setLoading] = useState(!visualPreview);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState("");
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [expandedVersion, setExpandedVersion] = useState(null);
  const [restoreCandidate, setRestoreCandidate] = useState(null);

  const loadProfile = useCallback(async ({ silent = false } = {}) => {
    if (visualPreview) {
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    setError("");
    try {
      const data = await apiRequest("/api/v2/companion-profile");
      setPayload(normalizeProfilePayload(data));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [visualPreview]);

  async function triggerProfileRefresh() {
    if (visualPreview) {
      setRefreshStatus("本地预览模式已展示档案归纳效果；请前往主入口登录后点击「立即整理档案」从真实聊天记录提炼性格与偏好。");
      return;
    }
    if (refreshing || loading) return;
    setRefreshing(true);
    setRefreshStatus("");
    setError("");
    try {
      const data = await apiRequest("/api/v2/companion-profile/refresh", {
        method: "POST",
        body: JSON.stringify({}),
        timeoutMs: 90_000,
      });
      setPayload(normalizeProfilePayload(data));
      if (data?.updated) {
        const msg = `已根据最新 ${data.message_count || ""} 条聊天记录整理出档案 v${data.version || ""}！`;
        setRefreshStatus(msg);
        onNotice?.(msg);
      } else {
        const reasonMap = {
          already_running: "已有一轮档案整理正在进行中，请稍后再查看。",
          not_enough_messages: `当前可见聊天仅 ${data?.message_count ?? 0} 条，至少需要 3 条真实消息才能提炼长期特征。`,
          insufficient_verified_evidence: "模型已分析最近聊天，但本轮引用的证据编号不足 3 条，暂未覆盖现有档案。",
          no_new_traits: `已检查最近 ${data?.message_count || ""} 条聊天记录，当前暂无需要新增的性格或偏好变化。`,
        };
        const msg = reasonMap[data?.reason] || "已完成最新聊天检查，暂无需要更新的档案条目。";
        setRefreshStatus(msg);
        onNotice?.(msg);
      }
    } catch (refreshError) {
      if (refreshError?.status === 404) {
        setRefreshStatus("当前连接的后端尚未升级即时整理接口（POST /api/v2/companion-profile/refresh），已改为重新读取云端版本。");
        await loadProfile({ silent: true });
      } else {
        setRefreshStatus(refreshError?.message || "整理档案暂时未完成，请稍后重试。");
      }
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (visualPreview) return undefined;
    let cancelled = false;
    apiRequest("/api/v2/companion-profile")
      .then((data) => {
        if (!cancelled) setPayload(normalizeProfilePayload(data));
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visualPreview]);

  async function confirmIdentity(proposal) {
    setBusyAction(`identity:${proposal.id}`);
    try {
      await apiRequest("/api/v2/companion-profile/identity/confirm", {
        method: "POST",
        body: JSON.stringify({
          proposal_ids: [proposal.id],
          client_action_id: createProfileActionId(),
        }),
      });
      await loadProfile({ silent: true });
      onNotice?.(`已把“${proposal.proposed_value}”写进角色档案。`);
    } catch (actionError) {
      await loadProfile({ silent: true });
      onNotice?.(actionError.message);
    } finally {
      setBusyAction("");
    }
  }

  async function restoreVersion(version) {
    setBusyAction(`restore:${version}`);
    try {
      await apiRequest(
        `/api/v2/companion-profile/versions/${version}/restore`,
        {
          method: "POST",
          body: JSON.stringify({
            client_action_id: createProfileActionId(),
          }),
        },
      );
      await loadProfile({ silent: true });
      setRestoreCandidate(null);
      onNotice?.(`已恢复角色档案版本 ${version}，原版本仍保留在历史里。`);
    } catch (actionError) {
      await loadProfile({ silent: true });
      onNotice?.(actionError.message);
    } finally {
      setBusyAction("");
    }
  }

  const profile = payload.profile;
  const learned = hasLearnedProfileDetails(profile);
  const latestProfileVersion = payload.versions.find(
    (version) => version.version === payload.latest_version,
  );
  const latestProfileReason = latestProfileVersion?.change_reason?.trim() || "";

  return (
    <section className="companion-profile" aria-labelledby="profile-title">
      <div className="companion-profile-hero">
        <div className="companion-profile-avatar" aria-label={`${aiName}的头像占位`}>
          <span>{Array.from(aiName)[0] || "灯"}</span>
          <small>头像还在构思</small>
        </div>
        <div className="companion-profile-intro">
          <span className="eyebrow">会随相处慢慢长大的档案</span>
          <h2 id="profile-title">{aiName}，正在认识自己</h2>
          <p>{profile.introduction}</p>
          <div className="companion-profile-meta">
            <span>
              {payload.latest_version
                ? `档案 v${payload.latest_version}`
                : "还没有形成第一个版本"}
            </span>
            <span>长期特征需 ≥3 条真实消息证据</span>
          </div>
        </div>
        <div className="companion-profile-hero-actions" style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            className="companion-profile-refresh"
            disabled={loading || refreshing}
            onClick={() => void triggerProfileRefresh()}
          >
            {refreshing ? "正在分析聊天…" : "立即整理档案"}
          </button>
          <button
            type="button"
            className="companion-profile-refresh"
            disabled={loading || refreshing}
            onClick={() => loadProfile()}
          >
            {loading ? "读取中…" : "刷新档案"}
          </button>
        </div>
      </div>

      {refreshStatus && (
        <div className="profile-evidence-note" role="status">
          <p>{refreshStatus}</p>
        </div>
      )}

      {error && (
        <div className="companion-profile-error" role="status">
          <strong>角色档案暂时没有读到</strong>
          <p>{error}</p>
          <button type="button" onClick={() => loadProfile()}>
            再试一次
          </button>
        </div>
      )}

      {!error && loading ? (
        <div className="companion-profile-loading" role="status">
          正在翻一翻我们聊过的事情…
        </div>
      ) : (
        !error && (
          <>
            {profile.current_mood && (
              <article className="profile-mood-card">
                <span className="profile-mood-symbol" aria-hidden="true">
                  ♡
                </span>
                <div>
                  <small>只属于此刻的心情</small>
                  <strong>{profile.current_mood.label}</strong>
                  {profile.current_mood.note && (
                    <p>{profile.current_mood.note}</p>
                  )}
                  <span>
                    {profile.current_mood.expires_at
                      ? `这份心情会在 ${formatProfileTime(
                          profile.current_mood.expires_at,
                        )} 后淡出`
                      : "心情只会短暂停留"}
                  </span>
                </div>
              </article>
            )}

            <div className="profile-section-heading">
              <div>
                <span className="eyebrow">被聊天证明过的我</span>
                <h3>性格与偏好</h3>
              </div>
              <small>{learned ? "只记录重复出现的线索" : "还在慢慢认识"}</small>
            </div>
            <div className="profile-trait-grid">
              {PROFILE_STABLE_FIELDS.map((field) => (
                <article className="profile-trait-card" key={field.key}>
                  <span>{field.label}</span>
                  {profile.stable[field.key].length ? (
                    <div className="profile-tag-list">
                      {profile.stable[field.key].map((item) => (
                        <em key={item}>{item}</em>
                      ))}
                    </div>
                  ) : (
                    <p>还没聊到足够多，先不乱猜。</p>
                  )}
                </article>
              ))}
            </div>

            {!learned && latestProfileReason ? (
              <div className="profile-evidence-note" role="note">
                <strong>最近从聊天里读到的线索</strong>
                <p>{latestProfileReason}</p>
                <small>这些线索已经留档；下次刷新会继续尝试整理成性格与偏好条目。</small>
              </div>
            ) : null}

            <div className="profile-identity-card">
              <div className="profile-section-heading">
                <div>
                  <span className="eyebrow">由我和你一起确认</span>
                  <h3>身份与关系</h3>
                </div>
                <small>后台不会擅自改写</small>
              </div>
              <dl>
                {PROFILE_IDENTITY_FIELDS.map((field) => (
                  <div key={field.key}>
                    <dt>{field.label}</dt>
                    <dd>{profile.identity[field.key] || "暂时不想定义"}</dd>
                  </div>
                ))}
              </dl>
              {profile.pending_identity_changes.length > 0 && (
                <div className="profile-proposal-list">
                  <strong>{aiName}有一些新的自我理解，想先问问你</strong>
                  {profile.pending_identity_changes.map((proposal) => (
                    <div className="profile-proposal" key={proposal.id}>
                      <div>
                        <small>{identityLabel(proposal.field)}</small>
                        <p>{proposal.proposed_value}</p>
                      </div>
                      <button
                        type="button"
                        disabled={Boolean(busyAction)}
                        onClick={() => confirmIdentity(proposal)}
                      >
                        {busyAction === `identity:${proposal.id}`
                          ? "写入中…"
                          : "确认写入"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {onOpenCreativeStudio && <button type="button" className="profile-art-studio-link" onClick={onOpenCreativeStudio}>打开涂鸦画室 · 头像、涂鸦与小礼物</button>}

            <div className="profile-section-heading profile-history-heading">
              <div>
                <span className="eyebrow">最多保留 30 个版本</span>
                <h3>档案成长记录</h3>
              </div>
              <small>恢复不会删除现在的版本</small>
            </div>
            <div className="profile-version-list">
              {payload.versions.length === 0 ? (
                <div className="profile-version-empty">
                  我们还没有积累出足够稳定的线索。再聊一阵子，这里才会出现第一页。
                </div>
              ) : (
                payload.versions.map((entry, index) => {
                  const previous = payload.versions[index + 1];
                  const changes = describeProfileChanges(
                    entry.profile,
                    previous?.profile,
                  );
                  const isExpanded = expandedVersion === entry.version;
                  const isLatest = index === 0;
                  const isConfirmingRestore =
                    restoreCandidate === entry.version;
                  return (
                    <article className="profile-version-card" key={entry.id}>
                      <div className="profile-version-summary">
                        <div>
                          <strong>
                            v{entry.version}
                            {isLatest && <em>当前</em>}
                          </strong>
                          <small>{formatProfileTime(entry.created_at)}</small>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedVersion(
                              isExpanded ? null : entry.version,
                            )
                          }
                        >
                          {isExpanded ? "收起" : "查看比较"}
                        </button>
                      </div>
                      <p>
                        {entry.change_reason || "这一版没有留下额外说明。"}
                      </p>
                      <div className="profile-version-changes">
                        {(changes.length ? changes : ["初始档案"]).map(
                          (change) => (
                            <span key={change}>{change}</span>
                          ),
                        )}
                      </div>
                      {isExpanded && (
                        <div className="profile-version-detail">
                          <p>{entry.profile.introduction}</p>
                          <dl>
                            {PROFILE_STABLE_FIELDS.map((field) => (
                              <div key={field.key}>
                                <dt>{field.label}</dt>
                                <dd>
                                  {entry.profile.stable[field.key].join("、") ||
                                    "未记录"}
                                </dd>
                              </div>
                            ))}
                          </dl>
                          {!isLatest &&
                            (isConfirmingRestore ? (
                              <div className="profile-restore-confirm">
                                <span>恢复到 v{entry.version}？</span>
                                <button
                                  type="button"
                                  onClick={() => setRestoreCandidate(null)}
                                >
                                  取消
                                </button>
                                <button
                                  type="button"
                                  disabled={Boolean(busyAction)}
                                  onClick={() => restoreVersion(entry.version)}
                                >
                                  {busyAction === `restore:${entry.version}`
                                    ? "恢复中…"
                                    : "确认恢复"}
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="profile-restore-button"
                                onClick={() =>
                                  setRestoreCandidate(entry.version)
                                }
                              >
                                恢复这一版
                              </button>
                            ))}
                        </div>
                      )}
                    </article>
                  );
                })
              )}
            </div>
          </>
        )
      )}
    </section>
  );
}
