"use strict";

const FILLER_PATTERNS = [
    /帮我(?:点|叫|找|选|买)?/g,
    /给我(?:点|叫|找|选|买)?/g,
    /我想(?:吃|喝|要)/g,
    /想吃/g,
    /想喝/g,
    /来一份/g,
    /点一份/g,
    /一份/g,
    /一点/g,
    /随便/g,
    /不知道吃(?:什么|啥)/g
];

const CONCRETE_FOOD = /(馄饨|饺子|面|饭|粥|汤|麻辣烫|烧烤|火锅|汉堡|披萨|寿司|炸鸡|奶茶|咖啡|豆浆|包子|煎饼|米线|粉丝|冒菜|轻食|沙拉)/g;

function normalizeTakeoutSearchKeyword(value) {
    const raw = String(value || "").replace(/[，。！？、,.!?；;：:]/g, " ").replace(/\s+/g, " ").trim();
    if (!raw) return "单人餐";
    const hints = [];
    if (/热乎|热汤|暖胃|暖和|汤面|馄饨|粥/.test(raw)) hints.push("热汤 馄饨 粥");
    if (/一人食|一个人|单人|独自/.test(raw)) hints.push("单人餐 套餐");
    if (/清淡|少油|不辣|养胃/.test(raw)) hints.push("清淡 粥 蒸菜");
    if (/喝|饮|奶茶|咖啡|豆浆/.test(raw)) hints.push("奶茶 咖啡 饮品");
    if (/夜宵|宵夜/.test(raw)) hints.push("夜宵 小吃");
    const concrete = [...new Set(raw.match(CONCRETE_FOOD) || [])];
    let cleaned = raw;
    for (const pattern of FILLER_PATTERNS) cleaned = cleaned.replace(pattern, " ");
    cleaned = cleaned.replace(/\s+/g, " ").trim();
    const hintTokens = hints.flatMap(hint => hint.split(" "));
    const terms = concrete.length || hintTokens.length
        ? [...new Set([...concrete, ...hintTokens])]
        : [cleaned];
    return (terms.filter(Boolean).slice(0, 3).join(" ") || cleaned || "单人餐").slice(0, 80);
}

module.exports = { normalizeTakeoutSearchKeyword };
