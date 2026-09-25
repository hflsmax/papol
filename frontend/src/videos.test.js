import test from 'node:test';
import assert from 'node:assert/strict';
import { bilibiliVideo, canPreview, videoLink, videoPreview, youtubeId } from '../../shared/videos.js';

test('a YouTube video is named by the id its link carries, however the link is written', () => {
  assert.equal(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://youtu.be/dQw4w9WgXcQ?si=abc'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://m.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://www.youtube.com/@channel'), null);
  assert.equal(youtubeId('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(youtubeId('not a url'), null);
});

test('a Bilibili video is named by its BV id or av number, and a short link by where it leads', () => {
  assert.deepEqual(bilibiliVideo('https://www.bilibili.com/video/BV11kev6cEhk/?spm_id_from=333.1007'), { id: 'BV11kev6cEhk', short: false });
  assert.deepEqual(bilibiliVideo('https://m.bilibili.com/video/bv11kev6cEhk'), { id: 'BV11kev6cEhk', short: false });
  assert.deepEqual(bilibiliVideo('https://bilibili.com/video/AV170001'), { id: 'av170001', short: false });
  assert.deepEqual(bilibiliVideo('https://b23.tv/AbC123'), { id: null, short: true });
  assert.equal(bilibiliVideo('https://www.bilibili.com/'), null);
  assert.equal(bilibiliVideo('https://space.bilibili.com/12345'), null);
  assert.equal(bilibiliVideo('https://www.bilibili.com/video/notanid'), null);
  assert.equal(bilibiliVideo('javascript:alert(1)'), null);
  assert.deepEqual(videoLink('https://youtu.be/dQw4w9WgXcQ'), { kind: 'youtube', id: 'dQw4w9WgXcQ' });
  assert.deepEqual(videoLink('https://b23.tv/AbC123'), { kind: 'bilibili', id: null });
  assert.equal(videoLink('https://example.com/'), null);
});

test("a YouTube video's title and picture are the Cloudflare Worker's to read, and the page asks nothing of YouTube", async () => {
  const asked = [];
  const answer = { id: 'dQw4w9WgXcQ', title: 'Never Gonna', sha256: 'a'.repeat(64) };
  const preview = await videoPreview('https://youtu.be/dQw4w9WgXcQ', {
    ask: async (url) => { asked.push(url); return answer; },
    fetch: async () => { throw new Error('the page asked the network'); },
  });
  assert.deepEqual(preview, answer);
  assert.deepEqual(asked, ['https://youtu.be/dQw4w9WgXcQ']);
  await assert.rejects(videoPreview('https://youtu.be/dQw4w9WgXcQ', { ask: async () => { throw new Error('YouTube answered 404 for this video'); } }),
    /YouTube answered 404/);
});

test("the web makes a Bilibili card as its link: only the Mac can ask Bilibili", async () => {
  assert.equal(canPreview(videoLink('https://youtu.be/dQw4w9WgXcQ')), true);
  assert.equal(canPreview(videoLink('https://b23.tv/AbC123')), false);
  let asked = false;
  await assert.rejects(
    videoPreview('https://www.bilibili.com/video/BV11kev6cEhk', { fetch: async () => { asked = true; }, videoPage: async () => { asked = true; } }),
    /Only the Mac app/,
  );
  assert.equal(asked, false);
});
