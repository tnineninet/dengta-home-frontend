import { hydrateStoredThinkingTrace } from "./chat-thinking.js";
import { hydrateStoredVoiceAnalysis } from "./voice.js";

export function hydrateChatMessage(message = {}) {
  return hydrateStoredThinkingTrace(hydrateStoredVoiceAnalysis(message));
}

export function hydrateChatHistory(messages = []) {
  return Array.isArray(messages)
    ? messages.map((message) => hydrateChatMessage(message))
    : [];
}
