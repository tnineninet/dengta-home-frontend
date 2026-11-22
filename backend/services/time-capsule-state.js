"use strict";

const CAPSULE_KEYS = Object.freeze(["time_capsules", "last_capsule_interaction_at"]);

// Web clients persist a whitelisted companion-status object; keep the channel
// bridge's capsule fields unless the caller explicitly sent them.
function preserveCapsuleKeys(existing, incoming) {
    const next = incoming && typeof incoming === "object" ? { ...incoming } : {};
    if (existing && typeof existing === "object") {
        for (const key of CAPSULE_KEYS) {
            if (Object.hasOwn(existing, key) && !Object.hasOwn(next, key)) next[key] = existing[key];
        }
    }
    return next;
}

// Chat-start snapshots must not wipe other status keys written meanwhile.
function mergeCapsuleIntoSavedStatus(latestStatus, capsules, now) {
    return {
        ...(latestStatus && typeof latestStatus === "object" ? latestStatus : {}),
        time_capsules: Array.isArray(capsules) ? capsules : [],
        last_capsule_interaction_at: new Date(now).toISOString()
    };
}



// Apply marker jobs to the latest stored capsules, so concurrent chats do not
// overwrite each other's new tasks. Only adds/updates/removes named jobs.
function applyCapsuleJobs(capsules, jobs, now) {
    const next = Array.isArray(capsules) ? capsules.slice() : [];
    for (const job of Array.isArray(jobs) ? jobs : []) {
        const name = String(job?.name || "").trim();
        if (!name) continue;
        const action = String(job?.action || "");
        const minutes = Math.max(1, Math.min(720, Number(job?.minutes) || 30));
        const index = next.findIndex((item) => String(item?.name || "").toLowerCase() === name.toLowerCase());
        if (action === "进行中") {
            if (index >= 0) next[index] = { ...next[index], estimateMinutes: minutes, updatedAt: now };
            else next.push({ name, startedAt: now, estimateMinutes: minutes, updatedAt: now });
        } else if (index >= 0) {
            next.splice(index, 1);
        }
    }
    return next
        .filter((item) => item && typeof item.name === "string" && item.name.trim())
        .map((item) => ({
            name: String(item.name).trim().slice(0, 80),
            startedAt: new Date(item.startedAt).getTime() || now,
            estimateMinutes: Math.max(1, Math.min(720, Number(item.estimateMinutes) || 30)),
            updatedAt: now
        }))
        .filter((item) => now - item.startedAt <= 24 * 60 * 60 * 1000)
        .slice(-10);
}

module.exports = { preserveCapsuleKeys, mergeCapsuleIntoSavedStatus, applyCapsuleJobs };