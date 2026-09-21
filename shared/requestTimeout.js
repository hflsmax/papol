// A deadline on a request, as an AbortSignal the requester passes on.
// With `signal`, the caller's own reason to stop ends it too: the one
// signal the requester gets aborts on either.
export async function withAbortTimeout(requester, timeoutMs, { signal } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const stop = () => controller.abort(signal.reason);
  if (signal?.aborted) stop();
  else signal?.addEventListener('abort', stop, { once: true });
  try {
    return await requester(controller.signal);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', stop);
  }
}
