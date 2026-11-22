import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
const globalHeaders = (vercel.headers || []).find(rule => rule.source === "/(.*)")?.headers || [];
const csp = globalHeaders.find(header => header.key === "Content-Security-Policy")?.value || "";
const scriptSrc = /(?:^|;\s*)script-src\s+([^;]+)/i.exec(csp)?.[1] || "";
if (/(?:^|\s)'(?:unsafe-inline|unsafe-eval)'/.test(scriptSrc)) {
  throw new Error("CSP script-src must not contain unsafe-inline or unsafe-eval");
}
const allowed = new Set([...scriptSrc.matchAll(/'sha256-([^']+)'/g)].map(match => match[1]));
if (!allowed.size) throw new Error("CSP script-src has no sha256 hashes");

const dist = path.join(root, "dist");
if (!fs.existsSync(dist)) throw new Error("dist/ is missing; run vite build first");
const htmlFiles = fs.readdirSync(dist).filter(name => name.endsWith(".html"));
const missing = [];
for (const file of htmlFiles) {
  const html = fs.readFileSync(path.join(dist, file), "utf8");
  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const hash = createHash("sha256").update(match[1], "utf8").digest("base64");
    if (!allowed.has(hash)) missing.push({ file, hash });
  }
}
if (missing.length) {
  console.error(JSON.stringify({ error: "CSP_RELOAD_REQUIRED", missing }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, htmlFiles: htmlFiles.length, allowedHashes: allowed.size }));
