// Auto-synced isomorphic ESM Medical AI Domain module (from backend-prod/services/medical-ai-domain.js)
/**
 * DengTa Medical AI Domain Engine (migrated & upgraded from E:\zsh\OphthalmicOCR_System):
 * Architecture Decision (AI PM):
 *   L1 Deterministic Clinical Guardrail & Biomechanical Validator (Zero-Hallucination)
 * + L2 Hybrid Semantic Retrieval (MiniSearch BM25 + CJK-Bigram + Medical Synonyms + TF-IDF Cosine + RRF)
 * + L3 Grounded RAG Prompt Assembler (Citations [M1..Mk] + Redline Alerts + Safety Disclaimer)
 *
 * Strictly zero raw patient PII: only consensus clinical knowledge, ophthalmic formulary,
 * validation formulas, and pseudonymized aggregate cohort benchmarks are included.
 */

import { createHybridSemanticIndex } from "./semantic-search.js";
import { COMMON_MEDICATIONS } from "./medications-data.js";

const MEDICAL_AI_DISCLAIMER =
    "本「灯塔医疗 AI 专区」整合自眼科临床共识知识库、围术期药典与生物力学校验规则，仅供健康科普、检查报告辅助理解与科研教学参考，不构成医疗诊断、手术决策或处方依据。具体治疗与停药减量请严格遵从主诊医师医嘱；如出现视力骤降、剧烈眼痛、高热不退或呼吸困难请立即急诊。";

const ARCHITECTURE_STRATEGY = Object.freeze({
    chosen: "hybrid_rag_with_clinical_guardrails",
    title: "确定性临床规则护栏 + 混合语义增强 RAG（三层医疗 AI 架构）",
    rationale: [
        "医疗数值与安全红线（RSB < 280μm、PTA ≥ 40%、Kmax > 47.2D、IOP > 21mmHg、哮喘禁用噻吗洛尔）对幻觉零容忍，必须由 L1 确定性公式与规则引擎 100% 精准核算，绝不交给大模型心算。",
        "临床问答同时包含精确缩写（CCT/AL/OZ/0.1%氟米龙）与高度口语化症状（“做完激光眼压20正常吗”“晚上开车炫光”“散瞳前房浅能点美多丽吗”），单一纯向量 RAG 易混淆剂量与代码，单一关键词易漏召回；L2 混合语义检索（BM25 + 中文 Bigram + 医疗双域同义词图谱 + TF-IDF 余弦 + RRF 融合）兼顾精确率与口语泛化，且端/服均实现亚毫秒级离线可用。",
        "L3 将 L1 规则校验结果与 L2 召回的 Top-K 权威指南按 [M1..Mk] 证据编号装配为结构化 Grounded RAG Prompt 注入 DengTa 对话大模型，既保留大模型自然共情解释力，又把回答牢牢锚定在临床证据内。",
    ],
    layers: [
        { id: "L1", name: "确定性临床校验与生物力学护栏", role: "SE/RSB/PTA/Munnerlyn/Ehlers 眼压校正/圆锥角膜筛查/跨设备一致/眼科禁忌拦截" },
        { id: "L2", name: "混合语义增强检索引擎 (Hybrid RRF)", role: "统一索引 29 项眼科临床指标 + 27 种眼科药典 + 4 套围术期方案 + 家庭常备 OTC 药" },
        { id: "L3", name: "Grounded RAG 证据装配器", role: "自动生成带引用编号、红线警示与免责边界的 Prompt，一键发给 DengTa AI 深度解读" },
    ],
});

const TEMPLATE_LABELS = Object.freeze({
    iolmaster: "IOLMaster 700 生物测量",
    cornea: "Pentacam 角膜地形图",
    zeiss_treatment: "ZEISS MEL90 激光治疗单",
    clinical_note: "屈光病历/混合检查单",
});

const PHYSIOLOGICAL_BOUNDS = Object.freeze({
    iolmaster: {
        al: [18.0, 35.0, "mm", "眼轴长度 AL"],
        cct: [350.0, 750.0, "μm", "中央角膜厚度 CCT"],
        acd: [1.5, 5.5, "mm", "前房深度 ACD"],
        lt: [2.0, 6.5, "mm", "晶状体厚度 LT"],
        wtw: [9.0, 14.0, "mm", "白到白距离 WTW"],
        pupil: [1.5, 9.5, "mm", "瞳孔直径 P"],
        k1: [30.0, 65.0, "D", "平K K1"],
        k2: [30.0, 65.0, "D", "陡K K2"],
        tk1: [30.0, 65.0, "D", "全角膜 TK1"],
        tk2: [30.0, 65.0, "D", "全角膜 TK2"],
    },
    cornea: {
        front_k1: [30.0, 65.0, "D", "前表面 K1"],
        front_k2: [30.0, 65.0, "D", "前表面 K2"],
        front_km: [30.0, 65.0, "D", "前表面 Km"],
        front_axis_flat: [0.0, 180.0, "°", "前表面平轴"],
        back_k1: [-12.0, -3.0, "D", "后表面 K1"],
        back_k2: [-12.0, -3.0, "D", "后表面 K2"],
        back_km: [-12.0, -3.0, "D", "后表面 Km"],
        pupil_center_pachy: [300.0, 800.0, "μm", "瞳孔中心厚度"],
        pachy_apex_pachy: [300.0, 800.0, "μm", "角膜顶点厚度"],
        thinnest_locat_pachy: [250.0, 800.0, "μm", "角膜最薄点厚度"],
        kmax_front: [32.0, 85.0, "D", "前表面最大曲率 Kmax"],
        acd_int: [1.5, 5.5, "mm", "内前房深度 ACD"],
        enter_iop: [5.0, 50.0, "mmHg", "眼压 IOP"],
        pupil_d: [1.5, 9.5, "mm", "瞳孔直径"],
    },
    zeiss_treatment: {
        k1: [30.0, 65.0, "D", "诊断 K1"],
        k2: [30.0, 65.0, "D", "诊断 K2"],
        cct: [350.0, 750.0, "μm", "术前角膜厚度 Pachy"],
        sphere: [-20.0, 10.0, "D", "球镜矫正 S"],
        cylinder: [-10.0, 10.0, "D", "柱镜矫正 C"],
        axis: [0.0, 180.0, "°", "散光轴位 A"],
        optical_zone: [4.5, 8.5, "mm", "光学区直径 OZ"],
        ablation_depth: [10.0, 220.0, "μm", "切削深度 Ablation"],
        rsb_um: [250.0, 700.0, "μm", "剩余基质床 RSB"],
        pta_pct: [5.0, 65.0, "%", "组织改变百分比 PTA"],
    },
    clinical_note: {
        sphere: [-25.0, 15.0, "D", "球镜度数 S"],
        cylinder: [-10.0, 10.0, "D", "柱镜度数 C"],
        axis: [0.0, 180.0, "°", "散光轴位 A"],
        se_calc: [-25.0, 15.0, "D", "等效球镜 SE"],
        iop: [5.0, 50.0, "mmHg", "眼压 IOP"],
        cct: [300.0, 800.0, "μm", "中央角膜厚度 CCT"],
        al: [18.0, 35.0, "mm", "眼轴长度 AL"],
    },
});

const OPHTHALMIC_KB_CATEGORIES = Object.freeze([
    { id: "all", name: "全部眼科指标" },
    { id: "biometry", name: "光学生物测量 (IOLMaster)" },
    { id: "cornea", name: "角膜地形图 (Pentacam)" },
    { id: "refractive", name: "屈光与激光手术 (ZEISS MEL90)" },
    { id: "safety", name: "生物力学安全红线与公式" },
    { id: "general", name: "门诊通用眼科体征" },
]);

