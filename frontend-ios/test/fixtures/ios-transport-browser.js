import { streamChat } from "../../src/api.js";

// This bundle is built only for a disposable CI host, never the product app.
const report = { streamedBeforeTerminal: false, utf8: false, postForm: false,
  truncatedRejected: false, abortRejected: false, cancelledNoMoreEvents: false };
const authSession = { getRequestContext: async () => ({
  accessToken: "fictional-transport-token", companionId: "fictional-companion",
}) };
const acknowledge = (name) => fetch(`/ack/${name}`, { method: "POST" });

async function run() {
try {
  const received = [];
  const done = await streamChat({ message: "fixture-normal" }, (event) => {
    received.push(event);
    if (event.type === "text") {
      report.streamedBeforeTerminal = true;
      report.utf8 = event.content === "你好🙂";
      // The server will not send done/EOF before this actual callback.
      void acknowledge("normal");
    }
  }, { authSession });
  report.postForm = done.fixture_form_valid === true;
  if (!report.utf8 || !report.postForm || received.length !== 2) throw new Error("fixture_normal");

  try {
    await streamChat({ message: "fixture-truncated" }, () => {}, { authSession });
  } catch (error) {
    report.truncatedRejected = error.code === "chat_stream_interrupted";
  }

  const controller = new AbortController();
  let textEvents = 0;
  try {
    await streamChat({ message: "fixture-cancel" }, (event) => {
      if (event.type !== "text") return;
      textEvents += 1;
      controller.abort();
    }, { authSession, signal: controller.signal });
  } catch {
    report.abortRejected = controller.signal.aborted;
  }
  const cancel = await fetch("/cancel-status").then((response) => response.json());
  report.cancelledNoMoreEvents = textEvents === 1 && cancel.closed === true;
} catch {
  // Fixed booleans only: no page contents, provider errors, credentials or URLs.
}
window.webkit.messageHandlers.transport.postMessage(report);
}
void run();
