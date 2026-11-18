import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { assertPrivatePhotoActive, preparePrivatePhoto } from "../src/private-photo.js";
import {
  archivePrivateMediaAsset,
  getPrivateMediaCatalog,
  patchPrivateMediaAsset,
  privateMediaFileWarning,
  updatePrivateMediaPreferences,
  uploadPrivateMediaAsset,
} from "../src/private-media-api.js";
import {
  normalizePrivateMediaCatalog,
  privateMediaAsset,
  privateMediaContentPath,
  privateMediaPreferenceId,
  privateMediaRequestPath,
  selectedPrivateMedia,
} from "../src/private-media.js";

const UUIDS = {
  user: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  companion: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  background: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  sticker: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
};

test("initial media selection works without Object.hasOwn on iOS 15.0 and explicit reset wins over aliases", t => {
  const original = Object.getOwnPropertyDescriptor(Object, "hasOwn");
  Object.defineProperty(Object, "hasOwn", { configurable: true, value: undefined });
  t.after(() => Object.defineProperty(Object, "hasOwn", original));
  assert.equal(selectedPrivateMedia(null, "user_avatar"), null);
  assert.equal(privateMediaPreferenceId(null, "user_avatar"), "");
  assert.equal(privateMediaPreferenceId({ user_avatar: null, user_avatar_asset_id: UUIDS.user }, "user_avatar"), "");
  assert.equal(privateMediaPreferenceId({ user_avatar_asset_id: UUIDS.user }, "user_avatar"), UUIDS.user);
});

test("static Photos imports tolerate older abort signals, retain PNG bytes and reject mislabeled or animated sources", async () => {
  const legacy = { aborted: false }; // no AbortSignal.throwIfAborted or .reason on early iOS 15.
  const pixels = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWMQier5DwADegH6AMv25AAAAABJRU5ErkJggg==", "base64");
  const png = new File([pixels], "synthetic.png", { type: "image/png" });
  assert.equal(await preparePrivatePhoto(png, "user_avatar", legacy), png);
  const fromFiles = await preparePrivatePhoto(new File([pixels], "synthetic.png"), "chat_background", legacy);
  assert.equal(fromFiles.type, "image/png");
  assert.deepEqual(Buffer.from(await fromFiles.arrayBuffer()), pixels);
  assert.throws(() => assertPrivatePhotoActive({ aborted: true }), { name: "AbortError" });
  for (const type of ["image/heic-sequence", "image/heif-sequence"]) {
    await assert.rejects(preparePrivatePhoto(new File(["synthetic"], "burst.heic", { type }), "user_avatar"), /静态.*JPEG/);
  }
  await assert.rejects(preparePrivatePhoto(new File([pixels], "renamed.heic", { type: "image/heic" }), "companion_avatar"), /HEIC.*JPEG/);
});

test("HEIC decoder failure releases its object URL and offers a usable fallback", async t => {
  const header = new Uint8Array([0, 0, 0, 20, ...Buffer.from("ftypheic"), 0, 0, 0, 0, ...Buffer.from("mif1")]);
  const input = new File([header], "test.heic", { type: "image/heic" });
  const previously = globalThis.Image;
  const source = "blob:synthetic-photo";
  t.mock.method(URL, "createObjectURL", () => source);
  const revoke = t.mock.method(URL, "revokeObjectURL", () => {});
  globalThis.Image = class {
    decode() { return Promise.reject(new Error("codec unavailable")); }
    removeAttribute(attribute) { assert.equal(attribute, "src"); }
  };
  try {
    await assert.rejects(preparePrivatePhoto(input, "user_avatar"), /HEIC.*JPEG/);
    assert.deepEqual(revoke.mock.calls[0].arguments, [source]);
  } finally {
    if (previously === undefined) delete globalThis.Image;
    else globalThis.Image = previously;
  }
});

