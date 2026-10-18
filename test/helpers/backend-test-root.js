import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

export function backendTestRoot({ frontendRoot, configuredRoot = process.env.DENGTA_BACKEND_TEST_ROOT, cwd = process.cwd() }) {
  const candidates = configuredRoot
    ? [path.resolve(cwd, configuredRoot)]
    : [path.resolve(frontendRoot, "../backend"), path.resolve(frontendRoot, "../dengta-home-backend")];
  const root = candidates.find(candidate => ["package.json", "test/helpers/xhs-sticker-fixture.js", "services/xhs-sticker-import.js", "routes/v2/private-media.js"]
    .every(file => existsSync(path.join(candidate, file))));
  if (!root) throw new Error("XHS integration requires a prepared DengTa backend checkout. Run npm ci in both frontend and backend, then npm run test:xhs-integration in frontend. Place backend at ../backend or ../dengta-home-backend, or set DENGTA_BACKEND_TEST_ROOT to its directory. This integration test never silently skips missing backend prerequisites.");
  return root;
}
