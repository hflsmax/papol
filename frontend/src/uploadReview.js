// The review form's fields while the PDF is still being read.
//
// An upload answers at once, and the form opens on what is known then:
// the title its filename gives, and nothing else. The reading of the PDF
// — its printed DOI, the indexes, the title block — arrives later, if it
// arrives, and by then the user may have typed. What they typed stands;
// the reading fills the rest.

import { authorList } from './paperFormat.js';

// The fields the PDF is read for, in the order the form shows them.
export const READ_FIELDS = ['title', 'authors', 'journal', 'year', 'doi'];

// The title an upload starts with: the filename's stem, underscores and
// hyphens as spaces, each word capitalized — the title the server falls
// back to when it can read nothing more (cloudflare/src/papers/extract.ts),
// so the two never disagree on a paper it could not read.
export function titleFromFilename(name) {
  const stem = String(name || '').split(/[\\/]/).pop().replace(/\.[^.]*$/, '');
  return stem.replace(/[_-]/g, ' ').replace(/\S+/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

// The form's rows for what was read: text in every field, authors as one
// comma-separated line.
export function reviewFields(read) {
  return {
    title: read?.title || '',
    authors: authorList(read?.authors).join(', '),
    journal: read?.journal || '',
    year: read?.year || '',
    doi: read?.doi || '',
  };
}

// The form after the reading came in. A field the user typed in keeps
// what they typed; one they left alone, or emptied, takes what was read,
// when something was. `edited` holds the names of the fields the user
// changed.
export function fillUnedited(form, edited, read) {
  const filled = reviewFields(read);
  const next = { ...form };
  for (const field of READ_FIELDS) {
    const untouched = !edited.has(field) || String(form[field] ?? '').trim() === '';
    if (untouched && filled[field] !== '') next[field] = filled[field];
  }
  return next;
}
