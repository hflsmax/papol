import assert from 'node:assert/strict';
import test from 'node:test';

import { applyChanges, foundFields, metadataCandidates, metadataChanges } from './metadataReview.js';

const form = { title: 'Finite-Choice Logic Programming', authors: 'Chris Martens, Robert J. Simmons, Michael Arntzenius', journal: '', year: 2024, doi: '10.48550/arxiv.2405.19040' };
const preprint = { doi: '10.48550/arxiv.2405.19040', title: 'Finite-Choice Logic Programming', authors: JSON.stringify(['Chris Martens', 'Robert J. Simmons', 'Michael Arntzenius']), journal: null, year: 2024 };
const published = { ...preprint, doi: '10.1145/3704849', journal: 'POPL', year: 2025, as_printed: preprint };

test('only the fields the reading would change are offered, from what is there to what was found', () => {
  assert.deepEqual(metadataChanges(form, foundFields(published)), [
    { field: 'journal', label: 'Journal', from: '', to: 'POPL' },
    { field: 'year', label: 'Year', from: '2024', to: '2025' },
    { field: 'doi', label: 'DOI', from: '10.48550/arxiv.2405.19040', to: '10.1145/3704849' },
  ]);
  // A reading that agrees with the form offers nothing.
  assert.deepEqual(metadataChanges(form, foundFields(preprint)), []);
  // A field the reading found nothing for is never emptied.
  assert.deepEqual(metadataChanges({ ...form, journal: 'arXiv' }, foundFields(preprint)), []);
  assert.deepEqual(metadataChanges(form, null), []);
});

test('the title block reads as the same fields', () => {
  assert.deepEqual(foundFields({ title: ' A Title ', authors: ['Ada Lovelace', 'Alan Turing'], journal: null, year: 1843, doi: null, arxiv_id: null }),
    { title: 'A Title', authors: 'Ada Lovelace, Alan Turing', journal: '', year: '1843', doi: '' });
});

test('only the changes the user keeps are written in', () => {
  const changes = metadataChanges(form, foundFields(published));
  assert.deepEqual(applyChanges(form, changes, new Set(['journal', 'doi'])), { ...form, journal: 'POPL', doi: '10.1145/3704849' });
  assert.deepEqual(applyChanges(form, changes, new Set()), form);
});

test('a match to the published version offers that and what the PDF prints', () => {
  const [first, second] = metadataCandidates(published);
  assert.equal(first.label, 'Published version (POPL, 2025)');
  assert.equal(first.fields.doi, '10.1145/3704849');
  assert.equal(second.label, 'As printed in the PDF');
  assert.equal(second.fields.doi, '10.48550/arxiv.2405.19040');
  assert.deepEqual(metadataCandidates(preprint).map((c) => c.key), ['found']);
  assert.deepEqual(metadataCandidates(null), []);
});
