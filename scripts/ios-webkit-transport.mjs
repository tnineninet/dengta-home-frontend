import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";
import { build } from "vite";

const [outputArgument, sourceSha] = process.argv.slice(2);
if (process.platform !== "darwin" || !outputArgument || !/^[a-f0-9]{40}$/.test(sourceSha || "")) {
  throw new Error("Usage on macOS: node scripts/ios-webkit-transport.mjs <evidence-directory> <source-sha>");
}
const root = fileURLToPath(new URL("..", import.meta.url));
const output = path.resolve(outputArgument), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "dengta-transport-"));
const nonce = randomUUID().toUpperCase(), bundle = "home.dengta.transport-fixture";
const app = path.join(temporary, "Transport.app"), assets = path.join(temporary, "assets");
fs.mkdirSync(output, { recursive: true }); fs.mkdirSync(app);
let device = "", normalResponse = null, cancelClosed = false;
const sockets = new Set(), timers = new Set();
const serverState = { normalRequests: 0, truncatedRequests: 0, cancelRequests: 0, normalAck: false, validForms: 0, unexpectedRequests: 0 };
const manifest = { schemaVersion: 1, sourceSha, nonce, runtime: "iOS Simulator WKWebView", businessFlows: "not-exercised", outcome: "failed" };
const later = (fn, milliseconds) => { const timer = setTimeout(() => { timers.delete(timer); fn(); }, milliseconds); timers.add(timer); };

function command(stage, executable, args, timeout = 60_000, required = true) {
  const result = spawnSync(executable, args, { cwd: root, encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024 });
  fs.writeFileSync(path.join(output, `${stage}.log`), `${result.stdout || ""}${result.stderr || ""}`);
  if (required && (result.error || result.status !== 0)) throw new Error(`Transport stage failed: ${stage}`);
  return result.stdout?.trim() || "";
}

const server = http.createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  const url = new URL(request.url, "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/fixture") {
    response.setHeader("Content-Type", "text/html");
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'");
    response.end('<!doctype html><meta charset="utf-8"><title>Synthetic transport fixture</title><script src="/fixture.js"></script>'); return;
  }
  if (request.method === "GET" && url.pathname === "/fixture.js") {
    response.setHeader("Content-Type", "text/javascript"); response.end(fs.readFileSync(path.join(assets, "fixture.js"))); return;
  }
  if (request.method === "POST" && url.pathname === "/ack/normal") {
    if (normalResponse && !normalResponse.writableEnded) {
      serverState.normalAck = true;
      normalResponse.end('data: {"type":"done","ok":true,"fixture_form_valid":true}\n\n');
    }
    response.end("{}"); return;
  }
  if (request.method === "GET" && url.pathname === "/cancel-status") {
    for (let attempt = 0; attempt < 50 && !cancelClosed; attempt += 1) await pause(20);
    response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ closed: cancelClosed })); return;
  }
  if (request.method === "POST" && url.pathname === "/chat/stream") {
    let size = 0, body = "";
    for await (const chunk of request) { size += chunk.length; if (size > 16_384) { response.writeHead(413); response.end(); return; } body += chunk.toString("utf8"); }
    const mode = ["normal", "truncated", "cancel"].find((name) => body.includes(`fixture-${name}`));
    if (!mode || !/^multipart\/form-data; boundary=/.test(request.headers["content-type"] || "") ||
        !body.includes('name="message"') || request.headers.authorization !== "Bearer fictional-transport-token" ||
        request.headers["x-dengta-companion-id"] !== "fictional-companion") {
      serverState.unexpectedRequests += 1; response.writeHead(400); response.end("{}"); return;
    }
    serverState[`${mode}Requests`] += 1; serverState.validForms += 1;
    response.writeHead(200, { "Content-Type": "text/event-stream", "X-Accel-Buffering": "no" }); response.flushHeaders();
    if (mode === "normal") {
      normalResponse = response;
      const bytes = Buffer.from('data: {"type":"text","content":"你好🙂"}\r\n\r\n');
      const split = bytes.indexOf(Buffer.from("🙂")) + 2;
      response.write(bytes.subarray(0, split));
      later(() => { if (!response.destroyed) response.write(bytes.subarray(split)); }, 50);
      later(() => { if (!response.writableEnded) response.destroy(); }, 10_000);
    } else if (mode === "truncated") {
      response.end('data: {"type":"text","content":"synthetic truncated"}\n\n');
    } else {
      let fallbackEnding = false;
      response.on("close", () => { cancelClosed = !fallbackEnding && !response.writableFinished; });
      response.write('data: {"type":"text","content":"synthetic cancellation"}\n\n');
      later(() => { fallbackEnding = true; if (!response.destroyed) response.end('data: {"type":"done","ok":true}\n\n'); }, 10_000);
    }
    return;
  }
  serverState.unexpectedRequests += 1; response.writeHead(404); response.end();
});
server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });

