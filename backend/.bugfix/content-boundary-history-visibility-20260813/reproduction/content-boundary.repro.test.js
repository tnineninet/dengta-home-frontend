const assert = require("node:assert/strict");
const {
    isProviderBoundaryResidue,
    filterMemoriesForContext,
    screenGeneratedMemorySummary
} = require("../../../services/persistent-memory-filter");
const {
    isProviderErrorDocument,
    providerOutputVerdict
} = require("../../../services/provider-output-guard");

const boundaryDiscussion = "我拒绝了上一版边界讨论，随后解释了为什么不能继续。";
const adultTheme = "这是明确成年角色之间的成人主题讨论，但不是协议错误。";
const html = "<!doctype html><html><body>gateway denied</body></html>";
const json = '{"message":"gateway denied","code":"policy_denied"}';

assert.equal(isProviderBoundaryResidue(boundaryDiscussion), false);
assert.equal(isProviderBoundaryResidue(adultTheme), false);
assert.equal(screenGeneratedMemorySummary(boundaryDiscussion).text, boundaryDiscussion);
assert.deepEqual(filterMemoriesForContext([{ id: "boundary", summary: boundaryDiscussion }]), [
    { id: "boundary", summary: boundaryDiscussion }
]);
assert.equal(isProviderErrorDocument(json), false);
assert.equal(providerOutputVerdict(json, { final: true }), "safe");
assert.equal(isProviderErrorDocument(html), false);
assert.equal(providerOutputVerdict(html, { final: true }), "safe");

console.log("reproduction scenario completed");
