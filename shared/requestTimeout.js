export async function withAbortTimeout(requester, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await requester(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}
