import assert from 'node:assert/strict';
import { Browser } from '../../scripts/share-e2e/cdp.mjs';
import { folderServer, newDigest } from './fixtures/folderPage.mjs';

// A folder an agent gathered, brought in through the real FolderImport
// (USER_STORIES.md §2c); the page and its pretend server are
// fixtures/folderPage.mjs.
const server = await folderServer();
const browser = new Browser();
try {
  await server.listen();
  await browser.start();
  const port = server.httpServer.address().port;
  await browser.navigate(`http://127.0.0.1:${port}/__folder_test`);
  await browser.waitFor('document.querySelectorAll(".folder-row").length === 4', { what: 'the folder\'s rows' });

  // The manifest's works in its order, then the folder's other PDFs; the
  // PDF the nook holds is found by its bytes and never sent.
  await browser.waitFor("document.body.innerText.includes('Already in your nook')", { what: 'the held PDF to be recognised' });
  const rows = () => browser.evaluate(`return [...document.querySelectorAll('.folder-row')].map((row) => ({
    title: row.querySelector('.folder-row-title').value ?? row.querySelector('.folder-row-title').textContent,
    status: row.querySelector('.folder-row-status').textContent,
    checked: row.querySelector('input[type=checkbox]').checked,
  }));`);
  let listed = await rows();
  assert.deepEqual(listed.map((row) => row.status.replace('…', '')).slice(1), ['Not in the folder', 'No PDF: find it yourself', 'Already in your nook']);
  assert.deepEqual(listed.map((row) => row.checked), [true, false, false, false]);
  assert.equal(listed[0].title, 'Manifest title', 'the manifest\'s title stands in until the PDF is read');
  assert.match(await browser.text(), /Where transformers start\./);
  const sent = await browser.evaluate('return window.seen.filter((step) => step.step === "address").map((step) => step.sha256);');
  assert.deepEqual(sent, [newDigest], 'only the new PDF went up');

  // The reading comes in and takes the title's place.
  await browser.evaluate('window.readingDone = true; return true;');
  await browser.waitFor('document.querySelector(".folder-row-title").value === "Attention Is All You Need"', { what: 'the reading to fill the title' });

  // The user files the batch: a new private shelf named after the folder,
  // and one of their tags.
  const shelfOptions = await browser.evaluate('return [...document.querySelectorAll("#folder-shelf option")].map((o) => o.textContent);');
  assert.deepEqual(shelfOptions, ['Reading · Public', 'New private shelf…']);
  await browser.evaluate(`
    const select = document.querySelector('#folder-shelf');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'new');
    select.dispatchEvent(new Event('change', {bubbles: true}));
    return true;`);
  await browser.waitFor('document.querySelector("#folder-new-shelf")');
  assert.equal(await browser.evaluate('return document.querySelector("#folder-new-shelf").value;'), 'Transformers review');
  await browser.evaluate('document.querySelector("#folder-tags").focus(); return true;');
  await browser.waitFor('document.querySelector(".tag-dropdown button")');
  await browser.evaluate('document.querySelector(".tag-dropdown button").click(); return true;');
  await browser.waitFor("[...document.querySelectorAll('.tag-chip.selected')].some((chip) => chip.textContent.includes('thesis'))");

  await browser.waitFor('document.querySelector(".form-actions button.primary").textContent === "Add 1 paper"');
  await browser.evaluate('document.querySelector(".form-actions button.primary").click(); return true;');
  await browser.waitFor("document.body.innerText.includes('1 added, 1 already yours, 2 problems.')", { what: 'the summary' });

  const steps = await browser.evaluate('return window.seen;');
  assert.deepEqual(steps.find((step) => step.step === 'shelf').body.is_public, false);
  assert.equal(steps.find((step) => step.step === 'shelf').body.name, 'Transformers review');
  const saves = steps.filter((step) => step.step === 'save').map((step) => step.body);
  assert.equal(saves.length, 1);
  assert.equal(saves[0].file_path, `${newDigest}.pdf`);
  assert.equal(saves[0].title, 'Attention Is All You Need');
  assert.equal(saves[0].doi, '10.48550/arXiv.1706.03762');
  assert.equal(saves[0].shelf_uuid, 's-new');
  assert.deepEqual(saves[0].tag_uuids, ['t-1']);
  assert.equal(saves[0].initial_comment, 'Where transformers start.');
  assert.equal(await browser.evaluate('return window.added === true && !window.reported;'), true);
  listed = await rows();
  assert.equal(listed[0].status, 'Added');
  // PDFs dropped together come through the same review, unnamed, with
  // the agent's prompt offered, folded, since there is no manifest.
  await browser.navigate(`http://127.0.0.1:${port}/__folder_test?loose`);
  await browser.waitFor("document.body.innerText.includes('Already in your nook')", { what: 'the loose PDFs\' review' });
  assert.equal(await browser.evaluate('return document.querySelector(".folder-import h3").textContent;'), 'Papers to add');
  assert.equal(await browser.evaluate('return document.querySelectorAll(".folder-row").length;'), 2);
  assert.equal(await browser.evaluate('return !!document.querySelector("details.folder-agent-hint:not([open]) pre");'), true);
  console.log('folder: the manifest orders and annotates the review, the nook\'s own PDF is skipped unsent, missing and PDF-less works are listed, the user\'s shelf and tag file the batch, and loose PDFs come through the same review with the prompt offered');
} catch (error) {
  await browser.capture('folder-smoke');
  throw error;
} finally {
  await browser.stop();
  await server.close();
}
