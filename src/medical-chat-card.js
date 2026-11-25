// Structured parser for DengTa Medical AI Grounded RAG packets & [M1..Mk] citations in ChatMessage.
// Pure presentation helper: never alters, filters, or suppresses any AI reply text.

const MEDICAL_PACKET_HEADER = "【灯塔医疗 AI · Grounded RAG 辅助解读请求】";

export function parseMedicalRagMessage(text = "") {
  const raw = String(text || "");
  if (!raw.includes(MEDICAL_PACKET_HEADER)) return null;

  const lines = raw.split(/\r?\n/);
  let question = "";
  let templateLabel = "";
  let status = "";
  const derived = [];
  const alerts = [];
  const citations = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("用户问题：")) {
      question = line.slice("用户问题：".length).trim();
      continue;
    }
    const l1Match = line.match(/^【L1 确定性临床规则校验结果（([^｜]+)｜状态：([A-Z]+)）】$/);
    if (l1Match) {
      templateLabel = l1Match[1].trim();
      status = l1Match[2].trim();
      continue;
    }
    if (line.startsWith("派生安全计算：")) {
      const items = line.slice("派生安全计算：".length).split("，").map((s) => s.trim()).filter(Boolean);
      derived.push(...items);
      continue;
    }
    const alertMatch = line.match(/^\d+\.\s*\[([A-Z]+)\/([A-Z0-9_]+)\]\s*(.+)$/);
    if (alertMatch) {
      alerts.push({
        level: alertMatch[1],
        rule: alertMatch[2],
        message: alertMatch[3].trim(),
      });
      continue;
    }
    const citeMatch = line.match(/^\[(M\d+)\]\s*\(([^)]+)\)\s*([^：]+)：/);
    if (citeMatch) {
      citations.push({
        code: citeMatch[1],
        source: citeMatch[2].trim(),
        title: citeMatch[3].trim(),
      });
    }
  }

  return {
    question: question || "临床检查报告结构化辅助解读",
    templateLabel: templateLabel || "医疗知识库检索",
    status: status || "INFO",
    derived,
    alerts,
    citations,
    rawText: raw,
  };
}

export function extractMedicalCitationBadges(text = "") {
  const raw = String(text || "");
  if (!raw || raw.includes(MEDICAL_PACKET_HEADER)) return [];
  const matches = raw.match(/\[M[1-9]\d?\]/g);
  if (!matches || !matches.length) return [];
  return [...new Set(matches.map((m) => m.slice(1, -1)))].slice(0, 8);
}
