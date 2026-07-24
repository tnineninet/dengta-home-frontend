import { DeviceActionReceipts } from "./McpDeviceCenter";
import { MessageAttachments, ThinkingPanel } from "./ChatMessageExtras";
import { getStickerById } from "./sticker-catalog";
import { formatVoiceConfidence } from "./voice";

const ASSISTANT_AVATAR =
  "/assets/characters/xiaodeng-bear-avatar.jpg";
const USER_AVATAR = "/assets/characters/taotao-cat-avatar.jpg";

export default function ChatMessage({
  item,
  aiName = "小灯",
  userName = "桃桃",
  companionMood = "",
  apiBaseUrl,
  onPreview,
}) {
  const isUser = item.role === "user";
  const displayName = isUser ? userName : aiName;
  const avatar = isUser ? USER_AVATAR : ASSISTANT_AVATAR;
  const sticker = !isUser
    ? getStickerById(item.tool_calls?.sticker_id)
    : null;

  return (
    <article className={`message-row ${isUser ? "user" : "assistant"}`}>
      <img
        className="message-avatar"
        src={avatar}
        alt={`${displayName}的头像`}
        loading="lazy"
      />
      <div className="message-column">
        <div className="message-role">{displayName}</div>
        <div className="message-bubble">
          {item.content && (
            <div className="message-content">{item.content}</div>
          )}
          {sticker && (
            <button
              type="button"
              className="message-sticker"
              aria-label={`查看表情：${sticker.alt}`}
              onClick={() => onPreview?.(sticker.assetPath, sticker.alt)}
            >
              <img src={sticker.assetPath} alt={sticker.alt} loading="lazy" />
            </button>
          )}
          <MessageAttachments
            value={item.attachments || item.files}
            apiBaseUrl={apiBaseUrl}
            onPreview={onPreview}
          />
          {isUser &&
            item.tool_calls?.attachment_instruction_mode === "system" && (
              <div className="attachment-instruction-badge">
                本轮附件已作为系统指令
              </div>
            )}
          {!isUser && (
            <>
              <ThinkingPanel
                key={`${item.id}-${item.isStreaming ? "streaming" : "complete"}`}
                message={item}
                aiName={aiName}
                companionMood={companionMood}
              />
              <DeviceActionReceipts actions={item.tool_calls?.mcp_actions} />
            </>
          )}
          {item.voiceAnalysis && (
            <div className="voice-message-meta">
              <span>语音转写</span>
              <strong>
                {item.voiceAnalysis.emotion} ·{" "}
                {formatVoiceConfidence(item.voiceAnalysis.confidence)}
              </strong>
            </div>
          )}
          {item.isStreaming && (
            <span className="stream-caret" aria-label="正在回复">
              ♥
            </span>
          )}
          <time>{item.formattedTime}</time>
        </div>
      </div>
    </article>
  );
}
