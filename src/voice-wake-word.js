/**
 * Siri-like Voice Wake Word Detector for DengTa (灯塔).
 *
 * Supports:
 *   1. One-breath commands: "嗨灯塔，帮我看看我今天穿得怎么样" -> { matched: true, command: "帮我看看我今天穿得怎么样" }
 *   2. Wake-only triggers:  "灯塔" / "Hey DengTa" / "<aiName>" -> { matched: true, command: "" } (opens active listening window)
 *   3. Natural Chinese/English fuzzy aliases (灯塔 / 嗨灯塔 / 嘿灯塔 / 小灯塔 / 呼叫灯塔 / dengta / hey dengta / hi dengta / custom aiName)
 */

const DEFAULT_WAKE_ALIASES = [
  "嗨灯塔",
  "嘿灯塔",
  "喂灯塔",
  "呼叫灯塔",
  "叫醒灯塔",
  "你好灯塔",
  "小灯塔",
  "灯塔",
  "hey dengta",
  "hi dengta",
  "hello dengta",
  "ok dengta",
  "dengta",
  "hey deng ta",
  "deng ta",
];

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildWakeAliases(aiName = "") {
  const custom = String(aiName || "").trim();
  const list = [...DEFAULT_WAKE_ALIASES];
  if (custom && custom.length >= 2 && custom.length <= 16) {
    list.unshift(`嗨${custom}`, `嘿${custom}`, `你好${custom}`, custom);
  }
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
}

/**
 * Parse a transcript against wake-word triggers.
 * @returns {{ matched: boolean, wakePhrase: string, command: string }}
 */
export function parseWakeWordTranscript(rawText, { aiName = "" } = {}) {
  const text = String(rawText || "").replace(/\s+/g, " ").trim();
  if (!text) return { matched: false, wakePhrase: "", command: "" };

  const aliases = buildWakeAliases(aiName);
  const pattern = new RegExp(
    `(?:^|[\\s，,。！？!?.、~～]+)(${aliases.map(escapeRegex).join("|")})(?:[\\s，,。！？!?.、~～：:]+|$)`,
    "i",
  );
  const match = pattern.exec(text);
  if (!match) {
    return { matched: false, wakePhrase: "", command: "" };
  }
  const wakePhrase = match[1] || "";
  const afterIndex = match.index + match[0].length;
  const trailing = text.slice(afterIndex).replace(/^[\s，,。！？!?.、~～：:]+/, "").trim();
  const leading = text.slice(0, match.index).replace(/[\s，,。！？!?.、~～：:]+$/, "").trim();
  const command = trailing || (leading.length >= 4 ? leading : "");
  return { matched: true, wakePhrase, command };
}

/**
 * Subtle pleasant 2-tone Web Audio wake chime (Siri-like confirmation).
 * Strictly optional; never throws if AudioContext is unavailable or locked.
 */
export function playWakeChime() {
  try {
    const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const playTone = (freq, start, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.08, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    };
    playTone(587.33, now, 0.11); // D5
    playTone(880.0, now + 0.09, 0.16); // A5
    window.setTimeout(() => {
      try {
        void ctx.close?.();
      } catch {
        // Ignore.
      }
    }, 500);
  } catch {
    // Ignore audio context errors on locked tabs.
  }
}
