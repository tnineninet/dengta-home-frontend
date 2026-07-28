import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function keyframeBlocks(styles, prefixPattern) {
  const blocks = [];
  const matcher = new RegExp(`@keyframes\\s+(${prefixPattern}[^\\s{]*)\\s*\\{`, "g");
  for (const match of styles.matchAll(matcher)) {
    let depth = 1;
    let cursor = match.index + match[0].length;
    while (cursor < styles.length && depth > 0) {
      if (styles[cursor] === "{") depth += 1;
      if (styles[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    blocks.push(styles.slice(match.index, cursor));
  }
  return blocks;
}

test("the companion pulse uses compositor motion instead of repainting an SVG dash", () => {
  const statusSource = read("src/CompanionStatus.jsx");
  const styles = read("src/native-feel.css");

  assert.doesNotMatch(
    statusSource,
    /<path[^>]*className="status-pulse-runner"/,
  );
  assert.match(styles, /\.status-pulse-runner[\s\S]*translate3d/);
  assert.doesNotMatch(
    styles,
    /\.status-pulse-runner[\s\S]{0,500}stroke-dashoffset/,
  );
});

test("the launch prelude and overlay motion only animate compositor properties", () => {
  const prelude = read("src/DengTaPrelude.jsx");
  const chatMessage = read("src/ChatMessage.jsx");
  const styles = read("src/native-feel.css");

  assert.match(prelude, /className="dengta-prelude"/);
  assert.match(
    prelude,
    /data-word="DENGTA"/,
    "the launch thread must resolve into the DENGTA wordmark",
  );
  assert.doesNotMatch(
    chatMessage,
    /key=\{`\$\{item\.id\}-\$\{item\.isStreaming/,
  );
  assert.match(styles, /@keyframes dengta-signature-settle/);
  assert.match(styles, /@keyframes native-sheet-enter/);
  assert.match(styles, /@keyframes native-nav-settle/);
  assert.match(styles, /@keyframes native-weather-unfold/);
  assert.doesNotMatch(
    keyframeBlocks(styles, "(?:dengta|native)").join("\n"),
    /(?:height|width|margin|padding|top|left)\s*:/,
  );
});

test("long repeated content can skip offscreen layout and reduced motion is supported", () => {
  const styles = read("src/native-feel.css");

  assert.match(styles, /content-visibility:\s*auto/);
  assert.match(styles, /contain-intrinsic-size:/);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/);
});
