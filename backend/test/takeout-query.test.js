const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeTakeoutSearchKeyword } = require("../services/takeout-query");

test("colloquial takeout desires become platform search keywords", () => {
    assert.equal(normalizeTakeoutSearchKeyword("想吃一份热乎的一人食"), "热汤 馄饨 粥");
    assert.equal(normalizeTakeoutSearchKeyword("热乎 一人食"), "热汤 馄饨 粥");
    assert.equal(normalizeTakeoutSearchKeyword("清淡一点"), "清淡 粥 蒸菜");
    assert.equal(normalizeTakeoutSearchKeyword("喝点好喝的"), "奶茶 咖啡 饮品");
    assert.equal(normalizeTakeoutSearchKeyword("肯德基"), "肯德基");
});

test("specific food words survive and filler is removed", () => {
    const value = normalizeTakeoutSearchKeyword("帮我点一份馄饨");
    assert.match(value, /馄饨/);
    assert.doesNotMatch(value, /帮我|点一份/);
});
