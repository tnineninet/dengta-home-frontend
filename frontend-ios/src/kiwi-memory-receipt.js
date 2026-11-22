const object = value => value && typeof value === "object" && !Array.isArray(value);
const jobStatuses = new Set(["pending", "running", "succeeded", "failed", "cancelled"]);
export const kiwiMemoryId = value => typeof value === "string" && /^[1-9]\d{0,18}$/.test(value);
export const memoryNumber = value => Number.isSafeInteger(value) && value >= 0;
export function invalidKiwiReceipt() {
  return Object.assign(new Error("Kiwi 的确认信息不完整。"), { code: "memory_ui_receipt_invalid" });
}
export function assertKiwiReceipt(data) {
  if (!object(data) || data.ok !== true || data.provider !== "kiwi" || data.storage !== "kiwi" || data.tenant_verified !== true) throw invalidKiwiReceipt();
  return data;
}
export function kiwiMemoryRecord(value) {
  if (!object(value) || !kiwiMemoryId(value.id) || typeof value.summary !== "string" || value.confirmation_status !== "confirmed") throw invalidKiwiReceipt();
  return value;
}
export function kiwiMemoryListReceipt(data) {
  assertKiwiReceipt(data);
  if (data.storage !== "kiwi" || !["list", "search"].includes(data.mode) || typeof data.partial !== "boolean" ||
      !Array.isArray(data.memories) || !(memoryNumber(data.total) || (data.partial && data.total === null)) ||
      !memoryNumber(data.offset) || !Number.isSafeInteger(data.limit) || data.limit < 1 || typeof data.has_more !== "boolean") throw invalidKiwiReceipt();
  data.memories.forEach(kiwiMemoryRecord);
  if (new Set(data.memories.map(item => item.id)).size !== data.memories.length ||
      (data.total !== null && data.total < data.memories.length) || data.memories.length > data.limit) throw invalidKiwiReceipt();
  return data;
}
export function kiwiMemoryWriteReceipt(data, id, summary) {
  assertKiwiReceipt(data);
  const memory = kiwiMemoryRecord(data.memory);
  if (memory.id !== id || (summary !== undefined && memory.summary !== summary)) throw invalidKiwiReceipt();
  return memory;
}
export function kiwiMemoryDeleteReceipt(data, id) {
  assertKiwiReceipt(data);
  if (data.deleted !== true || data.memory_id !== id) throw invalidKiwiReceipt();
  return data;
}
export function kiwiMemoryLockReceipt(data, id, permanent) {
  assertKiwiReceipt(data);
  if (data.memory_id !== id || data.permanent !== permanent || !object(data.memory) || data.memory.id !== id ||
      data.memory.permanent !== permanent || data.memory.locked !== permanent) throw invalidKiwiReceipt();
  return data.memory;
}
export function kiwiJobReceipt(data, id) {
  assertKiwiReceipt(data);
  const job = data.job;
  if (!object(job) || typeof job.id !== "string" || job.id !== id || !jobStatuses.has(job.status)) throw invalidKiwiReceipt();
  if (job.status === "succeeded" && (!object(job.result) || !object(job.result.extraction) ||
      !["saved", "skipped", "total"].every(key => memoryNumber(job.result.extraction[key])))) throw invalidKiwiReceipt();
  return job;
}
export function kiwiProfileReceipt(data) {
  assertKiwiReceipt(data);
  const timestamp = value => value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
  if (data.storage !== "kiwi" || typeof data.available !== "boolean" || typeof data.profile !== "string" || typeof data.summary !== "string" ||
      !timestamp(data.updated_at) || !timestamp(data.summary_updated_at) || data.profile_source !== "kiwi_learned") throw invalidKiwiReceipt();
  return data;
}
export function kiwiAcceptedJob(data) {
  assertKiwiReceipt(data);
  if (data.storage !== "kiwi" || data.accepted !== true || typeof data.job_id !== "string" ||
      !/^[A-Za-z0-9_-]{1,200}$/.test(data.job_id) || !jobStatuses.has(data.status)) throw invalidKiwiReceipt();
  return data.job_id;
}
export function emitMemoryChanged(scopeKey, source, sender, jobId) {
  if (typeof globalThis.window?.dispatchEvent === "function" && typeof CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent("dengta:memory-updated", { detail: { scopeKey, source, sender, jobId } }));
  }
}
