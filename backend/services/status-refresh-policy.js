const STATUS_REFRESH_COOLDOWN_MS = 10_000;

function reserveStatusRefresh(cache, key, now = Date.now()) {
    const previous = Number(cache.get(key)) || 0;
    if (previous && now - previous < STATUS_REFRESH_COOLDOWN_MS) return false;
    cache.set(key, now);
    return true;
}

function releaseStatusRefresh(cache, key, reservedAt) {
    if (cache.get(key) === reservedAt) cache.delete(key);
}

module.exports = {
    STATUS_REFRESH_COOLDOWN_MS,
    reserveStatusRefresh,
    releaseStatusRefresh
};
