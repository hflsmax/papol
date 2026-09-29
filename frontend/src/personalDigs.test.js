import test from 'node:test';
import assert from 'node:assert/strict';
import { installNativeHarness } from '../../shared/testing/nativeHarness.js';

const native = await installNativeHarness({ runtime: 'web', signedIn: true });
const { findDigs, personalDigsOn, startDig } = await import('../../shared/api/projects.js');

const PAPER = 'ab'.repeat(32);
const sent = () => native.requests().map(({ method, url }) => `${method} ${new URL(url).pathname}${new URL(url).search}`);

test('with no project, a dig is the reader\'s own, asked of /digs', async () => {
  native.route('GET /api/digs', { json: { mine: null, digs: [], project: null, subject: `paper:${PAPER}` } });
  native.route('POST /api/digs', ({ json }) => ({ json: { uuid: 'd1', project: null, posts: [], text: json().text } }));
  assert.equal((await findDigs(null, { paper: PAPER })).mine, null);
  const dig = await startDig(null, { paper: PAPER }, 'Why I keep it');
  assert.equal(dig.project, null);
  assert.deepEqual(sent().slice(-2), [`GET /api/digs?subject=paper%3A${PAPER}`, 'POST /api/digs']);
  assert.deepEqual(native.requests().at(-1).json(), { subject: `paper:${PAPER}`, text: 'Why I keep it' });
});

test('with a project, a dig is asked of the project', async () => {
  native.route('GET /api/projects/p1/digs', { json: { mine: null, digs: [] } });
  await findDigs('p1', { annotation: 'a1' });
  assert.equal(sent().at(-1), 'GET /api/projects/p1/digs?subject=annotation%3Aa1');
});

test('the reader\'s personal digs on a paper are asked by its name', async () => {
  native.route(`GET /api/papers/${PAPER.slice(0, 32)}/digs`, { json: { digs: {}, paper_digs: null } });
  assert.deepEqual(await personalDigsOn(PAPER), { digs: {}, paper_digs: null });
  assert.equal(sent().at(-1), `GET /api/papers/${PAPER.slice(0, 32)}/digs`);
});
