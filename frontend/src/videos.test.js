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

// YouTube as the page sees it: the oEmbed answer, then the thumbnail.
function youtube({ thumbnail = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', status = 200 } = {}) {
  const asked = [];
  const fetch = async (url, options) => {
    asked.push([String(url), options]);
    if (String(url).startsWith('https://www.youtube.com/oembed')) {
      return new Response(JSON.stringify({ title: '  Never Gonna  ', thumbnail_url: thumbnail }), { status });
    }
    return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
  };
  return { fetch, asked };
}

test("a YouTube video's title and thumbnail come from YouTube, as the page fetches them", async () => {
  const { fetch, asked } = youtube();
  const preview = await videoPreview('https://youtu.be/dQw4w9WgXcQ', { fetch });
  assert.equal(preview.id, 'dQw4w9WgXcQ');
  assert.equal(preview.title, 'Never Gonna');
  assert.equal(preview.image.type, 'image/jpeg');
  assert.equal(preview.image.size, 3);
  assert.match(asked[0][0], /oembed\?url=https%3A%2F%2Fwww\.youtube\.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&format=json$/);
  assert.equal(asked[1][0], 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  assert.equal(asked[1][1].referrerPolicy, 'no-referrer');
});

test('a thumbnail from anywhere but YouTube, or a refusal, is no preview', async () => {
  await assert.rejects(videoPreview('https://youtu.be/dQw4w9WgXcQ', youtube({ thumbnail: 'https://evil.example/x.jpg' })), /no thumbnail/);
  await assert.rejects(videoPreview('https://youtu.be/dQw4w9WgXcQ', youtube({ status: 404 })), /YouTube answered 404/);
});

test("the web makes a Bilibili card as its link: only the Mac can ask Bilibili", async () => {
  assert.equal(canPreview(videoLink('https://youtu.be/dQw4w9WgXcQ')), true);
  assert.equal(canPreview(videoLink('https://b23.tv/AbC123')), false);
  let asked = false;
  await assert.rejects(
    videoPreview('https://www.bilibili.com/video/BV11kev6cEhk', { fetch: async () => { asked = true; }, pageFetch: async () => { asked = true; } }),
    /Only the Mac app/,
  );
  assert.equal(asked, false);
});
