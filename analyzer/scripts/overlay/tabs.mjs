// Where the name tab of each box drawn over a page goes, so that no tab
// covers printed text, another box or another tab. A figure of rules set
// tight (Aiken's hierarchical data partitioning, Fig. 4: each rule's top
// a hair under the conclusion of the one above) leaves no room over a
// box, where a tab is looked for first; it then goes beside the box's top
// in the blank to its left or right, inside it on a corner the rule
// leaves blank (a rule's label stands at one end of its row, so the other
// end's corner is often free), and under it last. A tab over or under
// its box, hard by the next box, reads as that box's, so there it keeps a
// hair clear of it; one that fits nowhere goes where it covers the least.
//
// Everything is in one unit, top-left origin: boxes as [x0, y0, x1, y1],
// text as the rects of the page's words, a tab's size as [w, h].
//   placeTabs(boxes, text, page, sizes) -> [[x0, y0, x1, y1], …], one per box
// As a command, for the scripts that draw pages outside a browser:
//   node tabs.mjs < {"boxes": […], "text": […], "page": [w, h], "sizes": […]} > [[…], …]

const area = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

export function placeTabs(boxes, text, page, sizes) {
  const placed = [];
  const [W, H] = page;
  return boxes.map((b, i) => {
    const [w, h] = sizes[i];
    const [x0, y0, x1, y1] = b;
    const at = (x, y) => [x, y, x + w, y + h];
    // In the order a reader looks for a name: over the box at its left
    // end, then its right; beside its top, left then right; inside on a
    // corner its rule leaves blank; under it last, where it would read as
    // the title of the box below.
    // A tab beside the box or inside it is plainly its own; one over or
    // under it, between it and the next box, may read as the next one's.
    const choices = [
      [at(x0, y0 - h), 0, true], [at(x1 - w, y0 - h), 0, true], [at(x0 - w, y0), 0, false], [at(x1, y0), 0, false],
      [at(x1 - w, y0), 1, false], [at(x0, y0), 1, false],
      [at(x0, y1), 2, true], [at(x1 - w, y1), 2, true], [at(x0 - w, y1 - h), 2, false], [at(x1, y1 - h), 2, false],
      [at(x1 - w, y1 - h), 3, false], [at(x0, y1 - h), 3, false],
    ].filter(([t]) => t[0] >= 0 && t[1] >= 0 && t[2] <= W && t[3] <= H);
    // What a tab covers: printed text (its own rule's too) worst, then the
    // blank ground of another box; and one between its box and another,
    // hard by that one, reads as its. No tab covers another.
    const near = (t) => [t[0] - 2, t[1] - 2, t[2] + 2, t[3] + 2];
    const cost = (t, rank, between) => {
      let c = rank;
      const inked = text.reduce((n, r) => n + area(t, r), 0);
      if (inked > 0) c += 1e7 + inked;
      for (let j = 0; j < boxes.length; j += 1) {
        if (j === i) continue;
        if (area(t, boxes[j]) > 0) c += 1e6 + area(t, boxes[j]);
        else if (between && area(near(t), boxes[j]) > 0) c += 1e4;
      }
      for (const p of placed) if (area(near(t), p) > 0) c += 1e9;
      return c;
    };
    let best = choices[0]?.[0] ?? at(Math.max(0, x0), Math.max(0, y0));
    let bestCost = Infinity;
    for (const [t, rank, between] of choices) {
      const c = cost(t, rank, between);
      if (c < bestCost) { best = t; bestCost = c; }
    }
    placed.push(best);
    return best;
  });
}

if (typeof process !== "undefined" && process.argv?.[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const { boxes, text, page, sizes } = JSON.parse(input);
  process.stdout.write(JSON.stringify(placeTabs(boxes, text, page, sizes)));
}
