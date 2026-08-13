import { useEffect, useMemo, useState } from "react";
import { AuthenticatedImage } from "./PrivateMedia";
import {
  archivePrivateMediaAsset,
  getPrivateMediaCatalog,
  patchPrivateMediaAsset,
  privateMediaFileWarning,
  updatePrivateMediaPreferences,
  uploadPrivateMediaAsset,
} from "./private-media-api.js";
import {
  normalizePrivateMediaCatalog,
  privateMediaContentPath,
} from "./private-media.js";
const PURPOSES = [
  ["user_avatar", "用户头像", "你的聊天头像"],
  ["companion_avatar", "伴侣头像", "AI 伴侣的聊天头像"],
  ["chat_background", "聊天背景", "只显示在聊天视图"],
];

function preferenceKey(purpose) {
  return `${purpose}_asset_id`;
}

function UploadControl({ purpose, label, busy, onUpload }) {
  const [warning, setWarning] = useState("");
  return (
    <div className="media-upload-control">
      <label className="media-upload-button">
        <span>{busy ? "上传中…" : `上传${label}`}</span>
        <input
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            setWarning(privateMediaFileWarning(file, purpose));
            if (file) void onUpload(file);
            event.target.value = "";
          }}
        />
      </label>
      {warning && <small className="media-file-warning">{warning}</small>}
    </div>
  );
}

function StickerEditor({ asset, busy, onSave, onArchive, onPreview }) {
  const [draft, setDraft] = useState(() => ({
    display_name: asset.display_name,
    alt_text: asset.alt_text,
    mood_tags: asset.mood_tags.join(", "),
  }));
  return (
    <article className="media-sticker-item">
      <AuthenticatedImage
        src={privateMediaContentPath(asset.id)}
        alt={asset.alt_text || asset.display_name || "自定义表情"}
        className="media-sticker-preview"
        buttonClassName="media-preview-button"
        onPreview={onPreview}
      />
      <div className="media-sticker-fields">
        <label>
          显示名称
          <input
            value={draft.display_name}
            onChange={(event) =>
              setDraft((current) => ({ ...current, display_name: event.target.value }))
            }
          />
        </label>
        <label>
          替代文字
          <input
            value={draft.alt_text}
            onChange={(event) =>
              setDraft((current) => ({ ...current, alt_text: event.target.value }))
            }
          />
        </label>
        <label>
          心情标签（逗号分隔）
          <input
            value={draft.mood_tags}
            onChange={(event) =>
              setDraft((current) => ({ ...current, mood_tags: event.target.value }))
            }
          />
        </label>
      </div>
      <div className="media-item-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void onSave(asset.id, {
              display_name: draft.display_name,
              alt_text: draft.alt_text,
              mood_tags: draft.mood_tags
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            })
          }
        >
          保存文字
        </button>
        <button type="button" className="danger" disabled={busy} onClick={() => void onArchive(asset.id)}>
          归档
        </button>
      </div>
    </article>
  );
}

