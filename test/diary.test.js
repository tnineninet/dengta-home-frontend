import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(
  new URL("../public/secret-crush-diary.html", import.meta.url),
  "utf8",
);

assert.match(html, /<!DOCTYPE html>/i);
assert.match(html, /<style>[\s\S]*<\/style>/);
assert.match(html, /<script>[\s\S]*<\/script>/);
assert.doesNotMatch(html, /<link[^>]+stylesheet/i);
assert.doesNotMatch(html, /<script[^>]+src=/i);
assert.doesNotMatch(html, /https?:\/\//i);

const dataMatch = html.match(
  /<script id="diary-data" type="application\/json">([\s\S]*?)<\/script>/,
);
assert.ok(dataMatch, "diary JSON data must exist inside the HTML file");

const data = JSON.parse(dataMatch[1]);
assert.equal(data.stories.length, 3);

for (const story of data.stories) {
  assert.match(story.profile.name, /^\d{4}$/);
  assert.ok(story.profile.bio.length >= 8);
  assert.match(story.profile.color, /^#[0-9a-f]{6}$/i);

  const publicEntries = story.entries.filter((entry) => entry.type === "public");
  const privateEntries = story.entries.filter((entry) => entry.type === "private");
  assert.ok(publicEntries.length >= 8 && publicEntries.length <= 12);
  assert.ok(privateEntries.length >= 1 && privateEntries.length <= 2);
  assert.match(publicEntries[0].date, /^09-/);
  assert.match(publicEntries.at(-1).date, /^06-/);

  for (const entry of publicEntries) {
    assert.ok(entry.source === "iPhone" || entry.source === "微博 weibo.com");
    assert.ok(Number.isInteger(entry.likes));
    assert.ok(Number.isInteger(entry.comments));
    assert.ok(Number.isInteger(entry.reposts));
  }

  for (const entry of privateEntries) {
    assert.equal(entry.date, undefined);
    assert.equal(entry.likes, undefined);
    assert.ok(entry.content.length >= 80);
  }
}

const serviceWorker = await readFile(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);
assert.match(serviceWorker, /dengta-home-v8/);
assert.match(serviceWorker, /"\/secret-crush-diary\.html"/);
assert.match(serviceWorker, /cache\.put\(request, copy\)/);

console.log("single-file secret crush diary tests passed");
