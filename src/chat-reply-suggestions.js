const SUGGESTION_RULES = [
  {
    pattern: /喝酒|醉|酒气|微醺|抱抱|抱我|拥抱|搂/,
    suggestions: ["过来，抱抱小乖乖", "才不要呢，臭男人"],
  },
  {
    pattern: /难过|委屈|想哭|哭了|低落|不开心|心疼/,
    suggestions: ["来我这里，我会陪着你", "先告诉我，谁让你难过了"],
  },
  {
    pattern: /对不起|抱歉|错了|原谅/,
    suggestions: ["好吧，这次原谅你", "还不够，再认真哄哄我"],
  },
  {
    pattern: /吃醋|醋意|嫉妒|别人|不许看/,
    suggestions: ["好啦，我最在意的是你", "你吃醋的样子怎么这么可爱"],
  },
  {
    pattern: /累了|好累|困了|疲惫|休息|睡觉|晚安/,
    suggestions: ["靠过来休息一会儿吧", "不许硬撑，先乖乖去睡"],
  },
  {
    pattern: /害怕|怕了|担心|不安|做噩梦/,
    suggestions: ["别怕，我会一直在这里", "抓紧我的手，我们一起面对"],
  },
  {
    pattern: /想你|喜欢你|爱你|亲亲|亲我|心动/,
    suggestions: ["我也想你，再靠近一点", "哼，就只会说好听的话"],
  },
  {
    pattern: /生气|气死|不理你|讨厌/,
    suggestions: ["不气了，让我好好哄你", "那你先说，准备怎么赔我"],
  },
];

export function createReplySuggestions({ assistantText, mood } = {}) {
  const text = String(assistantText || "").trim();
  if (!text) return [];

  const context = `${text} ${String(mood || "")}`;
  const matched = SUGGESTION_RULES.find((rule) => rule.pattern.test(context));
  return matched
    ? [...matched.suggestions]
    : ["好，我在认真听", "哼，那你再哄哄我"];
}
