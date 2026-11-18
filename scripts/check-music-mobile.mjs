// Local UI check: install playwright or set PLAYWRIGHT_MODULE to its module URL.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("..", import.meta.url));
const apiOrigin = "https://api.music-fixture.invalid", playerOrigin = "https://player.music-fixture.invalid";
const vite = await createServer({
  root, configFile: false, envDir: false, logLevel: "error", plugins: [react()],
  define: { "import.meta.env.VITE_API_URL": JSON.stringify(apiOrigin) },
  server: { host: "127.0.0.1", port: 0, hmr: false },
});
let browser, page;
try {
  await vite.listen();
  const local = `http://127.0.0.1:${vite.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const context = await browser.newContext({ isMobile: true, hasTouch: true, viewport: { width: 320, height: 568 }, serviceWorkers: "block" });
  let embed = "failure";
  const tracks = Array.from({ length: 123 }, (_, i) => ({ id: String(1000 + i), title: `${i + 1}-虚构歌曲-${"long".repeat(28)}`, artist: "测试" }));
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === local) return route.continue();
    if (url.origin === playerOrigin) return route.fulfill({ contentType: "text/html; charset=utf-8", body: "<meta charset='utf-8'><meta name=viewport content='width=device-width'><title>Fixture</title><p>虚构播放器</p>" });
    if (url.origin !== apiOrigin) return route.abort();
    const path = url.pathname;
    const respond = (json, status = 200) => route.fulfill({ json, status, headers: { "Access-Control-Allow-Origin": "*" } });
    if (path.endsWith("/embed-url")) {
      if (embed === "failure") return respond({ code: "fixture_unavailable", error: "模拟未连接" }, 503);
      return respond({ url: embed === "malformed" ? "" : playerOrigin + "/?token=fictional" });
    }
    if (path.endsWith("/netease/cookie-session")) return respond({ session: { connected: true, account_name: "测试账号" } });
    if (path.endsWith("/cookie/my-playlists")) return respond({ owned: [{ playlist_id: "777", item_count: tracks.length, name: "测试歌单" }], subscribed: [] });
    if (path.endsWith("/cookie/playlist")) return respond({ playlist: { id: "777", name: "测试歌单", tracks } });
    if (path.endsWith("/music/playlists")) return respond({ playlists: [] });
    if (path.endsWith("/music/favorites")) return respond({ favorites: [] });
    if (path.endsWith("/connections/manage")) return respond({ connections: [] });
    return respond({});
  });
  page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const runtimeErrors = [];
  async function screenshot(name) {
    if (!process.env.MUSIC_EVIDENCE_DIR) return;
    await mkdir(process.env.MUSIC_EVIDENCE_DIR, { recursive: true });
    await writeFile(join(process.env.MUSIC_EVIDENCE_DIR, name), await page.screenshot());
  }
  page.on("pageerror", err => { runtimeErrors.push(err.message); console.error("App error:", err.message); });
  page.on("console", message => { if (message.type() === "error") console.error("Browser:", message.text()); });
  page.on("response", response => { if (response.status() >= 400 && response.url().startsWith(local)) console.error("Local response:", response.status(), new URL(response.url()).pathname); });
  await page.goto(local + "/visual-preview.html");
  const openStudio = async () => {
    await page.getByRole("button", { name: "打开命令面板", exact: true }).click();
    await page.getByRole("button", { name: /^音乐工作室 / }).click();
    await page.locator(".music-studio-page").waitFor();
  };
  await openStudio();
  const studio = page.locator(".music-studio-page");
  await studio.getByRole("alert").waitFor();
  await screenshot("music-studio-failure-320.png");
  await studio.getByRole("button", { name: "先回聊天" }).click();
  await page.locator(".main-panel.view-chat").waitFor();
  assert.ok(page.url().endsWith("visual-preview.html"), "in-app navigation keeps the loaded document");
  embed = "malformed";
  await openStudio();
  await studio.getByText("音乐工作室没有返回有效的 HTTPS 访问地址。").waitFor();
  embed = "ready";
  await studio.getByRole("button", { name: "重新连接" }).click();
  await page.frameLocator(".music-studio-frame").getByText("虚构播放器").waitFor();
  for (const [width, height, forced] of [[320, 568, false], [375, 667, true], [667, 375, false]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(value => document.documentElement.setAttribute("data-dengta-force-mobile", String(value)), forced);
    const rects = await studio.evaluate(el => {
      const rect = elm => elm.getBoundingClientRect().toJSON();
      return { content: rect(el.parentElement), page: rect(el), frame: rect(el.querySelector("iframe")), external: rect(el.querySelector("[aria-label='在浏览器打开音乐工作室']")) };
    });
    assert.ok(rects.page.bottom <= rects.content.bottom + 1 && rects.frame.bottom <= height + 1, `clipped ${width}x${height}: ` + JSON.stringify(rects));
    assert.ok(rects.frame.height > 96 && rects.frame.width <= width && rects.external.height >= 36, `missing player or recovery control ${width}x${height}`);
    console.log(`Studio ${width}x${height}, forced=${forced}: iframe ${Math.round(rects.frame.width)}x${Math.round(rects.frame.height)}, recovery visible`);
    await screenshot(`music-studio-${width}x${height}.png`);
  }
  await page.setViewportSize({ width: 320, height: 568 });
  await studio.getByRole("button", { name: "一起听同步" }).click();
  await page.getByRole("button", { name: "我的歌单", exact: true }).click();
  await page.getByRole("button", { name: "测试歌单", exact: true }).click();
  const pager = page.getByRole("navigation", { name: "网易云歌单分页" });
  await pager.getByRole("button", { name: "下一页" }).click();
  assert.equal(await pager.getByRole("status").innerText(), "51–100 / 123 首");
  await pager.getByRole("combobox").selectOption("2");
  assert.equal(await pager.getByRole("status").innerText(), "101–123 / 123 首");
  assert.equal(await page.locator(".music-cookie-playlist-detail li").count(), 23);
  assert.equal(await pager.getByRole("button", { name: "下一页" }).isDisabled(), true);
  assert.equal(await page.locator(".music-cookie-playlist-detail").evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, "long titles must not obscure controls");
  const pageEdge = await pager.boundingBox();
  assert.ok(pageEdge.x >= 0 && pageEdge.x + pageEdge.width <= 321, "page controls are inside the handset");
  assert.deepEqual(runtimeErrors, []);
  await screenshot("music-playlist-last-page-320.png");
  console.log("Real App: mobile command palette → studio error/retry → simulated frame → sync → NetEase playlist → pages 2 and 3; no external network or audio.");
} catch (error) {
  console.error("Page at failure:", await page?.locator("body").innerText().catch(() => ""));
  throw error;
} finally {
  await browser?.close();
  await vite.close();
}
