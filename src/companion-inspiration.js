export const COMPANION_INSPIRATIONS = Object.freeze([
  { id: "story", symbol: "✦", title: "一分钟接龙", hint: "一人一句，看看故事会走向哪里。", draft: "我们来玩一分钟故事接龙吧。一盏不会熄灭的灯出现在夜市里，你先写一句开头，我接下一句。" },
  { id: "colors", symbol: "◒", title: "今天是什么颜色", hint: "用一个颜色分享此刻的心情。", draft: "我想用一个颜色描述今天的心情。你先选一个颜色，说说为什么，然后我们一起给今天起个名字。" },
  { id: "music", symbol: "♫", title: "交换一首歌", hint: "找一首适合现在一起听的歌。", draft: "我想和你一起听歌。帮我找一首适合现在的歌，我们听完再各说一句喜欢它的原因。" },
  { id: "question", symbol: "?", title: "脑洞二选一", hint: "没有正确答案，跟着直觉选。", draft: "陪我玩一个脑洞二选一吧：如果能拥有一间漂浮在云上的小屋，或一艘停在海边的小船，你会选哪一个？先说你的选择，再问我。" },
  { id: "movie", symbol: "▷", title: "今晚的放映厅", hint: "一起挑个短视频或电影。", draft: "我想和你一起看点东西。先问我今晚想看轻松、冒险还是有点悬念的，再帮我挑一个。" },
  { id: "small", symbol: "☼", title: "收藏一个小瞬间", hint: "聊一件今天很小、却值得记住的事。", draft: "今天有个很小的瞬间，我想慢慢讲给你听。你也讲一个属于你这个角色的小瞬间吧，我们轮流说。" },
]);

export function pickCompanionInspiration(previousId, random = Math.random) {
  const pool = COMPANION_INSPIRATIONS.filter(item => item.id !== previousId);
  const value = Number(random());
  const index = Math.floor(Math.max(0, Math.min(Number.isFinite(value) ? value : 0, 0.999999)) * pool.length);
  return pool[index];
}