const OPHTHALMIC_KNOWLEDGE_ENTRIES = Object.freeze([
    {
        id: "al", field_keys: ["al", "axial_length"], category: "biometry", code: "AL",
        name_cn: "眼轴长度", name_en: "Axial Length", unit: "mm",
        normal_range: "22.0 – 24.5 mm（成年正视眼）",
        warning_threshold: "≥ 26.0 mm（高度近视/病理性近视高危）；< 21.0 mm（短眼轴/闭角风险）",
        clinical_meaning: "从角膜前表面顶点至视网膜色素上皮层（RPE）的眼球前后径，是评估近视进展与人工晶状体（IOL）屈光度计算的核心参数。",
        abnormality_implications: "眼轴每增长 1 mm 约对应近视加深 250–300 度（-2.5D ~ -3.0D）。AL ≥ 26.0 mm 需重点排查周边视网膜变性、裂孔及黄斑病变。",
        related_formulas: ["近视估算 ΔSE ≈ -2.75 × ΔAL", "SRK/T、Barrett Universal II 晶体计算公式"],
        aliases: ["眼轴", "眼轴长度", "Axial Length", "AL", "轴长"],
        linked_drugs: ["atropine_001", "tropicamide_phenylephrine"],
    },
    {
        id: "cct", field_keys: ["cct"], category: "biometry", code: "CCT",
        name_cn: "中央角膜厚度", name_en: "Central Corneal Thickness", unit: "μm",
        normal_range: "500 – 560 μm",
        warning_threshold: "< 480 μm（薄角膜预警，激光切削受限）；< 450 μm（慎行角膜激光手术）",
        clinical_meaning: "角膜中央区域从上皮层至内皮层的总厚度，直接决定屈光手术可安全切削的深度及眼压测量校正值。",
        abnormality_implications: "薄角膜不仅限制激光矫正度数，还易造成常规非接触眼压（NCT）读数假性偏低；厚角膜（>600μm）则可能致眼压测量偏高。",
        related_formulas: ["RSB = CCT - (角膜瓣/上皮厚) - 切削深度", "PTA = (瓣厚 + 切削深度) / CCT × 100%"],
        aliases: ["中央角膜厚度", "角膜厚度", "CCT", "Pachymetry", "Pachy"],
        linked_drugs: ["sodium_hyaluronate_01", "fluorometholone_01", "rb_bfgf"],
    },
    {
        id: "acd", field_keys: ["acd", "acd_int"], category: "biometry", code: "ACD",
        name_cn: "前房深度", name_en: "Anterior Chamber Depth", unit: "mm",
        normal_range: "2.80 – 3.80 mm（内前房 ACD Int 略小于含角膜厚度的外 ACD）",
        warning_threshold: "< 2.50 mm（浅前房，警惕原发性闭角型青光眼）；ICL 常规要求内 ACD ≥ 2.80 mm",
        clinical_meaning: "角膜内皮面至晶状体前囊膜之间的轴向距离，反映眼前节空间宽敞度。",
        abnormality_implications: "浅前房者散瞳检查须严格防急性闭角型青光眼发作；ICL 术前内 ACD < 2.8 mm 存在拱高不足与内皮损伤风险。",
        related_formulas: ["外前房深度 = 内前房深度(ACD Int) + CCT/1000"],
        aliases: ["前房深度", "内前房深度", "ACD", "ACD Int"],
        linked_drugs: ["tropicamide_phenylephrine", "brinzolamide", "timolol"],
    },
    {
        id: "lt", field_keys: ["lt"], category: "biometry", code: "LT",
        name_cn: "晶状体厚度", name_en: "Lens Thickness", unit: "mm",
        normal_range: "3.40 – 4.60 mm（随年龄增长逐渐增厚）",
        warning_threshold: "> 5.00 mm（晶状体膨隆，易继发前房变浅与房角关闭）",
        clinical_meaning: "晶状体前囊至后囊的轴向厚度，用于新一代多变量 IOL 公式及青光眼晶状体因素评估。",
        abnormality_implications: "晶状体过厚常伴前房变浅，常见于年龄相关性白内障膨胀期或短眼轴人群。",
        related_formulas: ["Barrett / Kane 公式核心输入参数"],
        aliases: ["晶状体厚度", "晶体厚度", "LT", "Lens Thickness"],
        linked_drugs: ["tropicamide_phenylephrine"],
    },
    {
        id: "wtw", field_keys: ["wtw"], category: "biometry", code: "WTW",
        name_cn: "角膜横径（白到白）", name_en: "White-to-White Distance", unit: "mm",
        normal_range: "11.2 – 12.4 mm",
        warning_threshold: "< 10.5 mm（小角膜）；> 13.0 mm（大角膜，需排查先天性青光眼）",
        clinical_meaning: "水平方向两侧角膜缘之间的距离，是 ICL 人工晶体尺寸选择和准分子吸引环匹配的关键依据。",
        abnormality_implications: "WTW 测量偏差会直接导致 ICL 术后拱高过高（青光眼风险）或过低（并发白内障风险）。",
        related_formulas: ["ICL 型号初选常参考 WTW + 0.5~1.0 mm 结合 UBM 睫状沟直径"],
        aliases: ["白到白", "角膜直径", "WTW", "White to White"],
        linked_drugs: ["sodium_hyaluronate_01"],
    },
    {
        id: "pupil", field_keys: ["pupil", "pupil_d"], category: "biometry", code: "Pupil / P",
        name_cn: "瞳孔直径 / 暗瞳直径", name_en: "Pupil Diameter", unit: "mm",
        normal_range: "明瞳 2.5 – 4.5 mm；暗瞳 5.0 – 6.8 mm",
        warning_threshold: "暗瞳 > 7.0 mm（若大于手术光学区 OZ，术后夜间眩光/光晕风险显著升高）",
        clinical_meaning: "瞳孔在不同光照条件下的直径，屈光手术前必须对比暗瞳直径与计划激光光学区（OZ）。",
        abnormality_implications: "暗瞳明显大于光学区时需向患者充分告知夜间眩光风险，或适当增大光学区（同时权衡切削深度增加）。",
        related_formulas: ["理想光学区 OZ 尽量覆盖暗瞳直径（常规 6.0 – 6.5 mm）"],
        aliases: ["瞳孔直径", "暗瞳", "Pupil", "Pupil D"],
        linked_drugs: ["brimonidine", "tropicamide_phenylephrine"],
    },
    {
        id: "k1", field_keys: ["k1", "front_k1"], category: "biometry", code: "K1",
        name_cn: "角膜平坦子午线曲率（平K）", name_en: "Flat Keratometry (K1)", unit: "D",
        normal_range: "40.0 – 45.5 D",
        warning_threshold: "< 38.0 D（过平，警惕既往角膜屈光术后或扁平角膜）；> 47.0 D（过陡，警惕圆锥角膜）",
        clinical_meaning: "角膜前表面屈光力最平坦方向的曲率值（单位：屈光度 D），常附带轴位角度（@°）。",
        abnormality_implications: "激光术后若预计最终角膜曲率过平（< 35 D）易引起高阶像差增加与夜间视觉质量下降。",
        related_formulas: ["K = 337.5 / Rf(mm)", "Km = (K1 + K2) / 2"],
        aliases: ["平K", "K1", "前表面K1", "平坦曲率"],
        linked_drugs: ["sodium_hyaluronate_01"],
    },
    {
        id: "k2", field_keys: ["k2", "front_k2"], category: "biometry", code: "K2",
        name_cn: "角膜陡峭子午线曲率（陡K）", name_en: "Steep Keratometry (K2)", unit: "D",
        normal_range: "41.0 – 46.5 D（生理上必满足 K2 ≥ K1）",
        warning_threshold: "> 47.2 D（陡峭异常，需结合 Kmax 与后表面高度筛查圆锥角膜）；K2 < K1 为录入/OCR倒置",
        clinical_meaning: "角膜前表面屈光力最陡峭方向的曲率值，与 K1 之差反映角膜规则散光量。",
        abnormality_implications: "若出现 K2 < K1，系统自动触发 K_ORDER_INVERSION 告警提示人工核对。",
        related_formulas: ["|ΔK| = K2 - K1（角膜前表面散光）"],
        aliases: ["陡K", "K2", "前表面K2", "陡峭曲率"],
        linked_drugs: ["sodium_hyaluronate_01"],
    },
    {
        id: "delta_k", field_keys: ["delta_k", "front_astig"], category: "biometry", code: "ΔK / Astig",
        name_cn: "角膜散光值", name_en: "Corneal Astigmatism", unit: "D",
        normal_range: "0.0 – 1.5 D（生理性顺规散光常见）",
        warning_threshold: "> 2.5 D（高度角膜散光，建议排查圆锥角膜或考虑散光矫正策略）",
        clinical_meaning: "角膜陡峭子午线与平坦子午线屈光力之差，用于核对 K2 - K1 一致性及验光散光来源。",
        abnormality_implications: "系统自动校验 ||ΔK| - |K2 - K1|| ≤ 0.35 D，超差自动标黄复核。",
        related_formulas: ["|ΔK| ≈ |K2 - K1|"],
        aliases: ["散光", "ΔK", "Astig", "角膜散光"],
        linked_drugs: [],
    },
    {
        id: "tk1", field_keys: ["tk1", "tk2", "delta_tk", "tse"], category: "biometry", code: "TK1 / TK2 / ΔTK",
        name_cn: "全角膜曲率（含后表面）", name_en: "Total Keratometry (IOLMaster 700)", unit: "D",
        normal_range: "TK1/TK2：40.0 – 46.5 D",
        warning_threshold: "|TK - K| 显著偏离提示角膜后表面存在非典型散光或既往屈光手术史",
        clinical_meaning: "IOLMaster 700 结合扫频 OCT 直接测得的角膜前后表面综合屈光力，对既往近视激光术后白内障晶体计算价值极高。",
        abnormality_implications: "能更准确反映后表面逆规散光贡献，减少散光型 Toric IOL 残余散光误差。",
        related_formulas: ["TSE = (TK1 + TK2) / 2"],
        aliases: ["全角膜曲率", "TK1", "TK2", "TSE", "ΔTK"],
        linked_drugs: [],
    },
    {
        id: "cw_chord", field_keys: ["cw_chord", "ix", "iy"], category: "biometry", code: "CW弦 / Ix / Iy",
        name_cn: "Chang-Waring 弦（视轴偏心）", name_en: "Chang-Waring Chord / Kappa Offset", unit: "mm",
        normal_range: "CW 弦 < 0.50 mm；Ix / Iy 多在 ±0.40 mm 内",
        warning_threshold: "CW 弦 > 0.60 mm（大 Kappa 角，多焦点 IOL 或激光偏心切削易致眩光）",
        clinical_meaning: "反映角膜反光点（视轴近似点）相对瞳孔中心的二维偏移向量（Ix/Iy）与模长。",
        abnormality_implications: "大 Kappa 角患者行屈光手术时需启用虹膜定位与 Kappa 角补偿，慎选衍射型多焦点人工晶体。",
        related_formulas: ["CW 弦长 ≈ √(Ix² + Iy²)"],
        aliases: ["CW弦", "Kappa角", "Ix", "Iy", "偏心向量"],
        linked_drugs: [],
    },
    {
        id: "front_qs", field_keys: ["front_qs", "back_qs"], category: "cornea", code: "QS",
        name_cn: "Pentacam 图像抓取质量标识", name_en: "Quality Specification", unit: "状态",
        normal_range: "OK（绿色通过）",
        warning_threshold: "红色或黄色警告（眨眼、泪膜破裂、固视丢失）提示该页数据可靠性下降",
        clinical_meaning: "OCULUS Pentacam 对本次 Scheimpflug 旋转扫描质量的自动质控标签。",
        abnormality_implications: "若 QS 不为 OK，角膜厚度和曲率可能存在伪影，建议滴人工泪液润湿眼表后重测。",
        related_formulas: ["OCR 常将绿底白字 OK 误识为 '回K'，系统自动语义纠正为 OK"],
        aliases: ["QS", "质量监控", "Quality Specification"],
        linked_drugs: ["sodium_hyaluronate_01", "peg_400"],
    },
    {
        id: "front_km", field_keys: ["front_km", "front_rf", "front_rs", "front_rm", "front_axis_flat"], category: "cornea", code: "Km / Rf / Rs / Axis",
        name_cn: "角膜前表面平均曲率与半径", name_en: "Cornea Front Mean K & Radii", unit: "D / mm / °",
        normal_range: "Km：41.0 – 45.5 D；Rf/Rs：7.40 – 8.30 mm；Axis：0 – 180°",
        warning_threshold: "Km > 47.0 D 或 Rmin < 6.7 mm 提示角膜异常陡峭",
        clinical_meaning: "全面刻画角膜前表面光学曲率半径（Rf 平半径、Rs 陡半径、Rm 均半径）及平均屈光力 Km。",
        abnormality_implications: "曲率半径越小代表角膜越陡峭；Rmin 对应角膜最陡曲率半径（与 Kmax 直接对应）。",
        related_formulas: ["K(D) = 337.5 / R(mm)"],
        aliases: ["Km", "Rf", "Rs", "Rm", "Axis", "Rmin", "前表面平均曲率"],
        linked_drugs: ["sodium_hyaluronate_01"],
    },
    {
        id: "back_k1", field_keys: ["back_k1", "back_k2", "back_km"], category: "cornea", code: "Cornea Back K1/K2/Km",
        name_cn: "角膜后表面曲率", name_en: "Posterior Corneal Curvature", unit: "D",
        normal_range: "-5.5 D 至 -6.8 D（因角膜-房水折射率差，必为负屈光力！）",
        warning_threshold: "绝对值 > 7.0 D 或后表面高度隆起 > +15 μm 高度警示早期亚临床圆锥角膜",
        clinical_meaning: "角膜内皮面（后表面）的发散屈光力；圆锥角膜最早期的形态改变往往始于后表面膨隆。",
        abnormality_implications: "OCR 易漏读负号，系统内建后表面负屈光力自动还原与校验。",
        related_formulas: ["后表面屈光力 K_back = (1.336 - 1.376) / R_back(m) < 0"],
        aliases: ["后表面K1", "后表面K2", "后表面Km", "Cornea Back"],
        linked_drugs: [],
    },
    {
        id: "thinnest_locat_pachy", field_keys: ["thinnest_locat_pachy", "pachy_apex_pachy", "pupil_center_pachy"], category: "cornea", code: "Thinnest / Apex / Pupil Pachy",
        name_cn: "角膜最薄点 / 顶点 / 瞳孔中心厚度", name_en: "Corneal Pachymetry Profile", unit: "μm",
        normal_range: "500 – 565 μm（且必满足 最薄点 ≤ 顶点厚度）",
        warning_threshold: "最薄点 < 470 μm（圆锥角膜/扩张高危筛查线）；顶点与最薄点差值 > 15 μm 需警惕",
        clinical_meaning: "Pentacam 三点角膜厚度分布，最薄点厚度（Thinnest Locat）是屈光手术安全评估中最保守的基准厚度。",
        abnormality_implications: "系统自动检验 Thinnest ≤ Apex + 5μm 逻辑，并联合跨设备核查 |ΔCCT| ≤ 35μm。",
        related_formulas: ["跨设备极差 ΔCCT = max(CCT_IOL, Apex_Pentacam, Pachy_ZEISS) - min(...)"],
        aliases: ["最薄点厚度", "角膜顶点厚度", "瞳孔中心厚度", "Thinnest Locat", "Pachy Apex"],
        linked_drugs: ["sodium_hyaluronate_01", "rb_bfgf", "calf_blood_gel"],
    },
    {
        id: "kmax_front", field_keys: ["kmax_front"], category: "cornea", code: "Kmax (Front)",
        name_cn: "角膜前表面最大曲率", name_en: "Maximum Anterior Keratometry", unit: "D",
        normal_range: "41.5 – 46.5 D",
        warning_threshold: "> 47.2 D（圆锥角膜筛查警戒线）；> 48.0 D（高度怀疑圆锥角膜，严禁行常规角膜激光切削）",
        clinical_meaning: "角膜前表面局部最陡峭一点的曲率峰值，是圆锥角膜筛查与随访进展（年增长 > 1.0 D 提示进展）的敏感指标。",
        abnormality_implications: "触发 Kmax > 47.2 D 时，系统自动弹出圆锥角膜筛查提醒（KERATOCONUS_SCREEN）。",
        related_formulas: ["圆锥角膜联合筛查：Kmax > 47.2 D 或 Thinnest < 470 μm"],
        aliases: ["Kmax", "最大曲率", "K Max Front", "前表面Kmax"],
        linked_drugs: ["sodium_hyaluronate_01", "olopatadine"],
    },
    {
        id: "cornea_volume", field_keys: ["cornea_volume", "chamb_volume", "angle"], category: "cornea", code: "Cornea Vol / Chamb Vol / Angle",
        name_cn: "角膜容积 / 前房容积 / 前房角", name_en: "Corneal & Anterior Chamber Volume / Angle", unit: "mm³ / °",
        normal_range: "角膜容积 55–66 mm³；前房容积 130–240 mm³；前房角 30–48°",
        warning_threshold: "前房容积 < 100 mm³ 或前房角 < 20° 提示窄房角/闭角风险",
        clinical_meaning: "三维体积与房角几何参数，全面反映角膜组织储备量及房水引流通道宽敞度。",
        abnormality_implications: "窄房角患者禁用或慎用散瞳药物，术前需结合房角镜/UBM 评估。",
        related_formulas: ["Pentacam 10 mm 直径角膜三维积分容积"],
        aliases: ["角膜容积", "前房容积", "前房角", "Cornea Volume", "Angle"],
        linked_drugs: ["brinzolamide", "latanoprost"],
    },
    {
        id: "sphere", field_keys: ["sphere"], category: "refractive", code: "Sphere (S / DS)",
        name_cn: "球镜度数", name_en: "Spherical Refraction", unit: "D",
        normal_range: "正视眼 0.00 D；负值(-)为近视，正值(+)为远视",
        warning_threshold: "≤ -6.00 D（高度近视）；≤ -10.00 D（超高度近视，优先评估 ICL 而非角膜切削）",
        clinical_meaning: "眼球球面屈光不正度数，-1.00 D 即临床俗称“近视 100 度”。",
        abnormality_implications: "高球镜度数需要更深的激光切削厚度，须严格联动核验 RSB 与 PTA 安全红线。",
        related_formulas: ["SE = S + C / 2"],
        aliases: ["球镜", "球镜度数", "Sphere", "DS"],
        linked_drugs: ["atropine_001", "fluorometholone_01"],
    },
    {
        id: "cylinder", field_keys: ["cylinder", "axis"], category: "refractive", code: "Cylinder (C) & Axis (A)",
        name_cn: "柱镜散光与轴位", name_en: "Cylindrical Power & Axis", unit: "D / °",
        normal_range: "柱镜 0.00 至 -1.00 D；轴位 0° – 180°",
        warning_threshold: "|C| ≥ 3.00 D（高度散光，需排查圆锥角膜并在术中启用眼球旋转追踪补偿）",
        clinical_meaning: "柱镜 C 表征散光大小，轴位 A 表征散光主子午线方向（1°–180°）。",
        abnormality_implications: "散光轴位旋转偏差 10° 即损失约 33% 散光矫正效果，轴位零误差至关重要。",
        related_formulas: ["SE = S + C / 2"],
        aliases: ["柱镜", "散光度数", "轴位", "Cylinder", "Axis", "DC"],
        linked_drugs: ["sodium_hyaluronate_01"],
    },
    {
        id: "se_calc", field_keys: ["se_calc", "se"], category: "refractive", code: "SE",
        name_cn: "等效球镜度", name_en: "Spherical Equivalent", unit: "D",
        normal_range: "-0.50 D 至 +0.50 D（正视范围）",
        warning_threshold: "SE ≤ -6.00 D（高度近视）；强制校验 |SE - (S + C/2)| ≤ 0.25 D",
        clinical_meaning: "将球镜与柱镜折算为单一等效球面屈光度的国际科研标准指标，用于近视分级与 Munnerlyn 切削预测。",
        abnormality_implications: "若实测 SE 与 S + C/2 偏差超过 0.25 D，自动触发 SE_FORMULA_MISMATCH 告警。",
        related_formulas: ["SE = Sphere + Cylinder / 2"],
        aliases: ["等效球镜", "SE", "Spherical Equivalent"],
        linked_drugs: ["atropine_001"],
    },
    {
        id: "optical_zone", field_keys: ["optical_zone"], category: "refractive", code: "OZ",
        name_cn: "激光光学区直径", name_en: "Optical Zone Diameter", unit: "mm",
        normal_range: "6.00 – 6.80 mm（临床主流 6.50 mm）",
        warning_threshold: "< 5.80 mm（夜间眩光光晕风险上升）；> 7.00 mm（切削深度按 OZ² 激增）",
        clinical_meaning: "激光精确重塑角膜屈光力的有效中央区直径。",
        abnormality_implications: "据 Munnerlyn 公式，切削深度与光学区直径的平方成正比，微调 OZ 可在视觉质量与厚度储备间权衡。",
        related_formulas: ["Munnerlyn 公式：Ablation(μm) ≈ (|SE| × OZ²) / 3"],
        aliases: ["光学区", "OZ", "Optical zone"],
        linked_drugs: ["brimonidine"],
    },
    {
        id: "ablation_depth", field_keys: ["ablation_depth"], category: "refractive", code: "Ablation Depth",
        name_cn: "激光切削深度", name_en: "Expected Ablation Depth", unit: "μm",
        normal_range: "30 – 130 μm（6.5 mm 光学区约 12–15 μm/D）",
        warning_threshold: "> 140 μm（深切削，PRK/TPRK 术后 Haze 风险显著升高，常需联合术中 MMC 及规范激素阶梯）",
        clinical_meaning: "准分子激光预计消融的角膜基质最大中心深度。",
        abnormality_implications: "医院真实 ZEISS MEL90 队列实测 |SE| 与切削深度呈显著线性正相关（约 11.1 μm/D, r=0.873）。",
        related_formulas: ["RSB = Pachy - Ablation", "PTA = (Epi/Flap + Ablation) / Pachy × 100%"],
        aliases: ["切削深度", "激光切削深度", "Ablation"],
        linked_drugs: ["fluorometholone_01", "mitomycin_c", "pranoprofen", "rb_bfgf"],
    },
    {
        id: "rsb_um", field_keys: ["rsb_um"], category: "safety", code: "RSB",
        name_cn: "剩余角膜基质床厚度（安全红线）", name_en: "Residual Stromal Bed", unit: "μm",
        normal_range: "≥ 300 μm（充裕安全）；临床底线 ≥ 250–280 μm",
        warning_threshold: "< 280 μm 触发最高级别 RED REVIEW 安全红线告警（RSB_SAFETY_REDLINE）！",
        clinical_meaning: "角膜激光切削底部至角膜内皮面之间保留的未切削基质层厚度，是预防医源性角膜扩张的生命线。",
        abnormality_implications: "当 RSB < 280 μm 时角膜生物力学抗张强度急剧下降，应重新评估光学区、降低欠矫量或改行 ICL 晶体植入。",
        related_formulas: ["RSB(PRK/TPRK) = Pachy - Ablation", "RSB(LASIK) = CCT - Flap(110μm) - Ablation"],
        aliases: ["剩余基质床", "剩余角膜基质床", "RSB", "Residual Stromal Bed"],
        linked_drugs: ["fluorometholone_01", "sodium_hyaluronate_01", "rb_bfgf"],
    },
    {
        id: "pta_pct", field_keys: ["pta_pct"], category: "safety", code: "PTA",
        name_cn: "角膜组织改变百分比（40% 警戒线）", name_en: "Percent Tissue Altered", unit: "%",
        normal_range: "< 35%（生物力学稳定区）",
        warning_threshold: "≥ 40%（国际屈光手术共识公认的术后角膜扩张独立高危红线！）",
        clinical_meaning: "手术涉及改变的角膜厚度（角膜瓣/上皮厚度 + 激光切削深度）占术前总角膜厚度的百分比。",
        abnormality_implications: "即使术前角膜厚度正常、RSB 勉强达标，只要 PTA ≥ 40%，术后远期扩张风险仍显著升高。",
        related_formulas: ["PTA = (Flap/Epi + Ablation) / CCT × 100%（PRK/TPRK 计上皮 50μm；LASIK 计瓣厚 110μm）"],
        aliases: ["PTA", "角膜组织改变百分比", "切削百分比", "40%红线"],
        linked_drugs: ["fluorometholone_01", "sodium_hyaluronate_01"],
    },
    {
        id: "munnerlyn_formula", field_keys: ["treatment_type"], category: "safety", code: "Munnerlyn / TPRK",
        name_cn: "Munnerlyn 切削公式与 TPRK/PRK 术式", name_en: "Munnerlyn Equation & Surface Ablation", unit: "μm/D",
        normal_range: "6.5 mm 光学区约 12–14 μm/D；6.0 mm 光学区约 10–12 μm/D",
        warning_threshold: "实测切削深度显著偏离 Munnerlyn 估算值时需复核光学区或非球面切削模式",
        clinical_meaning: "描述近视矫正度数 |SE|、光学区直径 OZ 与中心角膜切削深度之间二次方关系的经典屈光光学定律。",
        abnormality_implications: "TPRK 无需制作角膜瓣、生物力学保留佳，但术后前 3 天上皮愈合期伴异物痛感，1–3 月内需规范滴用氟米龙防 Haze 并复查眼压。",
        related_formulas: ["Ablation(μm) ≈ |SE(D)| × OZ(mm)² / 3"],
        aliases: ["Munnerlyn", "TPRK", "PRK", "SMILE", "FS-LASIK", "术式"],
        linked_drugs: ["levofloxacin", "fluorometholone_01", "pranoprofen", "sodium_hyaluronate_01", "rb_bfgf"],
    },
    {
        id: "kc_screening", field_keys: ["diagnosis"], category: "safety", code: "KC-Screen",
        name_cn: "圆锥角膜术前综合筛查标准", name_en: "Keratoconus Pre-Op Screening", unit: "规则",
        normal_range: "Kmax ≤ 47.2 D 且 Thinnest ≥ 470 μm 且后表面高度正常、BAD-D < 1.6",
        warning_threshold: "任一指标越界（Kmax > 47.2 D 或 Thinnest < 470 μm 或 BAD-D ≥ 1.6）列为重点复核/禁忌排查",
        clinical_meaning: "屈光手术术前质控的首要防线，旨在筛出隐匿性/亚临床圆锥角膜，杜绝医源性角膜扩张。",
        abnormality_implications: "疑似圆锥角膜者严禁行角膜激光手术，应转角膜病专科评估角膜胶原交联（CXL）或 RGP/巩膜镜矫正。",
        related_formulas: ["圆锥角膜联合筛查：Kmax > 47.2 D 或 Thinnest < 470 μm"],
        aliases: ["圆锥角膜", "BAD-D", "角膜扩张", "术前筛查"],
        linked_drugs: ["sodium_hyaluronate_01", "olopatadine"],
    },
    {
        id: "iop", field_keys: ["iop", "enter_iop"], category: "general", code: "IOP / NCT",
        name_cn: "眼内压（眼压）", name_en: "Intraocular Pressure", unit: "mmHg",
        normal_range: "10.0 – 21.0 mmHg（双眼差值通常 < 5 mmHg）",
        warning_threshold: "> 21.0 mmHg（高眼压/青光眼排查）；术后激素随访较基线升高 ≥ 5 mmHg 高度警惕激素性高眼压！",
        clinical_meaning: "眼球内容物对眼球壁施加的均衡压力，是青光眼筛查与屈光术后激素用药安全监测的必查指标。",
        abnormality_implications: "屈光激光术后角膜变薄会使常规 NCT 测值假性偏低 2–5 mmHg，测值看似“18–20 mmHg”即可能已发生激素性高眼压！",
        related_formulas: ["Ehlers 校正近似：CCT 每偏离 545μm 约 50μm，眼压校正约 2.5–3.5 mmHg"],
        aliases: ["眼压", "眼内压", "IOP", "NCT", "Enter IOP"],
        linked_drugs: ["timolol", "brinzolamide", "latanoprost", "brimonidine", "fluorometholone_01"],
    },
    {
        id: "va_od_os", field_keys: ["va_od_os"], category: "general", code: "UCVA / BCVA",
        name_cn: "裸眼视力 / 最佳矫正视力", name_en: "Visual Acuity", unit: "小数/五分法",
        normal_range: "小数记录 ≥ 1.0（五分记录 ≥ 5.0）",
        warning_threshold: "BCVA < 0.8 需排查弱视、白内障、角膜散光不规则或眼底黄斑病变",
        clinical_meaning: "反映黄斑中心凹最小分辨力的功能指标；UCVA 为裸眼视力，BCVA 为戴镜最佳矫正视力。",
        abnormality_implications: "术前 BCVA 是预测屈光术后视力上限的核心基线。",
        related_formulas: ["LogMAR = -log10(小数视力)"],
        aliases: ["视力", "裸眼视力", "矫正视力", "UCVA", "BCVA"],
        linked_drugs: ["sodium_hyaluronate_01"],
    },
    {
        id: "cd_ratio", field_keys: ["cd_ratio"], category: "general", code: "C/D",
        name_cn: "视神经杯盘比", name_en: "Cup-to-Disc Ratio", unit: "比值",
        normal_range: "0.2 – 0.4（且双眼差值 < 0.2）",
        warning_threshold: "C/D ≥ 0.6 或双眼差值 ≥ 0.2 需高度警惕青光眼性视神经损害（行 OCT-RNFL 与视野检查）",
        clinical_meaning: "眼底检查中视杯直径与视盘直径的比值，是评估青光眼视神经萎缩的重要体征。",
        abnormality_implications: "青光眼疑似患者术后应用氟米龙等激素滴眼液时，眼压飙升风险远高于普通人群。",
        related_formulas: ["C/D = 视杯垂直径 / 视盘垂直径"],
        aliases: ["杯盘比", "C/D", "视盘"],
        linked_drugs: ["latanoprost", "brinzolamide", "timolol"],
    },
]);

