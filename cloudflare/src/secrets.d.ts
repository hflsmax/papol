// Secrets are set with `wrangler secret put` and never appear in
// wrangler.toml, so `wrangler types` cannot know them; they are named
// here, on the Env the Worker sees and on the one the tests see. Each is
// optional: unset, the feature that needs it is off and says so.
interface Secrets {
  // Outgoing mail through an HTTP email API (src/jobs/mail.ts).
  EMAIL_API_URL?: string;
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;
  // The bibliographic APIs' polite pools, and OpenAlex's allowance
  // (src/papers/bibliography.ts).
  PAPOL_CONTACT_EMAIL?: string;
  PAPOL_OPENALEX_KEY?: string;
  // The GROBID host: its helper (host/helper/, reached under /helper/)
  // reads a PDF there and answers JSON, behind a Cloudflare tunnel with
  // nginx asking for one credential, "user:password" (src/papers/helper.ts).
  // Unset, references are "unavailable" and uploads get the filename.
  GROBID_URL?: string;
  GROBID_AUTH?: string;
  // An R2 API token for the files bucket, with which the Worker signs the
  // URL a client PUTs a file to directly (src/files.ts). Unset, the
  // Worker gives its own door as the address instead, which a local
  // `wrangler dev` needs, since its R2 is a simulation.
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  // "manual" in the suite: wake-ups are handed to the consumer by the
  // test, not sent (src/jobs/queue.ts).
  QUEUE_DELIVERY?: string;
}

interface Env extends Secrets {}

declare namespace Cloudflare {
  interface Env extends Secrets {}
}
