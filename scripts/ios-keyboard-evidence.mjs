const PHASES = ["login-email", "login-password", "login-submit", "register-confirmation", "register-submit", "forgot-email", "forgot-submit"];
const exact = (object, keys) => object && !Array.isArray(object) && typeof object === "object" &&
  Object.keys(object).length === keys.length && keys.every(key => key in object);
const rect = value => Array.isArray(value) && value.length === 4 && value.every(n => Number.isInteger(n) && n >= 0 && n <= 10000) && value[2] > 0 && value[3] > 0;
const bad = () => new Error("Keyboard UI evidence is missing, unsafe or outside the visible safe frame.");

export function validateKeyboardEvidence(output, nativeUi) {
  const lines = output.split(/\r?\n/).filter(line => line.startsWith("DENGTA_KEYBOARD_EVIDENCE:"));
  if (lines.length !== 1 || !/Executed 1 test, with 0 failures/.test(output) ||
      !/testAnonymousKeyboardLayout.*passed/.test(output)) throw bad();
  let receipt;
  try { receipt = JSON.parse(lines[0].slice("DENGTA_KEYBOARD_EVIDENCE:".length)); } catch { throw bad(); }
  if (!exact(receipt, ["schemaVersion", "runNonce", "phases", "submitted"]) || receipt.schemaVersion !== 1 || receipt.submitted !== false ||
      !/^[A-F0-9]{8}-[A-F0-9]{4}-4[A-F0-9]{3}-[89AB][A-F0-9]{3}-[A-F0-9]{12}$/.test(receipt.runNonce || "") ||
      !Array.isArray(receipt.phases) || receipt.phases.length !== PHASES.length ||
      !Number.isInteger(nativeUi?.safeAreaTop) || !Number.isInteger(nativeUi?.safeAreaBottom)) throw bad();
  for (const [index, phase] of receipt.phases.entries()) {
    if (!exact(phase, ["phase", "keyboardVisible", "controlVisible", "control", "keyboard", "window"]) ||
        phase.phase !== PHASES[index] || phase.keyboardVisible !== true || phase.controlVisible !== true ||
        ![phase.control, phase.keyboard, phase.window].every(rect)) throw bad();
    const [x, y, width, height] = phase.control, [wx, wy, ww, wh] = phase.window, [kx, ky, kw, kh] = phase.keyboard;
    if (x < wx - 1 || x + width > wx + ww + 1 || y < wy + nativeUi.safeAreaTop - 1 ||
        y + height > Math.min(ky, wy + wh - nativeUi.safeAreaBottom) - 1 ||
        kx < wx - 1 || kx + kw > wx + ww + 1 || ky <= wy + nativeUi.safeAreaTop || ky + kh > wy + wh + 1) throw bad();
  }
  return receipt;
}
