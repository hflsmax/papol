import test from 'node:test';
import assert from 'node:assert/strict';

const stored = new Map();
const listeners = {};
global.window = {
  location: new URL('https://papol.io/nook'),
  history: { pushState(_s, _t, url) { global.window.location = new URL(url, 'https://papol.io'); }, replaceState() {} },
  sessionStorage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) },
  innerWidth: 1440,
  innerHeight: 900,
  devicePixelRatio: 2,
  addEventListener: (name, listener) => { listeners[name] = listener; },
};
global.document = {
  title: 'Papol',
  addEventListener: (name, listener) => { listeners[`document:${name}`] = listener; },
};
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', language: 'en-US', onLine: true },
  configurable: true,
});

const { startFeedbackTrail, feedbackContext, describeClick, browserAndSystem } = await import('../../shared/feedbackTrail.js');

// An element as far as the trail looks at one.
function element(tag, { attributes = {}, text = '', className = '', matches = [], href } = {}) {
  const node = {
    tagName: tag.toUpperCase(),
    className,
    textContent: text,
    href,
    getAttribute: (name) => attributes[name] ?? null,
    matches: (selector) => matches.some((m) => selector.includes(m)),
    closest: (selector) => (selector === '[class]' ? (className ? node : null) : (node.control ? node : null)),
  };
  return node;
}

test('the trail keeps pages opened and controls pressed, never what anyone wrote', () => {
  startFeedbackTrail('nook');
  window.history.pushState(null, '', '/project/p1');
  const button = Object.assign(element('button', { text: '  Add to\n project ', matches: ['button'] }), { control: true });
  listeners['document:click']({ target: button });
  const card = element('div', { text: 'My private idea about effects', className: 'board-card raised' });
  listeners['document:click']({ target: card });
  const context = feedbackContext({ project: 'Effects' });

  assert.deepEqual(context.trail.map(({ kind, what }) => [kind, what]), [
    ['open', '/nook'],
    ['open', '/project/p1'],
    ['click', 'button "Add to project"'],
    ['click', 'div.board-card'],
  ]);
  assert.equal(JSON.stringify(context).includes('private idea'), false);
  assert.equal(context.app, 'nook');
  assert.equal(context.runtime, 'web');
  assert.equal(context.page, '/project/p1');
  assert.equal(context.project, 'Effects');
  assert.equal(context.title, null);
  assert.equal(context.viewport, '1440×900 at 2x');
  assert.equal(context.browser, 'Chrome 131');
  assert.equal(context.system, 'macOS');
});

test('a field is named by its label, never by its value', () => {
  const field = Object.assign(element('textarea', { attributes: { 'aria-label': 'Post' } }), { control: true, value: 'secret words' });
  assert.equal(describeClick(field), 'field "Post"');
  const link = Object.assign(element('a', { text: 'Some paper', href: 'https://papol.io/paper/abc?x=1' }), { control: true });
  assert.equal(describeClick(link), 'link /paper/abc');
  const away = Object.assign(element('a', { href: 'https://arxiv.org/abs/1' }), { control: true });
  assert.equal(describeClick(away), 'link arxiv.org');
});

test('browsers and systems are named from the user agent', () => {
  assert.deepEqual(
    browserAndSystem('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'),
    { browser: 'Safari 17.5', system: 'iOS' },
  );
  assert.deepEqual(
    browserAndSystem('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0'),
    { browser: 'Firefox 130', system: 'Windows' },
  );
});
