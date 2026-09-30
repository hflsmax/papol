// A telescope: where a clip of a named rule lands when the reader asks for it at a
// mention (Cmd-click): under the line the name is on, its left edge at the
// name's, at the size the rule is printed — so it reads as the page does —
// and above the line where the page ends too soon under it. Fractions of
// the mention's page, as a clip's frame is kept; the rule's box is
// fractions of its own page, whose size may differ.

const GAP = 0.006;
const EDGE = 0.02;

export function telescopeFrame(mention, rule, sizes = {}) {
  const across = sizes.rule?.width && sizes.mention?.width ? sizes.rule.width / sizes.mention.width : 1;
  const down = sizes.rule?.height && sizes.mention?.height ? sizes.rule.height / sizes.mention.height : 1;
  const w = Math.min(1 - 2 * EDGE, rule.w * across);
  const h = rule.h * down;
  const x = Math.max(EDGE, Math.min(mention.x, 1 - EDGE - w));
  let y = mention.y + mention.h + GAP;
  if (y + h > 1 - EDGE / 2) y = mention.y - GAP - h;
  return { x, y: Math.max(EDGE / 2, y), w, h };
}
