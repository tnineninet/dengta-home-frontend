export async function requestErrorLog(logId, request, timeoutMs = 15000) {
  const controller = new AbortController();
  let timer;
  try {
    const data = await Promise.race([
      request(`/api/errors/${encodeURIComponent(logId)}`, { retry: false, signal: controller.signal }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = Object.assign(new Error("日志读取超时，请重试。"), { code: "request_timeout" });
          reject(error);
          controller.abort();
        }, timeoutMs);
      }),
    ]);
    return data?.log || null;
  } finally {
    clearTimeout(timer);
  }
}
