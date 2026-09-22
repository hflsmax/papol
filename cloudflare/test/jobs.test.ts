// The queue on Workers: what the API writes, what a wake-up runs, what
// the sweep rescues, and the mail.
import { createExecutionContext, createMessageBatch, createScheduledController, env, getQueueResult, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import worker from "../src/index";
import { sentEmails } from "../src/jobs/mail";
import { queueAnnouncement, queueEmail } from "../src/jobs/notifications";
import { claim, enqueue, JobError, LEASE_MS, type Job } from "../src/jobs/queue";
import { HANDLERS, HOURLY_CRON, runOne, SWEEP_CRON, type Wakeup } from "../src/jobs/run";
import { call, count, exec, ok, register, row, rows, uuid } from "./helpers";

// The email API, stood in for: what was posted, and what it answers.
const posted: unknown[] = [];
function emailApi(status = 200, body = '{"id":"m1"}') {
  posted.length = 0;
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    expect(new Headers(init.headers).get("user-agent")).toBe("Papol/1.0");
    posted.push(JSON.parse(String(init.body)));
    return new Response(body, { status });
  });
}

async function job(id: string): Promise<Job> {
  return (await row<Job>("SELECT * FROM jobs WHERE uuid = ?", id))!;
}

// A wake-up arriving at the consumer for these jobs.
async function woken(...uuids: string[]) {
  const batch = createMessageBatch<Wakeup>("papol-jobs", uuids.map((id) => ({ id: uuid(), timestamp: new Date(), body: { job: id }, attempts: 1 })));
  const ctx = createExecutionContext();
  await worker.queue(batch, env, ctx);
  return getQueueResult(batch, ctx);
}

async function cron(expression: string, at = new Date()) {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ cron: expression, scheduledTime: at.getTime() }), env, ctx);
  await waitOnExecutionContext(ctx);
}

const noop = async () => ({ ran: true });

