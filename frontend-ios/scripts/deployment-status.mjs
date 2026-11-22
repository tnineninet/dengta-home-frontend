const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
const repo = String(process.env.GITHUB_REPOSITORY || "").trim();
if (!token || !repo) {
  console.error("GITHUB_TOKEN and GITHUB_REPOSITORY are required.");
  process.exit(2);
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "dengta-deployment-status",
};
const api = async (pathname) => {
  const response = await fetch(`https://api.github.com${pathname}`, { headers, cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`GitHub HTTP ${response.status}: ${body?.message || pathname}`);
  return body;
};

const deployments = await api(`/repos/${repo}/deployments?per_page=1&environment=Production`);
if (!Array.isArray(deployments) || !deployments.length) {
  console.error("No Production deployment records found.");
  process.exit(1);
}
const latest = deployments[0];
const statuses = await api(`/repos/${repo}/deployments/${latest.id}/statuses`);
const status = Array.isArray(statuses) ? statuses[0] : null;
const result = {
  id: latest.id,
  sha: latest.sha,
  ref: latest.ref,
  createdAt: latest.created_at,
  state: status?.state || "missing",
  environmentUrl: status?.environment_url || null,
  statusCreatedAt: status?.created_at || null,
};
console.log(JSON.stringify(result, null, 2));
if (result.state !== "success") {
  console.error(`Latest Production deployment state is ${result.state}.`);
  process.exit(1);
}
