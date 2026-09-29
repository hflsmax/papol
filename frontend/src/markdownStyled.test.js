// The Markdown box's styled copy of what is typed (shared/markdownStyled.js):
// every character stays, in order, and each mark wears its look.
import test from 'node:test';
import assert from 'node:assert/strict';

import { styledMarkdown } from '../../shared/markdownStyled.js';

const textOf = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

const samples = [
  'Try `x = 1` and **bold** now',
  '# A heading with *emphasis*\n> quoted _words_\n- item one\n1. item two',
  '```\nconst a = 1 < 2 && "b";\n```\nafter the fence',
  'a [link](https://papol.io) and ~~gone~~ and snake_case_name',
  '',
  '\n\n',
  '<script>alert(1)</script> & more',
];

test('the styled copy holds exactly the words typed', () => {
  for (const text of samples) assert.equal(textOf(styledMarkdown(text)), text);
});

test('each mark wears its look, with the marks kept faint', () => {
  const html = styledMarkdown('Try `x = 1` and **bold** and *it*');
  assert.match(html, /<span class="mdf-mark">`<\/span><span class="mdf-code">x = 1<\/span><span class="mdf-mark">`<\/span>/);
  assert.match(html, /<span class="mdf-b">bold<\/span>/);
  assert.match(html, /<span class="mdf-i">it<\/span>/);
});

test('lines take their block look', () => {
  assert.match(styledMarkdown('# Title'), /^<span class="mdf-mark"># <\/span><span class="mdf-h">Title<\/span>$/);
  assert.match(styledMarkdown('```\ncode\n```'), /<span class="mdf-code mdf-block">code<\/span>/);
  assert.match(styledMarkdown('- item'), /^<span class="mdf-mark">- <\/span>item$/);
});

test('underscores inside a word are part of it', () => {
  assert.doesNotMatch(styledMarkdown('snake_case_name'), /mdf-i/);
});

test('typed markup stays text', () => {
  assert.doesNotMatch(styledMarkdown('<b>x</b>'), /<b>/);
});
