import { after } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// These SSR fixtures use different auth transforms. Sharing dependency caches
// lets Vite replace another worker's cache while that worker is reading it.
export const fixtureCache = await mkdtemp(join(tmpdir(), "dengta-vite-test-"));
after(() => rm(fixtureCache, { recursive: true, force: true, maxRetries: 3 }));
