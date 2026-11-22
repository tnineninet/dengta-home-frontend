import { createHash } from "node:crypto";

const FEED = "https://www.dengtahome.com/updates/android.json";

async function main() {
  const feedResponse = await fetch(`${FEED}?ts=${Date.now()}`, { cache: "no-store" });
  if (!feedResponse.ok) throw new Error(`feed HTTP ${feedResponse.status}`);
  const feed = await feedResponse.json();
  const latest = feed?.latest;
  if (!latest?.apk_url) throw new Error("feed has no apk_url");
  const expectedSize = Number(latest.size_bytes);
  const expectedSha = String(latest.sha256 || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedSha)) throw new Error("feed sha256 is invalid");

  const apkResponse = await fetch(latest.apk_url, { cache: "no-store" });
  if (!apkResponse.ok) throw new Error(`apk HTTP ${apkResponse.status}`);
  const apk = Buffer.from(await apkResponse.arrayBuffer());
  const actualSha = createHash("sha256").update(apk).digest("hex");
  const result = {
    version: latest.version,
    versionCode: latest.version_code,
    apkUrl: latest.apk_url,
    expectedSize,
    actualSize: apk.length,
    expectedSha,
    actualSha,
    sizeMatches: apk.length === expectedSize,
    shaMatches: actualSha === expectedSha,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.sizeMatches || !result.shaMatches) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
