import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MEMBER_INKS, inMemberInk, memberInk, projectParam, sortAnnotations, whoMarked, withProject,
} from './project.js';

const ana = { uuid: '11111111-1111-4111-8111-111111111111', display_name: 'Ana' };
const ben = { uuid: '22222222-2222-4222-8222-222222222222', display_name: 'Ben' };

describe('the project in the URL', () => {
  it('is read when it is a uuid and ignored otherwise', () => {
    assert.equal(projectParam(`?pdf=abc&project=${ana.uuid.toUpperCase()}`), ana.uuid);
    assert.equal(projectParam('?pdf=abc'), null);
    assert.equal(projectParam('?project=nope'), null);
  });

  it('is put on and taken off a URL without touching the rest', () => {
    const on = withProject('http://papol.test/viewer/?pdf=abc&page=3', ana.uuid);
    assert.equal(on, `http://papol.test/viewer/?pdf=abc&page=3&project=${ana.uuid}`);
    assert.equal(withProject(on, null), 'http://papol.test/viewer/?pdf=abc&page=3');
  });
});

describe('what the project reads', () => {
  const read = {
    me: ana.uuid,
    annotations: [
      { uuid: 'a', kind: 'ink', user: ana, body: { color: '#d92b1f' } },
      { uuid: 'b', kind: 'note', user: ben, body: {} },
    ],
  };

  it('is sorted into mine and theirs, theirs marked', () => {
    const { mine, theirs } = sortAnnotations(read);
    assert.deepEqual(mine.map((a) => a.uuid), ['a']);
    assert.deepEqual(theirs.map((a) => [a.uuid, a.theirs, a.user.display_name]), [['b', true, 'Ben']]);
  });

  it('draws ink in its author\'s colour, the reader\'s own included', () => {
    assert.equal(inMemberInk({ color: '#d92b1f', user: ben }, ana).color, memberInk(ben));
    assert.equal(inMemberInk({ color: '#d92b1f' }, ana).color, memberInk(ana));
    assert.ok(MEMBER_INKS.includes(memberInk(ana)));
    // A stroke nobody is known for keeps its own colour.
    assert.equal(inMemberInk({ color: '#d92b1f' }, null).color, '#d92b1f');
  });

  it('names who marked the paper, the reader first and each once', () => {
    const who = whoMarked([{ user: ben }, { user: ben }, { user: ana }], ana);
    assert.deepEqual(who.map((u) => u.display_name), ['Ana', 'Ben']);
  });
});
