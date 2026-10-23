import { memo } from "react";
import ChatMessage from "./ChatMessage.jsx";
import { getMessageSkinPresentation } from "./chat-skin.js";
import { innerMonologueForMessage, visibleMonologueForMessage } from "./inner-monologue.js";
import { useLatestCallback } from "./use-latest-callback.js";

const Entry = memo(function Entry({ item, previousRole, nextRole, preferences, monologueRecord, ...props }) {
  const neighbors = [previousRole === undefined ? undefined : {role:previousRole}, item,
    nextRole === undefined ? undefined : {role:nextRole}];
  const visible = visibleMonologueForMessage(item);
  const cached = innerMonologueForMessage({[item.id]:monologueRecord},item.id);
  const incomplete = !visible || !String(visible.text || "").trim() ||
    ["missing", "failed", "truncated"].includes(visible.state) || visible.display_truncated;
  const supplemented = cached?.generated_with_reply === false && cached?.state === "complete";
  const monologue = supplemented && incomplete ? cached
    : visible?.text ? visible : cached || visible;
  return <ChatMessage {...props} item={item} skin={preferences.skin} reduceMotion={preferences.reduceMotion === true}
    skinPresentation={getMessageSkinPresentation(neighbors,1,preferences)} innerMonologue={monologue} />;
});

function hasVisibleAssistantContent(item) {
  if (item?.role !== "assistant") return true;
  if (item.chatError === true) return true;
  if (item.tool_calls?.refusal_detected) return true;
  if (String(item.content || "").trim()) return true;
  if (Array.isArray(item.attachments) && item.attachments.length > 0) return true;
  if (Array.isArray(item.files) && item.files.length > 0) return true;
  const toolCalls = item.tool_calls || {};
  return Boolean(
    toolCalls.sticker_id ||
    toolCalls.custom_sticker_id ||
    toolCalls.artwork_id ||
    toolCalls.music_card ||
    (Array.isArray(toolCalls.activity_actions) && toolCalls.activity_actions.length) ||
    (Array.isArray(toolCalls.mcp_actions) && toolCalls.mcp_actions.length)
  );
}

export default function ChatTranscript({ messages, preferences, innerMonologues, innerMonologuePending,
  innerMonologueErrors, onPreview, onReference, onDismissError, onOpenActivity, onRequestInnerMonologue, onCancelInnerMonologue, hideProcess = false, ...props }) {
  const preview = useLatestCallback(onPreview), reference = useLatestCallback(onReference);
  const dismiss = useLatestCallback(onDismissError), activity = useLatestCallback(onOpenActivity);
  const requestMonologue = useLatestCallback(onRequestInnerMonologue);
  const cancelMonologue = useLatestCallback(onCancelInnerMonologue);
  const visibleMessages = hideProcess
    ? (Array.isArray(messages) ? messages : []).filter(hasVisibleAssistantContent)
    : (Array.isArray(messages) ? messages : []);
  return visibleMessages.map((item,index)=><Entry key={item.renderKey ?? item.id} {...props} item={item}
    hideProcess={hideProcess} showErrorDetails={props.showErrorDetails === true}
    previousRole={visibleMessages[index-1]?.role} nextRole={visibleMessages[index+1]?.role} preferences={preferences}
    monologueRecord={innerMonologues?.[item.id]} innerMonologuePending={innerMonologuePending?.[item.id]===true}
    innerMonologueError={innerMonologueErrors?.[item.id] || ""} onPreview={preview} onReference={reference}
    onDismissError={dismiss} onOpenActivity={activity} onRequestInnerMonologue={requestMonologue}
    onCancelInnerMonologue={typeof onCancelInnerMonologue === "function" ? cancelMonologue : undefined} />);
}
