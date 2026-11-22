const assert = require("node:assert/strict");
const {
    pickNurseryEventMessage
} = require("../services/nursery-events");

const oldMessage = "小朋友醒了，正哭着找我们。她小声说：“在呢”";
const next = pickNurseryEventMessage({
    childName: "小朋友",
    utterance: "在呢",
    eventId: "event-1",
    recentMessages: [{ content: oldMessage }]
});
assert.notEqual(next, oldMessage);
assert.match(next, /小朋友/);
assert.match(next, /在呢/);

const manyRecent = [
    "小朋友醒了，正哭着找我们。她小声说：“在呢”",
    "小朋友在梦里翻了个身，醒了，正揉着眼睛找我们。她小声说：“在呢”",
    "小朋友半夜醒了，往我们这边挪了挪。她小声说：“在呢”",
    "小朋友醒了，哭声有点哑，伸着手要我们抱。她小声说：“在呢”",
    "小朋友忽然醒了，抱着小被子看向我们这边。她小声说：“在呢”"
].map((content) => ({ content }));
const varied = pickNurseryEventMessage({
    childName: "小朋友",
    utterance: "在呢",
    eventId: "event-2",
    recentMessages: manyRecent
});
assert.ok(varied);
assert.equal(
    manyRecent.some((item) => item.content === varied),
    false,
    "all recent templates should be avoided when possible"
);

console.log("nursery event message variation tests passed");
