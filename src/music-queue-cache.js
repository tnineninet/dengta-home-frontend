const KEY_PREFIX = "dengta_music_queue_v1:";
const MAX_QUEUE = 10;

function keyFor(scope) {
  return KEY_PREFIX + String(scope || "");
}

function validCard(card) {
  return Boolean(card?.id && card?.title && card?.audio_url);
}

export function readMusicDockQueue(scope) {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(keyFor(scope)) || "null");
    const queue = Array.isArray(parsed?.queue)
      ? parsed.queue.filter(validCard).filter((card, index, all) => all.findIndex((item) => item.id === card.id) === index).slice(-MAX_QUEUE)
      : [];
    const index = queue.length === 0
      ? -1
      : Math.min(Math.max(Number(parsed?.index) || 0, 0), queue.length - 1);
    return { queue, index };
  } catch {
    return { queue: [], index: -1 };
  }
}

export function writeMusicDockQueue(scope, { queue, index }) {
  try {
    const cleaned = Array.isArray(queue)
      ? queue.filter(validCard).filter((card, itemIndex, all) => all.findIndex((item) => item.id === card.id) === itemIndex).slice(-MAX_QUEUE)
      : [];
    if (cleaned.length === 0) {
      globalThis.localStorage?.removeItem(keyFor(scope));
      return;
    }
    const safeIndex = Math.min(Math.max(Number(index) || 0, 0), cleaned.length - 1);
    globalThis.localStorage?.setItem(keyFor(scope), JSON.stringify({ queue: cleaned, index: safeIndex }));
  } catch {
    // 队列持久化失败不影响播放。
  }
}
