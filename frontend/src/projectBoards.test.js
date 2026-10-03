import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// A project's Boards tab reads like its Papers tab: a row per board, known
// by its name and description, and the picked board's jacket beside the
// list. No picture of the canvas stands in for the board.
const page = readFileSync(new URL('./components/ProjectPage.jsx', import.meta.url), 'utf8');
const boards = page.slice(page.indexOf('function ProjectBoards('), page.indexOf('function NewBoard('));

test('boards are rows with a pane, as papers are', () => {
  assert.match(boards, /className=\{`project-row project-board\$\{selected \? ' is-selected' : ''\}`\}/);
  assert.match(boards, /className="project-papers-panel project-boards-panel"/);
  assert.doesNotMatch(page, /BoardMap|project-grid|boxes/);
});

test('a row says what the board is for, not what its newest card holds', () => {
  assert.match(boards, /b\.description && <p className="project-card-authors project-board-description">\{b\.description\}<\/p>/);
  assert.doesNotMatch(boards, /latest_card|project-card-added|firstName|when\(/);
});

test('moving between boards replaces the address, so Back leaves the tab', () => {
  assert.match(boards, /onOpenBoard\(uuid, board \? \{ replace: true \} : undefined\);/);
  assert.match(boards, /onLoaded=/);
});

test('the last row makes a board, named in place', () => {
  assert.match(page, /<NewBoard project=\{project\} act=\{act\} onMade=/);
  assert.match(page, /className="project-row project-board-new"/);
});
