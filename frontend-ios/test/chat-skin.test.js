import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { loadEntrypointCssCascade } from "./helpers/effective-css.js";
import {
  DEFAULT_CHAT_SKIN_PREFERENCES,
  chatSkinPreferencesApiPayload,
  getMessageSkinPresentation,
  normalizeChatSkinPreferences,
  readStoredChatSkinPreferences,
  writeStoredChatSkinPreferences,
} from "../src/chat-skin.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test("new accounts default to the cream skin while saved choices stay untouched", () => {
  assert.equal(DEFAULT_CHAT_SKIN_PREFERENCES.skin, "taotao-cream");
  assert.equal(normalizeChatSkinPreferences({}).skin, "taotao-cream");
  assert.equal(
    normalizeChatSkinPreferences({ skin: "classic-glass" }).skin,
    "classic-glass",
    "an explicitly saved classic-glass preference must not be replaced by the default",
  );

  const storage = memoryStorage();
  // 新账号没有本地记录：首屏就应按老账号同款奶油皮肤渲染，而不是先闪 classic-glass。
  assert.equal(
    readStoredChatSkinPreferences(storage, "new-account").skin,
    "taotao-cream",
  );
  // 老账号已保存 classic-glass 时，新默认值不得覆盖它。
  writeStoredChatSkinPreferences({ skin: "classic-glass" }, storage, "old-account");
  assert.equal(
    readStoredChatSkinPreferences(storage, "old-account").skin,
    "classic-glass",
  );
  assert.equal(
    readStoredChatSkinPreferences(storage, "new-account").skin,
    "taotao-cream",
  );
});

test("chat skin preferences keep only supported user-facing choices", () => {
  assert.deepEqual(
    normalizeChatSkinPreferences({
      skin: "taotao-cream",
      ornamentActivity: "lively",
      dynamicComposerHint: false,
      reduceMotion: true,
      unexpected: "ignored",
    }),
    {
      skin: "taotao-cream",
      ornamentActivity: "lively",
      dynamicComposerHint: false,
      reduceMotion: true,
      hideGenerationProcess: true,
      showErrorDetails: false,
    },
  );

  assert.deepEqual(
    normalizeChatSkinPreferences({
      skin: "unknown",
      ornamentActivity: "constant",
      dynamicComposerHint: "yes",
      reduceMotion: 1,
    }),
    DEFAULT_CHAT_SKIN_PREFERENCES,
  );
});

test("chat skin preferences convert between API and React field names", () => {
  assert.deepEqual(
    normalizeChatSkinPreferences({
      skin: "taotao-cream",
      ornament_activity: "quiet",
      dynamic_composer_hint: false,
      reduce_motion: true,
    }),
    {
      skin: "taotao-cream",
      ornamentActivity: "quiet",
      dynamicComposerHint: false,
      reduceMotion: true,
      hideGenerationProcess: true,
      showErrorDetails: false,
    },
  );
  assert.deepEqual(
    chatSkinPreferencesApiPayload({
      skin: "taotao-cream",
      ornamentActivity: "lively",
      dynamicComposerHint: true,
      reduceMotion: false,
    }),
    {
      skin: "taotao-cream",
      ornament_activity: "lively",
      dynamic_composer_hint: true,
      reduce_motion: false,
      hide_generation_process: true,
      show_error_details: false,
    },
  );
});

test("cream skin ornaments appear only at the start of a text message group", () => {
  const messages = [
    { id: "a1", role: "assistant", content: "第一句" },
    { id: "a2", role: "assistant", content: "接着说" },
    { id: "u1", role: "user", content: "好呀" },
    {
      id: "a3",
      role: "assistant",
      content: "",
      tool_calls: { sticker_id: "sleepy" },
    },
  ];

  assert.deepEqual(
    messages.map((_, index) =>
      getMessageSkinPresentation(messages, index, {
        skin: "taotao-cream",
        ornamentActivity: "natural",
      }),
    ),
    [
      { groupStart: true, groupEnd: false, showOrnament: true },
      { groupStart: false, groupEnd: true, showOrnament: false },
      { groupStart: true, groupEnd: true, showOrnament: true },
      { groupStart: true, groupEnd: true, showOrnament: false },
    ],
  );

  assert.equal(
    getMessageSkinPresentation(messages, 0, {
      skin: "taotao-cream",
      ornamentActivity: "quiet",
    }).showOrnament,
    false,
  );
  assert.equal(
    getMessageSkinPresentation(messages, 0, {
      skin: "classic-glass",
      ornamentActivity: "lively",
    }).showOrnament,
    false,
  );
});