const OPHTHALMIC_DRUG_CATEGORIES = Object.freeze([
    { id: "all", name: "全部眼科药品" },
    { id: "antibiotic", name: "抗感染滴眼液" },
    { id: "steroid", name: "糖皮质激素（防Haze/抗炎）" },
    { id: "nsaid", name: "非甾体抗炎药 (NSAIDs)" },
    { id: "tear_repair", name: "人工泪液与角膜修复" },
    { id: "glaucoma", name: "降眼压 / 青光眼用药" },
    { id: "mydriatic", name: "散瞳与近视防控用药" },
    { id: "allergy_viral", name: "抗过敏与抗病毒" },
    { id: "peri_op_aux", name: "围术期表麻与术中辅药" },
]);

const OPHTHALMIC_PERIOP_PROTOCOLS = Object.freeze([
    {
        id: "proto_tprk",
        title: "TPRK / PRK 表层屈光手术围术期经典用药阶梯（参考）",
        applicable_templates: ["zeiss_treatment", "cornea"],
        summary: "表层切削无角膜瓣，重点在于：术前抗感染 → 术后1周促上皮愈合+止痛防感染 → 术后1–3月激素阶梯防 Haze + 严格眼压监测 + 全程人工泪液。",
        stages: [
            { stage: "术前 1–3 天", regimen: "左氧氟沙星滴眼液 QID（预防感染）+ 玻璃酸钠滴眼液（改善泪膜）" },
            { stage: "术后第 1 周（戴绷带镜上皮愈合期）", regimen: "左氧氟沙星 QID + 普拉洛芬/溴芬酸钠（止痛抗炎）+ rb-bFGF 促上皮修复 + 不含防腐剂玻璃酸钠 Q2H–6次/日" },
            { stage: "术后 2 周 – 3 个月（防 Haze 关键期）", regimen: "0.1% 氟米龙滴眼液按月阶梯递减（QID→TID→BID→QD）+ 玻璃酸钠 QID；每 2–4 周必查校正眼压！" },
        ],
        drug_ids: ["levofloxacin", "fluorometholone_01", "pranoprofen", "sodium_hyaluronate_01", "rb_bfgf", "mitomycin_c"],
    },
    {
        id: "proto_smile_lasik",
        title: "SMILE / FS-LASIK 基质类屈光手术围术期方案（参考）",
        applicable_templates: ["zeiss_treatment", "iolmaster"],
        summary: "角膜上皮完整、恢复快，激素疗程通常短于 TPRK（约 2–4 周），重点预防弥漫性板层角膜炎（DLK）与术后干眼。",
        stages: [
            { stage: "术前 1–3 天", regimen: "左氧氟沙星或莫西沙星滴眼液 QID" },
            { stage: "术后 1–2 周", regimen: "左氧氟沙星 QID（7天停）+ 妥布霉素地塞米松/氟米龙抗炎 + 玻璃酸钠 QID" },
            { stage: "术后 3–4 周起", regimen: "激素逐步减停，延续玻璃酸钠/聚乙二醇人工泪液 1–3 个月稳定泪膜与视觉质量" },
        ],
        drug_ids: ["moxifloxacin", "levofloxacin", "tobramycin_dexamethasone", "fluorometholone_01", "sodium_hyaluronate_01", "peg_400"],
    },
    {
        id: "proto_steroid_iop",
        title: "术后激素性高眼压应急处置路径（参考）",
        applicable_templates: ["cornea", "clinical_note", "zeiss_treatment"],
        summary: "术后滴用氟米龙/泼尼松龙期间若眼压 > 21 mmHg 或较基线升高 ≥ 5 mmHg（注意薄角膜致 NCT 低估！），需及时干预保护视神经。",
        stages: [
            { stage: "轻中度升高（22–28 mmHg）", regimen: "遵医嘱减停强效激素（或改氯替泼诺/NSAIDs），联合局部降眼压药（如噻吗洛尔或布林佐胺）" },
            { stage: "显著升高（> 28 mmHg）", regimen: "停用激素 + 双联局部降眼压滴眼液 + 密切复查角膜厚度校正眼压与视盘 C/D" },
        ],
        drug_ids: ["brinzolamide", "timolol", "brimonidine", "loteprednol", "pranoprofen"],
    },
    {
        id: "proto_dry_eye_repair",
        title: "屈光术后神经源性干眼与上皮点染修复阶梯（参考）",
        applicable_templates: ["iolmaster", "cornea", "clinical_note"],
        summary: "激光手术短期切断角膜浅层神经导致瞬目减少与泪膜不稳定；首选无防腐剂单支装人工泪液，间隔 5–10 分钟依次点眼。",
        stages: [
            { stage: "轻中度干眼", regimen: "0.1% 玻璃酸钠（无防腐剂）或聚乙二醇滴眼液 4–6 次/日" },
            { stage: "中重度干眼 / 上皮点染", regimen: "0.3% 玻璃酸钠 + 重组牛碱性成纤维细胞生长因子（rb-bFGF）或小牛血去蛋白眼用凝胶（睡前）" },
        ],
        drug_ids: ["sodium_hyaluronate_01", "sodium_hyaluronate_03", "peg_400", "cmc_sodium", "rb_bfgf", "calf_blood_gel"],
    },
]);

