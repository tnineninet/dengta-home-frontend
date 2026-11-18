import { kiwiAcceptedJob, kiwiJobReceipt } from "./kiwi-memory-receipt.js";

// A successful chat only acknowledges the turn. Kiwi's job receipt confirms
// extraction separately. This watcher never submits or retries a write.
export function createChatMemoryJobs({ readJob, isCurrent, notify, schedule, cancel }) {
  const watching = new Map(), finished = new Set();
  let disposed = false;
  function finish(id, source) {
    watching.delete(id);
    finished.add(id);
    if (finished.size > 64) finished.delete(finished.values().next().value);
    notify(source, id);
  }
  async function poll(id, entry) {
    if (disposed || !isCurrent() || watching.get(id) !== entry) return;
    entry.timer = null;
    const valid = () => !disposed && isCurrent() && watching.get(id) === entry;
    try {
      const data = await readJob(id);
      if (!valid()) return;
      const job = kiwiJobReceipt(data, id);
      if (job.status === "succeeded") return finish(id, "chat-job-succeeded");
      if (job.status === "failed") return finish(id, "chat-job-failed");
      if (job.status === "cancelled") return finish(id, "chat-job-cancelled");
    } catch (error) {
      if (!valid()) return;
      if (error?.code === "memory_ui_receipt_invalid" || [400, 401, 403, 404].includes(error?.status)) return finish(id, "chat-job-unconfirmed");
    }
    if (++entry.reads >= 24) return finish(id, "chat-job-unconfirmed");
    entry.timer = schedule(() => void poll(id, entry), 5000);
  }
  return {
    observe(event, conversationId) {
      if (disposed || !isCurrent() || event?.type !== "done" || event.ok !== true || !conversationId ||
          (event.conversation_id ?? event.session_id) !== conversationId || !event.assistant_message?.id) return;
      const sync = event.memory_sync;
      if (!sync || String(sync.turn_id || "") !== String(event.assistant_message.id)) return;
      let id;
      try { id = kiwiAcceptedJob(sync); } catch { return; }
      if (watching.has(id) || finished.has(id)) return;
      // The memory page always reads on entry, even if an old watcher was evicted.
      if (watching.size >= 8) {
        const [oldId, old] = watching.entries().next().value;
        if (old.timer !== null) cancel(old.timer);
        finish(oldId, "chat-job-unconfirmed");
      }
      const entry = { timer: null, reads: 0 };
      watching.set(id, entry);
      notify("chat-job-accepted", id);
      void poll(id, entry);
    },
    dispose() {
      disposed = true;
      for (const entry of watching.values()) if (entry.timer !== null) cancel(entry.timer);
      watching.clear();
      finished.clear();
    },
  };
}
