import { request } from '../httpClient.js';

// ---------- Jobs ----------

// Work the server took on and will finish later: reading an upload,
// capturing a card's picture. A request that queues one answers with its
// uuid; this is how a client waits for the outcome.

export function getJob(uuid) {
  return request(`/jobs/${uuid}`);
}

export class JobFailed extends Error {
  constructor(job) {
    super(job.detail || 'The request could not be completed');
    this.name = 'JobFailed';
    this.job = job;
  }
}

const FIRST_WAIT_MS = 600;
const LONGEST_WAIT_MS = 4000;

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

// The job once it is over: its result when it is done, a JobFailed when
// it is not. Asks a little less often as the wait goes on — a metadata
// lookup answers in a second, a browser rendering a page takes ten, and
// neither deserves a request every half second for a minute. An
// AbortSignal ends the waiting, not the job.
export async function awaitJob(uuid, { signal } = {}) {
  let wait = FIRST_WAIT_MS;
  for (;;) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const job = await getJob(uuid);
    if (job.status === 'done') return job.result;
    if (job.status === 'failed') throw new JobFailed(job);
    await sleep(wait, signal);
    wait = Math.min(wait * 1.5, LONGEST_WAIT_MS);
  }
}
