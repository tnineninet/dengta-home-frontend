import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const script = fs.readFileSync(new URL("../ios/App/App/DengTaReadiness.js", import.meta.url), "utf8");
function fixture() {
  const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
  const page = { rect: box(0, 0, 400, 800), style: { overflowY: "auto" }, parentElement: null };
  page.getBoundingClientRect = () => page.rect;
  const elements = [100, 200, 300].map(top => ({ disabled: false, parentElement: page, rect: box(20, top, 360, 48),
    style: {}, contains: () => false, getBoundingClientRect() { return this.rect; } }));
  const selectors = ['input[type="email"]', 'input[type="password"]', 'button[type="submit"]'];
  const f = { prelude: false, covered: false, elements, page, box };
  const document = {
    documentElement: { dataset: { authStatus: "anonymous" } },
    querySelector(selector) {
      if (selector === ".auth-form") return { querySelector: key => elements[selectors.indexOf(key)] };
      if (selector.startsWith(".dengta-prelude")) return f.prelude ? {} : null;
      return null;
    },
    elementFromPoint(x, y) {
      if (f.covered) return {};
      return elements.find(e => x >= e.rect.left && x <= e.rect.right && y >= e.rect.top && y <= e.rect.bottom) || null;
    },
  };
  f.read = () => vm.runInNewContext(script, { document, window: { visualViewport: { width: 400, height: 800 } },
    innerWidth: 400, innerHeight: 800, getComputedStyle: e => ({ display: "block", visibility: "visible", opacity: "1", overflowX: "visible", overflowY: "visible", ...e.style }) });
  return f;
}

test("actual bundled readiness script accepts a fully visible anonymous login form", () => {
  const f = fixture(); assert.equal(f.read().ready, true);
});

for (const condition of ["offscreen", "clipped", "hidden", "transparent-ancestor", "disabled", "covered", "prelude"]) {
  test(`actual bundled readiness script rejects ${condition} controls`, () => {
    const f = fixture();
    if (condition === "offscreen") f.elements[2].rect = f.box(20, 780, 360, 48);
    if (condition === "clipped") f.page.rect = f.box(0, 0, 400, 250);
    if (condition === "hidden") f.elements[0].style.visibility = "hidden";
    if (condition === "transparent-ancestor") f.page.style.opacity = "0";
    if (condition === "disabled") f.elements[1].disabled = true;
    if (condition === "covered") f.covered = true;
    if (condition === "prelude") f.prelude = true;
    assert.equal(f.read().ready, false);
  });
}
