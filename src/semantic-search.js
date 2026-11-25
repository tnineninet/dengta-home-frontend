import MiniSearch from "minisearch";

export const SEMANTIC_SYNONYM_GROUPS = [
  ["发烧", "发热", "高烧", "低烧", "退烧", "体温高", "发烫", "解热", "寒战"],
  ["头痛", "头疼", "偏头痛", "牙痛", "牙疼", "痛经", "姨妈痛", "关节痛", "肌肉酸痛", "止痛", "镇痛"],
  ["感冒", "流鼻涕", "流涕", "鼻塞", "打喷嚏", "着凉", "受凉", "风寒", "风热", "上呼吸道"],
  ["咳嗽", "干咳", "咳痰", "有痰", "喉咙痒", "咽痛", "喉咙痛", "嗓子疼", "嗓子痛", "止咳", "化痰", "祛痰"],
  ["拉肚子", "腹泻", "水样便", "肠胃炎", "吃坏肚子", "肚子疼", "止泻", "补液", "脱水"],
  ["胃痛", "胃疼", "胃酸", "反酸", "烧心", "胃胀", "胀气", "消化不良", "积食", "养胃", "护胃", "恶心"],
  ["过敏", "起疹子", "荨麻疹", "皮肤痒", "瘙痒", "湿疹", "花粉", "过敏性鼻炎", "抗组胺", "打喷嚏"],
  ["外伤", "擦伤", "割伤", "破皮", "消毒", "化脓", "皮肤感染", "消炎药膏", "创可贴", "伤口"],
  ["眼干", "干眼", "干涩", "眼睛干涩", "磨眼", "眼疲劳", "视疲劳", "眼睛酸", "眼涩", "泪膜", "人工泪液", "玻璃酸钠", "海露", "思然"],
  ["口腔溃疡", "咽喉肿痛", "声音嘶哑", "扁桃体", "含片", "喉糖"],
  ["熬夜", "失眠", "睡不着", "补水", "维生素", "免疫力", "乏力", "疲劳"],
  ["酒精", "喝酒", "饮酒", "啤酒", "白酒", "双硫仑", "肝损伤", "胃出血"],
  ["开车", "驾驶", "驾车", "嗜睡", "困倦", "高空作业"],
  ["孕妇", "怀孕", "妊娠", "哺乳", "备孕", "儿童", "小孩"],
  ["外卖", "点餐", "吃饭", "午饭", "晚饭", "夜宵", "轻食", "预算", "配送", "加购", "美团", "饿了么", "京东到家"],
  ["清淡", "暖胃", "热汤", "馄饨", "粥", "蒸菜", "少油", "不辣"],
  ["报错", "错误", "崩溃", "失败", "超时", "日志", "定位", "故障", "诊断", "网络异常", "502", "401", "429"],
  ["记忆", "世界书", "人设", "提示词", "上下文", "知识库", "检索", "语义", "token", "预算"],
  ["语音", "朗读", "TTS", "麦克风", "转写", "情绪", "声音"],
  ["音乐", "歌单", "网易云", "一起听", "一起看", "投屏", "放映厅", "灵动岛", "彩虹胶囊"],
  ["眼轴", "眼轴长度", "轴长", "高度近视", "近视防控", "阿托品", "al", "iolmaster"],
  ["角膜厚度", "中央角膜厚度", "薄角膜", "最薄点", "顶点厚度", "cct", "pachy", "pachymetry", "pentacam"],
  ["剩余基质床", "基质床", "安全红线", "角膜扩张", "组织改变", "rsb", "pta", "切削深度", "ablation", "munnerlyn", "zeiss", "mel90"],
  ["圆锥角膜", "角膜陡峭", "揉眼", "最大曲率", "后表面", "kmax", "k1", "k2", "bad-d", "角膜地形图"],
  ["眼压", "高眼压", "青光眼", "激素性高眼压", "降眼压", "杯盘比", "视神经", "iop", "nct", "噻吗洛尔", "布林佐胺", "拉坦前列素"],
  ["散瞳", "浅前房", "前房深度", "窄房角", "闭角", "美多丽", "托吡卡胺", "acd", "wtw", "icl"],
  ["屈光手术", "近视手术", "全飞秒", "半飞秒", "全激光", "表层手术", "tprk", "prk", "smile", "lasik"],
  ["haze", "雾状混浊", "防haze", "氟米龙", "丝裂霉素", "mmc", "激素阶梯"],
  ["暗瞳", "眩光", "炫光", "光晕", "光学区", "等效球镜", "散光", "球镜", "柱镜", "轴位", "oz", "pupil", "sphere", "cylinder", "溴莫尼定"],
];