const OPHTHALMIC_DRUGS = Object.freeze([
    { id: "levofloxacin", category: "antibiotic", generic_name: "左氧氟沙星滴眼液 (0.5%)", brand_examples: "可乐必妥 / 朗沐宁", english_name: "Levofloxacin Ophthalmic Solution 0.5%", dosage_form: "滴眼液 5ml", peri_op_phase: "术前1–3天 & 术后1周", indications: "广谱第三代氟喹诺酮类，覆盖常见革兰氏阳性/阴性菌，屈光及白内障围术期一线预防感染用药。", typical_regimen: "术前 3 天 QID（每日4次）；术后 QID 连用 7 天后停药。", contraindications: "对喹诺酮类药物过敏者禁用。", key_monitoring: "避免无指征长期使用以防耐药菌及角膜上皮毒性；与其他眼药水间隔 5–10 分钟。", linked_indicators: ["cct", "treatment_type"], aliases: ["左氧氟沙星", "可乐必妥", "Levofloxacin", "抗生素", "消炎眼药水"] },
    { id: "moxifloxacin", category: "antibiotic", generic_name: "莫西沙星滴眼液 (0.5%)", brand_examples: "维乐速 (Vigamox)", english_name: "Moxifloxacin Ophthalmic Solution 0.5%", dosage_form: "自防腐滴眼液 3ml", peri_op_phase: "术前 & 术后1周", indications: "第四代氟喹诺酮类，角膜穿透力强、不含苯扎氯铵防腐剂，对耐药革兰氏阳性球菌活性更优。", typical_regimen: "TID（每日3次），术后通常应用 5–7 天。", contraindications: "喹诺酮类过敏者禁用。", key_monitoring: "无传统防腐剂，更适合角膜上皮脆弱或合并干眼的围术期患者。", linked_indicators: ["cct", "treatment_type"], aliases: ["莫西沙星", "维乐速", "Vigamox", "Moxifloxacin"] },
    { id: "tobramycin", category: "antibiotic", generic_name: "妥布霉素滴眼液 (0.3%)", brand_examples: "托百士 (Tobrex)", english_name: "Tobramycin Ophthalmic Solution 0.3%", dosage_form: "滴眼液 5ml", peri_op_phase: "常规门诊 / 儿童细菌性结膜炎", indications: "氨基糖苷类抗生素，对铜绿假单胞菌等革兰氏阴性杆菌效果突出，常用于细菌性结膜炎与角膜炎。", typical_regimen: "轻中度感染每 4 小时 1–2 滴；重症感染每小时 2 滴并随好转减量。", contraindications: "对氨基糖苷类过敏者禁用。", key_monitoring: "长期频繁滴用需警惕角膜点状上皮脱落及局部过敏。", linked_indicators: ["va_od_os"], aliases: ["妥布霉素", "托百士", "Tobrex", "Tobramycin"] },
    { id: "gatifloxacin", category: "antibiotic", generic_name: "加替沙星眼用凝胶 (0.3%)", brand_examples: "迪友 / 莱美", english_name: "Gatifloxacin Ophthalmic Gel 0.3%", dosage_form: "眼用凝胶 5g", peri_op_phase: "术前 / 睡前抗感染", indications: "第四代氟喹诺酮眼用凝胶，眼表滞留时间长，适合夜间抗感染保护。", typical_regimen: "每日 2–4 次或睡前涂入结膜囊。", contraindications: "喹诺酮类过敏者禁用。", key_monitoring: "凝胶滴入后可能有一过性视物模糊，建议最后滴用。", linked_indicators: ["treatment_type"], aliases: ["加替沙星", "迪友", "Gatifloxacin"] },
    { id: "fluorometholone_01", category: "steroid", generic_name: "氟米龙滴眼液 (0.1%)", brand_examples: "氟美童 / 爱丽氟米龙 (FML)", english_name: "Fluorometholone Ophthalmic Suspension 0.1%", dosage_form: "混悬滴眼液 5ml", peri_op_phase: "术后 1周–3月（防 Haze 核心）", indications: "中效温和糖皮质激素，升眼压风险较地塞米松低，是 TPRK/PRK 术后预防角膜雾状混浊（Haze）的一线主力药。", typical_regimen: "用前务必摇匀！TPRK 术后常按 QID→TID→BID→QD 逐月递减，总疗程 1–3 个月（遵医嘱）。", contraindications: "单纯疱疹病毒性角膜炎、真菌性角膜炎、角膜上皮明显缺损期禁用。", key_monitoring: "★核心监测：必须定期复查眼压（IOP），警惕激素性高眼压与隐匿性青光眼！混悬液滴前摇匀。", linked_indicators: ["iop", "ablation_depth", "rsb_um", "cct"], aliases: ["氟米龙", "氟美童", "FML", "Fluorometholone", "激素", "防Haze"] },
    { id: "loteprednol", category: "steroid", generic_name: "氯替泼诺混悬滴眼液 (0.5%)", brand_examples: "露达舒 (Lotemax)", english_name: "Loteprednol Etabonate 0.5%", dosage_form: "混悬滴眼液 5ml", peri_op_phase: "术后抗炎 / 激素性高眼压替代", indications: "酯类软性糖皮质激素，进入房水后迅速代谢失活，对眼压影响显著低于传统酮类激素。", typical_regimen: "用前摇匀，每日 2–4 次，逐步减量停药。", contraindications: "病毒性/真菌性角膜感染及活动性上皮缺损期禁用。", key_monitoring: "适用于对氟米龙/地塞米松敏感的眼压升高倾向人群，仍需按期监测 IOP。", linked_indicators: ["iop", "cd_ratio"], aliases: ["氯替泼诺", "露达舒", "Lotemax", "Loteprednol"] },
    { id: "tobramycin_dexamethasone", category: "steroid", generic_name: "妥布霉素地塞米松滴眼液", brand_examples: "典必殊 (TobraDex)", english_name: "Tobramycin 0.3% + Dexamethasone 0.1%", dosage_form: "混悬滴眼液 5ml / 眼膏", peri_op_phase: "SMILE/白内障术后短期（1–2周）", indications: "强效抗炎+抗感染复方制剂，常用于白内障术后及 SMILE/LASIK 术后早期强效控炎、预防 DLK。", typical_regimen: "摇匀后每日 4 次，通常短期应用 7–14 天后换用弱效激素或停药。", contraindications: "角膜上皮缺损、病毒/真菌性角膜炎、青光眼高危者慎用/禁用。", key_monitoring: "★强效激素，连续使用超过 10–14 天显著增加激素性高眼压与后囊下白内障风险！", linked_indicators: ["iop", "treatment_type", "lt"], aliases: ["典必殊", "妥布霉素地塞米松", "TobraDex", "地塞米松"] },
    { id: "prednisolone_acetate", category: "steroid", generic_name: "醋酸泼尼松龙滴眼液 (1%)", brand_examples: "百力特 (Pred Forte)", english_name: "Prednisolone Acetate 1%", dosage_form: "混悬滴眼液 5ml", peri_op_phase: "术后急性炎症 / 葡萄膜炎 / DLK 强化", indications: "角膜穿透力最强的局部强效糖皮质激素之一，用于前葡萄膜炎、重度术后反应及板层角膜炎（DLK）。", typical_regimen: "用前用力摇匀，依炎症严重度每 2–6 小时 1 滴，炎症控制后阶梯减量。", contraindications: "感染性角膜溃疡（病毒/真菌）、未经控制的青光眼禁用。", key_monitoring: "强升眼压潜能，必须严密随访 IOP 及角膜上皮完整性。", linked_indicators: ["iop", "cct"], aliases: ["百力特", "醋酸泼尼松龙", "Pred Forte", "泼尼松龙"] },
    { id: "pranoprofen", category: "nsaid", generic_name: "普拉洛芬滴眼液 (0.1%)", brand_examples: "普南扑灵", english_name: "Pranoprofen Ophthalmic Solution 0.1%", dosage_form: "滴眼液 5ml", peri_op_phase: "术后第1周止痛 / 激素减量辅助", indications: "前列腺素合成抑制剂，不升高眼压，用于外眼炎症、术后早期止痛退红及预防白内障术后黄斑囊样水肿（CME）。", typical_regimen: "每日 4 次，每次 1–2 滴；常规连用 1–4 周。", contraindications: "阿司匹林或 NSAIDs 过敏者禁用；严重角膜上皮溃疡慎用。", key_monitoring: "极少数角膜神经营养不良或重度干眼患者长期高频使用存在角膜融解风险，须注意上皮愈合。", linked_indicators: ["ablation_depth", "cct", "iop"], aliases: ["普拉洛芬", "普南扑灵", "Pranoprofen", "NSAID", "止痛"] },
    { id: "bromfenac", category: "nsaid", generic_name: "溴芬酸钠滴眼液 (0.1%)", brand_examples: "普罗纳克 (Bronuck)", english_name: "Bromfenac Sodium 0.1%", dosage_form: "滴眼液 5ml", peri_op_phase: "术后抗炎镇痛", indications: "长效强力眼用 NSAID，每日仅需 2 次，镇痛与抗无菌性炎症效果显著，不引起眼压升高。", typical_regimen: "BID（每日 2 次），每次 1 滴。", contraindications: "NSAIDs 过敏者禁用；角膜上皮大面积缺损期慎用。", key_monitoring: "依从性佳，滴用期间关注有无角膜上皮点染。", linked_indicators: ["ablation_depth", "iop"], aliases: ["溴芬酸钠", "普罗纳克", "Bronuck", "Bromfenac"] },
    { id: "diclofenac", category: "nsaid", generic_name: "双氯芬酸钠滴眼液 (0.1%)", brand_examples: "迪非 / 扶他林眼液", english_name: "Diclofenac Sodium 0.1%", dosage_form: "滴眼液 5ml", peri_op_phase: "术后镇痛 / 防黄斑水肿", indications: "经典非甾体抗炎滴眼液，用于角膜屈光术后镇痛、白内障术后防 CME 及过敏性结膜炎辅助治疗。", typical_regimen: "每日 3–4 次，每次 1 滴。", contraindications: "对双氯芬酸及 NSAIDs 过敏者禁用。", key_monitoring: "滴眼偶有一过性轻微刺痛；上皮未完全愈合时控制频次。", linked_indicators: ["ablation_depth"], aliases: ["双氯芬酸钠", "迪非", "Diclofenac"] },
    { id: "sodium_hyaluronate_01", category: "tear_repair", generic_name: "玻璃酸钠滴眼液 (0.1%)", brand_examples: "海露 (HYLO) / 爱丽", english_name: "Sodium Hyaluronate 0.1%", dosage_form: "无防腐剂多剂量 10ml / 单支装", peri_op_phase: "术前 & 术后 1–3 月全程必备", indications: "高保湿黏弹性人工泪液，促进角膜上皮细胞迁移与泪膜稳定，是所有屈光术后干眼的一线基石用药。", typical_regimen: "每日 4–6 次（术后首月可按需增至每 2 小时 1 次），与其他滴眼液间隔 5–10 分钟。", contraindications: "罕见过敏外无绝对禁忌。", key_monitoring: "屈光术后强烈优先选用不含防腐剂（如海露或单支装）剂型，保护脆弱角膜上皮微绒毛。", linked_indicators: ["cct", "front_qs", "thinnest_locat_pachy", "va_od_os"], aliases: ["玻璃酸钠", "海露", "爱丽", "HYLO", "人工泪液", "干眼"] },
    { id: "sodium_hyaluronate_03", category: "tear_repair", generic_name: "高浓度玻璃酸钠滴眼液 (0.3%)", brand_examples: "爱丽 0.3% / 施图伦高浓度型", english_name: "Sodium Hyaluronate 0.3%", dosage_form: "单支装 0.4ml×10支", peri_op_phase: "中重度术后干眼 / 上皮点染", indications: "更高黏度与保水力，适用于中重度干眼、角膜上皮干燥点染或夜间眼表润滑保护。", typical_regimen: "每日 3–5 次，睡前使用尤佳。", contraindications: "对成分过敏者禁用。", key_monitoring: "滴后可有数秒轻微视物模糊，属高黏度正常现象。", linked_indicators: ["cct", "front_qs"], aliases: ["玻璃酸钠0.3%", "高浓度玻璃酸钠", "重度干眼"] },
    { id: "peg_400", category: "tear_repair", generic_name: "聚乙二醇滴眼液", brand_examples: "思然 (Systane)", english_name: "Polyethylene Glycol 400 + Propylene Glycol", dosage_form: "滴眼液 15ml / 单支装", peri_op_phase: "术后泪膜修复 / 蒸发过强型干眼", indications: "形成仿生网格状保护膜，尤其适合睑板腺功能障碍（MGD）及屈光术后泪膜破裂时间（BUT）缩短患者。", typical_regimen: "每日 3–4 次或按需滴眼。", contraindications: "对本品成分过敏者禁用。", key_monitoring: "改善 Pentacam 检查前因泪膜不稳导致的 QS 报警。", linked_indicators: ["front_qs", "va_od_os"], aliases: ["聚乙二醇", "思然", "Systane", "人工泪液"] },
    { id: "cmc_sodium", category: "tear_repair", generic_name: "羧甲基纤维素钠滴眼液 (0.5%)", brand_examples: "亮视 (Refresh Plus)", english_name: "Carboxymethylcellulose Sodium 0.5%", dosage_form: "不含防腐剂单支装", peri_op_phase: "屈光术后干眼润滑", indications: "阴离子纤维素润滑剂，能与角膜上皮细胞表面结合延长泪液滞留时间，温和无刺激。", typical_regimen: "每日 4–6 次，单支开启后建议当日用完丢弃。", contraindications: "过敏者禁用。", key_monitoring: "单支装无防腐剂，切勿隔夜复用以防污染。", linked_indicators: ["va_od_os", "cct"], aliases: ["羧甲基纤维素钠", "亮视", "Refresh"] },
    { id: "rb_bfgf", category: "tear_repair", generic_name: "重组牛碱性成纤维细胞生长因子滴眼液/凝胶", brand_examples: "贝复舒 (rb-bFGF)", english_name: "Recombinant Bovine Basic Fibroblast Growth Factor", dosage_form: "滴眼液 / 眼用凝胶", peri_op_phase: "TPRK/PRK 术后上皮愈合期（1–2周）", indications: "促进角膜上皮细胞增殖与基质修复，显著加速 TPRK/PRK 表层手术后角膜上皮闭合，缩短疼痛期。", typical_regimen: "每日 4–6 次；需 2–8℃ 冷藏避光保存。", contraindications: "对本品过敏者禁用；合并活动性感染需在抗感染控制下使用。", key_monitoring: "蛋白质生物制剂忌高温暴晒，切勿与含酒精或强氧化剂眼液直接混滴。", linked_indicators: ["cct", "ablation_depth", "rsb_um"], aliases: ["贝复舒", "生长因子", "rb-bFGF", "角膜修复", "上皮修复"] },
    { id: "calf_blood_gel", category: "tear_repair", generic_name: "小牛血去蛋白提取物眼用凝胶 (20%)", brand_examples: "速高捷 / 欧沁", english_name: "Deproteinized Calf Blood Extract Eye Gel", dosage_form: "眼用凝胶 5g", peri_op_phase: "角膜上皮缺损 / 干眼角膜点染", indications: "提高角膜组织摄氧与葡萄糖利用，促进角膜上皮再生与基质营养修复。", typical_regimen: "每日 3–4 次或睡前涂入结膜囊内。", contraindications: "对本品过敏者禁用。", key_monitoring: "凝胶制剂安排在所有水剂滴眼液之后至少间隔 10 分钟使用。", linked_indicators: ["cct", "thinnest_locat_pachy"], aliases: ["小牛血", "速高捷", "欧沁", "角膜营养"] },
    { id: "brinzolamide", category: "glaucoma", generic_name: "布林佐胺滴眼液 (1%)", brand_examples: "派立明 (Azopt)", english_name: "Brinzolamide Ophthalmic Suspension 1%", dosage_form: "混悬滴眼液 5ml", peri_op_phase: "激素性高眼压 / 开角型青光眼", indications: "碳酸酐酶抑制剂（CAI），通过减少房水生成降低眼压，对心肺影响小，常作为术后激素性高眼压安全优选。", typical_regimen: "用前摇匀，每日 2–3 次，每次 1 滴。", contraindications: "磺胺类药物严重过敏者、严重肾功能不全者禁用。", key_monitoring: "偶有口苦或短暂视物雾感；滴后按压泪囊区 1–2 分钟减少全身吸收。", linked_indicators: ["iop", "cd_ratio", "acd"], aliases: ["布林佐胺", "派立明", "Azopt", "降眼压", "青光眼"] },
    { id: "timolol", category: "glaucoma", generic_name: "马来酸噻吗洛尔滴眼液 (0.5%)", brand_examples: "噻吗心安 (Timoptic)", english_name: "Timolol Maleate 0.5%", dosage_form: "滴眼液 5ml", peri_op_phase: "高眼压 / 青光眼一线降压", indications: "非选择性 β 受体阻滞剂，抑制房水生成，降眼压确切且性价比高，常用于激素性高眼压短期控压。", typical_regimen: "每日 1–2 次（早晚各 1 滴），滴后按压内眦泪囊区 2 分钟。", contraindications: "★绝对禁忌：支气管哮喘、重度慢阻肺（COPD）、窦性心动过缓、II–III 度房室传导阻滞及心衰患者严禁使用！", key_monitoring: "开方前必须询问哮喘与心率病史！", linked_indicators: ["iop", "cd_ratio", "acd"], aliases: ["噻吗洛尔", "噻吗心安", "Timolol", "降眼压", "β阻滞剂"] },
    { id: "latanoprost", category: "glaucoma", generic_name: "拉坦前列素滴眼液 (0.005%)", brand_examples: "适利达 (Xalatan)", english_name: "Latanoprost 0.005%", dosage_form: "滴眼液 2.5ml", peri_op_phase: "原发性开角型青光眼 / 高眼压症", indications: "前列腺素类衍生物，增加葡萄膜巩膜途径房水外流，24 小时平稳强效降眼压（降幅约 25–35%）。", typical_regimen: "QN（每晚睡前 1 滴），不可增加频次（过频反而减弱降压效果）。", contraindications: "活动性眼内炎症（葡萄膜炎）、黄斑囊样水肿高危或单纯疱疹角膜炎史慎用。", key_monitoring: "可能引起睫毛增长、眼周色素加深；未开封需冷藏，开封后室温 4 周内用完。", linked_indicators: ["iop", "cd_ratio", "angle"], aliases: ["拉坦前列素", "适利达", "Xalatan", "Latanoprost", "前列腺素"] },
    { id: "brimonidine", category: "glaucoma", generic_name: "酒石酸溴莫尼定滴眼液 (0.15% / 0.2%)", brand_examples: "阿法根 (Alphagan)", english_name: "Brimonidine Tartrate", dosage_form: "滴眼液 5ml", peri_op_phase: "降眼压 / 屈光术后夜间大暗瞳缩瞳参考", indications: "选择性 α2 肾上腺素能受体激动剂，兼具降眼压与轻度缩瞳作用（低浓度可辅助减轻大暗瞳术后夜间眩光）。", typical_regimen: "降眼压通常每日 2–3 次；缓解夜间眩光仅按医嘱晚间低频使用。", contraindications: "2 岁以下婴幼儿及使用单胺氧化酶抑制剂（MAOI）者禁用。", key_monitoring: "长期使用部分患者可出现滤泡性过敏性结膜炎或嗜睡口干。", linked_indicators: ["iop", "pupil", "optical_zone"], aliases: ["溴莫尼定", "阿法根", "Alphagan", "Brimonidine", "夜间眩光"] },
    { id: "tropicamide_phenylephrine", category: "mydriatic", generic_name: "复方托吡卡胺滴眼液", brand_examples: "美多丽 (Mydrin-P)", english_name: "Tropicamide 0.5% + Phenylephrine 0.5%", dosage_form: "滴眼液 5ml / 10ml", peri_op_phase: "术前散瞳验光 & 眼底周边排查", indications: "快速短效散瞳与睫状肌麻痹，是屈光术前散瞳验光及排查高度近视周边视网膜裂孔的标准检查用药。", typical_regimen: "检查前每隔 5–10 分钟滴 1 次，共 3–4 次，约 20–30 分钟充分散瞳，4–6 小时恢复。", contraindications: "★浅前房（ACD < 2.5 mm）、窄房角或原发性闭角型青光眼严禁散瞳！", key_monitoring: "散瞳前务必先确认前房深度与眼压；散瞳后 6 小时内畏光视近模糊，切勿自驾车。", linked_indicators: ["al", "acd", "lt", "pupil", "angle"], aliases: ["复方托吡卡胺", "美多丽", "散瞳", "Mydrin", "Tropicamide"] },
    { id: "atropine_001", category: "mydriatic", generic_name: "低浓度硫酸阿托品滴眼液 (0.01%)", brand_examples: "美欧品 / 兴齐", english_name: "Atropine Sulfate Ophthalmic Solution 0.01%", dosage_form: "单支装 0.4ml", peri_op_phase: "青少年近视进展防控（门诊）", indications: "延缓儿童青少年轴性近视进展（抑制眼轴 AL 过快增长），低浓度 0.01% 畏光与视近模糊反应轻微。", typical_regimen: "每晚睡前双眼各 1 滴，需长期规范随访并联合眼轴 AL 监测。", contraindications: "阿托品过敏、青光眼或高眼压、窄房角患者禁用。", key_monitoring: "每 3–6 个月复查 IOLMaster 眼轴（AL）、屈光度（SE）与眼压；切勿骤停以防反弹。", linked_indicators: ["al", "sphere", "se_calc"], aliases: ["低浓度阿托品", "阿托品", "0.01%阿托品", "近视防控", "Atropine"] },
    { id: "olopatadine", category: "allergy_viral", generic_name: "盐酸奥洛他定滴眼液 (0.1%)", brand_examples: "帕坦洛 (Patanol)", english_name: "Olopatadine HCl 0.1%", dosage_form: "滴眼液 5ml", peri_op_phase: "过敏性结膜炎 / 揉眼风险控制", indications: "双效抗组胺+肥大细胞稳定剂，快速止痒抗过敏；控制过敏揉眼对预防圆锥角膜进展尤为重要。", typical_regimen: "每日 2 次（间隔 6–8 小时），每次 1 滴。", contraindications: "对成分过敏者禁用；戴软性隐形眼镜需摘镜后滴眼，间隔 15 分钟再戴。", key_monitoring: "圆锥角膜倾向或过敏体质患者术前需严控眼痒揉眼习惯。", linked_indicators: ["kmax_front", "diagnosis"], aliases: ["奥洛他定", "帕坦洛", "Patanol", "抗过敏", "止痒"] },
    { id: "ganciclovir_gel", category: "allergy_viral", generic_name: "更昔洛韦眼用凝胶 (0.15%)", brand_examples: "丽科明 / 迪可罗", english_name: "Ganciclovir Ophthalmic Gel 0.15%", dosage_form: "眼用凝胶 5g", peri_op_phase: "病毒性角膜炎治疗 / 复发预防", indications: "广谱抗疱疹病毒药，用于单纯疱疹病毒性角膜炎（HSK）；既往 HSK 病史者行激光手术须高度谨慎防复发。", typical_regimen: "急性期每日 4–5 次，上皮愈合后减为每日 3 次维持 7 天。", contraindications: "对更昔洛韦/阿昔洛韦过敏者禁用；孕期哺乳期慎用。", key_monitoring: "活动性病毒性角膜炎严禁使用局部糖皮质激素滴眼液！", linked_indicators: ["cct", "diagnosis"], aliases: ["更昔洛韦", "丽科明", "抗病毒", "疱疹性角膜炎"] },
    { id: "proparacaine", category: "peri_op_aux", generic_name: "盐酸丙美卡因滴眼液 (0.5%)", brand_examples: "爱尔凯因 (Alcaine)", english_name: "Proparacaine HCl 0.5%", dosage_form: "滴眼液 15ml（院内专用）", peri_op_phase: "术中表面麻醉 / 院内眼压与检查", indications: "快速强效眼表局部麻醉药，15–20 秒起效，用于角膜屈光手术、白内障手术及接触式眼压测量。", typical_regimen: "仅限院内医护人员操作滴眼 1–2 滴；严禁患者带回家自行止痛！", contraindications: "★严禁院外滥用：反复自行滴用表麻药会导致严重角膜上皮毒性、神经营养性溃疡甚至穿孔！", key_monitoring: "2–8℃ 冷藏避光保存，变黄变色即弃用。", linked_indicators: ["treatment_type", "iop"], aliases: ["丙美卡因", "爱尔凯因", "Alcaine", "表面麻醉", "麻药"] },
    { id: "mitomycin_c", category: "peri_op_aux", generic_name: "丝裂霉素 C (0.02% MMC 术中专用)", brand_examples: "术中现配溶液（院内无菌使用）", english_name: "Mitomycin C 0.02% Intraoperative", dosage_form: "院内术中棉片贴敷", peri_op_phase: "TPRK/PRK 高度近视深切削术中防 Haze", indications: "抗代谢药，高度近视（|SE| > 6.0 D 或切削深度 > 75–100 μm）行 TPRK/PRK 时术中短暂贴敷角膜基质床抑制成纤维细胞增殖，显著降低术后 Haze 发生率。", typical_regimen: "严格由手术医生术中贴敷 12–40 秒，随后用大量平衡盐溶液（BSS）彻底冲洗。", contraindications: "不可接触角膜缘干细胞或巩膜；非院外滴眼液。", key_monitoring: "精准控制贴敷时长与冲洗彻底性，兼顾防 Haze 与内皮/上皮安全。", linked_indicators: ["ablation_depth", "se_calc", "rsb_um"], aliases: ["丝裂霉素", "MMC", "防Haze", "深切削"] },
]);

