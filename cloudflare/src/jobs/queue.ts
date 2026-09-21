// The queue: jobs the API writes and the consumer runs.
//
// The `jobs` table is the truth. A route
// writes the row in its batch beside whatever the job is about, and after
// the batch sends the row's uuid to a Cloudflare Queue as the wake-up; a
// consumer claims the row by uuid and runs it. A Cron Trigger claims
// anything due that nobody was woken for — a lost message, a consumer
// that died past its lease — and wakes it, so the message is a hint and
// the sweep is what makes the queue correct.
//
// A claim is one conditional UPDATE: on D1's single writer that is what
// `FOR UPDATE SKIP LOCKED` was on Postgres. A job's `key` holds one live
// job at a time through the partial unique index; a second enqueue under
// a live key inserts nothing, and its wake-up finds nothing to claim.

import { newUuid, now, one, statement, type Row } from "../db";

// A job running longer than this was abandoned by its consumer — nothing
// here takes longer than a GROBID pass, and that is bounded at five minutes.
export const LEASE_MS = 15 * 60 * 1000;

// A job is taken up twice: once, and once more after being abandoned.
export const MAX_ATTEMPTS = 2;

export type Status = "queued" | "running" | "done" | "failed";

export interface Job extends Row {
  uuid: string;
  kind: string;
  key: string | null;
  payload: string;
  status: Status;
  user_uuid: string | null;
  result: string | null;
  error: string | null;
  attempts: number;
  run_at: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  worker: string | null;
}

// A failure with a message for the person who asked for the job.
// Anything else a handler throws is a bug, logged and reported as failed
// all the same; this one is reported as it is said.
export class JobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobError";
  }
}

export interface Enqueued {
  uuid: string;
  statement: D1PreparedStatement;
}

// The row for a job, to go in the caller's batch. Under a live key the
// insert is a no-op, and the uuid then names no row: a wake-up for it
// finds nothing, which is the right outcome.
export function enqueue(
  db: D1Database, kind: string, payload: Row = {},
  { key = null, userUuid = null, runAt = null }: { key?: string | null; userUuid?: string | null; runAt?: string | null } = {},
): Enqueued {
  const uuid = newUuid();
  const at = now();
  const conflict = key === null ? "" : " ON CONFLICT (\"key\") WHERE status IN ('queued', 'running') DO NOTHING";
  return {
    uuid,
    statement: statement(
      db,
      `INSERT INTO jobs (uuid, kind, "key", payload, status, user_uuid, attempts, run_at, created_at)
       VALUES (?, ?, ?, ?, 'queued', ?, 0, ?, ?)${conflict}`,
      uuid, kind, key, JSON.stringify(payload), userUuid, runAt ?? at, at,
    ),
  };
}

// Send the wake-ups for rows just written. After the batch, never
// before: a message about a row that does not exist yet finds nothing.
// The suite hands wake-ups to the consumer itself, so that a job runs
// when the test says and not when the local runtime feels like it.
export async function wake(env: Env, uuids: string[]): Promise<void> {
  if (!uuids.length || env.QUEUE_DELIVERY === "manual") return;
  await env.JOBS.sendBatch(uuids.map((uuid) => ({ body: { job: uuid } })));
}

function due(): { now: string; stale: string } {
  const at = Date.now();
  return { now: new Date(at).toISOString(), stale: new Date(at - LEASE_MS).toISOString() };
}

// Take one job by name, if it is due — queued, or running past its lease.
// Null when it is not, or is somebody else's now, or never existed.
export async function claim(db: D1Database, uuid: string, worker: string): Promise<Job | null> {
  const { now: at, stale } = due();
  const job = await one<Job>(
    db,
    `UPDATE jobs SET status = 'running', started_at = ?, attempts = attempts + 1, worker = ?
     WHERE uuid = ? AND ((status = 'queued' AND run_at <= ?) OR (status = 'running' AND started_at < ?))
     RETURNING *`,
    at, worker, uuid, at, stale,
  );
  return job ? abandonedOrClaimed(db, job) : null;
}

// Every job that is due and was not woken: what the sweep claims.
export async function claimDue(db: D1Database, worker: string, limit = 20): Promise<Job[]> {
  const { now: at, stale } = due();
  const { results } = await db.prepare(
    `UPDATE jobs SET status = 'running', started_at = ?, attempts = attempts + 1, worker = ?
     WHERE uuid IN (
       SELECT uuid FROM jobs WHERE (status = 'queued' AND run_at <= ?) OR (status = 'running' AND started_at < ?)
       ORDER BY run_at, created_at LIMIT ?
     ) RETURNING *`,
  ).bind(at, worker, at, stale, limit).all<Job>();
  const claimed: Job[] = [];
  for (const job of results) {
    const live = await abandonedOrClaimed(db, job);
    if (live) claimed.push(live);
  }
  return claimed;
}

async function abandonedOrClaimed(db: D1Database, job: Job): Promise<Job | null> {
  if (job.attempts > MAX_ATTEMPTS) {
    await fail(db, job.uuid, `Abandoned by its worker ${job.attempts - 1} times`);
    console.error(`Job ${job.uuid} (${job.kind}) abandoned twice; failed`);
    return null;
  }
  if (job.attempts > 1) console.warn(`Job ${job.uuid} (${job.kind}) was left running; taking it up again`);
  return job;
}

export async function finish(db: D1Database, uuid: string, result: unknown): Promise<void> {
  await statement(db, "UPDATE jobs SET status = 'done', result = ?, error = NULL, finished_at = ? WHERE uuid = ?",
    result === undefined || result === null ? null : JSON.stringify(result), now(), uuid).run();
}

export async function fail(db: D1Database, uuid: string, error: string): Promise<void> {
  await statement(db, "UPDATE jobs SET status = 'failed', error = ?, finished_at = ? WHERE uuid = ?", error, now(), uuid).run();
}

export function payloadOf(job: Job): Row {
  return JSON.parse(job.payload || "{}");
}

export function resultOf(job: Job): unknown {
  return job.result ? JSON.parse(job.result) : null;
}

// How a job is getting on, as `GET /api/jobs/{uuid}` says it.
export function jobOut(job: Job) {
  return { uuid: job.uuid, kind: job.kind, status: job.status, detail: job.error, result: resultOf(job) };
}
