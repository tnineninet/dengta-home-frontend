import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true, hmr: false } });
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const letter = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "虚构信件", place_label: "虚构公园", area: { latitude: 0.001, longitude: 0.002, radius_m: 300 } };
const position = () => ({ latitude: 0, longitude: 0, accuracy: 10, captured_at: new Date().toISOString() });
const receipt = (letters = [], next = null) => ({ ok: true, letters, page: { has_more: next !== null, next_offset: next } });
let tree;
try {
  const { SurpriseMapContent } = await vite.ssrLoadModule("/src/SurpriseMap.jsx");
  const { default: SurpriseLetterMap } = await vite.ssrLoadModule("/src/SurpriseLetterMap.jsx");
  const { appBackLayers } = await vite.ssrLoadModule("/src/app-back-navigation.js");
  const button = label => tree.root.findAllByType("button").find(node => text(node) === label || node.props["aria-label"] === label);
  const click = async label => { const item = button(label); assert.ok(item, `button: ${label}`); await act(async () => item.props.onClick()); };
  const submit = async (label = "藏一封新信") => { await act(async () => tree.root.findByProps({ "aria-label": label }).props.onSubmit({ preventDefault() {} })); };
  const mount = async props => { await act(async () => { tree = TestRenderer.create(React.createElement(SurpriseMapContent, { aiName: "小灯", isCurrent: () => true, ...props })); }); };
  const unmount = async () => { await act(async () => tree.unmount()); tree = null; };
  const startDraft = async () => { await click("让伴侣留一封"); await submit(); };
  const write = async (title = "FICTIONAL_TITLE", body = "FICTIONAL_BODY") => {
    await act(async () => tree.root.findAllByType("input").find(node => node.props.required).props.onChange({ target: { value: title } }));
    await act(async () => tree.root.findByType("textarea").props.onChange({ target: { value: body } }));
  };
  await test("post office first screen loads only its own view, never location or model; compose stays tucked away", async () => {
    const paths = []; let locations = 0;
    await mount({ request: async path => { paths.push(path); return receipt([letter]); }, locatePosition: async () => { locations++; } });
    assert.deepEqual(paths, ["/api/v2/surprise-map/letters"]); assert.equal(locations, 0);
    assert.ok(button("走近了，打开信")); assert.ok(button("私人来信").props["aria-pressed"]);
    assert.equal(tree.root.findAllByType("form").length, 0); assert.match(text(tree.toJSON()), /灯塔邮局.*把惊喜留在某个地方/);
    assert.match(text(tree.toJSON()), /定位仅在你点击时进行/); await unmount();
  });
  await test("independent public failure has a retry, never erases private letters or masquerades as an empty map", async () => {
    let publicCalls = 0;
    await mount({ request: async path => { if (path.includes("/public?")) { publicCalls++; if (publicCalls === 1) throw Object.assign(Error("PRIVATE_ERROR"), { code: "request_timeout" }); return receipt([]); } return receipt([letter]); } });
    await click("公共惊喜"); assert.ok(button("重新加载此页")); assert.doesNotMatch(text(tree.toJSON()), /PRIVATE_ERROR|这片风景，还在等第一封信/);
    await click("重新加载此页"); assert.equal(publicCalls, 2); assert.match(text(tree.toJSON()), /这片风景，还在等第一封信/);
    await click("私人来信"); assert.match(text(tree.toJSON()), /虚构信件/); await unmount();
  });
  await test("loading and empty have different content; stale list receipts cannot replace a newer refresh", async () => {
    const old = deferred(), fresh = deferred(); let calls = 0;
    await mount({ request: () => (++calls === 1 ? old.promise : fresh.promise) });
    assert.match(text(tree.toJSON()), /正在整理沿途的来信/); assert.doesNotMatch(text(tree.toJSON()), /下一封惊喜，等你开始/);
    await click("公共惊喜"); await act(async () => fresh.resolve(receipt([])));
    await click("私人来信"); await act(async () => old.resolve(receipt([letter])));
    assert.doesNotMatch(text(tree.toJSON()), /虚构信件/); assert.match(text(tree.toJSON()), /下一封惊喜，等你开始/); await unmount();
  });
  await test("three-step AI writing is separate from geolocation, saving and publishing", async () => {
    const calls = []; let locations = 0;
    await mount({ request: async (path, options) => { calls.push({ path, options }); return path.endsWith("/draft") ? { draft: { title: "虚构标题", body: "虚构正文" } } : receipt(); }, locatePosition: async () => { locations++; } });
    await startDraft(); await click("请小灯写一封");
    assert.equal(locations, 0); assert.equal(calls.filter(call => call.options?.method === "POST").length, 1);
    assert.equal(calls.at(-1).path, "/api/v2/surprise-map/draft"); assert.equal(tree.root.findByType("textarea").props.value, "虚构正文");
    await submit(); assert.equal(locations, 0); assert.match(text(tree.toJSON()), /先只藏给我们/);
    await click("关闭窗口"); await click("让伴侣留一封"); await submit(); assert.equal(tree.root.findByType("textarea").props.value, "虚构正文"); await unmount();
  });
  await test("scope changes during location prevent claim POST, not merely its UI response", async () => {
    const wait = deferred(), calls = []; let active = true;
    await mount({ isCurrent: () => active, request: async (path, options) => { calls.push({ path, options }); return receipt([letter]); }, locatePosition: () => wait.promise });
    await click("走近了，打开信"); active = false; await act(async () => wait.resolve(position()));
    assert.equal(calls.filter(call => call.options?.method === "POST").length, 0); await unmount();
  });
  await test("first claim opens the seal before body; reread opens directly with no new GPS", async () => {
    let claimed = false, locations = 0;
    await mount({ request: async (_path, options) => { if (options?.method === "POST") { claimed = true; return { ok: true, letter: { ...letter, claimed: true, body: "FICTIONAL_OPENED" } }; } return receipt([{ ...letter, claimed, ...(claimed ? { body: "FICTIONAL_OPENED" } : {}) }]); }, locatePosition: async () => { locations++; return position(); } });
    await click("走近了，打开信"); assert.ok(button("拆开这封信")); assert.doesNotMatch(text(tree.toJSON()), /FICTIONAL_OPENED/);
    await click("拆开这封信"); assert.match(text(tree.toJSON()), /FICTIONAL_OPENED/); assert.equal(tree.root.findByProps({ role: "dialog" }).props["aria-modal"], "true");
    await click("收起信件"); await click("再读这封信"); assert.equal(locations, 1); assert.equal(button("拆开这封信"), undefined); assert.match(text(tree.toJSON()), /FICTIONAL_OPENED/); await unmount();
  });
  await test("collection is independently paginated, deduplicates moves between pages and handles withdrawn letters without body or area", async () => {
    const calls = [], unavailable = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", kind: "public", title: "这封来信已不可查看", claimed: true, unavailable: true, unavailable_reason: "withdrawn" };
    const opened = { ...letter, kind: "private", claimed: true, body: "PRIVATE_COLLECTION_FIXTURE" };
    await mount({ request: async path => { calls.push(path); if (path.includes("/collection?")) return new URL(path, "https://fixture.invalid").searchParams.get("offset") === "0" ? receipt([opened], 40) : receipt([opened, unavailable]); return receipt(); } });
    await click("已拆收藏"); await click("再看看更多来信");
    assert.match(calls.at(-1), /collection\?offset=40&limit=40/); assert.equal(tree.root.findAllByType("h3").filter(node => text(node) === letter.title).length, 1);
    assert.equal(button("这封来信已不可查看").props.disabled, true); assert.doesNotMatch(text(tree.toJSON()), /surprise_map_receipt_invalid/);
    await click("再读这封信"); assert.match(text(tree.toJSON()), /PRIVATE_COLLECTION_FIXTURE/); await unmount();
  });
  await test("public form is blank rather than copying private body/GPS, and every edit resets publication consent", async () => {
    await mount({ request: async () => receipt([{ ...letter, claimed: true, body: "PRIVATE_FIXTURE_BODY" }]) }); await click("另写公开版本");
    const form = tree.root.findByProps({ "aria-label": "公开信预览" });
    assert.deepEqual(form.findAllByType("input").filter(node => node.props.type !== "checkbox").map(node => node.props.value), ["", "", "", ""]);
    assert.equal(form.findByType("textarea").props.value, ""); assert.equal(button("确认发布公开版本").props.disabled, true);
    await act(async () => form.findByProps({ type: "checkbox" }).props.onChange({ target: { checked: true } })); assert.equal(button("确认发布公开版本").props.disabled, true);
    for (const input of form.findAllByProps({ type: "number" })) await act(async () => input.props.onChange({ target: { value: "0" } }));
    await act(async () => form.findByProps({ type: "checkbox" }).props.onChange({ target: { checked: true } })); assert.equal(button("确认发布公开版本").props.disabled, false);
    await act(async () => form.findByType("textarea").props.onChange({ target: { value: "FICTIONAL_PUBLIC" } })); assert.equal(button("确认发布公开版本").props.disabled, true); await unmount();
  });
  await test("pending AI draft cannot overwrite a newer handwritten draft even if a disabled handler fires", async () => {
    const wait = deferred();
    await mount({ request: async (_path, options) => options?.method === "POST" ? wait.promise : receipt() });
    await startDraft(); await click("请小灯写一封");
    const input = tree.root.findByType("textarea"); assert.equal(input.props.disabled, true);
    await act(async () => input.props.onChange({ target: { value: "NEW_HANDWRITTEN_FIXTURE" } }));
    await act(async () => wait.resolve({ draft: { title: "old", body: "old" } }));
    assert.equal(tree.root.findByType("textarea").props.value, "NEW_HANDWRITTEN_FIXTURE"); await unmount();
  });
  await test("public map picker starts neutral behind its own consent and copies no private point or GPS before explicit confirmation", async () => {
    let locations = 0;
    await mount({ request: async () => receipt([letter]), locatePosition: async () => { locations++; return { ...position(), latitude: 35.123456, longitude: 120.987654 }; } });
    await click("定位附近"); await click("另写公开版本"); await click("在地图上选公共地点");
    assert.equal(tree.root.findAllByType(SurpriseLetterMap).filter(node => !node.props.picker).length, 1); assert.match(text(tree.toJSON()), /OpenStreetMap/);
    await click("本次开启街道地图");
    let picker = tree.root.findAllByType(SurpriseLetterMap).find(node => node.props.picker);
    assert.deepEqual(picker.props.items, []); assert.equal(picker.props.position, null); assert.equal(picker.props.pickerPoint, null);
    assert.equal(button("使用这个公共落点").props.disabled, true);
    await act(async () => picker.props.onPick({ latitude: 31.234567, longitude: 121.456789 }));
    assert.match(text(tree.toJSON()), /31\.23, 121\.46/); assert.doesNotMatch(text(tree.toJSON()), /35\.123456|120\.987654/);
    await click("关闭窗口");
    let form = tree.root.findByProps({ "aria-label": "公开信预览" });
    assert.deepEqual(form.findAllByProps({ type: "number" }).map(node => node.props.value), ["", ""]);
    await click("在地图上选公共地点"); picker = tree.root.findAllByType(SurpriseLetterMap).find(node => node.props.picker);
    assert.equal(picker.props.pickerPoint, null); await act(async () => picker.props.onPick({ latitude: 31.234567, longitude: 121.456789 }));
    await click("使用这个公共落点"); form = tree.root.findByProps({ "aria-label": "公开信预览" });
    assert.deepEqual(form.findAllByProps({ type: "number" }).map(node => node.props.value), ["31.234567", "121.456789"]);
    assert.equal(form.findByProps({ type: "checkbox" }).props.checked, false); assert.equal(locations, 1);
    await act(async () => form.findByProps({ type: "checkbox" }).props.onChange({ target: { checked: true } }));
    await click("在地图上选公共地点"); picker = tree.root.findAllByType(SurpriseLetterMap).find(node => node.props.picker);
    await act(async () => picker.props.onPick({ latitude: 30.11111, longitude: 120.22222 })); await click("使用这个公共落点");
    form = tree.root.findByProps({ "aria-label": "公开信预览" }); assert.equal(form.findByProps({ type: "checkbox" }).props.checked, false); assert.equal(button("确认发布公开版本").props.disabled, true); await unmount();
  });
  await test("public publication cannot POST with only a checked box and no chosen public point", async () => {
    const posts = [];
    await mount({ request: async (_path, options) => { if (options?.method) posts.push(options); return receipt([letter]); } });
    await click("另写公开版本"); const form = tree.root.findByProps({ "aria-label": "公开信预览" });
    await act(async () => form.findByProps({ type: "checkbox" }).props.onChange({ target: { checked: true } }));
    await submit("公开信预览"); assert.equal(posts.length, 0); assert.match(text(tree.toJSON()), /请先在地图上选一个公共落点/); await unmount();
  });
  await test("public publishing sends the chosen park anchor precisely while presenting only its blurred public projection", async () => {
    const posts = [];
    await mount({ request: async (path, options) => {
      if (path.endsWith("/publish") && options?.method === "POST") {
        posts.push(options.body);
        return { ok: true, publication: { ...letter, title: options.body.public_title, area: { latitude: 24.44, longitude: 118.08, radius_m: 2000 } } };
      }
      return receipt([letter]);
    } });
    await click("另写公开版本"); let form = tree.root.findByProps({ "aria-label": "公开信预览" });
    for (const [index, value] of ["FICTIONAL_PUBLIC_TITLE", "FICTIONAL_PUBLIC_PARK"].entries()) await act(async () => form.findAllByProps({ type: "text" })[index].props.onChange({ target: { value } }));
    await act(async () => form.findByType("textarea").props.onChange({ target: { value: "FICTIONAL_PUBLIC_BODY" } }));
    await click("在地图上选公共地点"); await click("本次开启街道地图");
    const picker = tree.root.findAllByType(SurpriseLetterMap).find(node => node.props.picker);
    await act(async () => picker.props.onPick({ latitude: 24.443217, longitude: 118.076431 }));
    assert.match(text(tree.toJSON()), /公开地图约显示：24\.44, 118\.08/);
    await click("使用这个公共落点"); form = tree.root.findByProps({ "aria-label": "公开信预览" });
    await act(async () => form.findByProps({ type: "checkbox" }).props.onChange({ target: { checked: true } }));
    await submit("公开信预览"); assert.equal(posts.length, 1);
    assert.equal(posts[0].public_latitude, 24.443217); assert.equal(posts[0].public_longitude, 118.076431);
    assert.notEqual(posts[0].public_latitude, 24.44); assert.notEqual(posts[0].public_longitude, 118.08); await unmount();
  });
  await test("public letters can be filtered by pseudonym and cleared without touching private data", async () => {
    const publicLetter = { ...letter, author_alias: "晚风的旅人", source: "ai", contents: ["letter"] };
    const paths = [];
    await mount({ request: async path => { paths.push(path); return receipt([publicLetter]); } });
    await click("公共惊喜");
    assert.match(paths.at(-1), /\/public\?offset=0&limit=40/);
    await click("看看 TA 的其他信");
    assert.match(paths.at(-1), /author=%E6%99%9A%E9%A3%8E%E7%9A%84%E6%97%85%E4%BA%BA/);
    assert.ok(button("清除笔名筛选"));
    await click("清除笔名筛选");
    assert.doesNotMatch(paths.at(-1), /author=/);
    assert.equal(button("清除笔名筛选"), undefined);
    await unmount();
  });
  await test("MCP token can be created, listed and revoked from the map", async () => {
    const calls = []; let tokens = [];
    await mount({ request: async (path, options) => {
      calls.push({ path, options });
      if (path.endsWith("/mcp/tokens") && !options?.method) return { ok: true, tokens };
      if (path.endsWith("/mcp/tokens") && options?.method === "POST") {
        tokens = [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", label: "灯塔邮局 MCP", created_at: "2026-10-20T00:00:00.000Z", last_used_at: null }];
        return { ok: true, token: "dengta_map_fixture_token", id: tokens[0].id };
      }
      if (path.includes("/mcp/tokens/") && options?.method === "DELETE") { tokens = []; return { ok: true, revoked: true }; }
      return receipt([letter]);
    } });
    await click("MCP 接口");
    assert.ok(button("复制 MCP 地址"));
    await click("生成新令牌");
    assert.match(text(tree.toJSON()), /dengta_map_fixture_token/);
    assert.match(text(tree.toJSON()), /灯塔邮局 MCP/);
    await click("撤回");
    assert.equal(calls.filter(call => call.options?.method === "DELETE").length, 1);
    assert.doesNotMatch(text(tree.toJSON()), /dengta_map_fixture_token/);
    await unmount();
  });
  await test("AI can draft a public letter for strangers and publishing records the AI source", async () => {
    const calls = [];
    await mount({ request: async (path, options) => {
      calls.push({ path, options });
      if (path.endsWith("/draft")) {
        assert.equal(options.body.audience, "public");
        return { ok: true, audience: "public", draft: { title: "给路过的你", body: "今天的风很轻" } };
      }
      if (path.endsWith("/publish")) return { ok: true, publication: { ...letter, title: options.body.public_title, area: { latitude: 24.44, longitude: 118.08, radius_m: 2000 } } };
      return receipt([letter]);
    } });
    await click("另写公开版本");
    await click("让 AI 写给路过的人");
    let form = tree.root.findByProps({ "aria-label": "公开信预览" });
    assert.equal(form.findAllByProps({ type: "text" })[0].props.value, "给路过的你");
    assert.equal(form.findByType("textarea").props.value, "今天的风很轻");
    assert.match(text(form), /由 AI 起草/);
    const numbers = form.findAllByProps({ type: "number" });
    await act(async () => numbers[0].props.onChange({ target: { value: "24.44" } }));
    await act(async () => numbers[1].props.onChange({ target: { value: "118.08" } }));
    form = tree.root.findByProps({ "aria-label": "公开信预览" });
    await act(async () => form.findByProps({ type: "checkbox" }).props.onChange({ target: { checked: true } }));
    await submit("公开信预览");
    const published = calls.filter(call => call.path.endsWith("/publish")).at(-1);
    assert.equal(published.options.body.source, "ai");
    assert.equal(published.options.body.public_title, "给路过的你");
    await unmount();
  });
  await test("a previous private save success is cleared when opening the unrelated public draft", async () => {
    let saved = null;
    await mount({ request: async (_path, options) => { if (options?.method === "POST") { saved = { ...letter, title: options.body.title }; return { ok: true, published: false, letter: saved }; } return receipt(saved ? [saved] : []); }, locatePosition: async () => position() });
    await startDraft(); await write(); await submit(); await submit(); assert.match(text(tree.toJSON()), /信已经藏好/);
    await click("另写公开版本"); const form = tree.root.findByProps({ "aria-label": "公开信预览" });
    assert.doesNotMatch(text(form), /信已经藏好|只有当前账号和伴侣能发现/); await unmount();
  });
  await test("unconfirmed save retry keeps its original request identity and anchor rather than saving duplicates", async () => {
    const saves = []; let locations = 0;
    await mount({ request: async (path, options) => { if (path.endsWith("/letters") && options?.method === "POST") { saves.push(structuredClone(options.body)); if (saves.length === 1) throw Object.assign(Error("not confirmed"), { code: "request_timeout" }); return { ok: true, replayed: true, published: false, letter: { ...letter, title: options.body.title } }; } return receipt(); }, locatePosition: async () => ({ ...position(), latitude: locations++ }) });
    await startDraft(); await write(); await submit(); await submit(); await submit();
    assert.equal(locations, 1); assert.equal(saves.length, 2); assert.deepEqual(saves[0], saves[1]); assert.match(text(tree.toJSON()), /没有重复留信或更换地点/); await unmount();
  });
  await test("invalid save receipt preserves draft and retry identity without false success", async () => {
    const requests = [];
    await mount({ request: async (_path, options) => { if (options?.method === "POST") { requests.push(options.body); return { ok: true }; } return receipt(); }, locatePosition: async () => position() });
    await startDraft(); await write("TITLE", "FICTIONAL_UNSAVED"); await submit(); await submit(); await submit();
    assert.equal(requests.length, 2); assert.deepEqual(requests[0], requests[1]); assert.match(text(tree.toJSON()), /surprise_map_receipt_invalid/);
    await click("上一步"); assert.equal(tree.root.findByType("textarea").props.value, "FICTIONAL_UNSAVED"); await unmount();
  });
  await test("radar map is available immediately; street tiles require explicit consent and can be switched back", async () => {
    let locations = 0; await mount({ request: async () => receipt([letter]), locatePosition: async () => { locations++; } });
    assert.equal(tree.root.findAllByProps({ "aria-label": "可拖动缩放的地理地图" }).length, 1);
    assert.equal(tree.root.findByType(SurpriseLetterMap).props.tiles, false);
    await click("打开街道地图"); assert.equal(tree.root.findAllByType(SurpriseLetterMap)[0].props.tiles, false);
    await click("本次开启街道地图"); assert.equal(tree.root.findAllByType(SurpriseLetterMap)[0].props.tiles, true); assert.equal(locations, 0);
    await click("切换到雷达图"); assert.equal(tree.root.findAllByType(SurpriseLetterMap)[0].props.tiles, false); await unmount();
  });
  await test("coarse viewport changes affect only public queries and reset public pagination without GPS", async () => {
    const paths = []; let locations = 0;
    await mount({ request: async path => { paths.push(path); return receipt([letter], path.includes("/public?") ? 40 : null); }, locatePosition: async () => { locations++; return position(); } });
    await click("打开街道地图"); await click("本次开启街道地图");
    await act(async () => tree.root.findByType(SurpriseLetterMap).props.onViewport("121.45,31.23,121.49,31.26"));
    assert.equal(paths.length, 1);
    await click("公共惊喜"); let query = new URL(paths.at(-1), "https://fixture.invalid").searchParams;
    assert.equal(query.get("bbox"), "121.45,31.23,121.49,31.26"); assert.equal(query.get("offset"), "0");
    await click("再看看更多来信"); query = new URL(paths.at(-1), "https://fixture.invalid").searchParams; assert.equal(query.get("offset"), "40");
    await act(async () => tree.root.findByType(SurpriseLetterMap).props.onViewport("121.5,31.3,121.6,31.4"));
    query = new URL(paths.at(-1), "https://fixture.invalid").searchParams; assert.equal(query.get("offset"), "0"); assert.equal(query.get("bbox"), "121.5,31.3,121.6,31.4");
    assert.equal(locations, 0); await unmount();
  });
  await test("Escape and app back close the top dialog before leaving; composing input never closes it", async () => {
    await mount({ request: async () => receipt() }); await click("查看邮局玩法");
    const event = { key: "Escape", preventDefault() {}, stopPropagation() {} };
    await act(async () => tree.root.findByProps({ role: "dialog" }).props.onKeyDown({ ...event, isComposing: true })); assert.equal(tree.root.findAllByProps({ role: "dialog" }).length, 1);
    await act(async () => tree.root.findByProps({ role: "dialog" }).props.onKeyDown(event)); assert.equal(tree.root.findAllByProps({ role: "dialog" }).length, 0);
    await click("让伴侣留一封"); await act(async () => assert.equal(appBackLayers.closeTop(), true)); assert.equal(tree.root.findAllByProps({ role: "dialog" }).length, 0); await unmount();
    assert.equal(appBackLayers.closeTop(), false);
  });
  await test("invalid geography becomes a per-view error rather than a map renderer crash", async () => {
    for (const area of [{ ...letter.area, latitude: 91 }, { ...letter.area, longitude: -181 }, { ...letter.area, radius_m: -10 }]) {
      await mount({ request: async () => receipt([{ ...letter, area }]) }); assert.match(text(tree.toJSON()), /surprise_map_receipt_invalid/); assert.equal(button("走近了，打开信"), undefined); await unmount();
    }
  });
  await test("map retry destroys old runtime and replays latest markers, viewport callback stays current", async () => {
    const mounts = [], viewports = [];
    const mountRuntime = (_host, options) => { const calls = []; mounts.push({ options, calls }); return { update: value => calls.push(["update", value]), destroy: () => calls.push(["destroy"]), fit() {} }; };
    await act(async () => { tree = TestRenderer.create(React.createElement(SurpriseLetterMap, { items: [letter], mount: mountRuntime, onViewport: value => viewports.push(value) })); });
    await act(async () => mounts[0].options.onStatus("failed")); await click("重试地图");
    assert.equal(mounts.length, 2); assert.equal(mounts[0].calls.at(-1)[0], "destroy"); assert.equal(mounts[1].calls[0][1].items[0].id, letter.id);
    mounts[1].options.onViewport("121.4,31.2,121.5,31.3"); assert.deepEqual(viewports, ["121.4,31.2,121.5,31.3"]); await unmount();
  });
} finally { if (tree) await act(async () => tree.unmount()); await vite.close(); delete globalThis.IS_REACT_ACT_ENVIRONMENT; }