const OPHTHALMIC_DRUG_BY_ID = Object.fromEntries(OPHTHALMIC_DRUGS.map((d) => [d.id, d]));

// Anonymized aggregate research cohort migrated from E:\zsh\OphthalmicOCR_System\workspace_data\thesis_experiments\thesis_experiments_report.json
const ZSH_COHORT_BENCHMARK = Object.freeze({
    source: "OphthalmicAI v3.1 (E:\\zsh 真实脱敏多设备眼科队列)",
    ablation4Stage: [
        { stageId: "Exp1_PPOCRv5", label: "PP-OCRv5 基线（无方向纠偏/暗图处理）", accuracyPct: 56.31, rot180Pct: 0.0, darkModePct: 38.89, rsbCaught: "0/1", latencyMs: 21702.8 },
        { stageId: "Exp2_PPOCRv6_Small", label: "PP-OCRv6 Small 轻量化", accuracyPct: 77.67, rot180Pct: 0.0, darkModePct: 100.0, rsbCaught: "0/1", latencyMs: 377.5 },
        { stageId: "Exp3_PPOCRv6_Med_PreCLS", label: "+暗图Gamma预处理 +NMS +180°CLS纠偏", accuracyPct: 91.26, rot180Pct: 87.5, darkModePct: 100.0, rsbCaught: "0/1", latencyMs: 1806.6 },
        { stageId: "Exp4_OphthalmicAI_v3.1", label: "全链路 + 临床语义校验与 RSB 红线", accuracyPct: 93.2, rot180Pct: 87.5, darkModePct: 100.0, rsbCaught: "1/1", latencyMs: 1732.7 },
    ],
    calibration: {
        nFieldEvaluations: 256,
        optimalT: 0.653,
        eceBefore: 0.0649,
        eceAfter: 0.0562,
        eceReductionPct: 13.4,
        nllBefore: 0.0876,
        nllAfter: 0.0807,
        autoPassCoverage90ErrorPct: 0.0,
    },
    cohortKpi: {
        totalRecords: 36,
        uniquePatients: 9,
        corruptPdfsIsolated: 1,
        meanConfidencePct: 88.88,
        rulePassRatePct: 86.1,
        crossDocAlertCount: 0,
    },
    munnerlynFit: {
        slopeUmPerD: 11.1,
        interceptUm: 23.7,
        r: 0.873,
        xMin: 3.62,
        xMax: 7.38,
    },
    templateBreakdown: [
        { id: "iolmaster", name: "IOLMaster 700 生物测量", count: 19 },
        { id: "zeiss_treatment", name: "ZEISS MEL90 激光治疗单", count: 8 },
        { id: "clinical_note", name: "屈光病历/混合检查单", count: 5 },
        { id: "cornea", name: "Pentacam 角膜地形图", count: 4 },
    ],
    distributions: {
        al: { label: "眼轴长度 AL (mm)", n: 22, mean: 24.68, sd: 1.22, median: 24.8, min: 23.04, max: 26.94, bins: [{ label: "23.0–23.8", count: 6 }, { label: "23.8–24.6", count: 2 }, { label: "24.6–25.4", count: 7 }, { label: "25.4–26.2", count: 4 }, { label: "26.2–26.9", count: 3 }] },
        cct: { label: "中央角膜厚度 CCT (μm)", n: 33, mean: 497.52, sd: 24.15, median: 492.0, min: 466.0, max: 549.0, bins: [{ label: "466–480", count: 9 }, { label: "480–494", count: 9 }, { label: "494–508", count: 7 }, { label: "508–521", count: 2 }, { label: "521–535", count: 1 }, { label: "535–549", count: 5 }] },
        k1: { label: "角膜平K K1 (D)", n: 29, mean: 42.7, sd: 1.61, median: 42.2, min: 40.98, max: 45.7, bins: [{ label: "41.0–41.8", count: 10 }, { label: "41.8–42.6", count: 7 }, { label: "42.6–43.3", count: 6 }, { label: "44.9–45.7", count: 6 }] },
        se: { label: "等效球镜 SE (D)", n: 11, mean: -5.34, sd: 1.52, median: -6.0, min: -7.38, max: -2.38, bins: [{ label: "-7.4~-6.1", count: 3 }, { label: "-6.1~-4.9", count: 5 }, { label: "-4.9~-3.6", count: 1 }, { label: "-3.6~-2.4", count: 2 }] },
        rsb: { label: "剩余基质床 RSB (μm)", n: 7, mean: 406.14, sd: 13.5, median: 403.0, min: 390.0, max: 429.0, bins: [{ label: "390–403", count: 3 }, { label: "403–416", count: 2 }, { label: "416–429", count: 2 }] },
        ablation: { label: "激光切削深度 (μm)", n: 7, mean: 89.14, sd: 15.65, median: 92.0, min: 59.0, max: 104.0, bins: [{ label: "59–74", count: 1 }, { label: "74–89", count: 2 }, { label: "89–104", count: 4 }] },
    },
});

// Reproducible 36-Query Medical RAG & L1 Guardrail Benchmark (verified via dengta-home/tools/medical-rag-ablation.mjs)
const MEDICAL_RAG_BENCHMARK = Object.freeze({
    reproCommand: "node dengta-home/tools/medical-rag-ablation.mjs --write-report",
    corpusTotal: 89,
    queryCount: 36,
    ragAblation: [
        { id: "B0_Substring", label: "B0 朴素子串/精确切片基线", recallAt1Pct: 80.6, recallAt3Pct: 94.4, recallAt5Pct: 94.4, mrrAt5: 0.866, ndcgAt5: 0.744, avgLatencyMs: 0.25 },
        { id: "B1_BM25", label: "B1 纯 BM25 (MiniSearch)", recallAt1Pct: 88.9, recallAt3Pct: 100.0, recallAt5Pct: 100.0, mrrAt5: 0.944, ndcgAt5: 0.875, avgLatencyMs: 3.96 },
        { id: "B2_Semantic", label: "B2 医疗同义词 + TF-IDF 余弦", recallAt1Pct: 88.9, recallAt3Pct: 97.2, recallAt5Pct: 100.0, mrrAt5: 0.933, ndcgAt5: 0.818, avgLatencyMs: 2.78 },
        { id: "B3_Hybrid_RRF", label: "B3 混合语义 RRF 融合（灯塔方案）", recallAt1Pct: 91.7, recallAt3Pct: 97.2, recallAt5Pct: 100.0, mrrAt5: 0.951, ndcgAt5: 0.879, avgLatencyMs: 3.53 },
    ],
    safetySuites: [
        { label: "L1 临床红线校验 (14 例)", exactMatchPct: 100.0, hazardRecallPct: 100.0, falseAlarmPct: 0.0 },
        { label: "L1 眼科药典 A/C/D/X 禁忌 (10 例)", exactMatchPct: 100.0, hazardRecallPct: 100.0, falseAlarmPct: 0.0 },
        { label: "三机跨设备 + 随访进展 (8 例)", exactMatchPct: 100.0, hazardRecallPct: 100.0, falseAlarmPct: 0.0 },
        { label: "L3 引用规范 & Zero-PII (6 组)", exactMatchPct: 100.0, hazardRecallPct: 100.0, falseAlarmPct: 0.0 },
    ],
});

function extractFirstNumber(text) {
    if (text === null || text === undefined || text === "") return null;
    const match = String(text).match(/([+-]?\d+(?:\.\d+)?)/);
    if (!match) return null;
    const num = Number.parseFloat(match[1]);
    return Number.isFinite(num) ? num : null;
}

function parseOphthalmicReportText(rawText = "") {
    const text = String(rawText || "")
        .replace(/回K/g, "OK")
        .replace(/\b0D\b/g, "OD")
        .replace(/\b0S\b/g, "OS");
    const fields = {};
    const patterns = [
        ["eye", /(?:眼别|Eye)\s*[:：]?\s*(OD|OS|OU|右眼|左眼|双眼)|\b(OD|OS|OU)\b/i],
        ["treatment_type", /(?:术式|手术方式|Treatment(?:\s*Type)?)\s*[:：=]\s*([A-Za-z0-9\-/]+)|\b(FS-?LASIK|SMILE|TPRK|TransPRK|PRK|LASIK|ICL|LASEK|PTK)\b/i],
        ["al", /(?:眼轴长度|眼轴|\bAL\b)\s*[:：=]?\s*([+-]?\d+(?:\.\d+)?)\s*(?:mm)?/i],
        ["cct", /(?:中央角膜厚度|术前角膜厚度|角膜厚度|\bCCT\b|\bPachy\b)\s*[:：=]?\s*(\d{3}(?:\.\d+)?)\s*(?:μm|um)?/i],
        ["thinnest_locat_pachy", /(?:最薄点(?:厚度)?|Thinnest\s*Locat(?:ion)?)\s*[:：=]?\s*(\d{3}(?:\.\d+)?)/i],
        ["pachy_apex_pachy", /(?:角膜顶点(?:厚度)?|Pachy\s*Apex)\s*[:：=]?\s*(\d{3}(?:\.\d+)?)/i],
        ["acd", /(?:内前房深度|前房深度|\bACD(?:\s*Int)?\b)\s*[:：=]?\s*(\d(?:\.\d+)?)/i],
        ["wtw", /(?:白到白|角膜横径|\bWTW\b)\s*[:：=]?\s*(\d{1,2}(?:\.\d+)?)/i],
        ["pupil", /(?:暗瞳(?:直径)?|瞳孔(?:直径)?|\bPupil(?:\s*D)?\b)\s*[:：=]?\s*(\d(?:\.\d+)?)/i],
        ["k1", /(?:前表面\s*K1|平K|\bK1\b)\s*[:：=]?\s*(\d{2}(?:\.\d+)?)/i],
        ["k2", /(?:前表面\s*K2|陡K|\bK2\b)\s*[:：=]?\s*(\d{2}(?:\.\d+)?)/i],
        ["delta_k", /(?:角膜散光|ΔK|Astig)\s*[:：=]?\s*([+-]?\d(?:\.\d+)?)/i],
        ["kmax_front", /(?:最大曲率|\bKmax(?:\s*\(?Front\)?)?\b)\s*[:：=]?\s*(\d{2}(?:\.\d+)?)/i],
        ["sphere", /(?:球镜(?:矫正|度数)?|\bSphere\b|\bDS\b)\s*[:：=]?\s*([+-]?\d{1,2}(?:\.\d+)?)/i],
        ["cylinder", /(?:柱镜(?:矫正|度数)?|散光度数|\bCylinder\b|\bDC\b)\s*[:：=]?\s*([+-]?\d{1,2}(?:\.\d+)?)/i],
        ["axis", /(?:散光轴位|轴位|\bAxis\b)\s*[:：=]?\s*(\d{1,3})/i],
        ["se_calc", /(?:等效球镜|\bSE\b)\s*[:：=]?\s*([+-]?\d{1,2}(?:\.\d+)?)/i],
        ["optical_zone", /(?:光学区(?:直径)?|\bOZ\b|Optical\s*Zone)\s*[:：=]?\s*(\d(?:\.\d+)?)/i],
        ["ablation_depth", /(?:激光切削深度|切削深度|Ablation(?:\s*Depth)?)\s*[:：=]?\s*(\d{2,3}(?:\.\d+)?)/i],
        ["iop", /(?:眼内压|眼压|\bIOP\b|\bNCT\b)\s*[:：=]?\s*(\d{1,2}(?:\.\d+)?)/i],
        ["cd_ratio", /(?:杯盘比|\bC\/D\b)\s*[:：=]?\s*(0\.\d+)/i],
    ];

    for (const [key, regex] of patterns) {
        const match = text.match(regex);
        if (match) {
            const rawVal = (match[1] || match[2] || "").trim();
            if (key === "eye") {
                fields.eye = rawVal === "右眼" ? "OD" : rawVal === "左眼" ? "OS" : rawVal === "双眼" ? "OU" : rawVal.toUpperCase();
            } else {
                fields[key] = rawVal;
            }
        }
    }

    let templateId = "clinical_note";
    if (fields.ablation_depth || fields.optical_zone || /MEL90|ZEISS|TPRK|LASIK|SMILE/i.test(text)) {
        templateId = "zeiss_treatment";
    } else if (fields.kmax_front || fields.thinnest_locat_pachy || /Pentacam/i.test(text)) {
        templateId = "cornea";
        if (fields.k1 && !fields.front_k1) fields.front_k1 = fields.k1;
        if (fields.k2 && !fields.front_k2) fields.front_k2 = fields.k2;
        if (fields.iop && !fields.enter_iop) fields.enter_iop = fields.iop;
        if (fields.acd && !fields.acd_int) fields.acd_int = fields.acd;
    } else if (fields.al || fields.wtw || /IOLMaster/i.test(text)) {
        templateId = "iolmaster";
    }

    return { template_id: templateId, fields };
}

