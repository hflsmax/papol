import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Progress, Working } from '../../shared/ui/Waiting.js';
import {
  PROGRESS_HOLD_MS, formatBytes, formatProgressDetail, formatRate, holdFullBar, progressFraction,
} from '../../shared/waiting.js';

const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const MB = 1024 * 1024;

test('Working is the one spinner, a label, and a polite status', () => {
  const html = render(Working, { label: 'Extracting…' });
  assert.match(html, /^<div class="wait wait-working" role="status" aria-live="polite">/);
  assert.match(html, /<span class="spinner" aria-hidden="true"><\/span>/);
  assert.match(html, /<span class="wait-label">Extracting…<\/span>/);
  assert.equal((html.match(/spinner/g) || []).length, 1);
});

test('Working without a label is the spinner alone', () => {
  const html = render(Working, { label: '' });
  assert.match(html, /spinner/);
  assert.doesNotMatch(html, /wait-label/);
});

test('Progress is a progressbar with its value, its label and its detail', () => {
  const html = render(Progress, { fraction: 0.4, label: 'Uploading', detail: '12 MB of 30 MB' });
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-label="Uploading"/);
  assert.match(html, /aria-valuemin="0"/);
  assert.match(html, /aria-valuemax="100"/);
  assert.match(html, /aria-valuenow="40"/);
  assert.match(html, /aria-valuetext="12 MB of 30 MB"/);
  assert.match(html, /<span class="wait-label">Uploading<\/span><span class="wait-detail">12 MB of 30 MB<\/span>/);
  assert.match(html, /class="wait-fill" style="width:40%"/);
  assert.doesNotMatch(html, /spinner/, 'a measured wait shows no spinner');
});

test('Progress clamps its fraction to the bar', () => {
  assert.match(render(Progress, { fraction: 1.7, label: 'Uploading' }), /aria-valuenow="100"[^]*width:100%/);
  assert.match(render(Progress, { fraction: -1, label: 'Uploading' }), /aria-valuenow="0"[^]*width:0%/);
});

test('Progress without a fraction falls back to Working rather than animating', () => {
  for (const fraction of [null, undefined, NaN]) {
    const html = render(Progress, { fraction, label: 'Downloading', detail: 'unused' });
    assert.match(html, /role="status"/, `fraction ${fraction} shows a status`);
    assert.match(html, /spinner/);
    assert.match(html, /Downloading…/, 'the label gains its ellipsis');
    assert.doesNotMatch(html, /progressbar/);
    assert.doesNotMatch(html, /unused/);
  }
  assert.match(render(Progress, { fraction: null, label: 'Loading…' }), /Loading…</, 'an ellipsis is not doubled');
});

test('bytes are formatted in the unit they are best read in', () => {
  assert.equal(formatBytes(0), '0 bytes');
  assert.equal(formatBytes(1), '1 byte');
  assert.equal(formatBytes(512), '512 bytes');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(340 * 1024), '340 KB');
  assert.equal(formatBytes(12 * MB), '12 MB');
  assert.equal(formatBytes(12.34 * MB), '12.3 MB');
  assert.equal(formatBytes(1.5 * 1024 * MB), '1.5 GB');
  assert.equal(formatBytes(-5), '0 bytes');
});

test('a detail in bytes reads both numbers in the total\'s unit', () => {
  assert.equal(formatProgressDetail({ loaded: 12 * MB, total: 30 * MB }), '12 MB of 30 MB');
  assert.equal(formatProgressDetail({ loaded: 410 * 1024, total: 30 * MB }), '0.4 MB of 30 MB');
  assert.equal(formatProgressDetail({ loaded: 0, total: 30 * MB }), '0 MB of 30 MB');
  assert.equal(formatProgressDetail({ loaded: 120 * MB, total: 130 * MB }), '120 MB of 130 MB');
  assert.equal(formatProgressDetail({ loaded: 200, total: 900 }), '200 bytes of 900 bytes');
  assert.equal(formatProgressDetail({ loaded: 40 * MB, total: 30 * MB }), '30 MB of 30 MB', 'never past the end');
});

test('a detail in a count names what is counted', () => {
  assert.equal(formatProgressDetail({ loaded: 12, total: 26, unit: 'files' }), '12 of 26 files');
  assert.equal(formatProgressDetail({ loaded: 1, total: 1, unit: 'files' }), '1 of 1 file');
  assert.equal(formatProgressDetail({ loaded: 3, total: 30, unit: 'paper' }), '3 of 30 papers');
});

test('a rate is bytes per second', () => {
  assert.equal(formatRate(2.1 * MB), '2.1 MB/s');
});

test('a fraction needs a total', () => {
  assert.equal(progressFraction(5, 10), 0.5);
  assert.equal(progressFraction(15, 10), 1);
  assert.equal(progressFraction(5, 0), null);
  assert.equal(progressFraction(5, undefined), null);
  assert.equal(progressFraction(undefined, 10), null);
});

test('a full bar is held briefly and no longer', async () => {
  const started = Date.now();
  await holdFullBar(started);
  assert.ok(Date.now() - started >= PROGRESS_HOLD_MS - 5);
  const long = Date.now();
  await holdFullBar(long - PROGRESS_HOLD_MS * 2);
  assert.ok(Date.now() - long < 50, 'a hold that has already passed settles at once');
});