const CJK_RUN_PATTERN = /[\u4e00-\u9fff]+/g;
const LATIN_RUN_PATTERN = /[a-z0-9][a-z0-9._+-]{1,31}/gi;
const STOP_SINGLE_CHARS = new Set("的了是在我有和就不人都一个上也很到说要去你会着没有看好好吃想帮我给把吗呢啊吧呀哦".split(""));

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().trim();
}

export function estimateTextTokens(text) {
  const raw = String(text || "");
  if (!raw) return 0;
  const cjk = (raw.match(/[\u4e00-\u9fff]/g) || []).length;
  const rest = raw.length - cjk;
  return Math.max(1, Math.ceil(cjk * 0.75 + rest * 0.3));
}

export function tokenizeCjkHybrid(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const tokens = [];
  const latin = normalized.match(LATIN_RUN_PATTERN) || [];
  for (const word of latin) tokens.push(word);

  const cjkRuns = normalized.match(CJK_RUN_PATTERN) || [];
  for (const run of cjkRuns) {
    if (run.length <= 4) tokens.push(run);
    for (let i = 0; i < run.length - 1; i += 1) tokens.push(run.slice(i, i + 2));
    for (let i = 0; i < run.length - 2; i += 1) tokens.push(run.slice(i, i + 3));
    if (run.length === 1 && !STOP_SINGLE_CHARS.has(run)) tokens.push(run);
  }
  return tokens;
}

function extractConceptMatches(text) {
  const normalized = normalizeText(text);
  if (!normalized) return { groupIds: [], matchedLabels: [] };
  const matchedGroups = new Set();
  const matchedLabels = [];
  for (let i = 0; i < SEMANTIC_SYNONYM_GROUPS.length; i += 1) {
    const group = SEMANTIC_SYNONYM_GROUPS[i];
    const hit = group.find((term) => normalized.includes(term.toLowerCase()));
    if (hit) {
      matchedGroups.add(i);
      matchedLabels.push(hit);
    }
  }
  return { groupIds: [...matchedGroups], matchedLabels };
}

export function expandSemanticTokens(text) {
  const baseTokens = tokenizeCjkHybrid(text);
  const { groupIds, matchedLabels } = extractConceptMatches(text);
  const expanded = [...baseTokens];
  for (const gid of groupIds) {
    expanded.push(`__concept_${gid}`);
    for (const synonym of SEMANTIC_SYNONYM_GROUPS[gid]) {
      expanded.push(synonym.toLowerCase());
      for (const sub of tokenizeCjkHybrid(synonym)) expanded.push(sub);
    }
  }
  return {
    tokens: expanded,
    baseTokens: [...new Set(baseTokens)],
    conceptIds: groupIds,
    expandedConcepts: [...new Set(matchedLabels)],
  };
}

function buildFrequencyMap(tokens) {
  const freq = new Map();
  for (const token of tokens) freq.set(token, (freq.get(token) || 0) + 1);
  return freq;
}