describe("the queue", () => {
  it("runs a job a wake-up names, once, and acks the message either way", async () => {
    HANDLERS.noop = noop;
    const queued = enqueue(env.DB, "noop", { n: 1 });
    await queued.statement.run();
    expect((await job(queued.uuid)).status).toBe("queued");
    const result = await woken(queued.uuid);
    expect(result.ackAll || result.explicitAcks.length === 1).toBe(true);
    expect((await job(queued.uuid))).toMatchObject({ status: "done", result: JSON.stringify({ ran: true }), attempts: 1 });
    // The same wake-up again finds nothing to claim.
    await woken(queued.uuid, uuid());
    expect((await job(queued.uuid)).attempts).toBe(1);
  });

  it("holds one live job under a key, and lets a finished one free it", async () => {
    HANDLERS.noop = noop;
    const first = enqueue(env.DB, "noop", {}, { key: "once" });
    const again = enqueue(env.DB, "noop", {}, { key: "once" });
    await env.DB.batch([first.statement, again.statement]);
    expect(await count("jobs", "\"key\" = 'once'")).toBe(1);
    await woken(first.uuid, again.uuid);
    const after = enqueue(env.DB, "noop", {}, { key: "once" });
    await after.statement.run();
    expect(await count("jobs", "\"key\" = 'once'")).toBe(2);
  });

  it("is not due before its time", async () => {
    const later = enqueue(env.DB, "noop", {}, { runAt: new Date(Date.now() + 3600_000).toISOString() });
    await later.statement.run();
    expect(await claim(env.DB, later.uuid, "test")).toBeNull();
    expect((await job(later.uuid)).status).toBe("queued");
  });

  it("takes an abandoned job up once more, then fails it", async () => {
    const queued = enqueue(env.DB, "noop", {});
    await queued.statement.run();
    const claimed = await claim(env.DB, queued.uuid, "first");
    expect(claimed).toMatchObject({ status: "running", attempts: 1 });
    expect(await claim(env.DB, queued.uuid, "second")).toBeNull(); // still leased
    await exec("UPDATE jobs SET started_at = ? WHERE uuid = ?", new Date(Date.now() - LEASE_MS - 60_000).toISOString(), queued.uuid);
    expect(await claim(env.DB, queued.uuid, "second")).toMatchObject({ worker: "second", attempts: 2 });
    await exec("UPDATE jobs SET started_at = ? WHERE uuid = ?", new Date(Date.now() - LEASE_MS - 60_000).toISOString(), queued.uuid);
    expect(await claim(env.DB, queued.uuid, "third")).toBeNull();
    expect(await job(queued.uuid)).toMatchObject({ status: "failed", error: "Abandoned by its worker 2 times" });
  });

  it("fails a kind no worker knows rather than leaving it", async () => {
    const queued = enqueue(env.DB, "carrier_pigeon", {});
    await queued.statement.run();
    await woken(queued.uuid);
    expect(await job(queued.uuid)).toMatchObject({ status: "failed", error: "No worker knows the job kind 'carrier_pigeon'" });
  });

  it("records why a handler failed, as it said or as it crashed", async () => {
    HANDLERS.said = async () => { throw new JobError("Metadata lookup failed"); };
    HANDLERS.crashed = async () => { throw new RangeError("the disk is on fire"); };
    const said = enqueue(env.DB, "said", {}), crashed = enqueue(env.DB, "crashed", {});
    await env.DB.batch([said.statement, crashed.statement]);
    await woken(said.uuid, crashed.uuid);
    expect((await job(said.uuid)).error).toBe("Metadata lookup failed");
    expect((await job(crashed.uuid)).error).toBe("the disk is on fire");
  });

  it("sweeps up what nobody was woken for, and what a dead consumer left", async () => {
    HANDLERS.noop = noop;
    const forgotten = enqueue(env.DB, "noop", {});
    const abandoned = enqueue(env.DB, "noop", {});
    const notYet = enqueue(env.DB, "noop", {}, { runAt: new Date(Date.now() + 3600_000).toISOString() });
    await env.DB.batch([forgotten.statement, abandoned.statement, notYet.statement]);
    await exec("UPDATE jobs SET status = 'running', attempts = 1, started_at = ? WHERE uuid = ?", new Date(Date.now() - LEASE_MS - 60_000).toISOString(), abandoned.uuid);
    await cron(SWEEP_CRON);
    expect((await job(forgotten.uuid)).status).toBe("done");
    expect((await job(abandoned.uuid))).toMatchObject({ status: "done", attempts: 2 });
    expect((await job(notYet.uuid)).status).toBe("queued");
  });

  it("answers the job's owner, and nobody else", async () => {
    const account = await register(), other = await register();
    const theirs = enqueue(env.DB, "noop", {}, { userUuid: account.uuid });
    const nobodys = enqueue(env.DB, "noop", {});
    await env.DB.batch([theirs.statement, nobodys.statement]);
    expect(await ok("GET", `/api/jobs/${theirs.uuid}`, { headers: account.headers })).toEqual({
      uuid: theirs.uuid, kind: "noop", status: "queued", detail: null, result: null,
    });
    expect((await call("GET", `/api/jobs/${theirs.uuid}`, { headers: other.headers })).status).toBe(404);
    expect((await call("GET", `/api/jobs/${nobodys.uuid}`, { headers: account.headers })).status).toBe(404);
    expect((await call("GET", `/api/jobs/${theirs.uuid}`)).status).toBe(401);
    HANDLERS.noop = noop;
    await woken(theirs.uuid);
    expect((await ok("GET", `/api/jobs/${theirs.uuid}`, { headers: account.headers })).status).toBe("done");
  });
});

