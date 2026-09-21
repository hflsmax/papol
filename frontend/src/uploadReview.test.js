import assert from 'node:assert/strict';
import test from 'node:test';

import { fillUnedited, reviewFields, titleFromFilename } from './uploadReview.js';

const read = {
  doi: '10.1000/xyz', title: 'Attention Is All You Need',
  authors: '["Ashish Vaswani","Noam Shazeer"]', journal: 'NeurIPS', year: 2017,
};

test('the form opens on the title the filename gives', () => {
  assert.equal(titleFromFilename('attention_is-all YOU need.pdf'), 'Attention Is All You Need');
  assert.equal(titleFromFilename('C:\\papers\\1706.03762.PDF'), '1706.03762');
  assert.equal(titleFromFilename(''), '');
  assert.deepEqual(reviewFields({ title: 'From the filename' }), {
    title: 'From the filename', authors: '', journal: '', year: '', doi: '',
  });
});

test('the reading fills the fields the user left alone', () => {
  const opened = reviewFields({ title: 'attention' });
  assert.deepEqual(fillUnedited(opened, new Set(), read), {
    title: 'Attention Is All You Need', authors: 'Ashish Vaswani, Noam Shazeer',
    journal: 'NeurIPS', year: 2017, doi: '10.1000/xyz',
  });
});

test('what the user typed stands', () => {
  const typed = { ...reviewFields({ title: 'attention' }), title: 'My own title', year: '2018' };
  const filled = fillUnedited(typed, new Set(['title', 'year']), read);
  assert.equal(filled.title, 'My own title');
  assert.equal(filled.year, '2018');
  assert.equal(filled.authors, 'Ashish Vaswani, Noam Shazeer');
  assert.equal(filled.doi, '10.1000/xyz');
});

test('a field the user emptied is filled like one never touched', () => {
  const emptied = { ...reviewFields({ title: 'attention' }), title: '  ' };
  assert.equal(fillUnedited(emptied, new Set(['title']), read).title, 'Attention Is All You Need');
});

test('a reading with less than the form has changes nothing', () => {
  const opened = { ...reviewFields({ title: 'attention' }), thought: 'kept' };
  const partial = { title: null, authors: null, journal: null, year: null, doi: '10.1000/only' };
  assert.deepEqual(fillUnedited(opened, new Set(), partial), { ...opened, doi: '10.1000/only' });
  assert.deepEqual(fillUnedited(opened, new Set(), null), opened);
});
