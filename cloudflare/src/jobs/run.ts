// Running a job to its recorded outcome, and the two ways one arrives:
// a queue message naming it, and the sweep that finds what no message did.
//
// Every kind of job Papol has is named in HANDLERS. A row of a kind
// nobody here knows is failed, not left for a build that does know it:
// that build is a deploy away, and the row would say "queued" until then.

import limits from "../../../config/app_limits.json";
import { batch, one, type Row } from "../db";
import { extractMetadataJob, KIND as EXTRACT } from "../papers/extract";
import { captureWebpageJob, WEBPAGE } from "./capture";
import { claim, claimDue, fail, finish, JobError, payloadOf, wake, type Job } from "./queue";
import { SEND_ANNOUNCEMENT, SEND_EMAIL, sendAnnouncementJob, sendEmailJob } from "./notifications";
import { enqueue } from "./queue";

export type Handler = (env: Env, payload: Row) => Promise<unknown>;

export const HANDLERS: Record<string, Handler> = {
  [SEND_EMAIL]: sendEmailJob,
  [SEND_ANNOUNCEMENT]: sendAnnouncementJob,
  [WEBPAGE]: captureWebpageJob,
  [EXTRACT]: extractMetadataJob,
};

const ERROR_LIMIT = limits.text.job_error;

export async function runOne(env: Env, job: Job): Promise<boolean> {
  const handler = HANDLERS[job.kind];
  if (!handler) {
    await fail(env.DB, job.uuid, `No worker knows the job kind '${job.kind}'`);
    return false;
  }
  try {
    const result = await handler(env, payloadOf(job));
    await finish(env.DB, job.uuid, result);
    return true;
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)) || "failed";
    await fail(env.DB, job.uuid, message.slice(0, ERROR_LIMIT));
    if (error instanceof JobError) console.warn(`Job ${job.uuid} (${job.kind}) failed: ${message}`);
    else console.error(`Job ${job.uuid} (${job.kind}) crashed:`, error);
    return false;
  }
}

export interface Wakeup {
  job: string;
}

// The consumer: one message, one job. The message is acked either way,
// since the row records the outcome; a retry would only find a row that
// is no longer queued.
export async function consume(batchOf: MessageBatch<Wakeup>, env: Env): Promise<void> {
  for (const message of batchOf.messages) {
    const job = await claim(env.DB, message.body.job, `queue:${batchOf.queue}`);
    if (job) await runOne(env, job);
    message.ack();
  }
}

// The cron trigger, as wrangler.toml declares it.
export const SWEEP_CRON = "*/2 * * * *";

// The sweep, every couple of minutes: claim what is due and was not
// woken, and run it here — the sweep is a Worker invocation like any
// other, and a job handed straight to it needs no second wake-up.
export async function sweep(env: Env): Promise<string[]> {
  const jobs = await claimDue(env.DB, "cron:sweep");
  for (const job of jobs) await runOne(env, job);
  return jobs.map((job) => job.uuid);
}