test("the cream skin keeps local font, role-specific ornaments and reduced-motion fallback", () => {
  const css = fs.readFileSync(new URL("../src/native-feel.css", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const ornament = fs.readFileSync(
    new URL("../src/ChatSkinOrnament.jsx", import.meta.url),
    "utf8",
  );
  const fontLicense = fs.readFileSync(
    new URL("../public/fonts/OFL-ChillRound.txt", import.meta.url),
    "utf8",
  );
  assert.match(css, /ChillRoundF-v3\.0\.ttf/);
  assert.match(css, /data-chat-skin="taotao-cream"/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(app, /<ChatTranscript/);
  assert.match(fs.readFileSync(new URL("../src/ChatTranscript.jsx",import.meta.url),"utf8"), /getMessageSkinPresentation/);
  assert.match(app, /placeholder=\{[\s\S]*?composerHint/);
  assert.match(ornament, /isUser \? "is-cat" : "is-bear"/);
  assert.ok(
    (ornament.match(/className="ornament-ear"/g) || []).length >= 2,
    "the assistant's default bear must have two round ears",
  );
  assert.match(fontLicense, /SIL Open Font License, Version 1\.1/);
});

test("cream ornaments stay clear of the previous bubble and remain recognizable", () => {
  const cascade = loadEntrypointCssCascade(
    new URL("../src/main.jsx", import.meta.url),
    { width: 390, height: 844, reducedMotion: false },
  );
  const baseMessage = cascade.declarations(
    '.app-shell[data-chat-skin="taotao-cream"] .chat-skin-cream-message',
  );
  const groupStart = cascade.declarations(
    '.app-shell[data-chat-skin="taotao-cream"] .chat-skin-cream-message.group-start',
  );
  const ornament = cascade.declarations(
    '.app-shell[data-chat-skin="taotao-cream"] .chat-skin-ornament',
  );
  const pixels = (declaration) => Number.parseFloat(declaration?.value || "NaN");
  const previousBottomMargin = pixels(baseMessage["margin-block"]);
  const reservedTopSpace = pixels(groupStart["padding-top"]);
  const ornamentOffset = Math.abs(pixels(ornament.top));
  const ornamentHeight = pixels(ornament.height);

  assert.ok(
    reservedTopSpace >= ornamentOffset,
    "the ornament must stay inside the message row's paint-contained area",
  );
  assert.ok(
    previousBottomMargin * 2 + reservedTopSpace - ornamentOffset >= 0,
    "an ornament must not overlap the preceding message bubble",
  );
  assert.ok(
    ornamentOffset / ornamentHeight >= 0.8,
    "at least 80% of the character must sit above the bubble edge",
  );
});

test("the composer uses the motion crop from the supplied iridescent reference", () => {
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const mark = fs.readFileSync(
    new URL("../src/RainbowAgentMark.jsx", import.meta.url),
    "utf8",
  );
  const css = fs.readFileSync(
    new URL("../src/sun-glass-ui.css", import.meta.url),
    "utf8",
  );

  assert.match(app, /<RainbowAgentMark\s*\/>/);
  assert.match(mark, /\/assets\/rainbow-agent-mark\.webp/);
  assert.match(mark, /rainbow-agent-mark-reference/);
  assert.match(mark, /rainbow-agent-mark-glint/);
  assert.match(css, /direct circular crop of the supplied reference video/);
  assert.match(css, /\.rainbow-agent-mark-reference\s*\{/);
  assert.ok(
    fs.existsSync(
      new URL("../public/assets/rainbow-agent-mark.webp", import.meta.url),
    ),
    "the reference motion asset must ship with the production bundle",
  );
});
