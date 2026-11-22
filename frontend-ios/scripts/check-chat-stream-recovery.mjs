// Production streamChat + real loopback HTTP, with only fictional messages.
// This is a desktop browser transport check, not an iPhone device receipt.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("..", import.meta.url));
const evidence = resolve(process.env.CHAT_EVIDENCE_DIR || "D:/GZdeepseek/_audit/ios-next-20261118/chat-stream-browser");
const bundle = join(evidence, "assets"), records = [], held = new Set(), external = [], errors = [];
await mkdir(evidence, { recursive: true });
const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>合成聊天流恢复</title><style>body{font:18px system-ui;padding:24px;color:#26354a;background:#edf2f8}button{display:block;min-height:44px;margin:12px 0;padding:12px;width:100%}output{display:block;white-space:pre-wrap}</style><h1>聊天流恢复检查</h1><p>仅虚构数据 · 本地HTTP · 生产streamChat</p><button id="normal">完成后保持连接</button><button id="failed">失败后保持连接</button><button id="cancel">等待并停止</button><button id="stop" disabled>停止</button><output id="result"></output><script src="/fixture.js"></script>'); return;
  }
  if (request.method === "GET" && request.url === "/fixture.js") {
    response.setHeader("Content-Type", "text/javascript"); response.end(await readFile(join(bundle, "fixture.js"))); return;
  }
  if (request.method !== "POST" || request.url !== "/chat/stream") { response.writeHead(404); response.end(); return; }
  let body = "";
  for await (const chunk of request) { body += chunk.toString("utf8"); if (body.length > 16_384) throw new Error("fixture body too large"); }
  const mode = ["normal", "failed", "cancel"].find(value => body.includes(`synthetic-${value}`));
  assert.ok(mode); assert.match(request.headers["content-type"], /^multipart\/form-data; boundary=/);
  const record = { mode, closed: false }; records.push(record); held.add(response);
  response.on("close", () => { record.closed = true; held.delete(response); });
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  response.write('data: {"type":"meta","user_message":{"id":"fictional-user"}}\n\n');
  if (mode === "normal") {
    const bytes = Buffer.from('data: {"type":"text","content":"你好🙂"}\n\n');
    const split = bytes.indexOf(Buffer.from("🙂")) + 2;
    response.write(bytes.subarray(0, split));
    setTimeout(() => { if (!response.destroyed) response.write(Buffer.concat([bytes.subarray(split), Buffer.from('data: {"type":"done","ok":true}\n\ndata: {"type":"text","content":"ignored after terminal"}\n\n')])); }, 30);
  } else if (mode === "failed") {
    response.write('data: {"type":"error","code":"CHAT_FIXTURE_FAILURE","content":"虚构保存失败"}\n\ndata: {"type":"done","ok":false}\n\n');
  } else response.write('data: {"type":"text","content":"正在等待，点击停止"}\n\n');
  // Intentionally no end(): application termination must release this stream.
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const entry = `
import {streamChat} from ${JSON.stringify(join(root, "src/api.js").replaceAll("\\", "/"))};
const output=document.querySelector('#result'),stop=document.querySelector('#stop');
let current=null;
window.fixture={state:'idle',events:[]};
for(const mode of ['normal','failed','cancel'])document.querySelector('#'+mode).onclick=async()=>{
 const controller=new AbortController();current=controller;stop.disabled=false;
 window.fixture={state:'sending',events:[]};output.textContent='发送中';
 try{const done=await streamChat({message:'synthetic-'+mode},event=>{
  window.fixture.events.push(event);if(event.type==='text')output.textContent=event.content;
 },{signal:controller.signal,authSession:{getRequestContext:async()=>({})}});
 window.fixture.state='complete';output.textContent='已完成：'+window.fixture.events.filter(e=>e.type==='text').map(e=>e.content).join('');
 }catch(error){window.fixture.state=error.name==='AbortError'?'cancelled':'error';window.fixture.code=error.code;output.textContent=error.name==='AbortError'?'已停止':error.message;}
 finally{current=null;stop.disabled=true;}
};stop.onclick=()=>current?.abort();`;
let browser, page;
try {
  const entryFile = join(evidence, "fixture-entry.js");
  await writeFile(entryFile, entry);
  await build({ root, configFile: false, envDir: false, envPrefix: [], logLevel: "error",
    define: { "import.meta.env.VITE_API_URL": JSON.stringify(origin), "import.meta.env.VITE_SUPABASE_URL": '""', "import.meta.env.VITE_SUPABASE_ANON_KEY": '""' },
    build: { outDir: bundle, emptyOutDir: false, minify: false, lib: { entry: entryFile, formats: ["iife"], name: "ChatFixture", fileName: () => "fixture.js" } },
  });
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    external.push(url.origin); return route.abort();
  });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin);
  await page.locator("#normal").click();
  await page.waitForFunction(() => window.fixture.state === "complete");
  assert.equal(await page.locator("#result").textContent(), "已完成：你好🙂");
  assert.deepEqual(await page.evaluate(() => window.fixture.events.map(event => event.type)), ["meta", "text", "done"]);
  await page.locator("#failed").click();
  await page.waitForFunction(() => window.fixture.state === "error");
  assert.equal(await page.evaluate(() => window.fixture.code), "CHAT_FIXTURE_FAILURE");
  await page.locator("#cancel").click();
  await page.waitForFunction(() => window.fixture.events.some(event => event.type === "text"));
  await page.locator("#stop").click();
  await page.waitForFunction(() => window.fixture.state === "cancelled");
  for (let i = 0; i < 50 && records.some(record => !record.closed); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(records, ["normal", "failed", "cancel"].map(mode => ({ mode, closed: true })));
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await page.screenshot({ path: join(evidence, "chat-stream-recovery.png") });
  await writeFile(join(evidence, "receipt.json"), JSON.stringify({ runtime: `Desktop Edge ${browser.version()} mobile viewport 390x844`, deviceValidation: false, records, errors, external, final: await page.evaluate(() => window.fixture) }, null, 2));
  console.log("Production streamChat loopback browser passed: terminal without EOF, terminal failure, cancellation, split UTF8 and released connections; no external requests.");
} finally {
  await browser?.close(); for (const response of held) response.destroy(); server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
