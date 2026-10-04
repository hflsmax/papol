import { test } from "node:test";
import assert from "node:assert/strict";
import { placeTabs } from "../scripts/overlay/tabs.mjs";

const area = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

// Rules stacked a hair apart, as Aiken's Fig. 4 sets them: no room over a
// box but the first, a blank margin to their left. No tab covers a word, a
// box or another tab.
test("tabs in a tight stack of rules cover no text and no box", () => {
  const boxes = [[60, 70, 250, 105], [60, 106, 250, 152], [60, 153, 250, 205]];
  const text = boxes.flatMap(([x0, y0, x1, y1]) => [[x0 + 4, y0 + 2, x1 - 4, y0 + 12], [x0 + 4, y1 - 12, x1 - 40, y1 - 2]]);
  text.push([60, 55, 250, 68]); // the paragraph's last line over the figure
  const tabs = placeTabs(boxes, text, [612, 792], boxes.map(() => [40, 9]));
  tabs.forEach((t, i) => {
    for (const r of text) assert.equal(area(t, r), 0, `tab ${i} covers text`);
    boxes.forEach((b, j) => { if (j !== i) assert.equal(area(t, b), 0, `tab ${i} covers box ${j}`); });
    tabs.forEach((o, j) => { if (j !== i) assert.equal(area(t, o), 0, `tab ${i} covers tab ${j}`); });
  });
  // Each touches its own box and stands nearer it than any other.
  const gap = (a, b) => Math.hypot(Math.max(0, a[0] - b[2], b[0] - a[2]), Math.max(0, a[1] - b[3], b[1] - a[3]));
  tabs.forEach((t, i) => {
    assert.equal(gap(t, boxes[i]), 0, `tab ${i} off its box`);
    boxes.forEach((b, j) => { if (j !== i) assert.ok(gap(t, b) > 0, `tab ${i} touches box ${j}`); });
  });
});

test("a tab with room over its box sits there, at the left end", () => {
  const [t] = placeTabs([[100, 200, 300, 240]], [[104, 204, 290, 214]], [612, 792], [[50, 9]]);
  assert.deepEqual(t, [100, 191, 150, 200]);
});
