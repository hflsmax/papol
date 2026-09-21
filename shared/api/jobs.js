import { request } from '../httpClient.js';
import { pollUntil } from '../polling.js';

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

export function jobSettled(job) {
  return job.status === 'done' || job.status === 'failed';
}

// The job's result once it is done; a JobFailed when it is not. Asks on
// the schedule every wait in Papol uses (shared/polling.js). An
// AbortSignal ends the waiting, not the job.
export async function awaitJob(uuid, { signal } = {}) {
  const job = await pollUntil(() => getJob(uuid), jobSettled, { signal });
  if (job.status === 'failed') throw new JobFailed(job);
  return job.result;
}
