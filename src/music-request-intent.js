// 用户明确点歌时，在模型开始生成前先解析歌曲卡片，避免等 1-2 分钟。
export function extractMusicRequest(value) {
  const phrase = String(value || "").trim();
  if (!phrase || /(不要|别放|不用放|怎么放|如何放|能不能放|可以放吗|为什么|什么歌|放歌功能)/i.test(phrase)) return "";
  if (!/播放|放(?:一首|首|首歌|首歌|歌)|放《/.test(phrase)) return "";
  const quoted = phrase.match(/《([^》]{1,80})》/);
  let candidate = quoted?.[1] || "";
  if (candidate) {
    const rest = phrase
      .replace(quoted[0], " ")
      .replace(/^\s*(?:播放|放(?:一首|首)?)/i, " ")
      .replace(/在?聊天里?(?:播放|放).*$/i, " ")
      .replace(/不要打开.*$/i, " ")
      .replace(/[，。！？!?、\s]+/g, " ")
      .trim();
    if (rest) candidate = (candidate + " " + rest).trim();
  }
  if (!candidate) {
    const match = phrase.match(/(?:播放|放)(?:一首|首|个|点)?\s*([^，。！？\n]{1,80})/);
    candidate = match?.[1] || "";
  }
  candidate = String(candidate)
    .replace(/^(?:一首|首|个|点)?\s*(?:歌|歌曲|音乐)?\s*/i, "")
    .trim();
  if (!candidate || /^(?:歌|歌曲|音乐|首歌|列表|歌单|电台)$/.test(candidate)) return "";
  return candidate.slice(0, 80);
}

export function isRandomMusicRequest(value) {
  const phrase = String(value || "").trim();
  if (!phrase || /(不要|别放|不用放|怎么放|如何放|能不能放|可以放吗|为什么|什么歌)/i.test(phrase)) return false;
  return /(随便|随机|来点音乐|来首歌|推荐.{0,6}歌|每日推荐|今天听什么|听点什么)/i.test(phrase);
}
