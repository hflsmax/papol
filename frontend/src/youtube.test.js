import test from 'node:test';
import assert from 'node:assert/strict';
import { youtubeId, youtubePreview } from '../../shared/youtube.js';

test('a video is named by the id its link carries, however the link is written', () => {
  assert.equal(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://youtu.be/dQw4w9WgXcQ?si=abc'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://m.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://www.youtube.com/@channel'), null);
  assert.equal(youtubeId('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(youtubeId('not a url'), null);
});

// YouTube as the page sees it: the oEmbed answer, then the thumbnail.
function youtube({ thumbnail = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', status = 200 } = {}) {
  const asked = [];
  const fetch = async (url) => {
    asked.push(String(url));
    if (String(url).startsWith('https://www.youtube.com/oembed')) {
      return new Response(JSON.stringify({ title: '  Never Gonna  ', thumbnail_url: thumbnail }), { status });
    }
    return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
  };
  return { fetch, asked };
}

test("a video's title and thumbnail come from YouTube, as the page fetches them", async () => {
  const { fetch, asked } = youtube();
  const preview = await youtubePreview('dQw4w9WgXcQ', { fetch });
  assert.equal(preview.title, 'Never Gonna');
  assert.equal(preview.image.type, 'image/jpeg');
  assert.equal(preview.image.size, 3);
  assert.match(asked[0], /oembed\?url=https%3A%2F%2Fwww\.youtube\.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&format=json$/);
  assert.equal(asked[1], 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
});

test('a thumbnail from anywhere but YouTube, or a refusal, is no preview', async () => {
  await assert.rejects(youtubePreview('dQw4w9WgXcQ', youtube({ thumbnail: 'https://evil.example/x.jpg' })), /no thumbnail/);
  await assert.rejects(youtubePreview('dQw4w9WgXcQ', youtube({ status: 404 })), /YouTube answered 404/);
});
