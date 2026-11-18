const fields = ["schemaVersion", "runNonce", "mode", "login", "restoredSession", "chatSent", "streamedBeforeTerminal", "streamComplete", "personaSaved", "personaReadBack", "personaRestored", "memoryOpened", "settingsOpened", "composerGeometry", "logout", "screenshotCaptured", "phases"];
const requiredChecks = ["login", "restoredSession", "chatSent", "streamComplete", "personaSaved", "personaReadBack", "personaRestored", "memoryOpened", "settingsOpened", "composerGeometry"];
export const BUSINESS_ENV_KEYS = Object.freeze([
  "DENGTA_BUSINESS_MODE", "DENGTA_BUSINESS_NONCE", "DENGTA_BUSINESS_EMAIL", "DENGTA_BUSINESS_PASSWORD",
  "DENGTA_BUSINESS_CONTROL_URL", "DENGTA_BUSINESS_PROMPT_BASELINE", "DENGTA_BUSINESS_DETAILS_BASELINE",
  "DENGTA_BUSINESS_SCREENSHOT_PATH", "DENGTA_UI_SAFE_TOP", "DENGTA_UI_SAFE_BOTTOM",
]);

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new Error("business-receipt-invalid");
}

function frame(value) {
  if (!Array.isArray(value) || value.length !== 4 || value.some(n => !Number.isInteger(n) || n < 0 || n > 4000) || value[2] < 1 || value[3] < 1) throw new Error("business-geometry-invalid");
  return [...value];
}

/** Reject unknown fields before anything is exported. Raw XCTest stays private. */
export function validateBusinessEvidence(raw, { runNonce, mode, safeAreaTop, safeAreaBottom }) {
  exactKeys(raw, fields);
  if (!/^[a-f\d-]{36}$/i.test(runNonce) || raw.schemaVersion !== 1 || raw.runNonce !== runNonce || raw.mode !== mode ||
      !["synthetic", "live"].includes(mode)) throw new Error("business-receipt-invalid");
  if (![safeAreaTop, safeAreaBottom].every(n => Number.isInteger(n) && n >= 0 && n <= 200)) throw new Error("business-geometry-invalid");
  for (const field of fields.filter(key => !["schemaVersion", "runNonce", "mode", "phases"].includes(key))) {
    if (typeof raw[field] !== "boolean") throw new Error("business-receipt-invalid");
  }
  if (requiredChecks.some(field => raw[field] !== true) ||
      (mode === "synthetic" && (!raw.streamedBeforeTerminal || !raw.logout || !raw.screenshotCaptured)) ||
      (mode === "live" && (raw.screenshotCaptured || raw.logout))) throw new Error("business-check-failed");
  if (!Array.isArray(raw.phases) || raw.phases.length !== 2) throw new Error("business-geometry-invalid");
  const phases = raw.phases.map((item, i) => {
    exactKeys(item, ["phase", "control", "keyboard", "window"]);
    if (item.phase !== ["composer", "send"][i]) throw new Error("business-geometry-invalid");
    const control = frame(item.control), keyboard = frame(item.keyboard), window = frame(item.window);
    const [x, y, w, h] = control, [wx, wy, ww, wh] = window;
    if (x < wx - 1 || x + w > wx + ww + 1 || y < wy + safeAreaTop - 1 ||
        y + h > Math.min(keyboard[1], wy + wh - safeAreaBottom) - 1 || keyboard[1] <= wy + safeAreaTop || keyboard[1] >= wy + wh) throw new Error("business-geometry-invalid");
    return { phase: item.phase, control, keyboard, window };
  });
  const receipt = Object.fromEntries(fields.filter(key => key !== "phases").map(key => [key, raw[key]]));
  receipt.phases = phases;
  return receipt;
}

export function parseBusinessEvidence(output, options) {
  const receipts = String(output).split(/\r?\n/).filter(line => line.startsWith("DENGTA_BUSINESS_EVIDENCE:"));
  if (receipts.length !== 1) throw new Error("business-receipt-missing");
  return validateBusinessEvidence(JSON.parse(receipts[0].slice("DENGTA_BUSINESS_EVIDENCE:".length)), options);
}

/** Credentials go to the XCTest runner at execution time, never the app/build. */
export function runtimeXctestrun(buildDocument, environment) {
  if (!environment || Object.keys(environment).some(key => !BUSINESS_ENV_KEYS.includes(key)) ||
      Object.values(environment).some(value => typeof value !== "string" || value.length > 200_000)) throw new Error("business-runtime-environment-invalid");
  const document = structuredClone(buildDocument);
  let matches = 0;
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (!Array.isArray(value) && (value.BlueprintName === "AppUITests" || /(?:^|\/)AppUITests\.xctest$/.test(value.TestBundlePath || ""))) {
      value.EnvironmentVariables = { ...value.EnvironmentVariables, ...environment };
      value.OnlyTestIdentifiers = ["BusinessFlowTests/testCoreBusinessFlow"];
      matches += 1;
      return;
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(document);
  if (matches !== 1) throw new Error("business-test-target-invalid");
  return document;
}
