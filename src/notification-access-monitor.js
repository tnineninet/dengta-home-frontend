const errors = {
  music_notification_check_failed: "无法读取通知使用权，请重新检查。",
  music_notification_settings_failed: "无法打开通知使用权设置，请在系统设置中手动授权。",
  music_notification_listener_failed: "返回前台时无法自动检查授权，请点重新检查。",
};

export function createNotificationAccessMonitor({ supported, read, open, listen, onState, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let generation = 0, revision = 0, active = false, handle, opening = false;
  let listenerFailed = false;
  let state = { supported, granted: false, checking: supported, opening: false, errorCode: "", errorMessage: "" };
  const pending = new Set();
  const emit = patch => { state = { ...state, ...patch }; if (active) onState(state); };
  const failure = code => ({ checking: false, opening: false, errorCode: code, errorMessage: `${errors[code]}（${code}）` });
  function bounded(call) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (method, value) => { if (settled) return; settled = true; clearTimer(timer); pending.delete(cancel); method(value); };
      const cancel = () => finish(reject, new Error("Cancelled"));
      const timer = setTimer(() => finish(reject, new Error("Timeout")), 12000);
      pending.add(cancel);
      Promise.resolve().then(() => { if (settled) throw new Error("Cancelled"); return call(); }).then(value => finish(resolve, value), error => finish(reject, error));
    });
  }
  async function refresh() {
    if (!active || !supported) return;
    const token = generation, request = ++revision;
    emit({ checking: true });
    try {
      const result = await bounded(read);
      if (typeof result?.granted !== "boolean") throw new Error("Invalid receipt");
      if (active && token === generation && request === revision) emit({ granted: result.granted, checking: false, ...(listenerFailed ? failure("music_notification_listener_failed") : { errorCode: "", errorMessage: "" }) });
    } catch {
      if (active && token === generation && request === revision) emit(failure("music_notification_check_failed"));
    }
  }
  async function request() {
    if (!active || !supported || opening) return;
    opening = true;
    const token = generation;
    emit({ opening: true, errorCode: "", errorMessage: "" });
    try {
      if (await bounded(open) !== true) throw new Error("Settings unavailable");
      if (active && token === generation) await refresh();
    } catch {
      if (active && token === generation) emit(failure("music_notification_settings_failed"));
    } finally {
      if (token === generation) { opening = false; emit({ opening: false }); }
    }
  }
  function stop() {
    active = false; generation++; revision++; opening = false;
    for (const cancel of [...pending]) cancel();
    if (handle) { const previous = handle; handle = undefined; void Promise.resolve().then(() => previous.remove()).catch(() => {}); }
  }
  function start() {
    stop(); active = true; listenerFailed = false;
    const token = generation;
    if (!supported) return () => stop();
    void refresh();
    Promise.resolve().then(() => listen(event => { if (active && token === generation && event.isActive) void refresh(); }))
      .then(value => { if (!active || token !== generation) return value.remove(); handle = value; })
      .catch(() => { if (active && token === generation) { listenerFailed = true; emit(failure("music_notification_listener_failed")); } });
    return () => stop();
  }
  return { start, stop, refresh, request, initialState: state };
}
