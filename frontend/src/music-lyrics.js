const TIME_TAG = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

function timeToSeconds(minutes, seconds, fraction) {
  const ms = Number((fraction || "0").padEnd(3, "0").slice(0, 3));
  return Number(minutes) * 60 + Number(seconds) + ms / 1000;
}

export function parseLrc(raw) {
  const lines = [];
  const seen = new Map();
  for (const line of String(raw || "").split(/\r?\n/)) {
    const tags = [...line.matchAll(TIME_TAG)];
    if (tags.length === 0) continue;
    const text = line.replace(TIME_TAG, "").trim();
    if (!text) continue;
    for (const tag of tags) {
      const time = timeToSeconds(tag[1], tag[2], tag[3]);
      if (!Number.isFinite(time) || time < 0) continue;
      const key = time.toFixed(3);
      if (seen.has(key)) continue;
      seen.set(key, true);
      lines.push({ time, text: text.slice(0, 300) });
    }
  }
  return lines.sort((a, b) => a.time - b.time).slice(0, 500);
}

export function activeLyricIndex(lines, position) {
  if (!Array.isArray(lines) || lines.length === 0) return -1;
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lines[mid].time <= position) { found = mid; low = mid + 1; }
    else high = mid - 1;
  }
  return found;
}
