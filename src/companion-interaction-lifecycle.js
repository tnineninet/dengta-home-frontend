import { createScopedSettingsSession, settingsSaveScope } from "./settings-save-scope.js";

const scopeChanged = () => Object.assign(new Error("互动的账号、伴侣或对话已切换。"), { code: "companion_interaction_scope_changed" });

export function createCompanionInteractionLifecycle({ getScope, getSessionId, authSession, timeoutMs = 90_000, setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout }) {
  let scopeKey, sessionId, generation = 0, active = false, pending = null;
  const operations = new Set();
  const sameSession = (left, right) => (left || null) === (right || null);
  const matches = (scope, session) => active && getScope() === scope && settingsSaveScope(authSession.getSnapshot()) === scope && sameSession(getSessionId(), session);

  function invalidate() {
    generation += 1;
    for (const operation of operations) {
      operation.controller.abort(scopeChanged());
      operation.finish();
    }
    operations.clear();
    pending = null;
  }

  return {
    synchronize(nextScope, nextSession) {
      const changed = !active || scopeKey !== nextScope || !sameSession(sessionId, nextSession);
      if (changed) invalidate();
      scopeKey = nextScope;
      sessionId = nextSession || null;
      active = true;
      return changed;
    },
    matches,
    begin(eventId) {
      if (pending || !matches(scopeKey, sessionId)) return null;
      invalidate();
      const controller = new AbortController();
      const revision = ++generation;
      const timer = setTimer(() => controller.abort(Object.assign(new Error("这次互动等待超时，已有状态仍保留。请检查连接后再点一次互动。"), { code: "companion_interaction_timeout" })), timeoutMs);
      const operation = {
        eventId, scopeKey, sessionId, controller,
        authSession: createScopedSettingsSession(authSession, scopeKey, controller.signal),
        isScopeCurrent: () => generation === revision && matches(operation.scopeKey, operation.sessionId),
        isCurrent: () => operation.isScopeCurrent() && !controller.signal.aborted,
        adoptSession(id) {
          if (!id || operation.sessionId || !operation.isCurrent()) return false;
          operation.sessionId = id;
          sessionId = id;
          return true;
        },
        finish() { clearTimer(timer); },
        wait(work) {
          if (controller.signal.aborted) return Promise.reject(controller.signal.reason);
          return new Promise((resolve, reject) => {
            let settled = false;
            const settle = (callback, value) => {
              if (settled) return;
              settled = true;
              controller.signal.removeEventListener("abort", abort);
              callback(value);
            };
            const abort = () => settle(reject, controller.signal.reason || scopeChanged());
            controller.signal.addEventListener("abort", abort, { once: true });
            Promise.resolve().then(() => {
              if (!operation.isCurrent()) throw controller.signal.reason || scopeChanged();
              return work();
            }).then(value => settle(resolve, value), error => settle(reject, error));
          });
        },
      };
      operations.add(operation);
      pending = operation;
      return operation;
    },
    finish(operation) {
      operation.finish();
      if (pending !== operation) return false;
      pending = null;
      return operation.isScopeCurrent();
    },
    dispose() { invalidate(); active = false; },
  };
}