function recommendOphthalmicDrugs(templateId, fields = {}, alerts = []) {
    const recIds = [];
    const reasons = [];
    const alertRules = new Set((alerts || []).map((a) => a.rule));

    if (templateId === "zeiss_treatment") {
        recIds.push("levofloxacin", "fluorometholone_01", "pranoprofen", "sodium_hyaluronate_01", "rb_bfgf");
        reasons.push("ZEISS MEL90 屈光激光单：关联围术期抗感染、防 Haze 激素阶梯与角膜上皮促修复方案。");
        const abl = extractFirstNumber(fields.ablation_depth);
        if (abl !== null && abl >= 80) {
            recIds.push("mitomycin_c");
            reasons.push(`激光切削深度 ${abl.toFixed(0)}μm ≥ 80μm：提示关注术中 0.02% MMC 防 Haze 策略及术后校正眼压随访。`);
        }
    } else if (templateId === "cornea") {
        recIds.push("sodium_hyaluronate_01", "peg_400", "fluorometholone_01", "brinzolamide");
        reasons.push("Pentacam 角膜地形图：关联泪膜稳态人工泪液、角膜抗炎与薄角膜校正眼压监测参考。");
    } else if (templateId === "iolmaster") {
        recIds.push("tropicamide_phenylephrine", "sodium_hyaluronate_01", "atropine_001", "levofloxacin");
        reasons.push("IOLMaster 700 生物测量：关联术前散瞳眼底排查、轴性近视防控与围术期抗感染用药。");
    } else {
        recIds.push("sodium_hyaluronate_01", "levofloxacin", "pranoprofen", "tropicamide_phenylephrine");
        reasons.push("屈光/眼科门诊评估：关联常规干眼润湿、抗感染及检查散瞳参考用药。");
    }

    if (alertRules.has("KERATOCONUS_SCREEN")) {
        recIds.unshift("olopatadine");
        reasons.unshift("触发圆锥角膜筛查提醒：重点控制过敏眼痒与揉眼习惯，并审慎评估激光手术禁忌。");
    }
    if (alertRules.has("RSB_SAFETY_REDLINE") || alertRules.has("PTA_SAFETY_REDLINE")) {
        reasons.unshift("触发 RSB/PTA 生物力学安全红线：优先复核光学区、减矫量或改行 ICL 晶体植入，慎行深层角膜切削。");
    }
    if (alertRules.has("HIGH_IOP_ALERT") || alertRules.has("THIN_CORNEA_IOP_MASK")) {
        for (const gid of ["brinzolamide", "timolol", "latanoprost"]) {
            if (!recIds.includes(gid)) recIds.unshift(gid);
        }
        reasons.unshift("触发高眼压/薄角膜隐匿高眼压提醒：关联局部降眼压一线参考用药（开用噻吗洛尔前必排哮喘与心动过缓！）。");
    }
    if (alertRules.has("SHALLOW_ACD_MYDRIATIC_RISK")) {
        const idx = recIds.indexOf("tropicamide_phenylephrine");
        if (idx >= 0) recIds.splice(idx, 1);
        reasons.unshift("浅前房警报（ACD < 2.5mm）：已从推荐列表自动剔除散瞳药（美多丽），防诱发急性闭角型青光眼！");
    }

    const uniqueIds = [...new Set(recIds)];
    const drugs = uniqueIds.map((id) => OPHTHALMIC_DRUG_BY_ID[id]).filter(Boolean);
    const protocols = OPHTHALMIC_PERIOP_PROTOCOLS.filter((p) => p.applicable_templates.includes(templateId));

    return {
        template_id: templateId,
        reasons,
        drugs,
        protocols: protocols.length ? protocols : OPHTHALMIC_PERIOP_PROTOCOLS.slice(0, 2),
        disclaimer: "临床辅助参考，不替代眼科主诊医师处方决策。",
    };
}

function validateOphthalmicRecord({ template_id = "clinical_note", fields = {} } = {}) {
    const safeFields = { ...(fields && typeof fields === "object" ? fields : {}) };
    const derived = {};
    const alerts = [];

    // 1. Derived optical SE calculation & consistency
    const s = extractFirstNumber(safeFields.sphere);
    const c = extractFirstNumber(safeFields.cylinder);
    const se = extractFirstNumber(safeFields.se_calc);
    if (s !== null && c !== null) {
        const expectedSe = Number((s + c / 2).toFixed(2));
        derived.se_calc = `${expectedSe >= 0 ? "+" : ""}${expectedSe.toFixed(2)}D`;
        if (se !== null && Math.abs(se - expectedSe) > 0.25) {
            alerts.push({
                level: "WARN",
                rule: "SE_FORMULA_MISMATCH",
                field: "se_calc",
                message: `等效球镜 SE(${se.toFixed(2)}D) 与公式 S+C/2(${expectedSe.toFixed(2)}D) 偏差 > 0.25D`,
            });
        } else if (se === null) {
            safeFields.se_calc = derived.se_calc;
        }
    }

    // 2. Refractive biomechanics: RSB, PTA & Munnerlyn estimation
    const pachy = extractFirstNumber(safeFields.cct || safeFields.thinnest_locat_pachy || safeFields.pachy_apex_pachy);
    const ablation = extractFirstNumber(safeFields.ablation_depth);
    const oz = extractFirstNumber(safeFields.optical_zone);
    const effSe = extractFirstNumber(safeFields.se_calc);
    if (effSe !== null && oz !== null && oz > 0) {
        const munnerlynEst = Number(((Math.abs(effSe) * oz * oz) / 3).toFixed(1));
        derived.munnerlyn_estimated_ablation_um = `${munnerlynEst}μm`;
    }
    if (pachy !== null && ablation !== null && pachy > 0) {
        const ttype = String(safeFields.treatment_type || "").toUpperCase();
        const isFlap = ttype.includes("LASIK") || ttype.includes("FS");
        const flapOrEpi = isFlap ? 110.0 : 50.0;
        const rsb = isFlap ? pachy - flapOrEpi - ablation : pachy - ablation;
        const pta = ((flapOrEpi + ablation) / pachy) * 100.0;
        derived.rsb_um = `${Math.round(rsb)}μm`;
        derived.pta_pct = `${pta.toFixed(1)}%`;
        safeFields.rsb_um = derived.rsb_um;
        safeFields.pta_pct = derived.pta_pct;

        if (rsb < 280.0) {
            alerts.push({
                level: "REVIEW",
                rule: "RSB_SAFETY_REDLINE",
                field: "rsb_um",
                message: `剩余角膜基质床厚度 RSB=${Math.round(rsb)}μm 低于临床安全红线 280μm（角膜扩张高危）`,
            });
        }
        if (pta >= 40.0) {
            alerts.push({
                level: "REVIEW",
                rule: "PTA_SAFETY_REDLINE",
                field: "pta_pct",
                message: `角膜组织改变百分比 PTA=${pta.toFixed(1)}% ≥ 40% 安全红线（术后角膜扩张独立高危因素）`,
            });
        }
    }

    // 3. Physiological bounds
    const bounds = PHYSIOLOGICAL_BOUNDS[template_id] || PHYSIOLOGICAL_BOUNDS.clinical_note;
    for (const [key, [lo, hi, unit, label]] of Object.entries(bounds)) {
        const raw = String(safeFields[key] ?? "").trim();
        if (!raw) continue;
        const val = extractFirstNumber(raw);
        if (val === null) {
            alerts.push({ level: "WARN", rule: "FORMAT_NON_NUMERIC", field: key, message: `${label} 字段值 '${raw}' 无法解析为有效数值` });
            continue;
        }
        if (val < lo || val > hi) {
            alerts.push({ level: "WARN", rule: "PHYSIOLOGICAL_RANGE", field: key, message: `${label}=${val.toFixed(2)}${unit} 超出临床生理区间 [${lo}, ${hi}]${unit}` });
        }
    }

    // 4. Keratometry & Pachymetry consistency + Keratoconus Screening
    const k1 = extractFirstNumber(safeFields.k1 || safeFields.front_k1);
    const k2 = extractFirstNumber(safeFields.k2 || safeFields.front_k2);
    const dk = extractFirstNumber(safeFields.delta_k || safeFields.front_astig);
    if (k1 !== null && k2 !== null) {
        if (k2 < k1 - 0.1) {
            alerts.push({ level: "WARN", rule: "K_ORDER_INVERSION", field: "k2", message: `陡K K2(${k2.toFixed(2)}D) 小于 平K K1(${k1.toFixed(2)}D)，疑似倒置` });
        }
        if (dk !== null && Math.abs(Math.abs(dk) - Math.abs(k2 - k1)) > 0.35) {
            alerts.push({ level: "WARN", rule: "DELTA_K_MISMATCH", field: "delta_k", message: `|ΔK|(${Math.abs(dk).toFixed(2)}D) 与 |K2-K1|(${Math.abs(k2 - k1).toFixed(2)}D) 偏差 > 0.35D` });
        }
    }

    const apex = extractFirstNumber(safeFields.pachy_apex_pachy);
    const thin = extractFirstNumber(safeFields.thinnest_locat_pachy);
    if (apex !== null && thin !== null && thin > apex + 5.0) {
        alerts.push({ level: "WARN", rule: "PACHY_THINNEST_GT_APEX", field: "thinnest_locat_pachy", message: `最薄点厚度(${Math.round(thin)}μm) 大于 角膜顶点厚度(${Math.round(apex)}μm)` });
    }

    const kmax = extractFirstNumber(safeFields.kmax_front);
    const thinForKc = thin !== null ? thin : pachy;
    if ((kmax !== null && kmax > 47.2) || (thinForKc !== null && thinForKc < 470.0)) {
        const reasons = [];
        if (kmax !== null && kmax > 47.2) reasons.push(`Kmax=${kmax.toFixed(1)}D > 47.2D`);
        if (thinForKc !== null && thinForKc < 470.0) reasons.push(`角膜最薄点/CCT=${Math.round(thinForKc)}μm < 470μm`);
        alerts.push({
            level: "REVIEW",
            rule: "KERATOCONUS_SCREEN",
            field: kmax !== null && kmax > 47.2 ? "kmax_front" : "thinnest_locat_pachy",
            message: `圆锥角膜术前筛查高危（${reasons.join("，")}），严禁直接行常规激光切削，建议查后表面高度与 BAD-D`,
        });
    }

    // 5. High IOP + Thin-Cornea Ehlers IOP Correction Warning
    const iopVal = extractFirstNumber(safeFields.enter_iop || safeFields.iop);
    if (iopVal !== null) {
        if (pachy !== null && pachy < 500) {
            const ehlersDelta = Number((((545 - pachy) / 50) * 3.0).toFixed(1));
            const corrected = Number((iopVal + ehlersDelta).toFixed(1));
            derived.ehlers_corrected_iop = `${corrected} mmHg（薄角膜校正 +${ehlersDelta} mmHg）`;
            if (corrected > 21.0 && iopVal <= 21.0) {
                alerts.push({
                    level: "WARN",
                    rule: "THIN_CORNEA_IOP_MASK",
                    field: "iop",
                    message: `薄角膜掩盖风险：实测眼压 ${iopVal.toFixed(1)}mmHg，按 CCT=${Math.round(pachy)}μm Ehlers 校正约 ${corrected}mmHg > 21mmHg！`,
                });
            }
        }
        if (iopVal > 21.0) {
            alerts.push({
                level: "REVIEW",
                rule: "HIGH_IOP_ALERT",
                field: safeFields.enter_iop ? "enter_iop" : "iop",
                message: `眼压 IOP=${iopVal.toFixed(1)}mmHg > 21mmHg（警惕青光眼或激素性高眼压）`,
            });
        }
    }

    // 6. Shallow ACD -> Mydriatic / Angle-Closure Redline
    const acdVal = extractFirstNumber(safeFields.acd || safeFields.acd_int);
    if (acdVal !== null && acdVal < 2.5) {
        alerts.push({
            level: "REVIEW",
            rule: "SHALLOW_ACD_MYDRIATIC_RISK",
            field: safeFields.acd ? "acd" : "acd_int",
            message: `浅前房预警（ACD=${acdVal.toFixed(2)}mm < 2.5mm）：严禁直接散瞳验光（防诱发急性闭角型青光眼），ICL 常规要求内 ACD ≥ 2.8mm`,
        });
    }

    // 7. High Myopia Axial Length Check
    const alVal = extractFirstNumber(safeFields.al);
    if (alVal !== null && alVal >= 26.0) {
        alerts.push({
            level: "WARN",
            rule: "HIGH_MYOPIA_AL",
            field: "al",
            message: `长眼轴高度近视（AL=${alVal.toFixed(2)}mm ≥ 26.0mm）：建议术前散瞳详查周边视网膜变性、裂孔及黄斑 OCT`,
        });
    }

    // 8. Large Scotopic Pupil vs Optical Zone Glare Check
    const pupilVal = extractFirstNumber(safeFields.pupil || safeFields.pupil_d);
    if (pupilVal !== null && oz !== null && pupilVal > oz + 0.3) {
        alerts.push({
            level: "WARN",
            rule: "PUPIL_EXCEEDS_OZ",
            field: "pupil",
            message: `暗瞳直径(${pupilVal.toFixed(1)}mm) 大于计划光学区 OZ(${oz.toFixed(1)}mm)，术后夜间眩光/光晕风险升高`,
        });
    }

    const status = !alerts.length
        ? "PASS"
        : alerts.some((a) => a.level === "REVIEW")
            ? "REVIEW"
            : "WARN";

    const recommendations = recommendOphthalmicDrugs(template_id, safeFields, alerts);

    return {
        template_id,
        template_label: TEMPLATE_LABELS[template_id] || template_id,
        validation_status: status,
        fields: safeFields,
        derived,
        alerts,
        recommendations,
    };
}

