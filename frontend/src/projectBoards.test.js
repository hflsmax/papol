import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// A project's Boards tab reads like its Papers tab: a row per board, known
// by its name and what its newest card says, and the picked board's jacket
// beside the list. No picture of the canvas stands in for the board.
const page = readFileSync(new URL('./components/ProjectPage.jsx', import.meta.url), 'utf8');
const boards = page.slice(page.indexOf('function ProjectBoards('), page.indexOf('function NewBoard('));

test('boards are rows with a pane, as papers are', () => {
  assert.match(boards, /className=\{`project-row project-board\$\{selected \? ' is-selected' : ''\}`\}/);
  assert.match(boards, /className="project-papers-panel project-boards-panel"/);
  assert.doesNotMatch(page, /BoardMap|project-grid|boxes/);
});

test('a row says what its newest card holds and who put it there', () => {
  assert.match(boards, /latest\?\.text && <p className="project-card-authors project-board-latest">\{latest\.text\}<\/p>/);
  assert.match(boards, /\{isMe\(who\) \? 'You' : firstName\(who\)\} \{latest \? 'added' : 'made it'\}/);
});

test('moving between boards replaces the address, so Back leaves the tab', () => {
  assert.match(boards, /const pick = \(uuid\) => onOpenBoard\(uuid, board \? \{ replace: true \} : undefined\);/);
});

test('the last row makes a board, named in place', () => {
  assert.match(page, /<NewBoard project=\{project\} act=\{act\} onMade=/);
  assert.match(page, /className="project-row project-board-new"/);
});
