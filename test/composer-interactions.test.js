import assert from "node:assert/strict";
import {
  shouldSubmitComposerKeyDown,
  transitionComposerOverlays,
} from "../src/composer-interactions.js";

assert.equal(
  shouldSubmitComposerKeyDown({ key: "Enter", shiftKey: false }),
  true,
  "plain Enter submits the composer",
);
assert.equal(
  shouldSubmitComposerKeyDown({ key: "Enter", shiftKey: true }),
  false,
  "Shift+Enter inserts a line break",
);
assert.equal(
  shouldSubmitComposerKeyDown({
    key: "Enter",
    isComposing: true,
    nativeEvent: { isComposing: true },
  }),
  false,
  "Enter must not submit while an IME composition is active",
);
assert.equal(
  shouldSubmitComposerKeyDown({
    key: "Enter",
    nativeEvent: { isComposing: true },
  }),
  false,
  "the native IME state alone must also block submission",
);
assert.equal(
  shouldSubmitComposerKeyDown({
    key: "Enter",
    keyCode: 229,
    nativeEvent: { keyCode: 229 },
  }),
  false,
  "legacy Android IME Enter events must not submit",
);

assert.deepEqual(
  transitionComposerOverlays(
    { statusExpanded: true, composerMenuOpen: false },
    "open-composer-menu",
  ),
  { statusExpanded: false, composerMenuOpen: true },
);
assert.deepEqual(
  transitionComposerOverlays(
    { statusExpanded: false, composerMenuOpen: true },
    "open-status",
  ),
  { statusExpanded: true, composerMenuOpen: false },
);
assert.deepEqual(
  transitionComposerOverlays(
    { statusExpanded: true, composerMenuOpen: true },
    "focus-input",
  ),
  { statusExpanded: false, composerMenuOpen: false },
);

console.log("composer interaction tests passed");