function checkOphthalmicDrugSafety(drugIds = [], clinicalFlags = {}) {
    const idSet = new Set(Array.isArray(drugIds) ? drugIds : []);
    const selected = OPHTHALMIC_DRUGS.filter((d) => idSet.has(d.id));
    const alerts = [];

    if (clinicalFlags.asthmaOrBradycardia && idSet.has("timolol")) {
        alerts.push({
            severity: "X",
            rule: "TIMOLOL_CARDIOPULMONARY_CONTRAINDICATION",
            title: "X 级绝对禁忌：哮喘 / 慢阻肺 / 心动过缓严禁使用噻吗洛尔！",
            detail: "噻吗洛尔为非选择性 β 受体阻滞剂，经鼻泪管黏膜吸收入血可诱发致命性支气管痉挛或严重房室传导阻滞。",
            advice: "请立即改用对心肺无影响的局部降眼压药（如布林佐胺派立明或拉坦前列素），并遵眼科医师评估。",
        });
    }
    if (clinicalFlags.shallowAcd && (idSet.has("tropicamide_phenylephrine") || idSet.has("atropine_001"))) {
        alerts.push({
            severity: "X",
            rule: "SHALLOW_ACD_MYDRIATIC_CONTRAINDICATION",
            title: "X 级绝对禁忌：浅前房 / 窄房角严禁使用散瞳滴眼液！",
            detail: "复方托吡卡胺或阿托品散瞳可致周边虹膜堆积堵塞房角，诱发急性闭角型青光眼大发作（剧烈眼痛头痛、视力骤降）。",
            advice: "散瞳前必须完成裂隙灯前房深度与前房角评估。",
        });
    }
    if (clinicalFlags.viralKeratitis && selected.some((d) => d.category === "steroid")) {
        alerts.push({
            severity: "X",
            rule: "STEROID_VIRAL_KERATITIS",
            title: "X 级绝对禁忌：活动性病毒性角膜炎严禁使用糖皮质激素滴眼液！",
            detail: "氟米龙/地塞米松/泼尼松龙会抑制局部免疫，导致单纯疱疹病毒（HSK）角膜溃疡迅速扩大甚至角膜穿孔。",
            advice: "须优先规范使用更昔洛韦等抗病毒凝胶，切勿自行加用激素眼药水。",
        });
    }
    if (idSet.has("proparacaine")) {
        alerts.push({
            severity: "X",
            rule: "PROPARACAINE_NO_TAKE_HOME",
            title: "X 级红线警示：表面麻醉药（丙美卡因）严禁带回家止痛！",
            detail: "反复自行滴用表麻药会导致角膜上皮再生停滞、神经营养性溃疡甚至角膜穿孔失明。",
            advice: "术后止痛请遵医嘱使用普拉洛芬/溴芬酸钠等 NSAIDs 或口服止痛药。",
        });
    }
    const steroids = selected.filter((d) => d.category === "steroid");
    if (steroids.length >= 2) {
        alerts.push({
            severity: "D",
            rule: "DUPLICATE_OPHTHALMIC_STEROIDS",
            title: "D 级避免叠加：同时选用多种眼用糖皮质激素",
            detail: `所选清单包含 ${steroids.map((s) => s.generic_name).join(" + ")}，叠用会成倍推高激素性高眼压与白内障风险。`,
            advice: "同一阶段仅需按主诊方案单选一种激素并严格定期复查校正眼压。",
        });
    }
    const nsaids = selected.filter((d) => d.category === "nsaid");
    if (nsaids.length >= 2) {
        alerts.push({
            severity: "D",
            rule: "DUPLICATE_OPHTHALMIC_NSAIDS",
            title: "D 级避免叠加：重复使用多种眼用非甾体抗炎药（NSAIDs）",
            detail: `同时滴用 ${nsaids.map((s) => s.generic_name).join(" + ")} 不增加疗效反而升高角膜上皮点染与角膜融解风险。`,
            advice: "普拉洛芬、溴芬酸钠、双氯芬酸钠同类择一即可。",
        });
    }
    if (clinicalFlags.steroidResponder && steroids.some((d) => d.id === "tobramycin_dexamethasone" || d.id === "prednisolone_acetate")) {
        alerts.push({
            severity: "D",
            rule: "HIGH_POTENCY_STEROID_IOP_RISK",
            title: "D 级高危提示：高眼压敏感人群慎用强效激素（典必殊/百力特）",
            detail: "地塞米松与醋酸泼尼松龙升眼压潜能强，建议遵医嘱替换为软性激素（氯替泼诺）或低频氟米龙并密切监测眼压。",
            advice: "复查眼压时务必结合角膜厚度做 Ehlers 校正。",
        });
    }
    if (selected.length >= 2) {
        alerts.push({
            severity: "C",
            rule: "EYEDROP_SPACING_PROTOCOL",
            title: "C 级联合滴眼规范：多药间隔 5–10 分钟，先水剂后混悬液最后凝胶",
            detail: "连续快速滴入多种眼药水会相互冲刷稀释导致失效；混悬液（氟米龙/典必殊/派立明）用前须充分摇匀。",
            advice: "顺序建议：水剂人工泪液/抗生素 → 间隔5–10分钟 → 摇匀混悬液 → 最后睡前涂眼用凝胶。",
        });
    }

    const highestSeverity = alerts.some((a) => a.severity === "X")
        ? "X"
        : alerts.some((a) => a.severity === "D")
            ? "D"
            : alerts.some((a) => a.severity === "C")
                ? "C"
                : "A";

    return {
        selectedCount: selected.length,
        highestSeverity,
        alerts,
    };
}

// Unified Hybrid Semantic RAG Corpus (29 Ophthalmic Indicators + 27 Ophthalmic Drugs + 4 Peri-Op Protocols + Household OTC Meds)
const unifiedMedicalDocs = [
    ...OPHTHALMIC_KNOWLEDGE_ENTRIES.map((item) => ({
        id: `oph_kb_${item.id}`,
        domain: "ophthalmic_indicator",
        sourceLabel: "眼科临床指标共识",
        category: item.category,
        title: `${item.code} ${item.name_cn} (${item.name_en})`,
        tags: [...item.aliases, item.code, item.unit, ...item.field_keys],
        content: `正常范围：${item.normal_range}。警戒红线：${item.warning_threshold}。临床意义：${item.clinical_meaning} 异常提示：${item.abnormality_implications} 关联公式：${item.related_formulas.join("；")}`,
        raw: item,
    })),
    ...OPHTHALMIC_DRUGS.map((drug) => ({
        id: `oph_drug_${drug.id}`,
        domain: "ophthalmic_drug",
        sourceLabel: "眼科临床药典",
        category: drug.category,
        title: `${drug.generic_name}（${drug.brand_examples}）`,
        tags: [...drug.aliases, drug.english_name, drug.peri_op_phase, ...drug.linked_indicators],
        content: `适用阶段：${drug.peri_op_phase}。适应症：${drug.indications} 常规用法：${drug.typical_regimen} 禁忌：${drug.contraindications} 监测重点：${drug.key_monitoring}`,
        raw: drug,
    })),
    ...OPHTHALMIC_PERIOP_PROTOCOLS.map((proto) => ({
        id: `oph_proto_${proto.id}`,
        domain: "periop_protocol",
        sourceLabel: "屈光围术期阶梯方案",
        category: "protocol",
        title: proto.title,
        tags: [...proto.applicable_templates, ...proto.drug_ids, "围术期", "阶梯方案", "术后用药"],
        content: `${proto.summary} 阶段方案：${proto.stages.map((s) => `${s.stage}：${s.regimen}`).join("；")}`,
        raw: proto,
    })),
    ...COMMON_MEDICATIONS.map((otc) => ({
        id: `otc_${otc.id}`,
        domain: "household_otc",
        sourceLabel: "家庭常备OTC药箱",
        category: otc.category,
        title: `${otc.genericName}（${(otc.aliases || []).slice(0, 3).join("/")}）`,
        tags: [...(otc.aliases || []), ...(otc.symptoms || []), ...(otc.activeIngredients || []), otc.otcClass],
        content: `${otc.summary} 用法：${otc.dosage} 上限：${otc.maxDaily} 禁忌：${(otc.contraindications || []).join("；")}`,
        raw: otc,
    })),
];

const medicalRagIndex = createHybridSemanticIndex(unifiedMedicalDocs);

function searchMedicalRag({ query = "", domain = "", mode = "hybrid", limit = 8 } = {}) {
    const out = medicalRagIndex.search(query, { limit: 40, mode });
    const filtered = out.results
        .filter((hit) => !domain || domain === "all" || hit.doc.domain === domain)
        .slice(0, Math.max(1, Math.min(30, Number(limit) || 8)));
    return {
        query: out.query,
        mode: out.mode,
        strategy: ARCHITECTURE_STRATEGY.chosen,
        expandedConcepts: out.expandedConcepts,
        latencyMs: out.latencyMs,
        totalIndexed: unifiedMedicalDocs.length,
        results: filtered.map((hit, idx) => ({
            citation: `M${idx + 1}`,
            id: hit.doc.id,
            domain: hit.doc.domain,
            sourceLabel: hit.doc.sourceLabel,
            category: hit.doc.category,
            title: hit.doc.title,
            snippet: hit.snippet,
            fullContent: hit.doc.content,
            scores: { bm25: hit.bm25Score, semantic: hit.semanticScore, rrf: hit.rrfScore },
            matchedTerms: hit.matchedTerms,
            expandedConcepts: hit.expandedConcepts,
            estimatedTokens: hit.estimatedTokens,
        })),
    };
}

function buildGroundedMedicalPrompt({ question = "", validationResult = null, mode = "hybrid", limit = 5 } = {}) {
    const cleanQ = String(question || "").trim();
    const alertHint = validationResult?.alerts?.map((a) => `${a.rule} ${a.field}`).join(" ") || "";
    const ragQuery = [cleanQ, alertHint, validationResult?.template_label || ""].filter(Boolean).join(" ").trim() || "RSB PTA 眼压 屈光手术";
    const rag = searchMedicalRag({ query: ragQuery, mode, limit });

    const lines = [
        "【灯塔医疗 AI · Grounded RAG 辅助解读请求】",
        cleanQ ? `用户问题：${cleanQ}` : "请根据以下结构化检查指标校验结果与权威证据条目，给出通俗、严谨、分点清晰的解读与就医建议。",
    ];

    if (validationResult) {
        lines.push(
            "",
            `【L1 确定性临床规则校验结果（${validationResult.template_label}｜状态：${validationResult.validation_status}）】`,
            `已识别指标：${Object.entries(validationResult.fields || {}).filter(([, v]) => String(v || "").trim()).map(([k, v]) => `${k}=${v}`).join("，") || "无"}`,
        );
        if (validationResult.derived && Object.keys(validationResult.derived).length) {
            lines.push(`派生安全计算：${Object.entries(validationResult.derived).map(([k, v]) => `${k}=${v}`).join("，")}`);
        }
        if (validationResult.alerts?.length) {
            lines.push("触发红线/告警：");
            validationResult.alerts.forEach((a, i) => lines.push(`  ${i + 1}. [${a.level}/${a.rule}] ${a.message}`));
        } else {
            lines.push("触发红线/告警：未发现越界或公式冲突。");
        }
    }

    if (rag.results.length) {
        lines.push("", "【L2 混合语义 RAG 权威证据片段（回答请引用 [M1]..[Mk] 编号，禁止编造数值与处方）】");
        for (const item of rag.results) {
            lines.push(`[${item.citation}] (${item.sourceLabel}) ${item.title}：${item.fullContent}`);
        }
    }

    lines.push(
        "",
        "【回答约束】1) 严格依据以上 L1 计算值与 [M1]..[Mk] 证据回答，不虚构数值；2) 如存在 REVIEW/X 级红线，须放在首段醒目提示就医复核；3) 结尾附上非替代面诊处方提示。",
    );

    return {
        prompt: lines.join("\n"),
        rag,
        disclaimer: MEDICAL_AI_DISCLAIMER,
    };
}

/**
 * 3-Source Cross-Device Consistency Validator (migrated & upgraded from E:\zsh\OphthalmicOCR_System\app\validator.py):
 * Compares IOLMaster 700, Pentacam, and ZEISS MEL90 readings for the same eye.
 */
function runCrossDeviceValidation(records = []) {
    const safeRecords = Array.isArray(records) ? records.filter((r) => r && typeof r === "object") : [];
    const byEye = new Map();
    for (let i = 0; i < safeRecords.length; i += 1) {
        const rec = safeRecords[i];
        const fields = rec.fields && typeof rec.fields === "object" ? rec.fields : {};
        const eye = String(rec.eye || fields.eye || "OD").trim().toUpperCase();
        const normalizedEye = ["OD", "OS", "OU"].includes(eye) ? eye : "OD";
        if (!byEye.has(normalizedEye)) byEye.set(normalizedEye, []);
        byEye.get(normalizedEye).push({
            id: rec.id || `dev-${i + 1}`,
            template_id: rec.template_id || "clinical_note",
            label: rec.label || TEMPLATE_LABELS[rec.template_id] || `设备 ${i + 1}`,
            eye: normalizedEye,
            fields,
        });
    }

    const metrics = [];
    const findings = [];

    for (const [eye, grp] of byEye.entries()) {
        if (grp.length < 2) continue;

        const collectPoints = (extractor, minBound, maxBound) => {
            const pts = [];
            for (const r of grp) {
                const val = extractor(r);
                if (val !== null && val >= minBound && val <= maxBound) {
                    pts.push({ id: r.id, device: r.label, template_id: r.template_id, value: Number(val.toFixed(2)) });
                }
            }
            return pts;
        };

        const cctPts = collectPoints(
            (r) => extractFirstNumber(
                r.template_id === "cornea"
                    ? (r.fields.pachy_apex_pachy || r.fields.pupil_center_pachy || r.fields.cct || r.fields.thinnest_locat_pachy)
                    : (r.fields.cct || r.fields.pachy_apex_pachy),
            ),
            250,
            800,
        );
        if (cctPts.length >= 2) {
            const vals = cctPts.map((p) => p.value);
            const min = Math.min(...vals);
            const max = Math.max(...vals);
            const spread = Number((max - min).toFixed(1));
            metrics.push({ eye, key: "cct", label: "角膜厚度 CCT", unit: "μm", min, max, spread, points: cctPts });
            if (spread > 35.0) {
                findings.push({
                    eye,
                    level: "REVIEW",
                    rule: "CROSS_DOC_CCT_CRITICAL",
                    spread,
                    unit: "μm",
                    message: `${eye} 跨设备角膜厚度极差 ${spread}μm (>35μm 红线)：${cctPts.map((p) => `${p.device}=${p.value}μm`).join(" vs ")}，严禁直接按偏厚值设计切削深度！`,
                });
            } else if (spread > 20.0) {
                findings.push({
                    eye,
                    level: "WARN",
                    rule: "CROSS_DOC_CCT_DRIFT",
                    spread,
                    unit: "μm",
                    message: `${eye} 跨设备角膜厚度差异 ${spread}μm (>20μm)：建议以最薄测值保守核算 RSB 安全裕度。`,
                });
            }
        }

        const k1Pts = collectPoints(
            (r) => extractFirstNumber(r.template_id === "cornea" ? (r.fields.front_k1 || r.fields.k1) : (r.fields.k1 || r.fields.front_k1)),
            30,
            65,
        );
        if (k1Pts.length >= 2) {
            const vals = k1Pts.map((p) => p.value);
            const min = Math.min(...vals);
            const max = Math.max(...vals);
            const spread = Number((max - min).toFixed(2));
            metrics.push({ eye, key: "k1", label: "平K 曲率 K1", unit: "D", min, max, spread, points: k1Pts });
            if (spread > 1.5) {
                findings.push({
                    eye,
                    level: "REVIEW",
                    rule: "CROSS_DOC_K1_CRITICAL",
                    spread,
                    unit: "D",
                    message: `${eye} 跨设备 K1 曲率极差 ${spread}D (>1.5D 红线)：${k1Pts.map((p) => `${p.device}=${p.value}D`).join(" vs ")}，需排查角膜接触镜停戴不足或干眼泪膜破裂误差！`,
                });
            } else if (spread > 0.75) {
                findings.push({
                    eye,
                    level: "WARN",
                    rule: "CROSS_DOC_K1_DRIFT",
                    spread,
                    unit: "D",
                    message: `${eye} 跨设备 K1 曲率差异 ${spread}D (>0.75D)：建议人工泪液润湿后复测角膜地形图与生物测量。`,
                });
            }
        }

        const acdPts = collectPoints(
            (r) => extractFirstNumber(r.fields.acd || r.fields.acd_int),
            1.5,
            5.5,
        );
        if (acdPts.length >= 2) {
            const vals = acdPts.map((p) => p.value);
            const min = Math.min(...vals);
            const max = Math.max(...vals);
            const spread = Number((max - min).toFixed(2));
            metrics.push({ eye, key: "acd", label: "前房深度 ACD", unit: "mm", min, max, spread, points: acdPts });
            if (spread > 0.35) {
                findings.push({
                    eye,
                    level: "WARN",
                    rule: "CROSS_DOC_ACD_DRIFT",
                    spread,
                    unit: "mm",
                    message: `${eye} 跨设备前房深度极差 ${spread}mm (>0.35mm)：注意区分外前房（含 CCT）与内前房口径，ICL 术前须核准内 ACD。`,
                });
            }
        }

        const iopPts = collectPoints(
            (r) => extractFirstNumber(r.fields.iop || r.fields.enter_iop),
            5,
            50,
        );
        if (iopPts.length >= 2) {
            const vals = iopPts.map((p) => p.value);
            const min = Math.min(...vals);
            const max = Math.max(...vals);
            const spread = Number((max - min).toFixed(1));
            metrics.push({ eye, key: "iop", label: "眼压 IOP", unit: "mmHg", min, max, spread, points: iopPts });
            if (spread > 4.0) {
                findings.push({
                    eye,
                    level: "WARN",
                    rule: "CROSS_DOC_IOP_VARIATION",
                    spread,
                    unit: "mmHg",
                    message: `${eye} 跨设备/时段眼压波动 ${spread}mmHg (>4mmHg)：建议排查测量时段差异、眨眼挤眼伪影或激素性高眼压。`,
                });
            }
        }
    }

    const status = findings.some((f) => f.level === "REVIEW")
        ? "REVIEW"
        : findings.length > 0
            ? "WARN"
            : "PASS";

    return {
        status,
        eyeCount: byEye.size,
        deviceCount: safeRecords.length,
        metrics,
        findings,
    };
}

