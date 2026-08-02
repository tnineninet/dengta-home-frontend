export const PERSONA_RESET_MARKER_KEY = "dengta_persona_reset_seen_v1";

export const PERSONA_LOCAL_STORAGE_KEYS = Object.freeze([
  "dengta_companion_status_v1",
  "dengta_companion_interactions_v1",
  "dengta_intimate_duel_v2",
  "dengta_message_references_v1",
  "dengta_prompt_receipt_v1",
  "dengta_push_cursor",
  "dengta_push_seen_ids",
]);

export function applyPersonaResetToLocalStorage(
  resetAt,
  storage = globalThis.localStorage,
) {
  const marker = String(resetAt || "").trim();
  if (!marker || !storage) return false;
  if (storage.getItem(PERSONA_RESET_MARKER_KEY) === marker) return false;

  for (const key of PERSONA_LOCAL_STORAGE_KEYS) storage.removeItem(key);
  storage.setItem(PERSONA_RESET_MARKER_KEY, marker);
  return true;
}
