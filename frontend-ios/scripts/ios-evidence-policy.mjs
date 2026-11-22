const STAGES = new Set([
  "bridge-created", "bridge-keychain-available", "bridge-keychain-missing",
  "protected-data-available", "protected-data-unavailable",
  "keychain-read", "keychain-update", "keychain-add", "keychain-delete",
  "probe-add", "probe-read", "probe-delete", "probe-deleted-read", "probe-roundtrip",
]);
const STATES = new Set(["unconfigured", "loading", "anonymous", "authenticating", "recovery", "authenticated", "expired", "error", "unknown"]);
const UI_BOOLS = ["ready", "controls", "blocked", "keyboardOpen", "androidMarker", "apkEntry"];
const UI_NUMBERS = ["sample", "viewportHeight", "viewportOffsetTop", "innerHeight", "safeAreaTop", "safeAreaBottom"];
const exactKeys = (object, keys) => object && typeof object === "object" && !Array.isArray(object) && Object.keys(object).every(key => keys.includes(key));
const safeError = () => new Error("Invalid simulator evidence schema or launch identity.");

export function validateKeychainReceipt(value, nonce) {
  if (!exactKeys(value, ["schemaVersion", "runNonce", "events"]) || value.schemaVersion !== 1 || value.runNonce !== nonce ||
      !Array.isArray(value.events) || value.events.length > 64) throw safeError();
  for (const event of value.events) {
    if (!exactKeys(event, ["stage", "status", "verified"]) || !STAGES.has(event.stage) ||
        ("status" in event && !Number.isInteger(event.status)) ||
        ("verified" in event && typeof event.verified !== "boolean")) throw safeError();
  }
  const last = stage => value.events.findLast(event => event.stage === stage);
  const passed = Boolean(last("bridge-keychain-available") && last("protected-data-available") &&
    ["probe-add", "probe-read", "probe-delete"].every(stage => last(stage)?.status === 0) &&
    last("probe-deleted-read")?.status === -25300 && last("probe-roundtrip")?.verified === true &&
    !last("bridge-keychain-missing") && !last("protected-data-unavailable"));
  return { receipt: value, passed };
}

export function validateUiReceipt(value, nonce) {
  if (!exactKeys(value, ["schemaVersion", "runNonce", "state", ...UI_BOOLS, ...UI_NUMBERS]) ||
      value.schemaVersion !== 2 || value.runNonce !== nonce || !STATES.has(value.state) ||
      !UI_BOOLS.every(key => typeof value[key] === "boolean") ||
      !UI_NUMBERS.every(key => Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= 10000)) throw safeError();
  const passed = value.state === "anonymous" && value.ready && value.controls && !value.blocked &&
    !value.androidMarker && !value.apkEntry && value.viewportHeight > 0;
  return { receipt: value, passed };
}

export function mayCaptureAnonymousScreen(receipt) {
  return Boolean(receipt && ["anonymous", "loading", "unconfigured", "expired", "error"].includes(receipt.state));
}
