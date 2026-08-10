// Verifies that a production web bundle contains the configured public auth values.
// Run with: npm run verify:public-auth-build (after npm run build).
// Requires: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the process environment.

import fs from "node:fs";
import path from "node:path";

const requiredVariables = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
];
const configuredValues = requiredVariables.map((name) => ({
  name,
  value: String(process.env[name] || "").trim(),
}));
const missingVariables = configuredValues
  .filter(({ value }) => !value)
  .map(({ name }) => name);

if (missingVariables.length) {
  throw new Error(
    `Missing required public auth environment variables: ${missingVariables.join(", ")}`,
  );
}

const assetsDirectory = path.resolve("dist", "assets");
if (!fs.existsSync(assetsDirectory)) {
  throw new Error("Production bundle not found. Run npm run build first.");
}

const javascript = fs
  .readdirSync(assetsDirectory)
  .filter((fileName) => fileName.endsWith(".js"))
  .map((fileName) =>
    fs.readFileSync(path.join(assetsDirectory, fileName), "utf8"),
  )
  .join("\n");
const omittedVariables = configuredValues
  .filter(({ value }) => !javascript.includes(value))
  .map(({ name }) => name);

if (omittedVariables.length) {
  throw new Error(
    `Production bundle omitted required public auth values: ${omittedVariables.join(", ")}`,
  );
}

console.log("Production bundle contains the configured public auth values.");
