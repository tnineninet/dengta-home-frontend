const token = String(process.env.VERCEL_TOKEN || "").trim();
const projectId = String(process.env.VERCEL_PROJECT_ID || "").trim();
const teamId = String(process.env.VERCEL_TEAM_ID || "").trim();
const expectedSha = String(process.env.EXPECTED_SHA || "").trim();
if (!token) throw new Error("VERCEL_TOKEN is required");
if (!projectId) throw new Error("VERCEL_PROJECT_ID is required");
if (!teamId) throw new Error("VERCEL_TEAM_ID is required");
if (!expectedSha) throw new Error("EXPECTED_SHA is required");

const url = new URL("https://api.vercel.com/v6/deployments");
url.searchParams.set("projectId", projectId);
url.searchParams.set("teamId", teamId);
url.searchParams.set("limit", "1");
url.searchParams.set("target", "production");

const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
if (!response.ok) throw new Error(`Vercel API HTTP ${response.status}`);
const body = await response.json();
const deployment = body.deployments?.[0];
if (!deployment) throw new Error("Vercel returned no production deployment");
const actualSha = String(deployment.meta?.githubCommitSha || "");
const result = {
  uid: deployment.uid,
  state: deployment.state,
  ref: deployment.meta?.githubCommitRef || null,
  expectedSha,
  actualSha,
  shaMatches: actualSha === expectedSha,
  ready: deployment.state === "READY",
};
console.log(JSON.stringify(result, null, 2));
if (!result.shaMatches || !result.ready) process.exitCode = 1;
