// What "Extract metadata from PDF" found, offered rather than written in.
//
// The edit form's details are shared by every reader of the paper, and a
// reading is a judgment: the title block may be misread, a registry's
// match may be another paper. So the reading never changes a field by
// itself. The form lists each field the reading would change, from what
// is there to what was found, each ticked; the user keeps the ones they
// want, or none.

import { authorList } from './paperFormat.js';

export const METADATA_FIELDS = [
  ['title', 'Title'],
  ['authors', 'Authors'],
  ['journal', 'Journal'],
  ['year', 'Year'],
  ['doi', 'DOI'],
];

const text = (value) => (value == null ? '' : String(value).trim());

// A reading — the server's (authors as a JSON list) or the title block's
// (authors as an array) — as the form's text fields.
export function foundFields(read) {
  if (!read) return null;
  const authors = Array.isArray(read.authors) ? read.authors : authorList(read.authors);
  return {
    title: text(read.title),
    authors: authors.join(', '),
    journal: text(read.journal),
    year: text(read.year),
    doi: text(read.doi),
  };
}

// The fields the reading would change: found something, and something
// other than what the form holds. A field it found nothing for is kept as
// it is, never emptied.
export function metadataChanges(form, found) {
  if (!found) return [];
  return METADATA_FIELDS
    .filter(([field]) => found[field] !== '' && found[field] !== text(form[field]))
    .map(([field, label]) => ({ field, label, from: text(form[field]), to: found[field] }));
}

// The form with the chosen changes in it; every other field as it was.
export function applyChanges(form, changes, chosen) {
  const next = { ...form };
  for (const change of changes) if (chosen.has(change.field)) next[change.field] = change.to;
  return next;
}

// The readings to choose between. A preprint or author's copy matched to
// its published version comes back with what the PDF itself printed
// (`as_printed`): both are offered, the published version first.
export function metadataCandidates(read) {
  if (!read) return [];
  const published = foundFields(read);
  if (!read.as_printed) return [{ key: 'found', label: null, fields: published }];
  const where = [read.journal, read.year].filter(Boolean).join(', ');
  return [
    { key: 'published', label: where ? `Published version (${where})` : 'Published version', fields: published },
    { key: 'printed', label: 'As printed in the PDF', fields: foundFields(read.as_printed) },
  ];
}
