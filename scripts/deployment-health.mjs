const FEED = "https://www.dengtahome.com/updates/android.json";
const BACKEND = "https://dengta-home-backend-rkmq.onrender.com/health";

async function head(url) {
  const response = await fetch(url, { method: "HEAD", redirect: "follow" });
  return {
    ok: response.ok,
    status: response.status,
    url: response.url,
    length: Number(response.headers.get("content-length") || 0),
    type: response.headers.get("content-type") || "",
  };
}

async function main() {
  const checkedAt = new Date().toISOString();
  const result = { checkedAt, feed: null, apk: null, backend: null, errors: [] };
  try {
    const response = await fetch(`${FEED}?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`feed HTTP ${response.status}`);
    result.feed = await response.json();
  } catch (error) {
    result.errors.push(`feed: ${error.message}`);
  }
  try {
    const apkUrl = result.feed?.latest?.apk_url;
    if (!apkUrl) throw new Error("feed has no apk_url");
    result.apk = await head(apkUrl);
    if (!result.apk.ok) result.errors.push(`apk HTTP ${result.apk.status}`);
  } catch (error) {
    result.errors.push(`apk: ${error.message}`);
  }
  try {
    const response = await fetch(BACKEND, { cache: "no-store" });
    result.backend = { status: response.status, body: await response.json().catch(() => null) };
    if (!response.ok) result.errors.push(`backend HTTP ${response.status}`);
  } catch (error) {
    result.errors.push(`backend: ${error.message}`);
  }
  result.summary = {
    feedVersion: result.feed?.latest?.version || null,
    feedVersionCode: result.feed?.latest?.version_code || null,
    feedApkUrl: result.feed?.latest?.apk_url || null,
    apkBytes: result.apk?.length || null,
    backendRevision: result.backend?.body?.revision || null,
    backendStatus: result.backend?.body?.status || null,
  };
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
