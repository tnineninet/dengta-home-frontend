import assert from "node:assert/strict";
import { normalizeCompanionActivities } from "../src/companion-activities.js";

assert.deepEqual(normalizeCompanionActivities(null), []);
assert.deepEqual(normalizeCompanionActivities([{ id: "x", kind: "pay" }, { id: "<invalid>", kind: "music" }]), []);
const result = normalizeCompanionActivities([{ id: "test-1", kind: "bilibili", videos: [{ bvid: "BV1234567890", title: "测试", page_url: "javascript:private" }, { bvid: "BV1234567890" }, { bvid: "bad" }] }]);
assert.equal(result[0].videos.length, 1);
assert.equal(result[0].videos[0].pageUrl, "https://www.bilibili.com/video/BV1234567890");
assert.equal(normalizeCompanionActivities([{ id: "a", kind: "music", query: "a".repeat(300) }])[0].query.length, 120);
console.log("Companion activity normalization passed: bounded receipts, allowlisted modules and canonical video links.");
