import assert from 'node:assert/strict';
import test from 'node:test';
import { draftsFrom, parseDraft } from './newsletterDraft.js';

test('a drafted letter fills the subject from its title and the body with the whole letter', () => {
  const draft = parseDraft('2026-09-25-whats-new', "# What's new in Papol\r\n\r\n*September 25, 2026*\n\nHello,\n");
  assert.deepEqual(draft, {
    name: '2026-09-25-whats-new',
    subject: "What's new in Papol",
    body: "# What's new in Papol\n\n*September 25, 2026*\n\nHello,",
  });
});

test('a letter with no title is named by its directory', () => {
  assert.equal(parseDraft('2026-10-01-notes', 'Hello,').subject, '2026-10-01-notes');
});

test('drafts are listed newest first, by their directory', () => {
  const drafts = draftsFrom({
    '../../newsletters/2026-09-25-whats-new/letter.md': '# A',
    '../../newsletters/2026-10-09-autumn/letter.md': '# B',
  });
  assert.deepEqual(drafts.map((d) => d.name), ['2026-10-09-autumn', '2026-09-25-whats-new']);
});
