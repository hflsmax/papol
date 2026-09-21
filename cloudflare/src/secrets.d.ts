// Secrets are set with `wrangler secret put` and never appear in
// wrangler.toml, so `wrangler types` cannot know them; they are named
// here, on the Env the Worker sees and on the one the tests see. Each is
// optional: unset, the feature that needs it is off and says so.
interface Secrets {
  // Outgoing mail through an HTTP email API (src/jobs/mail.ts).
  EMAIL_API_URL?: string;
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;
}

interface Env extends Secrets {}

declare namespace Cloudflare {
  interface Env extends Secrets {}
}