function cosineSimilarity(vecA, vecB, idfMap) {
  if (!vecA.size || !vecB.size) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [term, countA] of vecA.entries()) {
    const wA = (1 + Math.log(countA)) * (idfMap.get(term) || 1);
    normA += wA * wA;
    const countB = vecB.get(term);
    if (countB) {
      const wB = (1 + Math.log(countB)) * (idfMap.get(term) || 1);
      dot += wA * wB;
    }
  }
  for (const [term, countB] of vecB.entries()) {
    const wB = (1 + Math.log(countB)) * (idfMap.get(term) || 1);
    normB += wB * wB;
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function buildSnippet(content, terms, maxLen = 150) {
  const raw = String(content || "").replace(/\s+/g, " ").trim();
  if (raw.length <= maxLen) return raw;
  const lower = raw.toLowerCase();
  let bestIdx = -1;
  for (const term of terms) {
    if (!term || term.startsWith("__") || term.length < 2) continue;
    const idx = lower.indexOf(term.toLowerCase());
    if (idx >= 0 && (bestIdx === -1 || idx < bestIdx)) bestIdx = idx;
  }
  if (bestIdx < 0) return raw.slice(0, maxLen) + "…";
  const start = Math.max(0, bestIdx - 28);
  const end = Math.min(raw.length, start + maxLen);
  return `${start > 0 ? "…" : ""}${raw.slice(start, end)}${end < raw.length ? "…" : ""}`;
}

export function createHybridSemanticIndex(documents = []) {
  const safeDocs = (Array.isArray(documents) ? documents : []).filter((doc) => doc && doc.id);
  const docById = new Map();
  const docVectors = new Map();
  const docConcepts = new Map();
  const df = new Map();

  const miniSearch = new MiniSearch({
    fields: ["title", "tagsText", "content"],
    storeFields: ["id"],
    tokenize: (text) => tokenizeCjkHybrid(text),
    processTerm: (term) => term.toLowerCase(),
    searchOptions: {
      boost: { title: 3.0, tagsText: 2.2, content: 1.0 },
      prefix: true,
      fuzzy: 0.15,
      combineWith: "OR",
    },
  });

  const indexedRows = safeDocs.map((doc) => {
    const title = String(doc.title || "");
    const tagsText = Array.isArray(doc.tags) ? doc.tags.join(" ") : String(doc.tags || "");
    const content = String(doc.content || "");
    const fullText = `${title} ${title} ${tagsText} ${tagsText} ${content}`;
    const expanded = expandSemanticTokens(fullText);
    const freq = buildFrequencyMap(expanded.tokens);
    docById.set(String(doc.id), doc);
    docVectors.set(String(doc.id), freq);
    docConcepts.set(String(doc.id), new Set(expanded.conceptIds));
    for (const term of freq.keys()) df.set(term, (df.get(term) || 0) + 1);
    return { id: String(doc.id), title, tagsText, content };
  });

  if (indexedRows.length) miniSearch.addAll(indexedRows);

  const totalDocs = Math.max(1, indexedRows.length);
  const idfMap = new Map();
  for (const [term, count] of df.entries()) {
    idfMap.set(term, Math.log(1 + (totalDocs - count + 0.5) / (count + 0.5)) + 1);
  }

  function search(query, { limit = 20, mode = "hybrid", category = "", rrfK = 20 } = {}) {
    const started = typeof performance !== "undefined" ? performance.now() : Date.now();
    const rawQuery = normalizeText(query);
    const filteredIds = category
      ? new Set(safeDocs.filter((d) => d.category === category).map((d) => String(d.id)))
      : null;

    if (!rawQuery) {
      const base = safeDocs
        .filter((d) => !filteredIds || filteredIds.has(String(d.id)))
        .slice(0, limit)
        .map((doc) => ({
          doc,
          bm25Score: 0,
          semanticScore: 0,
          rrfScore: 0,
          matchedTerms: [],
          expandedConcepts: [],
          snippet: buildSnippet(doc.content, []),
          estimatedTokens: estimateTextTokens(`${doc.title}\n${doc.content}`),
        }));
      const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;
      return {
        results: base,
        query: "",
        mode,
        expandedConcepts: [],
        latencyMs: Number(elapsed.toFixed(2)),
        totalIndexed: safeDocs.length,
      };
    }

    const qExpanded = expandSemanticTokens(rawQuery);
    const qVec = buildFrequencyMap(qExpanded.tokens);
    const queryConceptSet = new Set(qExpanded.conceptIds);

    const bm25QueryText = mode === "bm25" ? rawQuery : [rawQuery, ...qExpanded.expandedConcepts].join(" ");
    const rawBm25Hits = indexedRows.length
      ? miniSearch.search(bm25QueryText).filter((hit) => !filteredIds || filteredIds.has(String(hit.id)))
      : [];
    const maxBm25 = rawBm25Hits.length ? Math.max(0.001, rawBm25Hits[0].score) : 1;
    const bm25RankMap = new Map();
    const bm25ScoreMap = new Map();
    const bm25TermsMap = new Map();
    rawBm25Hits.forEach((hit, index) => {
      const id = String(hit.id);
      bm25RankMap.set(id, index + 1);
      bm25ScoreMap.set(id, Math.min(1, hit.score / maxBm25));
      bm25TermsMap.set(id, Array.isArray(hit.terms) ? hit.terms.slice(0, 6) : []);
    });

    const semanticScored = [];
    for (const [id, vec] of docVectors.entries()) {
      if (filteredIds && !filteredIds.has(id)) continue;
      const cosine = cosineSimilarity(qVec, vec, idfMap);
      const docC = docConcepts.get(id);
      let sharedConcepts = 0;
      for (const cid of queryConceptSet) if (docC?.has(cid)) sharedConcepts += 1;
      const conceptBoost = queryConceptSet.size ? (sharedConcepts / queryConceptSet.size) * 0.25 : 0;
      const combinedSemantic = Math.min(1, cosine * 0.85 + conceptBoost);
      if (combinedSemantic > 0.03) semanticScored.push({ id, score: combinedSemantic });
    }
    semanticScored.sort((a, b) => b.score - a.score);
    const maxSem = semanticScored.length ? Math.max(0.001, semanticScored[0].score) : 1;
    const semanticRankMap = new Map();
    const semanticScoreMap = new Map();
    semanticScored.forEach((item, index) => {
      semanticRankMap.set(item.id, index + 1);
      semanticScoreMap.set(item.id, Math.min(1, item.score / maxSem));
    });

    const candidateIds = new Set([
      ...(mode === "semantic" ? [] : bm25RankMap.keys()),
      ...(mode === "bm25" ? [] : semanticRankMap.keys()),
    ]);
    for (const [id, doc] of docById.entries()) {
      if (filteredIds && !filteredIds.has(id)) continue;
      const titleAndTags = normalizeText(`${doc.title || ""} ${Array.isArray(doc.tags) ? doc.tags.join(" ") : ""}`);
      if (titleAndTags.includes(rawQuery)) candidateIds.add(id);
    }

    const maxTheoreticalRrf = (1 / (rrfK + 1)) + (1 / (rrfK + 1));
    const fused = [...candidateIds].map((id) => {
      const doc = docById.get(id);
      const rBm25 = bm25RankMap.get(id);
      const rSem = semanticRankMap.get(id);
      const bm25Norm = bm25ScoreMap.get(id) || 0;
      const semNorm = semanticScoreMap.get(id) || 0;
      const titleAndTags = normalizeText(`${doc.title || ""} ${Array.isArray(doc.tags) ? doc.tags.join(" ") : ""}`);
      const exactBoost = titleAndTags.includes(rawQuery) ? 0.35 : 0;

      let rrfRaw;
      if (mode === "bm25") rrfRaw = rBm25 ? (1 / (rrfK + rBm25)) * 2 : 0;
      else if (mode === "semantic") rrfRaw = rSem ? (1 / (rrfK + rSem)) * 2 : 0;
      else rrfRaw = (rBm25 ? 1 / (rrfK + rBm25) : 0) + (rSem ? 1 / (rrfK + rSem) : 0);

      const rrfNorm = Math.min(1, (rrfRaw / maxTheoreticalRrf) * 0.85 + exactBoost + (bm25Norm * 0.08 + semNorm * 0.07));
      const docC = docConcepts.get(id);
      const hitConcepts = [];
      for (const cid of queryConceptSet) if (docC?.has(cid)) hitConcepts.push(SEMANTIC_SYNONYM_GROUPS[cid][0]);
      const matchedTerms = [...new Set([
        ...(bm25TermsMap.get(id) || []),
        ...qExpanded.baseTokens.filter((t) => t.length >= 2 && normalizeText(`${doc.title} ${doc.content}`).includes(t)).slice(0, 4),
      ])].slice(0, 6);

      return {
        doc,
        bm25Score: Number(bm25Norm.toFixed(3)),
        semanticScore: Number(semNorm.toFixed(3)),
        rrfScore: Number(rrfNorm.toFixed(3)),
        matchedTerms,
        expandedConcepts: hitConcepts,
        snippet: buildSnippet(doc.content, [...matchedTerms, ...hitConcepts, rawQuery]),
        estimatedTokens: estimateTextTokens(`${doc.title}\n${doc.content}`),
      };
    });

    fused.sort((a, b) => b.rrfScore - a.rrfScore || b.bm25Score - a.bm25Score || b.semanticScore - a.semanticScore);
    const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;
    return {
      results: fused.slice(0, Math.max(1, Math.min(50, Number(limit) || 20))),
      query: rawQuery,
      mode,
      expandedConcepts: qExpanded.expandedConcepts,
      latencyMs: Number(elapsed.toFixed(2)),
      totalIndexed: safeDocs.length,
    };
  }

  return { search, totalIndexed: safeDocs.length };
}
