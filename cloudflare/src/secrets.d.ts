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
  // The reference analyzer on the NixOS host, behind a Cloudflare tunnel
  // with Access in front (src/papers/grobid.ts). Unset, references are
  // "unavailable" and uploads get no title-block reading.
  GROBID_URL?: string;
  GROBID_ACCESS_CLIENT_ID?: string;
  GROBID_ACCESS_CLIENT_SECRET?: string;
  // "manual" in the suite: wake-ups are handed to the consumer by the
  // test, not sent (src/jobs/queue.ts).
  QUEUE_DELIVERY?: string;
}

interface Env extends Secrets {}

declare namespace Cloudflare {
  interface Env extends Secrets {}
}
