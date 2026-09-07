import test from 'node:test';
import assert from 'node:assert/strict';
import { resizeClipFrame } from './clipResize.js';

test('clip resizing preserves its original visible aspect ratio', () => {
  const frame = { x: 0.1, y: 0.2, w: 0.3, h: 0.2 };
  const rendered = { width: 360, height: 160 };
  const resized = resizeClipFrame(
    frame,
    rendered,
    { x: 120, y: 40 },
    2.25,
    { width: 1200, height: 800 },
  );

  const width = resized.w * 1200;
  const height = resized.h * 800;
  assert.ok(Math.abs(width / height - rendered.width / rendered.height) < 1e-12);
});

test('vertical-only resizing also scales both dimensions', () => {
  const frame = { x: 0, y: 0, w: 0.25, h: 0.25 };
  const resized = resizeClipFrame(
    frame,
    { width: 250, height: 150 },
    { x: 0, y: 100 },
    5 / 3,
    { width: 1000, height: 600 },
  );

  assert.equal(resized.w / frame.w, resized.h / frame.h);
  assert.ok(resized.w > frame.w);
});

test('resizing repairs a previously distorted clip', () => {
  const resized = resizeClipFrame(
    { x: 0, y: 0, w: 0.3, h: 0.3 },
    { width: 300, height: 180 },
    { x: 1, y: 1 },
    2,
    { width: 1000, height: 600 },
  );

  assert.ok(Math.abs((resized.w * 1000) / (resized.h * 600) - 2) < 1e-12);
});
