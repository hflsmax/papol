import { draftsFrom } from './newsletterDraft.js';

// Every letter in newsletters/, read into the build, for the admin's
// Email users form to start from.
export const NEWSLETTER_DRAFTS = draftsFrom(
  import.meta.glob('../../newsletters/*/letter.md', { query: '?raw', import: 'default', eager: true }),
);