describe("mail", () => {
  const configured = { EMAIL_API_URL: "https://mail.example.test/emails", EMAIL_API_KEY: "key", EMAIL_FROM: "papol@example.test" };

  it("sends one job's mail through the email API and marks its notifications", async () => {
    const account = await register("reader@example.test");
    const notification = uuid();
    await exec("INSERT INTO notifications (uuid, user_uuid, content, read, emailed, created_at) VALUES (?, ?, 'A seminar was called', 0, 0, ?)", notification, account.uuid, new Date().toISOString());
    const queued = queueEmail(env.DB, "reader@example.test", "Papol: 1 new message today", "Hello", [notification]);
    await queued.statement.run();
    emailApi();
    await runOne({ ...env, ...configured } as Env, await claim(env.DB, queued.uuid, "test") as Job);
    expect(posted).toEqual([{ from: "papol@example.test", to: ["reader@example.test"], subject: "Papol: 1 new message today", text: "Hello" }]);
    expect(await row("SELECT emailed FROM notifications WHERE uuid = ?", notification)).toEqual({ emailed: 1 });
    expect((await job(queued.uuid)).status).toBe("done");
  });

  it("leaves the notification for the digest when the mail cannot be sent", async () => {
    const queued = queueEmail(env.DB, "reader@example.test", "Subject", "Body", []);
    await queued.statement.run();
    emailApi(502, "bad gateway");
    await runOne({ ...env, ...configured } as Env, await claim(env.DB, queued.uuid, "test") as Job);
    expect(await job(queued.uuid)).toMatchObject({ status: "failed", error: "Email to reader@example.test failed: 502 bad gateway" });
  });

  it("skips, not fails, when no email API is configured", async () => {
    const queued = queueEmail(env.DB, "reader@example.test", "Subject", "Body", []);
    await queued.statement.run();
    await woken(queued.uuid);
    expect(await job(queued.uuid)).toMatchObject({ status: "done", result: JSON.stringify({ sent: false, skipped: "Email not configured" }) });
  });

  it("queues the day's digest at its hour, once a day, from unread unemailed news", async () => {
    const reader = await register("reader@example.test", "Reader"), admin = await register("admin@example.test");
    const at = new Date().toISOString();
    for (const [user, content, read, emailed, when] of [
      [reader.uuid, "today", 0, 0, at], [reader.uuid, "already read", 1, 0, at], [reader.uuid, "already mailed", 0, 1, at],
      [reader.uuid, "last week", 0, 0, new Date(Date.now() - 8 * 86400_000).toISOString()], [admin.uuid, "the admin's", 0, 0, at],
    ] as const) {
      await exec("INSERT INTO notifications (uuid, user_uuid, content, read, emailed, created_at) VALUES (?, ?, ?, ?, ?, ?)", uuid(), user, content, read, emailed, when);
    }
    await exec("INSERT INTO settings (key, value) VALUES ('digest_hour', '9')");
    const nineUtc = new Date(Date.UTC(2026, 8, 21, 9, 0, 0));
    const mailed = { ...env, ...configured } as Env;
    const worker = { ...(await import("../src/index")).default };
    // Not its hour: nothing.
    await worker.scheduled(createScheduledController({ cron: HOURLY_CRON, scheduledTime: new Date(Date.UTC(2026, 8, 21, 8)).getTime() }), mailed, createExecutionContext());
    expect(await count("jobs")).toBe(0);
    await worker.scheduled(createScheduledController({ cron: HOURLY_CRON, scheduledTime: nineUtc.getTime() }), mailed, createExecutionContext());
    const emails = await rows<Job>("SELECT * FROM jobs WHERE kind = 'send_email' ORDER BY payload");
    expect(emails.map((e) => JSON.parse(e.payload).to).sort()).toEqual(["admin@example.test", "reader@example.test"]);
    // The reader's news: today's, and the welcome that signing up left.
    const readers = JSON.parse(emails.find((e) => JSON.parse(e.payload).to === "reader@example.test")!.payload);
    expect(readers.subject).toBe("Papol: 2 new messages today");
    expect(readers.body).toContain("  - today");
    expect(readers.body).toContain("Welcome to Papol, Reader");
    for (const left of ["already read", "already mailed", "last week"]) expect(readers.body).not.toContain(left);
    expect(readers.notification_uuids).toHaveLength(2);
    // The hour firing again queues nothing more.
    await worker.scheduled(createScheduledController({ cron: HOURLY_CRON, scheduledTime: nineUtc.getTime() + 1000 }), mailed, createExecutionContext());
    expect(await count("jobs", "kind = 'daily_digest'")).toBe(1);
    expect(await count("jobs", "kind = 'send_email'")).toBe(2);
  });

  it("sends an announcement as batches of a hundred, one email per recipient", async () => {
    const calls: { url: string; body: any[] }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get("user-agent")).toBe("Papol/1.0");
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response('{"data":[]}');
    });
    const to = Array.from({ length: 150 }, (_, i) => `reader${i}@example.test`);
    const queued = queueAnnouncement(env.DB, to, "Papol is live", "Hello");
    await queued.statement.run();
    await runOne({ ...env, ...configured } as Env, await claim(env.DB, queued.uuid, "test") as Job);
    expect(calls.map((c) => [c.url, c.body.length])).toEqual([["https://mail.example.test/emails/batch", 100], ["https://mail.example.test/emails/batch", 50]]);
    expect(calls[0].body[0]).toEqual({ from: "papol@example.test", to: ["reader0@example.test"], subject: "Papol is live", text: "Hello" });
    expect(await job(queued.uuid)).toMatchObject({ status: "done", result: JSON.stringify({ sent: true, recipients: 150 }) });
  });

  it("reads back what was sent, page by page", async () => {
    const urls: string[] = [];
    const email = (id: string) => ({ id, to: ["a@example.test"], from: "papol@example.test", subject: "S", created_at: "2026-09-22 09:50:31.069000+00", last_event: "delivered" });
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return Response.json(url.includes("after=") ? { data: [email("3")], has_more: false } : { data: [email("1"), email("2")], has_more: true });
    });
    expect((await sentEmails({ ...env, ...configured } as Env)).map((e) => e.id)).toEqual(["1", "2", "3"]);
    expect(urls).toEqual(["https://mail.example.test/emails?limit=100", "https://mail.example.test/emails?limit=100&after=2"]);
  });
});
