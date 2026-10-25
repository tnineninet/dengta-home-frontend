import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const projectFile = path.join(root, ".vercel", "project.json");
const local = fs.existsSync(projectFile) ? JSON.parse(fs.readFileSync(projectFile, "utf8")) : {};
const projectId = String(process.env.VERCEL_PROJECT_ID || local.projectId || "").trim();
const orgId = String(process.env.VERCEL_TEAM_ID || process.env.VERCEL_ORG_ID || local.orgId || "").trim();
if (!projectId) throw new Error("Missing VERCEL_PROJECT_ID (or .vercel/project.json)");
const token = String(process.env.VERCEL_TOKEN || "").trim();
const apply = process.env.APPLY === "1";
const keep = Math.max(1, Number(process.env.KEEP || 10));
if (!token) {
  console.error("VERCEL_TOKEN is required. Create a token at https://vercel.com/account/tokens");
  process.exit(2);
}

const api = async (method, pathname) => {
  const response = await fetch(`https://api.vercel.com${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${pathname}: HTTP ${response.status} ${body?.error?.message || ""}`.trim());
  return body;
};

const deployments = [];
let until = 0;
while (true) {
  const query = new URLSearchParams({ projectId, limit: "100", ...(until ? { until: String(until) } : {}) });
  if (orgId) query.set("teamId", orgId);
  const page = await api("GET", `/v6/deployments?${query}`);
  const rows = page.deployments || [];
  deployments.push(...rows);
  if (rows.length < 100) break;
  const lastCreated = Number(rows.at(-1)?.created || 0);
  if (!lastCreated || lastCreated === until) break;
  until = lastCreated;
}

const unique = [...new Map(deployments.map((item) => [item.uid || item.id, item])).values()]
  .sort((a, b) => Number(b.created || 0) - Number(a.created || 0));
const protectedIds = new Set(unique.slice(0, keep).map((item) => item.uid || item.id));
const remove = unique.filter((item) => !protectedIds.has(item.uid || item.id));
console.log(JSON.stringify({ projectId, total: unique.length, keep, remove: remove.length, apply }, null, 2));

for (const deployment of remove) {
  const id = deployment.uid || deployment.id;
  if (!apply) {
    console.log(`[dry-run] ${id} ${deployment.url || ""}`);
    continue;
  }
  const query = orgId ? `?teamId=${encodeURIComponent(orgId)}` : "";
  try {
    await api("DELETE", `/v13/deployments/${encodeURIComponent(id)}${query}`);
    console.log(`deleted ${id}`);
  } catch (error) {
    console.error(`failed ${id}: ${error.message}`);
    process.exitCode = 1;
  }
}