/**
 * Local Pseudonymized Longitudinal Follow-Up Analyzer (IOP / AL / SE trend + progression alerts)
 */
function analyzeLongitudinalVisits(visits = []) {
    const clean = (Array.isArray(visits) ? visits : [])
        .filter((v) => v && typeof v === "object" && String(v.date || "").trim())
        .map((v, idx) => ({
            id: String(v.id || `visit-${idx + 1}`),
            date: String(v.date).trim(),
            eye: ["OD", "OS", "OU"].includes(String(v.eye || "OD").toUpperCase()) ? String(v.eye || "OD").toUpperCase() : "OD",
            iop: extractFirstNumber(v.iop),
            al: extractFirstNumber(v.al),
            se: extractFirstNumber(v.se),
            cct: extractFirstNumber(v.cct),
            note: String(v.note || "").trim().slice(0, 160),
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

    const alerts = [];
    const iopSeries = clean.filter((v) => v.iop !== null).map((v) => ({ date: v.date, value: v.iop }));
    const alSeries = clean.filter((v) => v.al !== null).map((v) => ({ date: v.date, value: v.al }));
    const seSeries = clean.filter((v) => v.se !== null).map((v) => ({ date: v.date, value: v.se }));

    const summary = {
        iopLatest: iopSeries.at(-1)?.value ?? null,
        iopDelta: iopSeries.length >= 2 ? Number((iopSeries.at(-1).value - iopSeries[0].value).toFixed(1)) : null,
        alLatest: alSeries.at(-1)?.value ?? null,
        alDelta: alSeries.length >= 2 ? Number((alSeries.at(-1).value - alSeries[0].value).toFixed(2)) : null,
        alAnnualizedMm: null,
        seLatest: seSeries.at(-1)?.value ?? null,
        seDelta: seSeries.length >= 2 ? Number((seSeries.at(-1).value - seSeries[0].value).toFixed(2)) : null,
    };

    if (iopSeries.length >= 2) {
        const baselineIop = iopSeries[0].value;
        const maxIop = Math.max(...iopSeries.map((p) => p.value));
        const delta = Number((maxIop - baselineIop).toFixed(1));
        if (delta >= 5.0 || maxIop > 21.0) {
            alerts.push({
                level: maxIop > 21.0 ? "REVIEW" : "WARN",
                rule: "STEROID_IOP_SPIKE",
                message: `随访眼压显著抬升（基线 ${baselineIop} → 峰值 ${maxIop} mmHg，升幅 +${delta} mmHg）：若正在滴用氟米龙/典必殊等激素眼液，须尽快复诊排查激素性高眼压！`,
            });
        }
    }

    if (alSeries.length >= 2) {
        const firstT = Date.parse(alSeries[0].date);
        const lastT = Date.parse(alSeries.at(-1).date);
        const days = Number.isFinite(firstT) && Number.isFinite(lastT) ? Math.max(1, (lastT - firstT) / 86400000) : 0;
        const deltaAl = alSeries.at(-1).value - alSeries[0].value;
        if (days >= 30) {
            const annualized = Number(((deltaAl / days) * 365).toFixed(2));
            summary.alAnnualizedMm = annualized;
            if (annualized >= 0.3) {
                alerts.push({
                    level: "WARN",
                    rule: "RAPID_AXIAL_PROGRESSION",
                    message: `眼轴年化增速约 +${annualized} mm/年（≥ 0.30 mm/年警戒线，总增幅 +${deltaAl.toFixed(2)} mm）：提示轴性近视活跃进展，建议评估离焦光学或低浓度阿托品干预。`,
                });
            }
        }
    }

    if (seSeries.length >= 2) {
        const deltaSe = Number((seSeries.at(-1).value - seSeries[0].value).toFixed(2));
        if (deltaSe <= -0.5) {
            alerts.push({
                level: "WARN",
                rule: "REFRACTIVE_REGRESSION",
                message: `随访等效球镜近视漂移 ${deltaSe.toFixed(2)} D（≤ -0.50 D）：建议复查角膜地形图、上皮厚度与用眼习惯，排查屈光回退或干眼伪近视。`,
            });
        }
    }

    const status = alerts.some((a) => a.level === "REVIEW")
        ? "REVIEW"
        : alerts.length > 0
            ? "WARN"
            : "PASS";

    return {
        status,
        visitCount: clean.length,
        sortedVisits: clean,
        series: { iop: iopSeries, al: alSeries, se: seSeries },
        summary,
        alerts,
    };
}

function formatClinicalSummaryMarkdown({
    validationResult = null,
    crossDeviceResult = null,
    longitudinalResult = null,
    consultQuestion = "",
} = {}) {
    const lines = [
        "# 灯塔医疗 AI 专区 · 脱敏临床辅助复诊摘要",
        "",
        `> 生成时间：${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC｜隐私声明：本摘要不包含任何姓名、电话、病历号等个人身份信息（Zero-PII）。`,
        "",
    ];
    if (consultQuestion) {
        lines.push(`## 本次核心咨询问题`, "", `- ${consultQuestion}`, "");
    }
    if (validationResult) {
        lines.push(
            `## 1. 单报告 L1 确定性校验（${validationResult.template_label} · 状态：${validationResult.validation_status}）`,
            "",
        );
        const derivedEntries = Object.entries(validationResult.derived || {});
        if (derivedEntries.length) {
            lines.push("### 派生生物力学与光学核算", ...derivedEntries.map(([k, v]) => `- **${k}**: ${v}`), "");
        }
        if (validationResult.alerts?.length) {
            lines.push("### 触发安全红线与告警", ...validationResult.alerts.map((a) => `- **[${a.level} / ${a.rule}]** ${a.message}`), "");
        } else {
            lines.push("- 未触发越界或公式冲突告警。", "");
        }
    }
    if (crossDeviceResult && crossDeviceResult.deviceCount >= 2) {
        lines.push(`## 2. 多设备一致性核验（共 ${crossDeviceResult.deviceCount} 台设备 · 状态：${crossDeviceResult.status}）`, "");
        for (const m of crossDeviceResult.metrics || []) {
            lines.push(`- **${m.eye} ${m.label}**：极差 ${m.spread}${m.unit}（区间 ${m.min}–${m.max}${m.unit}）`);
        }
        if (crossDeviceResult.findings?.length) {
            lines.push("", "### 跨设备冲突预警", ...crossDeviceResult.findings.map((f) => `- **[${f.level} / ${f.rule}]** ${f.message}`));
        }
        lines.push("");
    }
    if (longitudinalResult && longitudinalResult.visitCount > 0) {
        lines.push(`## 3. 脱敏随访趋势分析（共 ${longitudinalResult.visitCount} 次记录 · 状态：${longitudinalResult.status}）`, "");
        lines.push("| 日期 | 眼别 | 眼压 IOP (mmHg) | 眼轴 AL (mm) | 等效球镜 SE (D) | 备注 |");
        lines.push("| :--- | :---: | :---: | :---: | :---: | :--- |");
        for (const v of longitudinalResult.sortedVisits || []) {
            lines.push(`| ${v.date} | ${v.eye} | ${v.iop ?? "—"} | ${v.al ?? "—"} | ${v.se ?? "—"} | ${v.note || "—"} |`);
        }
        if (longitudinalResult.alerts?.length) {
            lines.push("", "### 随访进展提醒", ...longitudinalResult.alerts.map((a) => `- **[${a.level} / ${a.rule}]** ${a.message}`));
        }
        lines.push("");
    }
    lines.push("---", "", `**医疗免责边界**：${MEDICAL_AI_DISCLAIMER}`);
    return lines.join("\n");
}


const SAMPLE_CLINICAL_REPORTS = Object.freeze([
  {
    id: "zeiss-rsb-redline",
    badge: "RSB/PTA 红线",
    label: "ZEISS MEL90 高度近视激光单（触发剩余基质床红线）",
    question: "这份激光切削方案能直接做 FS-LASIK 吗？如果剩余角膜厚度不够有哪些更安全的替代方案？",
    text: [
      "ZEISS MEL90 Treatment Report (脱敏演示)",
      "Eye: 0D",
      "术式: FS-LASIK",
      "CCT: 485μm",
      "Sphere: -7.50D  Cylinder: -1.00D  Axis: 175°",
      "Optical Zone: 6.5mm  Ablation Depth: 112μm",
      "Pupil: 7.2mm  IOP: 18.5mmHg",
    ].join("\n"),
  },
  {
    id: "pentacam-kc-iop",
    badge: "圆锥角膜+隐匿高眼压",
    label: "Pentacam 角膜地形图（Kmax 偏高 + 薄角膜眼压掩盖）",
    question: "角膜地形图提示 Kmax 49.1D、最薄点 458μm，实测眼压 19.5mmHg 正常吗？平时眼睛痒能揉吗？",
    text: [
      "Oculus Pentacam 4 Maps Refractive (脱敏演示)",
      "Eye: OS",
      "Front K1: 44.2D  Front K2: 47.6D  Kmax Front: 49.1D",
      "Pachy Apex: 465μm  Thinnest Locat: 458μm",
      "IOP: 19.5mmHg  ACD: 3.15mm",
    ].join("\n"),
  },
  {
    id: "iolmaster-shallow-acd",
    badge: "浅前房+长眼轴",
    label: "IOLMaster 700 生物测量（浅前房散瞳禁忌 + K1/K2 倒置）",
    question: "这份 IOLMaster 报告眼轴 26.8mm 但前房只有 2.35mm，检查前能直接滴美多丽散瞳吗？",
    text: [
      "ZEISS IOLMaster 700 Biometry (脱敏演示)",
      "Eye: OD",
      "AL: 26.82mm  CCT: 522μm  ACD: 2.35mm  LT: 4.18mm  WTW: 11.4mm",
      "K1: 43.20D  K2: 42.50D  Pupil: 4.2mm",
    ].join("\n"),
  },
]);

const SAMPLE_CROSS_DEVICE_PRESETS = Object.freeze({
  conflict: [
    { id: "dev-iol", template_id: "iolmaster", label: "IOLMaster 700", eye: "OD", fields: { cct: "548", k1: "43.10", acd: "3.32", iop: "16.0" } },
    { id: "dev-pen", template_id: "cornea", label: "Pentacam 地形图", eye: "OD", fields: { pachy_apex_pachy: "506", front_k1: "44.95", acd_int: "2.82", enter_iop: "16.5" } },
    { id: "dev-zei", template_id: "zeiss_treatment", label: "ZEISS MEL90 治疗单", eye: "OD", fields: { cct: "510", k1: "43.40", acd: "", iop: "21.8" } },
  ],
  consistent: [
    { id: "dev-iol", template_id: "iolmaster", label: "IOLMaster 700", eye: "OD", fields: { cct: "532", k1: "43.10", acd: "3.18", iop: "15.5" } },
    { id: "dev-pen", template_id: "cornea", label: "Pentacam 地形图", eye: "OD", fields: { pachy_apex_pachy: "524", front_k1: "43.35", acd_int: "3.08", enter_iop: "15.8" } },
    { id: "dev-zei", template_id: "zeiss_treatment", label: "ZEISS MEL90 治疗单", eye: "OD", fields: { cct: "526", k1: "43.25", acd: "", iop: "16.2" } },
  ],
});

const SAMPLE_LONGITUDINAL_VISITS = Object.freeze([
  { id: "v-1", date: "2026-05-01", eye: "OD", iop: "15.2", al: "25.40", se: "-5.25", cct: "522", note: "术前基线评估" },
  { id: "v-2", date: "2026-06-05", eye: "OD", iop: "16.8", al: "25.43", se: "-0.25", cct: "438", note: "术后 1 月复查，氟米龙 QID" },
  { id: "v-3", date: "2026-08-10", eye: "OD", iop: "22.4", al: "25.51", se: "-0.50", cct: "436", note: "激素第 3 月眼压抬升，嘱改氯替泼诺" },
  { id: "v-4", date: "2026-11-12", eye: "OD", iop: "16.1", al: "25.60", se: "-0.75", cct: "437", note: "停激素后眼压回落至安全线" },
]);

export {
    MEDICAL_AI_DISCLAIMER,
    ARCHITECTURE_STRATEGY,
    TEMPLATE_LABELS,
    PHYSIOLOGICAL_BOUNDS,
    OPHTHALMIC_KB_CATEGORIES,
    OPHTHALMIC_KNOWLEDGE_ENTRIES,
    OPHTHALMIC_DRUG_CATEGORIES,
    OPHTHALMIC_PERIOP_PROTOCOLS,
    OPHTHALMIC_DRUGS,
    ZSH_COHORT_BENCHMARK,
    MEDICAL_RAG_BENCHMARK,
    parseOphthalmicReportText,
    validateOphthalmicRecord,
    recommendOphthalmicDrugs,
    checkOphthalmicDrugSafety,
    searchMedicalRag,
    buildGroundedMedicalPrompt,
    runCrossDeviceValidation,
    analyzeLongitudinalVisits,
    formatClinicalSummaryMarkdown,
    SAMPLE_CLINICAL_REPORTS,
    SAMPLE_CROSS_DEVICE_PRESETS,
    SAMPLE_LONGITUDINAL_VISITS,
};
