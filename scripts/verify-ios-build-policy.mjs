import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://dengta-home-backend-rkmq.onrender.com";

/** Check emitted literals, alongside the separate redirect behavior tests.
 * This is not an authenticated request or a WKWebView network assertion. */
export function verifyIosBuildPolicy({ directory = path.resolve("dist/assets"), apiUrl = process.env.VITE_API_URL } = {}) {
  if (apiUrl !== API) throw new Error("iOS build requires the reviewed HTTPS API endpoint.");
  const javascript = fs.readdirSync(directory).filter(name => name.endsWith(".js"))
    .map(name => fs.readFileSync(path.join(directory, name), "utf8")).join("\n");
  if (!javascript.includes(API)) throw new Error("Emitted iOS assets omit the reviewed API endpoint.");
  if (!javascript.includes("dengta://auth")) throw new Error("Emitted iOS assets omit the native authentication callback.");
  return { apiLiteralPresent: true, nativeCallbackLiteralPresent: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(verifyIosBuildPolicy()));
}