try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await build({ root, configFile: false, envDir: false, envPrefix: [], logLevel: "warn",
    define: { "import.meta.env.VITE_API_URL": JSON.stringify(origin), "import.meta.env.VITE_SUPABASE_URL": '""', "import.meta.env.VITE_SUPABASE_ANON_KEY": '""' },
    build: { outDir: assets, minify: false, lib: { entry: path.join(root, "test/fixtures/ios-transport-browser.js"), formats: ["iife"], name: "TransportFixture", fileName: () => "fixture.js" } } });
  const sdk = command("sdk-path", "xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"]);
  command("compile-host", "xcrun", ["--sdk", "iphonesimulator", "swiftc", "-parse-as-library", "-target", `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-ios15.0-simulator`,
    "-sdk", sdk, "-framework", "UIKit", "-framework", "WebKit", path.join(root, "test/fixtures/IOSWebKitTransportHost.swift"), "-o", path.join(app, "Transport")], 120_000);
  fs.writeFileSync(path.join(app, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
    <key>CFBundleIdentifier</key><string>${bundle}</string><key>CFBundleExecutable</key><string>Transport</string><key>CFBundleName</key><string>Transport Fixture</string>
    <key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>CFBundleShortVersionString</key><string>1.0</string>
    <key>CFBundleSupportedPlatforms</key><array><string>iPhoneSimulator</string></array><key>MinimumOSVersion</key><string>15.0</string>
    <key>LSRequiresIPhoneOS</key><true/><key>UIDeviceFamily</key><array><integer>1</integer></array>
    <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/><key>NSAllowsArbitraryLoadsInWebContent</key><true/></dict>
    <key>UILaunchScreen</key><dict/></dict></plist>`);
  command("sign-host", "codesign", ["--force", "--sign", "-", app]);
  command("verify-host", "codesign", ["--verify", "--strict", app]);
  const runtimes = JSON.parse(command("runtimes", "xcrun", ["simctl", "list", "runtimes", "--json"])).runtimes;
  const runtime = runtimes.filter((item) => item.isAvailable && item.identifier.includes(".iOS-"))
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
  assert.ok(runtime, "Installed iOS runtime required");
  const types = JSON.parse(command("device-types", "xcrun", ["simctl", "list", "devicetypes", "--json"])).devicetypes;
  const type = types.find((item) => item.name === "iPhone 17"); assert.ok(type);
  const created = command("create-device", "xcrun", ["simctl", "create", `DengTa Transport ${nonce.slice(0, 8)}`, type.identifier, runtime.identifier]);
  assert.match(created, /^[A-F0-9-]{36}$/i); device = created;
  command("boot", "xcrun", ["simctl", "boot", device]);
  command("boot-complete", "xcrun", ["simctl", "bootstatus", device, "-b"], 180_000);
  command("install-host", "xcrun", ["simctl", "install", device, app]);
  command("launch-host", "xcrun", ["simctl", "launch", device, bundle, "--fixture-url", `${origin}/fixture`, "--run-nonce", nonce, "--source-sha", sourceSha]);
  const container = command("host-container", "xcrun", ["simctl", "get_app_container", device, bundle, "data"]);
  assert.ok(path.isAbsolute(container) && fs.statSync(container).isDirectory());
  const receiptFile = path.join(container, "tmp", "transport-receipt.json");
  for (let attempt = 0; attempt < 60 && !fs.existsSync(receiptFile); attempt += 1) await pause(500);
  const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.nonce, nonce); assert.equal(receipt.sourceSha, sourceSha);
  assert.equal(receipt.runtime, "iOS Simulator WKWebView"); assert.equal(receipt.businessFlows, "not-exercised");
  fs.writeFileSync(path.join(output, "transport-receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  for (const key of ["streamedBeforeTerminal", "utf8", "postForm", "truncatedRejected", "abortRejected", "cancelledNoMoreEvents"]) assert.equal(receipt[key], true, key);
  assert.deepEqual(serverState, { normalRequests: 1, truncatedRequests: 1, cancelRequests: 1, normalAck: true, validForms: 3, unexpectedRequests: 0 });
  manifest.outcome = "synthetic-transport-passed"; manifest.server = serverState;
} catch {
  manifest.failure = "Synthetic WKWebView transport did not pass; inspect stage logs.";
  manifest.server = serverState; process.exitCode = 1;
} finally {
  for (const timer of timers) clearTimeout(timer);
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  if (device) {
    command("shutdown-created-device", "xcrun", ["simctl", "shutdown", device], 60_000, false);
    command("delete-created-device", "xcrun", ["simctl", "delete", device], 60_000, false);
  }
  fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify(manifest));
}
