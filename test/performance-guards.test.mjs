import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("agent mark stays static by default and touch never starts the 426KB webp", () => {
    const source = read("src/RainbowAgentMark.jsx");
    assert.match(source, /rainbow-agent-mark-static\.png/);
    assert.match(source, /pointerType !== "mouse"/);
    assert.match(source, /prefers-reduced-motion/);
    assert.match(source, /hover: hover/);
});

test("static first frame asset exists and stays small", () => {
    const file = path.join(root, "public", "assets", "rainbow-agent-mark-static.png");
    const size = fs.statSync(file).size;
    assert.ok(size > 0 && size < 64 * 1024, `static mark too large: ${size}`);
});

test("hidden/scroll pause contract and low-data font fallback stay wired", () => {
    const main = read("src/main.jsx");
    assert.match(main, /dengtaHidden =/);
    assert.match(main, /dengtaScrolling = "1"/);
    assert.match(main, /dengtaLowData/);
    const css = read("src/index.css");
    assert.match(css, /data-dengta-hidden="1"/);
    assert.match(css, /animation-play-state: paused !important/);
    const typography = read("src/typography.css");
    assert.match(typography, /data-dengta-low-data="1"/);
});
