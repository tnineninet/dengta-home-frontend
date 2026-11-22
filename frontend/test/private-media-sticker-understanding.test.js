import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { describePrivateSticker } from "../src/private-media-api.js";

const ASSET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("sticker understanding sends only the scoped asset bytes to vision", async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  let request = null;
  const description = await describePrivateSticker(ASSET, {
    client: {
      apiFetch: async (path, options) => {
        assert.equal(path, `/api/v2/private-media/assets/${ASSET}/content`);
        assert.equal(options.retry, false);
        return new Response(bytes, { status: 200, headers: { "Content-Type": "image/png" } });
      },
      apiRequest: async (path, options) => {
        request = { path, options, body: JSON.parse(options.body) };
        return { description: "一只抱着枕头打瞌睡的熊，适合表达困倦和晚安。" };
      },
    },
  });
  assert.equal(description, "一只抱着枕头打瞌睡的熊，适合表达困倦和晚安。");
  assert.equal(request.path, "/api/v2/vision/describe");
  assert.equal(request.body.mime_type, "image/png");
  assert.deepEqual([...Buffer.from(request.body.image_base64, "base64")], [...bytes]);
});

test("sticker understanding rejects invalid targets and unusable responses", async () => {
  await assert.rejects(describePrivateSticker("not-an-asset"), { name: "TypeError" });
  await assert.rejects(
    describePrivateSticker(ASSET, {
      client: {
        apiFetch: async () => new Response("", { status: 404 }),
        apiRequest: async () => ({ description: "" }),
      },
    }),
    /读取失败/,
  );
  await assert.rejects(
    describePrivateSticker(ASSET, {
      client: {
        apiFetch: async () => new Response(new Uint8Array([1]), { status: 200 }),
        apiRequest: async () => ({ description: "" }),
      },
    }),
    /没有返回可用的表情描述/,
  );
});
