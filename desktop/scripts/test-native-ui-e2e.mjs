// Sharing on the desktop, driven through the interface a reader actually uses.
//
//     ./deploy.sh macos dev --backend http://127.0.0.1:8010   # in one terminal
//     node desktop/scripts/test-native-ui-e2e.mjs
//
// The browser harness (scripts/share-e2e) drives the same feature through
// Chrome, where the paper always comes from the service. The desktop is the
// surface that reads its paper from the local replica instead, and that
// difference is what this watches: a link handed out lives only on the
// service, so a paper read locally has to go and ask whether one is out. When
// it stopped asking, every shared paper here read as unshared — no way to see
// a link, no way to stop one — and nothing in either suite noticed.
//
// It drives the development build only, signs nothing in, and puts the paper
// back as it found it.
//
// Names are matched exactly. The one time this suite asked for a name
// "containing" Share, it found a reader called A. Sharer and every check
// after it failed on the wrong element.

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = join(dirname(fileURLToPath(import.meta.url)), 'papol-ui.swift');

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  [${ok ? 'ok  ' : 'FAIL'}] ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (!ok) failures += 1;
};

// Every command reports absence in its exit status, so a missing window can
// never read as an assertion that passed.
function ui(args, { tolerate = false } = {}) {
  try {
    return { ok: true, out: execFileSync('xcrun', ['swift', UI, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim() };
  } catch (error) {
    const out = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    if (!tolerate) throw new Error(`${args.join(' ')}: ${out || error.message}`);
    return { ok: false, out, status: error.status };
  }
}

const present = (pid, name, ...flags) =>
  ui(['find', pid, name, ...flags], { tolerate: true }).ok;

const waitFor = (pid, name, { seconds = 20, flags = [] } = {}) =>
  ui(['wait', pid, name, '--timeout', String(seconds), ...flags], { tolerate: true });

const waitGone = (pid, name, { seconds = 20, flags = [] } = {}) =>
  ui(['gone', pid, name, '--timeout', String(seconds), ...flags], { tolerate: true });

const press = (pid, name, ...flags) => ui(['press', pid, name, ...flags], { tolerate: true });

// A link is closed through a question, not a button: "Stop sharing" asks
// whether to keep the link without the marks or close it altogether.
function closeAnyLink(pid) {
  if (!present(pid, 'Stop sharing')) return;
  press(pid, 'Stop sharing');
  waitFor(pid, 'Close the link');
  press(pid, 'Close the link');
  waitGone(pid, 'Stop sharing');
}

try {
  const found = ui(['dev'], { tolerate: true });
  if (!found.ok) {
    console.error(`\n${found.out}\n`);
    process.exit(2);
  }
  const pid = found.out;
  console.log(`\n== The development build, pid ${pid} ==`);

  const listing = ui(['dump', pid], { tolerate: true });
  check('its window is there and the page has named something', listing.ok,
    `${listing.out.split('\n')[0]} (exit ${listing.status})`);
  if (!listing.ok) throw new Error('nothing to drive');

  // The paper rows name an author and a year; the nook's own links do not.
  // Taking the whole name keeps the match exact.
  const paper = listing.out.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('AXLink:') && line.includes(' · '))
    .map((line) => line.slice('AXLink:'.length).trim())[0];
  check('the library is showing papers to open', Boolean(paper), 'no paper rows in the window');
  if (!paper) throw new Error('no paper to open');

  console.log(`\n== Opening "${paper}" ==`);
  check('the paper opens', press(pid, paper).ok);
  const share = waitFor(pid, 'Share', { flags: ['--pressable'] });
  check('its Share control is on the page', share.ok, share.out);
  // Not AXButton: aria-haspopup="menu" publishes as a pop-up button, and
  // looking for the wrong role here once cost an hour of hunting a bug that
  // was never there.
  check('published as an AXPopUpButton, as a menu button is',
    share.out.startsWith('AXPopUpButton'), share.out);

  closeAnyLink(pid);
  check('the paper starts with no link out', !present(pid, 'Stop sharing'));

  console.log('\n== Handing out a reading ==');
  press(pid, 'Share', '--pressable');
  check('the Share menu opens', waitFor(pid, 'This PDF').ok);
  // The marks are opt-in, and only a link carrying them is the reader's own
  // to be reported back — which is what this suite is here to watch.
  if (!present(pid, 'Create a link')) {
    press(pid, 'Include my notes, paint and clips', '--pressable');
  }
  const offer = waitFor(pid, 'Create a link', { flags: ['--pressable'] });
  check('with the offer to make one carrying the marks', offer.ok, offer.out);
  press(pid, 'Create a link', '--pressable');
  const made = waitFor(pid, 'Stop sharing', { seconds: 30, flags: ['--pressable'] });
  check('the link is made and the paper says so', made.ok, made.out);

  // The point of the whole suite. Up to here the page could be showing a
  // link it remembers making; coming back to the paper makes it read the
  // paper afresh, and a desktop paper comes from the replica, which holds
  // no links at all.
  console.log('\n== Coming back to the paper afterwards ==');
  press(pid, 'All papers', '--contains', '--pressable');
  check('the library comes back', waitFor(pid, paper).ok);
  press(pid, paper);
  check('the paper opens again', waitFor(pid, 'Share', { flags: ['--pressable'] }).ok);
  const remembered = waitFor(pid, 'Stop sharing', { seconds: 25, flags: ['--pressable'] });
  check('the paper still knows a link of theirs is out', remembered.ok,
    'a paper read from the replica never asked the service for its link');
  check('and says so where a reader would see it', present(pid, 'READING SHARED'));

  console.log('\n== Taking it back ==');
  closeAnyLink(pid);
  check('the link is closed and the paper is plain again', !present(pid, 'Stop sharing'));
} catch (error) {
  console.log('\nHARNESS ERROR:', error.message);
  failures += 1;
}

console.log(`\n${'='.repeat(56)}`);
console.log(failures ? `${failures} FAILED` : 'All native interface checks passed.');
process.exit(failures ? 1 : 0);
