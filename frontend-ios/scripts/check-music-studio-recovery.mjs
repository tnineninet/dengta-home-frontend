// Real browser + loopback HTTP only. The API deliberately sends headers before stalling its JSON body.
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { createServer } from "vite";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("..", import.meta.url));
const records = [], held = new Set();
let mode = "stalled-body", sequence = 0;
const api = createHttpServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "content-type,x-dengta-companion-id");
  if (request.method === "OPTIONS") { response.end(); return; }
  assert.equal(request.url, "/api/v2/music/embed-url");
  const record = { sequence: ++sequence, mode, companion: request.headers["x-dengta-companion-id"], closed: false };
  records.push(record);
  response.on("close", () => { record.closed = true; held.delete(response); });
  response.setHeader("Content-Type", "application/json");
  if (mode === "stalled-body") {
    held.add(response);
    response.write('{"url":');
  } else response.end(JSON.stringify({ url: `https://player.music-fixture.invalid/${record.companion || "ready"}` }));
});
await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
const apiOrigin = `http://127.0.0.1:${api.address().port}`;
const entryPath = resolve(root, "fixture-music-recovery.jsx");
const entry = `
import React,{useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import MusicStudio from '/src/MusicStudio.jsx';
import {authSession} from './auth-session.js';
function Demo(){
 const snapshot=useSyncExternalStore(authSession.subscribe,authSession.getSnapshot);
 return <MusicStudio key={JSON.stringify([snapshot.user.id,snapshot.activeCompanionId])} onOpenChat={()=>{}} onOpenSync={()=>{}}/>;
}
createRoot(document.querySelector('#root')).render(<Demo/>);`;
const auth = `
let snapshot={user:{id:'fictional-account-a'},activeCompanionId:'fictional-companion-a',scopeRevision:0};
const listeners=new Set();
export const authSession=window.fixtureAuth={
 getSnapshot:()=>snapshot,
 subscribe:listener=>{listeners.add(listener);return ()=>listeners.delete(listener);},
 getRequestContext:async()=>({companionId:snapshot.activeCompanionId}),
 switchScope:(account,companion)=>{snapshot={user:{id:account},activeCompanionId:companion,scopeRevision:snapshot.scopeRevision+1};for(const listener of listeners)listener();}
};`;
const vite = await createServer({ root, configFile: false, envDir: false, appType: "custom", logLevel: "error",
  define: { "import.meta.env.VITE_API_URL": JSON.stringify(apiOrigin) },
  optimizeDeps: { include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "lucide-react"] },
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
  plugins: [{ name: "music-recovery-fixture", enforce: "pre",
    resolveId(id) {
      if (id === "/fixture-music-recovery.jsx") return entryPath;
      if (id === "./auth-session.js") return "\0fictional-music-auth";
    },
    load(id) { if (id === entryPath || id === entryPath.replaceAll("\\", "/")) return entry; if (id === "\0fictional-music-auth") return auth; },
    configureServer(server) { server.middlewares.use((request, response, next) => {
      if (request.url !== "/") return next();
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture-music-recovery.jsx"></script>');
    }); },
  }],
});
let browser, page;
const evidence = process.env.MUSIC_EVIDENCE_DIR;
const errors = [], external = [];
try {
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || url.origin === apiOrigin) return route.continue();
    if (url.origin === "https://player.music-fixture.invalid") return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<p>虚构播放器 ${url.pathname}</p>` });
    external.push(url.origin); return route.abort();
  });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => document.body.textContent.includes("正在打开音乐工作室"));
  await page.getByRole("alert").waitFor({ timeout: 14_000 });
  assert.match(await page.getByRole("alert").innerText(), /超时|超过/);
  assert.equal(records.length, 1, "a timed out embed URL is not requested again automatically");
  await page.waitForFunction(() => true); // Let the browser finish aborting its response stream.
  mode = "ready";
  await page.getByRole("button", { name: "重新连接", exact: true }).click();
  await page.frameLocator("iframe").getByText(/fictional-companion-a/).waitFor();
  assert.equal(records.length, 2);
  mode = "stalled-body";
  await page.getByRole("button", { name: "刷新音乐工作室", exact: true }).click();
  await page.waitForFunction(() => document.body.textContent.includes("正在打开音乐工作室"));
  while (records.length < 3) await new Promise(resolve => setTimeout(resolve, 10));
  mode = "ready";
  await page.evaluate(() => window.fixtureAuth.switchScope("fictional-account-b", "fictional-companion-b"));
  await page.frameLocator("iframe").getByText(/fictional-companion-b/).waitFor();
  assert.equal(records.length, 4);
  await page.waitForFunction(() => document.querySelector("iframe")?.src.endsWith("fictional-companion-b"));
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log("MusicStudio recovery: stalled HTTP response body timed out; explicit retry succeeded; account+companion switch aborted the old stream and loaded the current fixture.");
} finally {
  if (evidence) {
    await mkdir(evidence, { recursive: true });
    await page?.screenshot({ path: join(evidence, "music-studio-recovery.png") }).catch(() => {});
    await writeFile(join(evidence, "music-studio-recovery.json"), JSON.stringify({ browser: browser?.version(), records, errors, external, text: await page?.locator("body").innerText().catch(() => "") }, null, 2));
  }
  await browser?.close();
  for (const response of held) response.destroy();
  await vite.close();
  await new Promise(resolve => api.close(resolve));
}
