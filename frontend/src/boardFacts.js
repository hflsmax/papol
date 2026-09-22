// The one muted line under a board's name: only the parts that apply, in
// the order a reader asks about a board — whose it is, how much is on it,
// where it came from, and how old it is.
import { boardSourcePapers } from '../../shared/boardPapers.js';
import { browserDate, lastEdited } from '../../shared/lastEdited.js';

const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// A day, with the year only when it is not this one.
export function dayOf(value) {
  const when = browserDate(value);
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: when.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(when);
}

export function boardFacts(board) {
  const facts = [];
  // The owner is named only to someone else: on your own board it is you.
  if (!board.can_edit && board.owner) facts.push({ key: 'owner', owner: board.owner });
  const cards = board.item_count ?? board.items?.length ?? 0;
  facts.push({ key: 'cards', text: count(cards, 'card') });
  const groups = board.groups?.length || 0;
  if (groups) facts.push({ key: 'groups', text: count(groups, 'group') });
  const papers = boardSourcePapers(board).length;
  if (papers) facts.push({ key: 'papers', text: `from ${count(papers, 'paper')}` });
  if (board.created_at) {
    facts.push({ key: 'created', text: `Created ${dayOf(board.created_at)}`, dateTime: board.created_at });
  }
  if (board.updated_at) {
    facts.push({ key: 'edited', text: `Edited ${lastEdited(board.updated_at)}`, dateTime: board.updated_at });
  }
  return facts;
}
