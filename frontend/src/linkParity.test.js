import test from 'node:test';
import assert from 'node:assert/strict';
import table from '../../shared/testing/linkParity.json' with { type: 'json' };
import { bilibiliVideo, videoLink, youtubeId } from '../../shared/videos.js';
import { extractArxivId, extractDoi } from '../../shared/identifiers.js';

// The app's half of a table the Worker's suite reads too
// (cloudflare/test/linkParity.test.ts): a link the app makes a card of
// is one the Worker accepts, and an identifier the upload form reads off
// a PDF is the one the Worker would have read.

for (const { name, url, youtubeId: id, bilibiliVideo: bilibili, videoLink: link } of table.videos) {
  test(`the app reads ${name} as the Worker does`, () => {
    assert.equal(youtubeId(url), id);
    assert.deepEqual(bilibiliVideo(url), bilibili);
    assert.deepEqual(videoLink(url), link);
  });
}

for (const { name, text, doi, arxivId } of table.identifiers) {
  test(`the upload form reads ${name} as the Worker does`, () => {
    assert.equal(extractDoi(text), doi);
    assert.equal(extractArxivId(text), arxivId);
  });
}