export default function MediaSettings({
  catalog,
  loading,
  error,
  onRefresh,
  onCatalogChange,
  onPreview,
}) {
  const normalized = useMemo(() => normalizePrivateMediaCatalog(catalog), [catalog]);
  const [busy, setBusy] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!catalog && !loading) void onRefresh?.();
  }, [catalog, loading, onRefresh]);

  async function perform(key, action) {
    setBusy(key);
    setLocalError("");
    try {
      await action();
      const fresh = await getPrivateMediaCatalog();
      onCatalogChange?.(fresh);
    } catch (caught) {
      setLocalError(caught?.message || "私密媒体操作失败，请稍后重试。");
    } finally {
      setBusy("");
    }
  }

  function upload(purpose, file) {
    return perform(`upload:${purpose}`, () =>
      uploadPrivateMediaAsset({ image: file, purpose }),
    );
  }

  function choose(purpose, id) {
    return perform(`preference:${purpose}`, () =>
      updatePrivateMediaPreferences({ [preferenceKey(purpose)]: id || null }),
    );
  }

  const stickers = normalized.assets.filter((asset) => asset.purpose === "custom_sticker");
  const feedback = localError || error;

  return (
    <section className="media-settings settings-card" aria-labelledby="media-settings-title">
      <div className="settings-card-heading">
        <div>
          <span className="settings-kicker">PRIVATE MEDIA</span>
          <h3 id="media-settings-title">头像、背景与表情包</h3>
          <p>图片经登录态安全读取，不接受外部图片地址。</p>
        </div>
        <button type="button" className="media-refresh-button" disabled={loading || Boolean(busy)} onClick={() => void onRefresh?.()}>
          {loading ? "读取中…" : "刷新"}
        </button>
      </div>

      {feedback && <div className="media-settings-error" role="alert">{feedback}</div>}

      <div className="media-purpose-grid" aria-busy={loading || Boolean(busy)}>
        {PURPOSES.map(([purpose, label, hint]) => {
          const items = normalized.assets.filter((asset) => asset.purpose === purpose);
          const selectedId = String(normalized.preferences[preferenceKey(purpose)] || "");
          return (
            <section className="media-purpose-card" key={purpose} aria-labelledby={`media-${purpose}`}>
              <div className="media-purpose-heading">
                <div><h4 id={`media-${purpose}`}>{label}</h4><small>{hint}</small></div>
                <UploadControl purpose={purpose} label={label} busy={busy === `upload:${purpose}`} onUpload={(file) => upload(purpose, file)} />
              </div>
              {items.length ? (
                <div className="media-choice-list">
                  {items.map((asset) => {
                    const alt =
                      asset.alt_text || asset.display_name || label;
                    return (
                      <article
                        className={`media-choice${
                          selectedId === asset.id ? " selected" : ""
                        }`}
                        key={asset.id}
                      >
                        <AuthenticatedImage
                          src={privateMediaContentPath(asset.id)}
                          alt={alt}
                          className="media-choice-image"
                          buttonClassName="media-choice-preview"
                          onPreview={onPreview}
                        />
                        <span title={asset.display_name || label}>
                          {asset.display_name || label}
                        </span>
                        <button
                          type="button"
                          className="media-choice-enable"
                          aria-pressed={selectedId === asset.id}
                          disabled={Boolean(busy) || selectedId === asset.id}
                          onClick={() => void choose(purpose, asset.id)}
                        >
                          {selectedId === asset.id ? "使用中" : "启用"}
                        </button>
                      </article>
                    );
                  })}
                  {selectedId && <button type="button" className="media-clear-button" disabled={Boolean(busy)} onClick={() => void choose(purpose, null)}>清除当前{label}</button>}
                </div>
              ) : (
                <p className="media-empty-state">还没有上传{label}。</p>
              )}
            </section>
          );
        })}
      </div>

      <section className="media-sticker-section" aria-labelledby="media-stickers-title">
        <div className="media-purpose-heading">
          <div><h4 id="media-stickers-title">自定义表情包</h4><small>名称与替代文字仅用于显示，不在前端做内容词过滤。</small></div>
          <UploadControl purpose="custom_sticker" label="表情" busy={busy === "upload:custom_sticker"} onUpload={(file) => upload("custom_sticker", file)} />
        </div>
        {stickers.length ? (
          <div className="media-sticker-list">
            {stickers.map((asset) => (
              <StickerEditor
                key={asset.id}
                asset={asset}
                busy={Boolean(busy)}
                onPreview={onPreview}
                onSave={(id, changes) => perform(`patch:${id}`, () => patchPrivateMediaAsset(id, changes))}
                onArchive={(id) => perform(`archive:${id}`, () => archivePrivateMediaAsset(id))}
              />
            ))}
          </div>
        ) : <p className="media-empty-state">还没有自定义表情，上传后可编辑显示文字与心情标签。</p>}
      </section>
    </section>
  );
}
