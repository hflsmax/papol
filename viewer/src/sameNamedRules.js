// A name more than one rule goes by. Relax! (ICFP 25) defines (commute) for
// its choreographies and again for the prophecy relation, and the analyzer
// can only guess which one a mention means. The telescope at such a mention
// shows every rule by the name, in reading order, one under another, each
// tagged with its page; a press on one goes to it.

// A rule's name as a reader tells names apart: case, brackets and math
// letters aside ("(Commute)" is "commute").
export const ruleName = (label) => String(label ?? '').normalize('NFKC').toLowerCase().replace(/^[[(\s]+|[\])\s]+$/g, '');

// Every rule float by each name, in reading order, where more than one goes by it.
export function sharedNames(floats) {
  const byName = new Map();
  for (const float of floats) {
    if (float.kind !== 'rule') continue;
    const name = ruleName(float.label);
    byName.set(name, [...(byName.get(name) ?? []), float]);
  }
  const shared = new Map();
  for (const [name, named] of byName) {
    if (named.length > 1) shared.set(name, [...named].sort((a, b) => a.page - b.page || a.y - b.y));
  }
  return shared;
}
