import tls from "node:tls";

const FEED = "https://www.dengtahome.com/updates/android.json";
const BACKEND = "https://dengta-home-backend-rkmq.onrender.com/health";
const SITE = "https://www.dengtahome.com/";
const PWA_MANIFEST = "https://www.dengtahome.com/manifest.webmanifest";
const SERVICE_WORKER = "https://www.dengtahome.com/sw.js";

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

async function certExpiry(hostname) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: hostname, port: 443, servername: hostname, timeout: 10000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!cert || !cert.valid_to) {
        reject(new Error(`no certificate for ${hostname}`));
        return;
      }
      const validTo = new Date(cert.valid_to);
      resolve({
        hostname,
        validTo: validTo.toISOString(),
        daysRemaining: Math.floor((validTo.getTime() - Date.now()) / 86400000),
      });
    });
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error(`TLS timeout for ${hostname}`));
    });
    socket.on("error", (error) => reject(error));
  });
}

async function main() {
  const checkedAt = new Date().toISOString();
  const result = { checkedAt, site: null, pwa: null, feed: null, apk: null, backend: null, errors: [] };
  try {
    const response = await fetch(SITE, { cache: "no-store" });
    const html = await response.text();
    result.site = { status: response.status, bytes: Buffer.byteLength(html), hasRoot: html.includes('id="root"'), assets: { checked: 0, failed: [] } };
    if (!response.ok) result.errors.push(`site HTTP ${response.status}`);
    if (!result.site.hasRoot) result.errors.push("site HTML has no root mount");
    const assetPaths = [...new Set([...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css)[^"]*)"/g)].map((match) => match[1]))].slice(0, 12);
    for (const assetPath of assetPaths) {
      const assetUrl = new URL(assetPath, SITE);
      if (assetUrl.hostname !== new URL(SITE).hostname) continue;
      result.site.assets.checked += 1;
      try {
        const assetResponse = await fetch(assetUrl, { method: "HEAD" });
        if (!assetResponse.ok) result.site.assets.failed.push(`${assetUrl.pathname} HTTP ${assetResponse.status}`);
      } catch (error) {
        result.site.assets.failed.push(`${assetUrl.pathname} ${error.message}`);
      }
    }
    for (const failure of result.site.assets.failed) result.errors.push(`site asset: ${failure}`);
  } catch (error) {
    result.errors.push(`site: ${error.message}`);
  }
  try {
    const [manifestResponse, swResponse] = await Promise.all([
      fetch(PWA_MANIFEST, { cache: "no-store" }),
      fetch(SERVICE_WORKER, { cache: "no-store" }),
    ]);
    const manifest = await manifestResponse.json().catch(() => null);
    const sw = await swResponse.text();
    const icons = Array.isArray(manifest?.icons) ? manifest.icons : [];
    const iconSizes = new Set(icons.map((icon) => String(icon?.sizes || "")));
    const manifestOk =
      manifestResponse.ok &&
      manifest &&
      typeof manifest.name === "string" &&
      typeof manifest.short_name === "string" &&
      manifest.start_url &&
      manifest.display === "standalone" &&
      iconSizes.has("192x192") &&
      iconSizes.has("512x512");
    const swOk =
      swResponse.ok &&
      /javascript/i.test(swResponse.headers.get("content-type") || "") &&
      sw.includes('addEventListener("install"') &&
      sw.includes('addEventListener("fetch"') &&
      sw.includes("CACHE_NAME");
    result.pwa = {
      manifestStatus: manifestResponse.status,
      swStatus: swResponse.status,
      manifestOk: Boolean(manifestOk),
      swOk: Boolean(swOk),
      name: manifest?.name || null,
      startUrl: manifest?.start_url || null,
      display: manifest?.display || null,
      icons: icons.map((icon) => icon?.sizes).filter(Boolean),
    };
    if (!manifestOk) result.errors.push("PWA manifest is missing required install fields");
    if (!swOk) result.errors.push("PWA service worker is missing or not cacheable");
  } catch (error) {
    result.errors.push(`pwa: ${error.message}`);
  }
  try {
    const response = await fetch(`${FEED}?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`feed HTTP ${response.status}`);
    result.feed = await response.json();
    if (result.feed?.schema_version !== 1) throw new Error("feed schema_version is not 1");
    if (result.feed?.package_id !== "home.dengta.app") throw new Error("feed package_id mismatch");
    if (!result.feed?.latest || typeof result.feed.latest !== "object") throw new Error("feed has no latest release");
    if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(String(result.feed.latest.version || ""))) {
      throw new Error("feed version is invalid");
    }
    if (!Number.isSafeInteger(Number(result.feed.latest.version_code)) || Number(result.feed.latest.version_code) < 1) {
      throw new Error("feed version_code is invalid");
    }
    const expectedVersionCode = Number(process.env.EXPECTED_FEED_VERSION_CODE || 0);
    if (expectedVersionCode > 0 && Number(result.feed.latest.version_code) !== expectedVersionCode) {
      throw new Error(`feed is stale: expected ${expectedVersionCode}, got ${result.feed.latest.version_code}`);
    }
  } catch (error) {
    result.feed = null;
    result.errors.push(`feed: ${error.message}`);
  }
  try {
    const apkUrl = result.feed?.latest?.apk_url;
    if (!apkUrl) throw new Error("feed has no apk_url");
    result.apk = await head(apkUrl);
    if (!result.apk.ok) result.errors.push(`apk HTTP ${result.apk.status}`);
    const expectedSize = Number(result.feed?.latest?.size_bytes);
    if (Number.isSafeInteger(expectedSize) && expectedSize > 0 && result.apk.length !== expectedSize) {
      result.errors.push(`apk size mismatch: feed=${expectedSize} remote=${result.apk.length}`);
    }
    const expectedSha = String(result.feed?.latest?.sha256 || "");
    if (!/^[a-f0-9]{64}$/i.test(expectedSha)) {
      result.errors.push("apk sha256 missing or invalid in feed");
    }
    if (!/android|octet-stream/i.test(result.apk.type)) {
      result.errors.push(`apk content-type unexpected: ${result.apk.type || "missing"}`);
    }
  } catch (error) {
    result.errors.push(`apk: ${error.message}`);
  }
  try {
    const response = await fetch(BACKEND, { cache: "no-store" });
    result.backend = { status: response.status, body: await response.json().catch(() => null) };
    if (!response.ok) result.errors.push(`backend HTTP ${response.status}`);
    if (!result.backend.body || typeof result.backend.body !== "object") {
      result.errors.push("backend health body is not JSON");
    } else if (!result.backend.body.revision) {
      result.errors.push("backend health is missing revision");
    }
  } catch (error) {
    result.errors.push(`backend: ${error.message}`);
  }
  result.certs = { site: null, backend: null, apk: null };
  for (const [key, hostname] of [["site", "www.dengtahome.com"], ["backend", "dengta-home-backend-rkmq.onrender.com"]]) {
    try {
      result.certs[key] = await certExpiry(hostname);
      if (result.certs[key].daysRemaining < 14) {
        result.errors.push(`${key} certificate expires in ${result.certs[key].daysRemaining} days`);
      }
    } catch (error) {
      result.errors.push(`${key} certificate: ${error.message}`);
    }
  }
  try {
    const apkHostname = new URL(result.feed?.latest?.apk_url).hostname;
    result.certs.apk = await certExpiry(apkHostname);
    if (result.certs.apk.daysRemaining < 14) {
      result.errors.push(`apk certificate expires in ${result.certs.apk.daysRemaining} days`);
    }
  } catch (error) {
    result.errors.push(`apk certificate: ${error.message}`);
  }
  result.summary = {
    siteStatus: result.site?.status ?? null,
    siteBytes: result.site?.bytes ?? null,
    siteAssetsChecked: result.site?.assets?.checked ?? 0,
    siteAssetFailures: result.site?.assets?.failed?.length ?? 0,
    pwaManifest: result.pwa?.manifestOk ?? false,
    pwaServiceWorker: result.pwa?.swOk ?? false,
    feedVersion: result.feed?.latest?.version || null,
    feedVersionCode: result.feed?.latest?.version_code || null,
    feedApkUrl: result.feed?.latest?.apk_url || null,
    apkBytes: result.apk?.length || null,
    backendRevision: result.backend?.body?.revision || null,
    backendStatus: result.backend?.body?.status || null,
    siteCertDays: result.certs?.site?.daysRemaining ?? null,
    backendCertDays: result.certs?.backend?.daysRemaining ?? null,
    apkCertDays: result.certs?.apk?.daysRemaining ?? null,
  };
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