test("private media upload uses apiFetch with browser-managed FormData headers", async () => {
  let request;
  const image = new Blob(["image"], { type: "image/png" });
  await uploadPrivateMediaAsset(
    {
      image,
      purpose: "custom_sticker",
      displayName: "成人/情色名称",
      altText: "成人/情色替代文字",
      moodTags: ["亲密", "开心"],
    },
    {
      async apiFetch(path, options) {
        request = { path, options };
        return new Response(JSON.stringify({ id: UUIDS.sticker }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  );

  assert.equal(request.path, "/api/v2/private-media/assets");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers, undefined, "不得手工设置 multipart Content-Type");
  assert.ok(request.options.body instanceof FormData);
  const sentFile = request.options.body.get("file");
  assert.ok(sentFile instanceof Blob, "二进制必须使用后端约定的 file 字段");
  assert.equal(sentFile.size, image.size);
  assert.equal(sentFile.type, image.type);
  assert.equal(request.options.body.get("purpose"), "custom_sticker");
  assert.equal(request.options.body.get("display_name"), "成人/情色名称");
  assert.equal(request.options.body.get("alt_text"), "成人/情色替代文字");
  assert.equal(request.options.body.get("mood_tags"), "亲密,开心");
});

test("private media API wrappers preserve endpoint methods and JSON bodies", async () => {
  const calls = [];
  const client = {
    async apiRequest(path, options = {}) {
      calls.push([path, options]);
      return { ok: true };
    },
  };
  await getPrivateMediaCatalog(client);
  await updatePrivateMediaPreferences({ user_avatar_asset_id: UUIDS.user }, client);
  await updatePrivateMediaPreferences({ chat_background_asset_id: null }, client);
  await patchPrivateMediaAsset(UUIDS.sticker, { display_name: "新名字" }, client);
  await archivePrivateMediaAsset(UUIDS.sticker, client);

  assert.deepEqual(calls, [
    ["/api/v2/private-media/catalog", {}],
    ["/api/v2/private-media/preferences", { method: "PUT", body: JSON.stringify({ purpose: "user_avatar", asset_id: UUIDS.user }) }],
    ["/api/v2/private-media/preferences", { method: "PUT", body: JSON.stringify({ purpose: "chat_background", asset_id: null }) }],
    [`/api/v2/private-media/assets/${UUIDS.sticker}`, { method: "PATCH", body: JSON.stringify({ display_name: "新名字" }) }],
    [`/api/v2/private-media/assets/${UUIDS.sticker}`, { method: "DELETE" }],
  ]);

  assert.deepEqual(await updatePrivateMediaPreferences({}, client), { ok: true, preferences: [] }, "空偏好不得产生请求");
  assert.throws(
    () => patchPrivateMediaAsset("../outside", {}, client),
    /ID 无效/,
  );
  assert.throws(
    () => archivePrivateMediaAsset("not-a-uuid", client),
    /ID 无效/,
  );
  assert.equal(calls.length, 5, "非法 UUID 不得产生编辑或归档请求");
  await archivePrivateMediaAsset(UUIDS.sticker, true, client);
  assert.equal(calls.at(-1)[0], `/api/v2/private-media/assets/${UUIDS.sticker}?permanent=true`);
  await archivePrivateMediaAsset(UUIDS.sticker, "true", client);
  assert.equal(calls.at(-1)[0], `/api/v2/private-media/assets/${UUIDS.sticker}`, "只有明确布尔 true 可以请求永久删除");
});

test("size guidance warns at 5/12 MB without blocking submission", () => {
  assert.equal(privateMediaFileWarning({ size: 5 * 1024 * 1024 }, "user_avatar"), "");
  assert.match(privateMediaFileWarning({ size: 5 * 1024 * 1024 + 1 }, "custom_sticker"), /5 MB.*后端/);
  assert.equal(privateMediaFileWarning({ size: 12 * 1024 * 1024 }, "chat_background"), "");
  assert.match(privateMediaFileWarning({ size: 12 * 1024 * 1024 + 1 }, "chat_background"), /12 MB.*后端/);
});

test("catalog selects safe avatars/background and keeps display text verbatim", () => {
  const catalog = normalizePrivateMediaCatalog({
    assets: [
      { id: UUIDS.user, purpose: "user_avatar", display_name: "我的头像" },
      { id: UUIDS.companion, purpose: "companion_avatar" },
      { id: UUIDS.background, purpose: "chat_background" },
      { id: UUIDS.sticker, purpose: "custom_sticker", display_name: "成人/情色名称", alt_text: "成人/情色替代文字" },
      { id: "not-a-uuid", purpose: "custom_sticker" },
    ],
    preferences: {
      user_avatar_asset_id: UUIDS.user,
      companion_avatar_asset_id: UUIDS.companion,
      chat_background_asset_id: UUIDS.background,
    },
  });

  assert.equal(catalog.assets.length, 4, "非法 UUID 资源必须在产生请求前剔除");
  assert.equal(selectedPrivateMedia(catalog, "user_avatar").id, UUIDS.user);
  assert.equal(selectedPrivateMedia(catalog, "companion_avatar").id, UUIDS.companion);
  assert.equal(selectedPrivateMedia(catalog, "chat_background").id, UUIDS.background);
  const sticker = privateMediaAsset(catalog, UUIDS.sticker, "custom_sticker");
  assert.equal(sticker.display_name, "成人/情色名称");
  assert.equal(sticker.alt_text, "成人/情色替代文字");
});

test("catalog treats the pre-fetch null state as an empty safe catalog", () => {
  assert.deepEqual(normalizePrivateMediaCatalog(null), {
    assets: [],
    preferences: {},
  });
  assert.equal(selectedPrivateMedia(null, "user_avatar"), null);
});

test("content whitelist accepts only valid UUID assets on the API origin", () => {
  const path = `/api/v2/private-media/assets/${UUIDS.sticker}/content`;
  assert.equal(privateMediaContentPath(UUIDS.sticker), path);
  assert.equal(privateMediaContentPath("../outside"), "");
  assert.equal(privateMediaRequestPath(path, "https://api.example.test"), path);
  assert.equal(privateMediaRequestPath("/api/v2/private-media/assets/not-a-uuid/content", "https://api.example.test"), "");
  assert.equal(privateMediaRequestPath(`https://evil.example/${path}`, "https://api.example.test"), "");
});

test("chat and settings integration retain fallbacks, custom stickers, and chat-only background", () => {
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const message = fs.readFileSync(new URL("../src/ChatMessage.jsx", import.meta.url), "utf8");
  const mediaSettings = fs.readFileSync(new URL("../src/MediaSettings.jsx", import.meta.url), "utf8");
  const background = fs.readFileSync(new URL("../src/ChatBackground.jsx", import.meta.url), "utf8");

  assert.match(message, /custom_sticker_id/);
  assert.match(message, /fallback=\{/);
  assert.match(
    message,
    /isUser\s*\?\s*Array\.from\(userName \|\| "我"\)\[0\] \|\| "我"\s*:\s*Array\.from\(aiName \|\| "伴"\)\[0\] \|\| "伴"/,
    "avatar letter must use the personalized user/companion name first char",
  );
  assert.match(message, /tool_calls\?\.sticker_id/, "内置表情支持必须保留");
  assert.match(app, /function renderChat\(\)[\s\S]*?<ChatBackground src=\{chatBackground\}/);
  assert.doesNotMatch(app, /renderSettings\(\)[\s\S]{0,500}<ChatBackground/);
  assert.match(app, /settingsCategory === "appearance"[\s\S]*?<MediaSettings/);
  assert.match(mediaSettings, /头像、背景与表情包/);
  assert.match(background, /if \(!media\.url\) return null/, "背景失败不得阻塞聊天内容");
});
